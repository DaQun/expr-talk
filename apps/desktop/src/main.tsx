import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  setOpenAICompatibleTransport,
  setOpenAICompatibleStreamTransport,
  type OpenAICompatibleTransportResponse,
} from "@showtalk/llm";
import { AppProviders } from "./app/providers";
import { AppRouter } from "./app/router";
import "./styles/global.css";

if ("__TAURI_INTERNALS__" in window) {
  setOpenAICompatibleTransport((request) =>
    invoke<OpenAICompatibleTransportResponse>("llm_chat_completion", {
      request,
    }),
  );
  setOpenAICompatibleStreamTransport(async (request, onChunk) => {
    const requestId = request.requestId;
    const unlisten = await listen<{ requestId: string; chunk: string }>(
      "llm-stream-chunk",
      (event) => {
        if (event.payload.requestId === requestId) onChunk(event.payload.chunk);
      },
    );
    try {
      return await invoke<OpenAICompatibleTransportResponse>(
        "llm_chat_completion",
        { request },
      );
    } finally {
      unlisten();
    }
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </React.StrictMode>,
);
