import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDisplayReasoning } from "./sanitizeReasoning";

test("strips trailing 输出JSON glued to a thought paragraph", () => {
  const input =
    "我们根据规则需要提出新质询。可以问：默认意味着优先选择吗？具体设计一条质询。输出JSON";
  const cleaned = sanitizeDisplayReasoning(input);
  assert.equal(
    cleaned,
    "我们根据规则需要提出新质询。可以问：默认意味着优先选择吗？具体设计一条质询。",
  );
  assert.doesNotMatch(cleaned, /输出\s*JSON/i);
});

test("strips trailing full-line format instructions and code fences", () => {
  const input = [
    "先攻击边界条件，再换因果链角度。",
    "现在开始输出合法 JSON 对象",
    "```json",
  ].join("\n");
  const cleaned = sanitizeDisplayReasoning(input);
  assert.equal(cleaned, "先攻击边界条件，再换因果链角度。");
});

test("strips short schema preview lines at the end", () => {
  const input = '思考完毕。\n{"question": string, "focus": string}';
  const cleaned = sanitizeDisplayReasoning(input);
  assert.equal(cleaned, "思考完毕。");
});

test("keeps substantive Chinese reasoning intact", () => {
  const input =
    "用户只说了有区别，但没有给出具体论据支撑远程办公成为默认。可以攻击证据不足。";
  assert.equal(sanitizeDisplayReasoning(input), input);
});

test("returns empty when reasoning is pure meta", () => {
  assert.equal(sanitizeDisplayReasoning("输出JSON"), "");
  assert.equal(sanitizeDisplayReasoning("只输出合法 JSON，不要 Markdown"), "");
});

test("drops meta-instruction lines in the middle of reasoning", () => {
  const input = [
    "用户观点缺少论据支撑。",
    "根据系统提示需要追问",
    "因此下一轮质询应聚焦因果链。",
  ].join("\n");
  const cleaned = sanitizeDisplayReasoning(input);
  assert.equal(cleaned, "用户观点缺少论据支撑。\n因此下一轮质询应聚焦因果链。");
});

test("drops role-echo and task-confirmation lines", () => {
  const input = [
    "我需要扮演反方提出质询",
    "用户的核心漏洞是没有区分『可选』和『默认』。",
    "先理解用户要求",
    "这一轮就从默认带来的成本切入。",
  ].join("\n");
  const cleaned = sanitizeDisplayReasoning(input);
  assert.equal(
    cleaned,
    "用户的核心漏洞是没有区分『可选』和『默认』。\n这一轮就从默认带来的成本切入。",
  );
});

test("collapses blank-line runs left by filtering", () => {
  const input = "第一句。\n\n\n只输出 JSON\n\n\n第二句。";
  assert.equal(sanitizeDisplayReasoning(input), "第一句。\n\n第二句。");
});
