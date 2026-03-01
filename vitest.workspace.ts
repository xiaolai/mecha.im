// Deprecated: vitest v4 uses `projects` in vitest.config.ts.
// This file re-exports for backward compatibility.
import { defineWorkspace } from "vitest/config";
import { projects } from "./vitest.config.js";

export default defineWorkspace(projects);
