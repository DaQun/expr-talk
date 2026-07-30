import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import {
  setOpenAICompatibleTransport,
  type OpenAICompatibleTransportResponse,
} from "@expr-talk/llm";
import { AppProviders } from "./app/providers";
import { AppRouter } from "./app/router";
import "./styles/global.css";

if ("__TAURI_INTERNALS__" in window) {
  setOpenAICompatibleTransport((request) =>
    invoke<OpenAICompatibleTransportResponse>("llm_chat_completion", {
      request,
    }),
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </React.StrictMode>,
);
