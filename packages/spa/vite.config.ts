import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://127.0.0.1:7660";

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
      "/bots": API_TARGET,
      "/acl": API_TARGET,
      "/audit": API_TARGET,
      "/budgets": API_TARGET,
      "/discover": API_TARGET,
      "/doctor": API_TARGET,
      "/healthz": API_TARGET,
      "/models": API_TARGET,
      "/meter": API_TARGET,
      "/mesh": API_TARGET,
      "/node": API_TARGET,
      "/nodes": API_TARGET,
      "/plugins": API_TARGET,
      "/settings": API_TARGET,
      "/tools": API_TARGET,
      "/events": API_TARGET,
      "/ws": {
        target: API_TARGET.replace(/^http/, "ws"),
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
