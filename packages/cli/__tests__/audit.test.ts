import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProgram } from "../src/program.js";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

vi.mock("@mecha/mcp-server", () => {
  const audit = {
    append: vi.fn(),
    read: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  };
  return {
    createAuditLog: vi.fn().mockReturnValue(audit),
    main: vi.fn(),
    __mockAudit: audit,
  };
});

import { createAuditLog } from "@mecha/mcp-server";

function getMockAudit() {
  // Access the shared mock audit object via the factory
  return (createAuditLog as ReturnType<typeof vi.fn>)() as {
    append: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
}

let deps: CommandDeps;

beforeEach(() => {
  vi.clearAllMocks();
  // Re-set defaults after clearAllMocks
  const audit = {
    append: vi.fn(),
    read: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  };
  (createAuditLog as ReturnType<typeof vi.fn>).mockReturnValue(audit);
  deps = makeDeps();
});

function run(args: string[]) {
  const program = createProgram(deps);
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  return program.parseAsync(["node", "mecha", ...args]);
}

describe("mecha audit log", () => {
  it("shows info when no entries", async () => {
    await run(["audit", "log"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("No audit entries"));
  });

  it("displays entries", async () => {
    const audit = getMockAudit();
    audit.read.mockReturnValue([
      {
        ts: "2026-02-27T10:00:00Z",
        client: "claude-desktop/1.2",
        tool: "mecha_list_casas",
        params: {},
        result: "ok",
        durationMs: 42,
      },
    ]);
    (createAuditLog as ReturnType<typeof vi.fn>).mockReturnValue(audit);

    await run(["audit", "log"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("mecha_list_casas"),
    );
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("42ms"),
    );
  });

  it("respects --limit flag", async () => {
    await run(["audit", "log", "--limit", "10"]);
    const audit = getMockAudit();
    expect(audit.read).toHaveBeenCalledWith({ limit: 10 });
  });

  it("outputs JSON when --json is active", async () => {
    deps = makeDeps();
    Object.defineProperty(deps.formatter, "isJson", { value: true, writable: false });
    const audit = getMockAudit();
    audit.read.mockReturnValue([{ ts: "2026-02-27T10:00:00Z", tool: "test", params: {}, result: "ok", client: "x", durationMs: 1 }]);
    (createAuditLog as ReturnType<typeof vi.fn>).mockReturnValue(audit);

    await run(["audit", "log"]);
    expect(deps.formatter.json).toHaveBeenCalled();
  });

  it("shows error result details", async () => {
    const audit = getMockAudit();
    audit.read.mockReturnValue([
      {
        ts: "2026-02-27T10:00:00Z",
        client: "unknown",
        tool: "mecha_casa_status",
        params: { target: "bob" },
        result: "error",
        error: "CASA not found",
        durationMs: 2,
      },
    ]);
    (createAuditLog as ReturnType<typeof vi.fn>).mockReturnValue(audit);

    await run(["audit", "log"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("error: CASA not found"),
    );
  });
});

describe("mecha audit clear", () => {
  it("clears the audit log", async () => {
    await run(["audit", "clear"]);
    const audit = getMockAudit();
    expect(audit.clear).toHaveBeenCalled();
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("cleared"));
  });
});
