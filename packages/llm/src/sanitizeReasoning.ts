/**
 * 清洗模型 reasoning 通道中泄漏的格式元指令，避免展示给用户。
 * 典型噪声：思考收尾的「输出JSON」「只输出合法 JSON」或即将开始的 ```json 围栏。
 */
export function sanitizeDisplayReasoning(text: string): string {
  let s = text.replace(/\r\n/g, "\n").trim();
  if (!s) return "";

  // 末尾代码围栏（模型常在 reasoning 末尾预告 JSON 代码块）
  s = s.replace(/\n?```(?:json|JSON)?\s*$/i, "").trimEnd();

  // 先剥整行纯格式指令 / 空壳 schema 预告，避免吃掉上一句的句号
  const lines = s.split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1]?.trim() ?? "";
    if (!last) {
      lines.pop();
      continue;
    }
    if (isFormatMetaLine(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  s = lines.join("\n").trimEnd();

  // 再处理粘在同一行末尾的「输出 JSON」类收尾语
  // 例：「…设计一条质询。输出JSON」→ 保留「…设计一条质询。」
  // 注意：不要匹配句号本身，以免误删上句标点
  const trailingMeta =
    /\s*(?:好的?[，,。.]?\s*)?(?:接下来|下面|现在)?(?:开始|准备)?(?:只)?(?:直接)?输出\s*(?:一个)?(?:合法|有效|严格)?\s*JSON(?:\s*(?:对象|格式|响应|结果))?(?:\s*[。.!！]?)?\s*$/iu;
  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(trailingMeta, "").trimEnd();
    if (next === s) break;
    s = next;
  }

  return s.trim();
}

function isFormatMetaLine(line: string): boolean {
  if (/^(?:好的?[，,。.]?\s*)?(?:接下来|下面|现在)?(?:开始|准备)?(?:只)?(?:直接)?输出\s*(?:一个)?(?:合法|有效|严格)?\s*JSON(?:\s*(?:对象|格式|响应|结果))?(?:\s*[。.!！]?)?$/iu.test(line)) {
    return true;
  }
  if (/^只输出\s*(?:合法|有效|严格)?\s*JSON/iu.test(line)) return true;
  if (/^不要\s*(?:输出\s*)?(?:Markdown|markdown|解释|前言)/iu.test(line)) return true;
  if (/^response\s*(?:must be|format|in)\s*json/i.test(line)) return true;
  // 过短的 schema 预告行，如 {"question": string, "focus": string}
  if (
    line.length <= 96 &&
    /^\{[\s\S]*\}$/.test(line) &&
    /["']?(?:question|focus|understood)["']?\s*:/i.test(line) &&
    !/[一-龥]{4,}/.test(line)
  ) {
    return true;
  }
  return false;
}
