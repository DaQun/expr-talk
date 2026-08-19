import assert from "node:assert/strict";
import test from "node:test";
import {
  alignFeynmanReport,
  alignFreeReport,
  parseStructuredReport,
} from "./finalReport";
import { freeTopicRequiresThesis } from "@showtalk/shared";
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
  assert.equal(report.dimensionReviews?.content?.source, "llm");
  assert.equal(report.dimensionReviews?.voice, undefined);
  assert.equal(report.dimensionReviews?.expression, undefined);
  assert.deepEqual(report.taskChecks, [
    { label: "明确观点", status: "met", evidence: "开头给出了立场。" },
  ]);
});

test("normalizes free-form issue codes and ignores model-declared score sources", () => {
  const report = parseStructuredReport(JSON.stringify({
    ...baseReport,
    dimensionReviews: {
      logic: {
        score: 65,
        verdict: "论据不足。",
        evidence: "只有结论。",
        source: "objective",
      },
    },
    topIssues: [
      {
        code: "MISSING_ARGUMENTS",
        title: "缺乏论据支撑",
        severity: "high",
      },
    ],
    nextPractice: {
      ...baseReport.nextPractice,
      targetIssue: "缺乏论据支撑",
    },
  }));

  assert.equal(report.topIssues[0]?.code, "unsupported_claim");
  assert.equal(report.nextPractice.targetIssue, "unsupported_claim");
  assert.equal(report.dimensionReviews?.logic?.source, "llm");
});

test("blank free topics do not require a thesis", () => {
  assert.equal(
    freeTopicRequiresThesis("（自由发挥）请输入或口述你想练的主题，说完即可。建议 60–90 秒。"),
    false,
  );
  assert.equal(freeTopicRequiresThesis(""), false);
  assert.equal(
    freeTopicRequiresThesis(
      "【自由发挥】选一个你真正相信的观点，60–90 秒讲清楚：观点、理由、一个例子。",
    ),
    true,
  );
});

test("aligns blank free reports away from thesis-essay standards", () => {
  const report = parseStructuredReport(JSON.stringify({
    ...baseReport,
    scores: {
      logic: 50,
      structure: 55,
      hook: 45,
      persuasiveness: 50,
      memorability: 55,
      actionability: 68,
    },
    taskChecks: [
      { label: "是否在开头明确告知讲述主题", status: "partial" },
      { label: "是否按清晰的时间或逻辑顺序组织内容", status: "partial" },
      { label: "是否在结尾对整体讲述进行总结或收束", status: "missed" },
    ],
    topIssues: [
      {
        code: "missing_thesis",
        title: "缺少核心观点或结论性主张",
        severity: "high",
      },
      {
        code: "unclear_structure",
        title: "结构松散，层次不分明",
        severity: "high",
      },
      {
        code: "too_many_fillers",
        title: "填充词使用频率过高",
        severity: "medium",
      },
    ],
    nextPractice: {
      targetIssue: "missing_thesis",
      instruction: "请用1分钟时间，以‘今天求职上我最有感触的一点是…’开头。",
      retryPrompt: "开头直接给出核心判断，中间用2个具体事件支撑，结尾用一句话总结。",
      successCriteria: ["开头10秒内明确给出核心观点", "结尾有明确的总结"],
    },
  }));

  const aligned = alignFreeReport(report, {
    mode: "free",
    topic: "（自由发挥）请输入或口述你想练的主题，说完即可。建议 60–90 秒。",
  });

  assert.deepEqual(
    aligned.topIssues.map((issue) => issue.code),
    ["unclear_structure", "too_many_fillers"],
  );
  assert.equal(aligned.scores.hook, undefined);
  assert.equal(aligned.scores.persuasiveness, undefined);
  assert.equal(aligned.scores.logic, 50);
  assert.deepEqual(
    aligned.taskChecks?.map((check) => check.label),
    ["是否按清晰的时间或逻辑顺序组织内容"],
  );
  assert.equal(aligned.nextPractice.targetIssue, "unclear_structure");
  assert.match(aligned.nextPractice.instruction, /自由发挥/);
  assert.doesNotMatch(aligned.nextPractice.instruction, /核心判断|结论先行/);
});

test("keeps thesis requirements on free opinion topics and other modes", () => {
  const report = parseStructuredReport(JSON.stringify({
    ...baseReport,
    scores: { logic: 50, hook: 40 },
    topIssues: [
      {
        code: "missing_thesis",
        title: "缺少核心观点",
        severity: "high",
      },
    ],
    nextPractice: {
      targetIssue: "missing_thesis",
      instruction: "先说结论。",
      retryPrompt: "重新表达。",
      successCriteria: ["前 15 秒出现结论"],
    },
  }));

  const opinion = alignFreeReport(report, {
    mode: "free",
    topic: "【自由发挥】选一个你真正相信的观点，60–90 秒讲清楚：观点、理由、一个例子。",
  });
  assert.equal(opinion.topIssues[0]?.code, "missing_thesis");
  assert.equal(opinion.scores.hook, 40);

  const debate = alignFreeReport(report, {
    mode: "debate",
    topic: "远程办公应成默认",
  });
  assert.equal(debate.topIssues[0]?.code, "missing_thesis");
});

test("aligns Feynman review tasks to in-session checkpoints", () => {
  const report = parseStructuredReport(JSON.stringify({
    ...baseReport,
    dimensionReviews: {
      scenario_task: {
        score: 35,
        verdict: "未完成核心任务",
        evidence: "要求三大成因",
      },
    },
    taskChecks: [
      { label: "讲清常见成因（需求拉动）", status: "missed" },
    ],
  }));
  const aligned = alignFeynmanReport(report, {
    mode: "feynman",
    feynmanCheckpoints: [
      { id: "definition", status: "understood", evidence: "钱多物价涨" },
      { id: "mechanism", status: "understood", evidence: "供需失衡" },
      { id: "example", status: "understood", evidence: "冷饮变贵" },
      { id: "boundary", status: "in_progress", evidence: "还不清楚" },
    ],
  });
  assert.deepEqual(
    aligned.taskChecks?.map((check) => check.status),
    ["met", "met", "met", "partial"],
  );
  assert.equal(aligned.dimensionReviews?.scenario_task?.score, 85);
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

test("rejects a Feynman continuation without a learner question", () => {
  assert.throws(
    () => parseFeynmanTurnResult('{"understood":false,"focus":"机制"}'),
    /没有提出问题/,
  );
});

test("rejects an early understood while checkpoints remain uncovered", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"understood":true,"question":"","focus":"已理解定义和累积机制"}',
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
    // 模型声称理解但没有任何检查点被覆盖：强制回到追问，不能跳过缺口
    assert.deepEqual(result, {
      understood: false,
      question: "你能用最简单的话说一下它到底是什么吗？",
      focus: "核心定义",
      checkpoints: [
        { id: "definition", status: "not_started" },
        { id: "mechanism", status: "not_started" },
        { id: "example", status: "not_started" },
        { id: "boundary", status: "not_started" },
      ],
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forces a boundary follow-up when the model claims understanding too early", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '{"understood":true,"question":"","focus":"已理解定义、机制和例子","checkpoints":[{"id":"definition","status":"understood","evidence":"本金和利息一起生息"},{"id":"mechanism","status":"understood","evidence":"第二年本金变110元"},{"id":"example","status":"understood","evidence":"100元变110元再变121元"},{"id":"boundary","status":"not_started"}]}',
            },
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await generateFeynmanTurn(
      {
        kind: "feynman",
        phase: "cross_examination",
        currentRound: 2,
        turns: [
          {
            id: "t1",
            role: "opponent",
            round: 1,
            text: "复利是什么？",
            createdAt: new Date().toISOString(),
          },
          {
            id: "t2",
            role: "user",
            round: 1,
            text: "复利是本金和利息一起再生息。",
            createdAt: new Date().toISOString(),
          },
        ],
        feynman: {
          learnerRole: "child",
          difficulty: "standard",
          checkpoints: [
            { id: "definition", status: "understood", evidence: "本金和利息一起生息" },
            { id: "mechanism", status: "understood", evidence: "第二年本金变110元" },
            { id: "example", status: "understood", evidence: "100元变110元再变121元" },
            { id: "boundary", status: "not_started" },
          ],
        },
      },
      "复利",
      { providerId: "custom", baseUrl: "https://example.test/v1", apiKey: "test" },
    );
    // 边界与误解仍未讲清：即便模型说 understood，也必须追问边界
    assert.equal(result.understood, false);
    assert.equal(result.question, "什么情况下它不适用，或者容易和什么弄混？");
    assert.equal(result.focus, "边界与误解");
    assert.equal(result.checkpoints[3]?.status, "not_started");
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
