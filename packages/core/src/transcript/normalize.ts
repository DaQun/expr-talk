/** 基础文本清洗：去多余空白、统一标点周围空格 */
export function normalizeTranscript(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[，,]\s*/g, "，")
    .replace(/[。\.]\s*/g, "。")
    .replace(/[！!]\s*/g, "！")
    .replace(/[？?]\s*/g, "？")
    .trim();
}

/** 去除 ASR 常见伪影（重复标点、孤立语气词碎片可后续扩展） */
export function removeAsrArtifacts(text: string): string {
  return text
    .replace(/([，。！？、])\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const END_PUNCT = /[。！？!?…]$/;
const HAS_ANY_PUNCT = /[，。！？、,.!?;；：:]/;

/**
 * 流式 ASR 常无标点。对「端点 final 段」做轻量补全：
 * - 已有句末标点：原样
 * - 问句语气：补 ？
 * - 否则补 。
 * 不做完整标点恢复（那需要单独的 punctuation 模型）。
 */
export function formatFinalAsrSegment(raw: string): string {
  let text = removeAsrArtifacts(normalizeTranscript(raw));
  if (!text) return text;

  // 段内若完全无标点且较长，在常见连接处插顿号感的逗号（保守：只处理「然后/但是/所以」前）
  if (!HAS_ANY_PUNCT.test(text) && text.length >= 12) {
    text = text
      .replace(/(然后|但是|可是|所以|因为|如果|而且|另外)/g, "，$1")
      .replace(/^，/, "");
  }

  if (END_PUNCT.test(text)) return text;

  if (
    /^(吗|呢|吧|啊)$/.test(text.slice(-1)) ||
    /(吗|呢|么|吧)$/.test(text) ||
    /^(什么|怎么|为何|是否|能否|有没有)/.test(text)
  ) {
    return `${text}？`;
  }

  return `${text}。`;
}

/** 多段 final 拼成展示/分析用全文：段间换行 */
export function joinFinalSegments(
  segments: Array<{ text: string; isFinal?: boolean }>,
): string {
  return segments
    .filter((s) => (s.isFinal === undefined || s.isFinal) && s.text.trim())
    .map((s) => formatFinalAsrSegment(s.text))
    .join("\n");
}
