import {
  METRICS_SCHEMA_VERSION,
  type SessionMetrics,
  type TranscriptSegment,
} from "@showtalk/shared";
import zhLexicon from "./lexicons/zh.json";
import { countChars, countWordsMixed } from "./count";
import { countFillers } from "./filler";
import { countHedges } from "./hedge";
import { countVagueWords } from "./vague";
import { computeRepetitionRate } from "./repetition";
import { computeWordsPerMinute } from "./pace";
import { countLongPauses } from "./pause";
import { computeDensityScore } from "./density";

export type LexiconPack = {
  fillers: string[];
  hedges: string[];
  vague: string[];
};

export const DEFAULT_ZH_LEXICON: LexiconPack = zhLexicon;

export type ComputeMetricsInput = {
  text: string;
  durationSec?: number;
  segments?: TranscriptSegment[];
  lexicon?: LexiconPack;
  /** 按 utterance 计的平均句长；不传则用整段近似 */
  utteranceCount?: number;
};

export function computeSessionMetrics(input: ComputeMetricsInput): SessionMetrics {
  const lexicon = input.lexicon ?? DEFAULT_ZH_LEXICON;
  const text = input.text;
  const totalChars = countChars(text);
  const totalWords = countWordsMixed(text);
  const fillerCount = countFillers(text, lexicon.fillers);
  const hedgeCount = countHedges(text, lexicon.hedges);
  const vagueWordCount = countVagueWords(text, lexicon.vague);
  const repetitionRate = computeRepetitionRate(text);
  const wordsPerMinute = computeWordsPerMinute(totalWords, input.durationSec);
  const longPauseCount = input.segments
    ? countLongPauses(input.segments)
    : undefined;

  const utteranceCount = Math.max(1, input.utteranceCount ?? 1);
  const avgSentenceLength =
    totalChars > 0 ? Math.round((totalChars / utteranceCount) * 10) / 10 : 0;

  const densityScore = computeDensityScore({
    totalChars,
    fillerCount,
    hedgeCount,
    vagueWordCount,
  });

  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    totalChars,
    totalWords,
    durationSec: input.durationSec,
    wordsPerMinute,
    fillerCount,
    hedgeCount,
    vagueWordCount,
    repetitionRate: Math.round(repetitionRate * 1000) / 1000,
    avgSentenceLength,
    longPauseCount,
    densityScore,
  };
}
