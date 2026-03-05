import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeDiscoveredNode, readDiscoveredNodes, readNodes } from "@mecha/core";
import { makeDeps } from "../test-utils.js";
import { createProgram } from "../../src/program.js";

describe("node promote", () => {
  let mechaDir: string;

  beforeEach(() => { mechaDir = mkdtempSync(join(tmpdir(), "mecha-promote-")); });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  it("promotes a discovered node to manual registry", async () => {
    writeDiscoveredNode(mechaDir, {
      name: "bob",
      host: "100.100.1.9",
      port: 7660,
      apiKey: "bob-key",
      source: "tailscale",
      lastSeen: new Date().toISOString(),
      addedAt: new Date().toISOString(),
    });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();
    await program.parseAsync(["node", "mecha", "node", "promote", "bob"]);

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
    const manual = readNodes(mechaDir);
    expect(manual).toHaveLength(1);
    expect(manual[0]!.name).toBe("bob");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("bob"));
  });

  it("errors when node not found", async () => {
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();
    await program.parseAsync(["node", "mecha", "node", "promote", "ghost"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("ghost"));
  });
});
