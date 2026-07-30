import { countLexiconHits } from "./count";

export function countFillers(text: string, lexicon: string[]): number {
  return countLexiconHits(text, lexicon).count;
}
