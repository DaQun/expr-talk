/**
 * 清洗模型 reasoning 通道中泄漏的格式元指令与提示词回声，避免展示给用户。
 * 典型噪声：
 * - 思考收尾或中途的「输出JSON」「只输出合法 JSON」、即将开始的 ```json 围栏；
 * - 系统提示回声，如「（以下略）按系统要求…」「根据指令需要…」；
 * - 自言自语的任务确认，如「我需要扮演反方…」「先理解用户要求」。
 */
export function sanitizeDisplayReasoning(text: string): string {
  let s = text.replace(/\r\n/g, "\n").trim();
  if (!s) return "";

  // 末尾代码围栏（模型常在 reasoning 末尾预告 JSON 代码块）
  s = s.replace(/\n?```(?:json|JSON)?\s*$/i, "").trimEnd();

  // 行级过滤：任意位置的纯元指令行 / 空壳 schema 预告行都丢弃
  s = s
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return !isFormatMetaLine(trimmed);
    })
    .join("\n");

  // 换行变化后再剥一次末尾空行
  s = s.trimEnd();

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

  return collapseBlankLines(s.trim());
}

/** 过滤后可能留下成串空行，折叠为单个空行，保持展示节奏 */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

function isFormatMetaLine(line: string): boolean {
  // 「输出JSON」「现在开始输出合法 JSON 对象」等格式指令
  if (/^(?:好的?[，,。.]?\s*)?(?:接下来|下面|现在)?(?:开始|准备)?(?:只)?(?:直接)?输出\s*(?:一个)?(?:合法|有效|严格)?\s*JSON(?:\s*(?:对象|格式|响应|结果))?(?:\s*[。.!！]?)?$/iu.test(line)) {
    return true;
  }
  if (/^只输出\s*(?:合法|有效|严格)?\s*JSON/iu.test(line)) return true;
  if (/^不要\s*(?:输出\s*)?(?:Markdown|markdown|解释|前言)/iu.test(line)) return true;
  if (/^response\s*(?:must be|format|in)\s*json/i.test(line)) return true;

  // 系统提示 / 角色设定的回声
  if (/^(?:\(?\s*)?(?:根据|按照|遵循)\s*(?:系统|上述)?\s*(?:提示|指令|要求|规则)/u.test(line)) {
    return true;
  }
  if (/^我\s*(?:需要|将|要)\s*(?:扮演|以|作为)\s*(?:反方|教练|小白|AI)/u.test(line)) {
    return true;
  }
  if (/^(?:作为|我是)\s*(?:反方|教练|小白|AI\s*(?:助手|模型))/u.test(line)) return true;
  if (/^(?:先|首先)?\s*(?:理解|分析|确认)\s*(?:用户)?\s*(?:的)?\s*(?:要求|需求|指令|任务)[。.!！]?$/u.test(line)) {
    return true;
  }

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
