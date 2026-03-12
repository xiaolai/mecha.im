import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/dashboard/",
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": `http://localhost:${process.env.MECHA_PORT ?? "7801"}`,
      "/prompt": `http://localhost:${process.env.MECHA_PORT ?? "7801"}`,
      "/health": `http://localhost:${process.env.MECHA_PORT ?? "7801"}`,
    },
  },
});
