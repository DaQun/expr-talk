import { countLexiconHits } from "./count";

export function countHedges(text: string, lexicon: string[]): number {
  return countLexiconHits(text, lexicon).count;
}
