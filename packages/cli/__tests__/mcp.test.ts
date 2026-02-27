import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProgram } from "../src/program.js";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

vi.mock("@mecha/mcp-server", () => ({
  main: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn(),
}));

import { main } from "@mecha/mcp-server";

let deps: CommandDeps;

beforeEach(() => {
  vi.clearAllMocks();
  deps = makeDeps();
});

function run(args: string[]) {
  const program = createProgram(deps);
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  return program.parseAsync(["node", "mecha", ...args]);
}

describe("mecha mcp serve", () => {
  it("calls main with default mode and transport", async () => {
    await run(["mcp", "serve"]);
    expect(main).toHaveBeenCalledWith({
      mode: "query",
      transport: "stdio",
      port: undefined,
      host: undefined,
    });
  });

  it("passes --mode flag", async () => {
    await run(["mcp", "serve", "--mode", "read-only"]);
    expect(main).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "read-only" }),
    );
  });

  it("passes --transport http flag", async () => {
    await run(["mcp", "serve", "--transport", "http"]);
    expect(main).toHaveBeenCalledWith(
      expect.objectContaining({ transport: "http" }),
    );
  });

  it("passes --port and --host flags", async () => {
    await run(["mcp", "serve", "--transport", "http", "--port", "8080", "--host", "0.0.0.0"]);
    expect(main).toHaveBeenCalledWith(
      expect.objectContaining({ transport: "http", port: 8080, host: "0.0.0.0" }),
    );
  });

  it("rejects invalid --transport value", async () => {
    await expect(run(["mcp", "serve", "--transport", "nope"])).rejects.toThrow();
  });

  it("rejects invalid --mode value", async () => {
    await expect(run(["mcp", "serve", "--mode", "typo"])).rejects.toThrow();
  });

  it("rejects non-numeric --port", async () => {
    await expect(run(["mcp", "serve", "--port", "abc"])).rejects.toThrow(/Invalid port/);
  });

  it("rejects out-of-range --port", async () => {
    await expect(run(["mcp", "serve", "--port", "0"])).rejects.toThrow(/Invalid port/);
    await expect(run(["mcp", "serve", "--port", "99999"])).rejects.toThrow(/Invalid port/);
  });

  it("rejects hex/scientific port values", async () => {
    await expect(run(["mcp", "serve", "--port", "0x1F"])).rejects.toThrow(/Invalid port/);
    await expect(run(["mcp", "serve", "--port", "1e3"])).rejects.toThrow(/Invalid port/);
  });
});

describe("mecha mcp config", () => {
  it("outputs JSON config", async () => {
    await run(["mcp", "config"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: expect.objectContaining({
          mecha: expect.objectContaining({
            args: ["mcp", "serve"],
          }),
        }),
      }),
    );
  });
});
