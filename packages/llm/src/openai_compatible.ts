import type { LLMConfig, TestResult } from "@expr-talk/shared";
import type { LLMStreamProgress } from "./types";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAICompatibleTransportRequest = {
  url: string;
  apiKey?: string;
  body: Record<string, unknown>;
  requestId?: string;
};

export type OpenAICompatibleTransportResponse = {
  status: number;
  contentType: string;
  body: string;
};

export type OpenAICompatibleTransport = (
  request: OpenAICompatibleTransportRequest,
) => Promise<OpenAICompatibleTransportResponse>;

export type OpenAICompatibleStreamTransport = (
  request: OpenAICompatibleTransportRequest,
  onChunk: (chunk: string) => void,
) => Promise<OpenAICompatibleTransportResponse>;

let nativeTransport: OpenAICompatibleTransport | null = null;
let nativeStreamTransport: OpenAICompatibleStreamTransport | null = null;

/** 桌面壳注入原生 HTTP transport；浏览器模式保留 fetch。 */
export function setOpenAICompatibleTransport(
  transport: OpenAICompatibleTransport | null,
): void {
  nativeTransport = transport;
}

/** 桌面端通过 Tauri event 转发 SSE 字节块；浏览器端直接使用 fetch ReadableStream。 */
export function setOpenAICompatibleStreamTransport(
  transport: OpenAICompatibleStreamTransport | null,
): void {
  nativeStreamTransport = transport;
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("LLM 请求已取消"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("LLM 请求已取消"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function isDevLoggingEnabled(): boolean {
  if (typeof location === "undefined") return false;
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function createRequestId(): string {
  return `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function resolveBaseUrl(config: LLMConfig): string {
  const base = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return base;
}

function resolveModel(config: LLMConfig): string {
  return config.model ?? "gpt-4o-mini";
}

type CompletionText = {
  content: string;
  reasoning: string;
};

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    })
    .join("");
}

function readCompletionText(payload: unknown): CompletionText {
  if (!payload || typeof payload !== "object") {
    return { content: "", reasoning: "" };
  }

  const root = payload as Record<string, unknown>;
  const firstChoice = Array.isArray(root.choices) ? root.choices[0] : undefined;
  const choice =
    firstChoice && typeof firstChoice === "object"
      ? (firstChoice as Record<string, unknown>)
      : undefined;
  const message =
    choice?.message && typeof choice.message === "object"
      ? (choice.message as Record<string, unknown>)
      : undefined;
  const delta =
    choice?.delta && typeof choice.delta === "object"
      ? (choice.delta as Record<string, unknown>)
      : undefined;

  const sources = [delta, message, choice, root].filter(
    (source): source is Record<string, unknown> => Boolean(source),
  );
  let content = "";
  let reasoning = "";

  for (const source of sources) {
    content += readText(source.content);
    content += readText(source.text);
    reasoning += readText(source.reasoning_content);
    reasoning += readText(source.reasoning);
  }

  return { content, reasoning };
}

function usableCompletionText({ content, reasoning }: CompletionText): string {
  if (content.trim()) return content.trim();

  // 部分推理模型在 token 用尽时只吐出 reasoning；尽量从中恢复 JSON 响应。
  const match = reasoning.match(/\{[\s\S]*\}/);
  return match?.[0] ?? "";
}

/** OpenAI compatible chat.completions */
export async function chatCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    responseFormatJson?: boolean;
    signal?: AbortSignal;
    stream?: boolean;
    onProgress?: (progress: LLMStreamProgress) => void;
  },
): Promise<string> {
  const base = resolveBaseUrl(config);
  const url = `${base}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: resolveModel(config),
    messages,
    temperature: options?.temperature ?? config.temperature ?? 0.3,
    // 复盘 JSON 需要足够长度；过小会导致 reasoning 模型只吐思考、content 为空
    max_tokens: options?.responseFormatJson ? 4096 : 1024,
  };
  if (options?.responseFormatJson) {
    body.response_format = { type: "json_object" };
  }
  if (options?.stream) body.stream = true;

  const requestId = createRequestId();
  const startedAt = performance.now();
  const debug = isDevLoggingEnabled();
  if (debug) {
    console.groupCollapsed(`[LLM][${requestId}] POST ${url}`);
    console.info("request", {
      requestId,
      url,
      headers: {
        "Content-Type": headers["Content-Type"],
        Authorization: config.apiKey ? "Bearer [REDACTED]" : "未设置",
      },
      body,
    });
    console.info("messages", messages);
    console.groupEnd();
  }

  if (nativeStreamTransport && options?.stream) {
    const stream = createCompletionStreamCollector(
      options.onProgress,
      debug,
      requestId,
      startedAt,
    );
    let receivedChunk = false;
    let nativeResponse: OpenAICompatibleTransportResponse;
    try {
      nativeResponse = await withAbort(
        nativeStreamTransport(
          { url, apiKey: config.apiKey, body, requestId },
          (chunk) => {
            receivedChunk = true;
            stream.push(chunk);
          },
        ),
        options.signal,
      );
    } catch (error) {
      if (debug) {
        console.error(`[LLM][${requestId}] native stream error`, {
          durationMs: Math.round(performance.now() - startedAt),
          error,
        });
      }
      throw error;
    }

    if (nativeResponse.status < 200 || nativeResponse.status >= 300) {
      throw new Error(
        `LLM HTTP ${nativeResponse.status}: ${nativeResponse.body.slice(0, 300)}`,
      );
    }

    if (nativeResponse.contentType.includes("text/event-stream")) {
      // 某些服务端会声明 SSE 却一次性回传；此时仍能从最终 body 恢复内容。
      if (!receivedChunk && nativeResponse.body) stream.push(nativeResponse.body);
      return stream.finish();
    }

    return readCompletionBody(nativeResponse.body, debug, requestId, startedAt);
  }

  let res: Response;
  try {
    if (nativeTransport) {
      const nativeResponse = await withAbort(
        nativeTransport({
          url,
          apiKey: config.apiKey,
          body,
          requestId,
        }),
        options?.signal,
      );
      res = new Response(nativeResponse.body, {
        status: nativeResponse.status,
        headers: nativeResponse.contentType
          ? { "Content-Type": nativeResponse.contentType }
          : undefined,
      });
    } else {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    }
  } catch (error) {
    if (debug) {
      console.error(`[LLM][${requestId}] network error`, {
        durationMs: Math.round(performance.now() - startedAt),
        error,
      });
    }
    throw error;
  }

  if (!res.ok) {
    const responseText = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${responseText.slice(0, 300)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (options?.stream && contentType.includes("text/event-stream") && res.body) {
    return readCompletionStream(res, options.onProgress, debug, requestId, startedAt);
  }

  const responseText = await res.text().catch(() => "");
  return readCompletionBody(responseText, debug, requestId, startedAt);
}

function readCompletionBody(
  responseText: string,
  debug: boolean,
  requestId: string,
  startedAt: number,
): string {
  if (debug) {
    console.info(`[LLM][${requestId}] response`, {
      durationMs: Math.round(performance.now() - startedAt),
      body: responseText,
    });
  }

  let data: unknown;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`LLM 返回非 JSON 内容：${responseText.slice(0, 300)}`);
  }
  const content = usableCompletionText(readCompletionText(data));
  if (content) return content;
  throw new Error(
    "LLM 返回空内容（请检查模型名是否可用，或调大 max_tokens）",
  );
}

async function readCompletionStream(
  response: Response,
  onProgress: ((progress: LLMStreamProgress) => void) | undefined,
  debug: boolean,
  requestId: string,
  startedAt: number,
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const stream = createCompletionStreamCollector(
    onProgress,
    debug,
    requestId,
    startedAt,
  );

  while (true) {
    const { done, value } = await reader.read();
    if (value) stream.push(decoder.decode(value, { stream: !done }));
    if (done) break;
  }
  return stream.finish();
}

function createCompletionStreamCollector(
  onProgress: ((progress: LLMStreamProgress) => void) | undefined,
  debug: boolean,
  requestId: string,
  startedAt: number,
) {
  let buffer = "";
  let content = "";
  let reasoning = "";
  let dataLines: string[] = [];
  let rawResponse = "";
  let eventCount = 0;

  const emitProgress = () => {
    onProgress?.({
      phase: "streaming",
      receivedChars: content.length + reasoning.length,
      content,
      reasoning,
    });
  };

  const processEvent = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") return;

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    eventCount += 1;
    const extracted = readCompletionText(payload);
    content += extracted.content;
    reasoning += extracted.reasoning;
    emitProgress();
  };

  const push = (chunk: string) => {
    rawResponse += chunk;
    buffer = `${buffer}${chunk}`.replace(
      /\r\n/g,
      "\n",
    );

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line === "") processEvent();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      newline = buffer.indexOf("\n");
    }

  };

  const finish = (): string => {
    if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart());
    processEvent();

    let result = usableCompletionText({ content, reasoning });
    if (!result) {
      try {
        result = usableCompletionText(readCompletionText(JSON.parse(rawResponse)));
      } catch {
        // 这是标准 SSE 文本，完整内容本身不是 JSON。
      }
    }

    if (debug) {
      console.info(`[LLM][${requestId}] stream complete`, {
        durationMs: Math.round(performance.now() - startedAt),
        receivedChars: content.length + reasoning.length,
        eventCount,
        recoveredFromJson: Boolean(result) && !content.trim() && !reasoning.trim(),
      });
    }
    if (result) return result;
    throw new Error("LLM 流式响应结束，但未返回可用内容");
  };

  onProgress?.({ phase: "streaming", receivedChars: 0, content: "", reasoning: "" });
  return { push, finish };
}

export async function testOpenAICompatible(
  config: LLMConfig,
): Promise<TestResult> {
  const started = performance.now();
  try {
    if (!config.baseUrl && !config.providerId) {
      return { ok: false, message: "缺少 baseUrl" };
    }
    // Ollama 可不需要 key
    const isLocal =
      (config.baseUrl ?? "").includes("localhost") ||
      (config.baseUrl ?? "").includes("127.0.0.1");
    if (!config.apiKey && !isLocal) {
      return { ok: false, message: "缺少 apiKey" };
    }

    const content = await chatCompletion(
      config,
      [
        { role: "system", content: "Reply with exactly: pong" },
        { role: "user", content: "ping" },
      ],
      { temperature: 0 },
    );
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      message: `连接成功：${content.slice(0, 40)}`,
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
