import type { TranscriptSegment, Utterance } from "@expr-talk/shared";
import { normalizeTranscript, removeAsrArtifacts } from "./normalize";

const SENTENCE_SPLIT = /(?<=[。！？!?；;])|\n+/;

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 将 final segments 合并后按标点切成分析用 Utterance */
export function segmentsToUtterances(
  sessionId: string,
  segments: TranscriptSegment[],
): Utterance[] {
  const finals = segments.filter((s) => s.isFinal && s.text.trim().length > 0);
  if (finals.length === 0) return [];

  const merged = normalizeTranscript(
    removeAsrArtifacts(finals.map((s) => s.text).join("\n")),
  );

  const parts = merged
    .split(SENTENCE_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);

  // 合并过短碎片（< 4 字）到下一句
  const sentences: string[] = [];
  let buffer = "";
  for (const part of parts) {
    buffer += part;
    if (buffer.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "").length >= 4) {
      sentences.push(buffer);
      buffer = "";
    }
  }
  if (buffer) {
    if (sentences.length > 0) {
      sentences[sentences.length - 1] += buffer;
    } else {
      sentences.push(buffer);
    }
  }

  const startMs = finals[0]?.startMs;
  const endMs = finals[finals.length - 1]?.endMs;
  const segmentIds = finals.map((s) => s.id);

  return sentences.map((text) => ({
    id: createId("utt"),
    sessionId,
    text,
    startMs,
    endMs,
    segmentIds: [...segmentIds],
  }));
}

export function utterancesToPlainText(utterances: Utterance[]): string {
  return utterances.map((u) => u.text).join("");
}
