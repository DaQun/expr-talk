/** 中文按字、英文按词计数；返回可用于语速的「字/词」总量 */
export function countChars(text: string): number {
  const cleaned = text.replace(/[\s\p{P}\p{S}]/gu, "");
  return cleaned.length;
}

export function countWordsMixed(text: string): number {
  const zh = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const en = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return zh + en;
}

export function countLexiconHits(
  text: string,
  lexicon: string[],
): { count: number; matches: Array<{ term: string; index: number }> } {
  const matches: Array<{ term: string; index: number }> = [];
  // 长词优先，避免「就是」被「就」误伤（当前词表无单字冲突，仍按长度排序）
  const sorted = [...lexicon].sort((a, b) => b.length - a.length);
  let remaining = text;
  let offset = 0;

  while (remaining.length > 0) {
    let hit: string | null = null;
    for (const term of sorted) {
      if (remaining.startsWith(term)) {
        hit = term;
        break;
      }
    }
    if (hit) {
      matches.push({ term: hit, index: offset });
      remaining = remaining.slice(hit.length);
      offset += hit.length;
    } else {
      remaining = remaining.slice(1);
      offset += 1;
    }
  }

  return { count: matches.length, matches };
}
