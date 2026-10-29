import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const server = process.env.OPEN_SILA_SERVER ?? "http://127.0.0.1:4590";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@open-sila/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": { target: server, changeOrigin: true, ws: true },
      "/login": { target: server, changeOrigin: true },
      "/logout": { target: server, changeOrigin: true },
    },
  },
  build: {
    outDir: "../../packages/server/public",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
