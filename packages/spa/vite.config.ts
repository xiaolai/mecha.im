import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/casas": "http://127.0.0.1:7660",
      "/acl": "http://127.0.0.1:7660",
      "/audit": "http://127.0.0.1:7660",
      "/discover": "http://127.0.0.1:7660",
      "/healthz": "http://127.0.0.1:7660",
      "/meter": "http://127.0.0.1:7660",
      "/mesh": "http://127.0.0.1:7660",
      "/settings": "http://127.0.0.1:7660",
      "/events": "http://127.0.0.1:7660",
      "/ws": {
        target: "ws://127.0.0.1:7660",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
