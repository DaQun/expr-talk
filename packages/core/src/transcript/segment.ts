import type { TranscriptSegment, Utterance } from "@expr-talk/shared";
import { normalizeTranscript, removeAsrArtifacts } from "./normalize";

const SENTENCE_SPLIT = /(?<=[。！？!?；;…])|\n+/;
const CLAUSE_SPLIT = /(?<=[，、,])\s*/;
const BREAK_BEFORE =
  /(然后|但是|可是|所以|因为|如果|而且|另外|不过|接下来|首先|其次|最后|一开始|后来|现在|第一|第二|第三)/g;
const BREAK_WORDS = new Set([
  "然后", "但是", "可是", "所以", "因为", "如果", "而且", "另外", "不过",
  "接下来", "首先", "其次", "最后", "一开始", "后来", "现在", "第一", "第二", "第三",
]);
const SUBJECT_RESET =
  /([^\u0000])(我|你|他|她|它|我们|你们|他们|这个|那个|这些)(觉得|认为|想|说|看|希望|建议|决定)/g;
const ACK_WORDS = new Set([
  "好的", "好", "行", "对", "嗯", "嗯嗯", "OK", "ok", "可以", "没问题", "是的", "对对对",
]);
const MIN_CHARS = 6;
const MAX_CHARS = 80;
const FORCE_CHARS = 60;

type Candidate = {
  text: string;
  segment: TranscriptSegment;
  startOffset: number;
  endOffset: number;
};

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function meaningfulLength(text: string): number {
  return text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "").length;
}

function forceSplit(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, FORCE_CHARS + 1);
    const boundary = Math.max(
      window.lastIndexOf("，"),
      window.lastIndexOf("、"),
      window.lastIndexOf(","),
      window.lastIndexOf(" "),
    );
    const cut = boundary >= MIN_CHARS ? boundary + 1 : FORCE_CHARS;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

function splitSegment(text: string): string[] {
  const punctuationCount = (text.match(/[，。！？、；：,.!?;:]/g) ?? []).length;
  const compactLength = text.replace(/\s/g, "").length || 1;
  const hasUsefulPunctuation = punctuationCount / compactLength >= 0.03;
  const initial = hasUsefulPunctuation
    ? text.split(SENTENCE_SPLIT)
    : text
        .replace(BREAK_BEFORE, "\u0000$1")
        .replace(SUBJECT_RESET, "$1\u0000$2$3")
        .split(/\u0000|\n+/);

  const parts = initial
    .flatMap((part) =>
      part.length > MAX_CHARS && /[，、,]/.test(part)
        ? part.split(CLAUSE_SPLIT)
        : [part],
    )
    .flatMap(forceSplit)
    .map((part) => part.trim())
    .filter(Boolean);
  const joined: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    let part = parts[index];
    while (BREAK_WORDS.has(part) && index + 1 < parts.length) {
      part += parts[index + 1];
      index += 1;
    }
    joined.push(part);
  }
  return joined;
}

function segmentCandidates(segment: TranscriptSegment): Candidate[] {
  const text = normalizeTranscript(removeAsrArtifacts(segment.text)).replace(
    /^[嗯啊呃额，、\s]+/,
    "",
  );
  if (!text) return [];
  let cursor = 0;
  return splitSegment(text).map((part) => {
    const startOffset = Math.max(cursor, text.indexOf(part, cursor));
    const endOffset = startOffset + part.length;
    cursor = endOffset;
    return { text: part, segment, startOffset, endOffset };
  });
}

function mergeFragments(candidates: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const item of candidates) {
    const normalizedAck = item.text.replace(/[，。！？!?；;\s]/g, "");
    if (!meaningfulLength(item.text) || ACK_WORDS.has(normalizedAck)) continue;
    if (out[out.length - 1]?.text === item.text) continue;
    if (meaningfulLength(item.text) < MIN_CHARS && out.length > 0) {
      const previous = out[out.length - 1];
      if (previous.segment.id === item.segment.id) {
        previous.text += item.text;
        previous.endOffset = item.endOffset;
        continue;
      }
    }
    out.push({ ...item });
  }
  if (out.length > 1 && meaningfulLength(out[0].text) < MIN_CHARS) {
    const first = out.shift()!;
    if (first.segment.id === out[0].segment.id) {
      out[0].text = first.text + out[0].text;
      out[0].startOffset = first.startOffset;
    } else {
      out.unshift(first);
    }
  }
  return out;
}

function timing(item: Candidate): Pick<Utterance, "startMs" | "endMs" | "timeSource"> {
  const { startMs, endMs } = item.segment;
  if (startMs == null || endMs == null || endMs <= startMs) {
    return { timeSource: "none" };
  }
  const segmentLength = Math.max(1, normalizeTranscript(item.segment.text).length);
  if (item.startOffset === 0 && item.endOffset >= segmentLength) {
    return { startMs, endMs, timeSource: "segment" };
  }
  const duration = endMs - startMs;
  return {
    startMs: Math.round(startMs + (item.startOffset / segmentLength) * duration),
    endMs: Math.round(startMs + (item.endOffset / segmentLength) * duration),
    timeSource: "estimated",
  };
}

/** 将 final segments 分段，并保留每个分析单元可追溯的原始 segment 与时间。 */
export function segmentsToUtterances(
  sessionId: string,
  segments: TranscriptSegment[],
): Utterance[] {
  const candidates = segments
    .filter((segment) => segment.isFinal && segment.text.trim())
    .flatMap(segmentCandidates);
  return mergeFragments(candidates).map((item) => ({
    id: createId("utt"),
    sessionId,
    text: item.text,
    segmentIds: [item.segment.id],
    ...timing(item),
  }));
}

export function utterancesToPlainText(utterances: Utterance[]): string {
  return utterances.map((u) => u.text).join("");
}
