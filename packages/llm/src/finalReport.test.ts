import assert from "node:assert/strict";
import test from "node:test";
import { parseStructuredReport } from "./finalReport";
import {
  chatCompletion,
  setOpenAICompatibleTransport,
  setOpenAICompatibleStreamTransport,
} from "./openai_compatible";
import { parseDebateTurnResult } from "./debate";
import {
  generateFeynmanTurn,
  mergeFeynmanCheckpoints,
  parseFeynmanTurnResult,
  shouldCompleteFeynmanTurn,
} from "./feynman";

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
      '{"understood":false,"question":"为什么这里会产生累积效果？","focus":"因果机制","checkpoints":[{"id":"definition","status":"understood","evidence":"说明了本金和利息。"},{"id":"mechanism","status":"in_progress","evidence":"还需要解释累积原因。"},{"id":"example","status":"not_started"},{"id":"boundary","status":"not_started"}]}',
    ),
    {
      understood: false,
      question: "为什么这里会产生累积效果？",
      focus: "因果机制",
      checkpoints: [
        { id: "definition", status: "understood", evidence: "说明了本金和利息。" },
        { id: "mechanism", status: "in_progress", evidence: "还需要解释累积原因。" },
        { id: "example", status: "not_started", evidence: undefined },
        { id: "boundary", status: "not_started", evidence: undefined },
      ],
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
      checkpoints: [
        { id: "definition", status: "not_started" },
        { id: "mechanism", status: "not_started" },
        { id: "example", status: "not_started" },
        { id: "boundary", status: "not_started" },
      ],
    },
  );
});

test("normalizes incomplete and invalid Feynman checkpoints", () => {
  const result = parseFeynmanTurnResult(
    '{"understood":false,"question":"能举个例子吗？","checkpoints":[{"id":"example","status":"understood","evidence":"购物时比较两件商品。"},{"id":"unknown","status":"understood"},{"id":"boundary","status":"invalid"}]}',
  );

  assert.deepEqual(result.checkpoints, [
    { id: "definition", status: "not_started" },
    { id: "mechanism", status: "not_started" },
    { id: "example", status: "understood", evidence: "购物时比较两件商品。" },
    { id: "boundary", status: "not_started" },
  ]);
});

test("keeps Feynman checkpoints monotonic across rounds", () => {
  assert.deepEqual(
    mergeFeynmanCheckpoints(
      [
        { id: "definition", status: "understood", evidence: "用户已给出定义。" },
        { id: "mechanism", status: "in_progress", evidence: "机制尚待说明。" },
      ],
      [
        { id: "definition", status: "not_started" },
        { id: "mechanism", status: "understood", evidence: "用户解释了因果链。" },
        { id: "example", status: "in_progress" },
        { id: "boundary", status: "not_started" },
      ],
    ),
    [
      { id: "definition", status: "understood", evidence: "用户已给出定义。" },
      { id: "mechanism", status: "understood", evidence: "用户解释了因果链。" },
      { id: "example", status: "in_progress" },
      { id: "boundary", status: "not_started" },
    ],
  );
});

test("ends Feynman questioning after six rounds", () => {
  assert.equal(shouldCompleteFeynmanTurn(5, false), false);
  assert.equal(shouldCompleteFeynmanTurn(6, false), true);
  assert.equal(shouldCompleteFeynmanTurn(2, true), true);
});

test("rejects a Feynman continuation without a learner question", () => {
  assert.throws(
    () => parseFeynmanTurnResult('{"understood":false,"focus":"机制"}'),
    /没有提出问题/,
  );
});

test("retries for a follow-up when the first Feynman explanation completes early", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                calls === 1
                  ? '{"understood":true,"question":"","focus":"已理解"}'
                  : '{"understood":false,"question":"复利的累积是怎样发生的？","focus":"累积机制"}',
            },
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await generateFeynmanTurn(
      { kind: "feynman", phase: "opening", currentRound: 1, turns: [] },
      "复利",
      { providerId: "custom", baseUrl: "https://example.test/v1", apiKey: "test" },
    );
    assert.deepEqual(result, {
      understood: false,
      question: "复利的累积是怎样发生的？",
      focus: "累积机制",
      checkpoints: [
        { id: "definition", status: "not_started" },
        { id: "mechanism", status: "not_started" },
        { id: "example", status: "not_started" },
        { id: "boundary", status: "not_started" },
      ],
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to a default question when retry still confirms understanding", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          { message: { content: '{"understood":true,"question":"","focus":"已理解"}' } },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );

  try {
    const result = await generateFeynmanTurn(
      { kind: "feynman", phase: "opening", currentRound: 1, turns: [] },
      "复利",
      { providerId: "custom", baseUrl: "https://example.test/v1", apiKey: "test" },
    );
    assert.equal(result.understood, false);
    assert.ok(result.question.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("streams native transport chunks into cumulative progress", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  const progress: string[] = [];
  setOpenAICompatibleStreamTransport(async (request, onChunk) => {
    assert.equal(request.url, "https://example.test/v1/chat/completions");
    onChunk(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: '{"question":"' } }],
      })}\n\n`,
    );
    onChunk(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: '中文问题"}' } }],
      })}\n\ndata: [DONE]\n\n`,
    );
    return { status: 200, contentType: "text/event-stream", body: "" };
  });

  try {
    const content = await chatCompletion(
      { providerId: "custom", baseUrl: "https://example.test/v1", apiKey: "test" },
      [{ role: "user", content: "test" }],
      {
        stream: true,
        onProgress: ({ content: partial = "" }) => progress.push(partial),
      },
    );
    assert.equal(content, '{"question":"中文问题"}');
    assert.deepEqual(progress, ["", '{"question":"', '{"question":"中文问题"}']);
  } finally {
    setOpenAICompatibleStreamTransport(null);
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
