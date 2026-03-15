import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Relative base so the SPA works from both / (fleet) and /dashboard/ (bot-direct)
  base: "./",
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  server: {
    proxy: {
      "/api": `http://localhost:${process.env.MECHA_PORT ?? "7801"}`,
      "/prompt": `http://localhost:${process.env.MECHA_PORT ?? "7801"}`,
      "/health": `http://localhost:${process.env.MECHA_PORT ?? "7801"}`,
    },
  },
});
