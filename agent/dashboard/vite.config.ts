import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
