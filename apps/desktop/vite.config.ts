import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@expr-talk/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@expr-talk/core": path.resolve(__dirname, "../../packages/core/src"),
      "@expr-talk/asr": path.resolve(__dirname, "../../packages/asr/src"),
      "@expr-talk/llm": path.resolve(__dirname, "../../packages/llm/src"),
      "@expr-talk/storage": path.resolve(__dirname, "../../packages/storage/src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
