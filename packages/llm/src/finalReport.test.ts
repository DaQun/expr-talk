import assert from "node:assert/strict";
import test from "node:test";
import { parseStructuredReport } from "./finalReport";
import {
  chatCompletion,
  setOpenAICompatibleTransport,
} from "./openai_compatible";
import { parseDebateTurnResult } from "./debate";
import { parseFeynmanTurnResult } from "./feynman";

const baseReport = {
  schemaVersion: 4,
  summary: "自由表达：观点基本清楚。",
  scores: { logic: 72 },
  topIssues: [],
  sentenceFeedback: [],
  rewriteExamples: [],
  nextPractice: {
    targetIssue: "logic_gap",
    instruction: "补上因果关系。",
    retryPrompt: "重新表达。",
    successCriteria: ["因果关系明确"],
  },
};

test("parses dimension reviews and task checks defensively", () => {
  const report = parseStructuredReport(JSON.stringify({
    ...baseReport,
    dimensionReviews: {
      content_logic: {
        score: 108,
        verdict: "观点明确，论据较弱。",
        evidence: "提出了结论，但没有具体例子。",
        source: "mixed",
      },
      expression: { score: "80", verdict: "无效", evidence: "无效" },
      voice: {
        score: 90,
        verdict: "模型越权生成的语音结论",
        evidence: "没有声学证据",
        source: "llm",
      },
    },
    taskChecks: [
      { label: "明确观点", status: "met", evidence: "开头给出了立场。" },
      { label: "无效状态", status: "unknown" },
    ],
  }));

  assert.equal(report.dimensionReviews?.content?.score, 100);
  assert.equal(report.dimensionReviews?.logic?.score, 100);
  assert.equal(report.dimensionReviews?.content?.source, "mixed");
  assert.equal(report.dimensionReviews?.voice, undefined);
  assert.equal(report.dimensionReviews?.expression, undefined);
  assert.deepEqual(report.taskChecks, [
    { label: "明确观点", status: "met", evidence: "开头给出了立场。" },
  ]);
});

test("keeps version 2 reports compatible", () => {
  const report = parseStructuredReport(JSON.stringify({
    ...baseReport,
    schemaVersion: 2,
  }));

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.dimensionReviews, undefined);
  assert.equal(report.taskChecks, undefined);
});

test("extracts a report JSON object wrapped in model prose", () => {
  const report = parseStructuredReport(
    `以下是复盘结果：\n\n\`\`\`json\n${JSON.stringify({
      ...baseReport,
      summary: "费曼学习法：用 {定义} 和例子完成了初步解释。",
    })}\n\`\`\`\n\n请根据建议继续练习。`,
  );

  assert.equal(report.summary, "费曼学习法：用 {定义} 和例子完成了初步解释。");
  assert.equal(report.scores.logic, 72);
});

test("parses debate questions for user-controlled continuation", () => {
  const result = parseDebateTurnResult(
    '```json\n{"question":"你的因果证据是什么？","focus":"因果链"}\n```',
  );
  assert.deepEqual(result, {
    question: "你的因果证据是什么？",
    focus: "因果链",
  });
});

test("rejects an empty debate question", () => {
  assert.throws(
    () =>
      parseDebateTurnResult('{"question":""}'),
    /没有生成反方质询/,
  );
});

test("accepts a Feynman learner question or understanding result", () => {
  assert.deepEqual(
    parseFeynmanTurnResult(
      '{"understood":false,"question":"为什么这里会产生累积效果？","focus":"因果机制"}',
    ),
    {
      understood: false,
      question: "为什么这里会产生累积效果？",
      focus: "因果机制",
    },
  );
  assert.deepEqual(
    parseFeynmanTurnResult(
      '{"understood":true,"question":"不应保留","focus":"已理解定义和例子"}',
    ),
    {
      understood: true,
      question: "",
      focus: "已理解定义和例子",
    },
  );
});

test("rejects a Feynman continuation without a learner question", () => {
  assert.throws(
    () => parseFeynmanTurnResult('{"understood":false,"focus":"机制"}'),
    /没有提出问题/,
  );
});

test("uses an injected native transport instead of fetch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  setOpenAICompatibleTransport(async (request) => {
    assert.equal(request.url, "https://example.test/v1/chat/completions");
    assert.equal(request.apiKey, "test-key");
    assert.equal(request.body.model, "test-model");
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: "pong" } }],
      }),
    };
  });

  try {
    const content = await chatCompletion(
      {
        providerId: "custom",
        baseUrl: "https://example.test/v1/",
        apiKey: "test-key",
        model: "test-model",
      },
      [{ role: "user", content: "ping" }],
    );
    assert.equal(content, "pong");
  } finally {
    setOpenAICompatibleTransport(null);
    globalThis.fetch = originalFetch;
  }
});

test("joins SSE deltas split across network chunks", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"{\\"summary\\""}}]}\r',
    '\n\r\ndata: {"choices":[{"delta":{"content":":\\"完成\\"}"}}]}\r\n\r',
    "\ndata: [DONE]\r\n\r\n",
  ];
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );

  const progress: number[] = [];
  try {
    const content = await chatCompletion(
      {
        providerId: "custom",
        baseUrl: "https://example.test/v1",
        apiKey: "test",
      },
      [{ role: "user", content: "test" }],
      {
        stream: true,
        onProgress: ({ receivedChars }) => progress.push(receivedChars),
      },
    );
    assert.equal(content, '{"summary":"完成"}');
    assert.ok(progress.at(-1)! > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reads text arrays and alternate reasoning fields from SSE", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":[{"type":"text","text":"{\\"understood\\":false,"}]}}]}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"text":"\\"question\\":\\"什么是它？\\"}"}}]}\n\n',
            ),
          );
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );

  try {
    const content = await chatCompletion(
      { providerId: "custom", baseUrl: "https://example.test/v1", apiKey: "test" },
      [{ role: "user", content: "test" }],
      { stream: true },
    );
    assert.equal(content, '{"understood":false,"question":"什么是它？"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recovers a JSON body mislabeled as an SSE response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"understood":true,"question":""}' } }],
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );

  try {
    const content = await chatCompletion(
      { providerId: "custom", baseUrl: "https://example.test/v1", apiKey: "test" },
      [{ role: "user", content: "test" }],
      { stream: true },
    );
    assert.equal(content, '{"understood":true,"question":""}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("flushes the last SSE event without a terminal blank line", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      'data: {"choices":[{"delta":{"reasoning":"答案：{\\"understood\\":true}"}}]}\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );

  try {
    const content = await chatCompletion(
      { providerId: "custom", baseUrl: "https://example.test/v1", apiKey: "test" },
      [{ role: "user", content: "test" }],
      { stream: true },
    );
    assert.equal(content, '{"understood":true}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
