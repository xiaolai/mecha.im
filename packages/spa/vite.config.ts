import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const API_TARGET = "http://127.0.0.1:7660";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/auth": API_TARGET,
      "/casas": API_TARGET,
      "/acl": API_TARGET,
      "/audit": API_TARGET,
      "/discover": API_TARGET,
      "/healthz": API_TARGET,
      "/meter": API_TARGET,
      "/mesh": API_TARGET,
      "/settings": API_TARGET,
      "/events": API_TARGET,
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
