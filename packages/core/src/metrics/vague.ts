import { countLexiconHits } from "./count";

export function countVagueWords(text: string, lexicon: string[]): number {
  return countLexiconHits(text, lexicon).count;
}
