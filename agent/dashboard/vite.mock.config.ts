import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mockApiPlugin } from "./scripts/mock-api";

export default defineConfig({
  plugins: [react(), mockApiPlugin()],
  base: "/dashboard/",
  build: { outDir: "dist" },
});
