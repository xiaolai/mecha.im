import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentClient, detectAgentPort } from "../src/client.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("AgentClient", () => {
  it("constructs with default port", () => {
    const client = new AgentClient();
    expect(client.baseUrl).toBe("http://127.0.0.1:7660");
  });

  it("constructs with custom port", () => {
    const client = new AgentClient(8080);
    expect(client.baseUrl).toBe("http://127.0.0.1:8080");
  });

  it("isAlive returns false when no server", async () => {
    const client = new AgentClient(19999);
    expect(await client.isAlive()).toBe(false);
  });
});

describe("detectAgentPort", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "client-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns port from agent.json", () => {
    writeFileSync(
      join(dir, "agent.json"),
      JSON.stringify({ port: 7660, pid: 1234 }),
    );
    expect(detectAgentPort(dir)).toBe(7660);
  });

  it("returns null when no agent.json", () => {
    expect(detectAgentPort(dir)).toBeNull();
  });

  it("returns null for corrupt agent.json", () => {
    writeFileSync(join(dir, "agent.json"), "not-json{");
    expect(detectAgentPort(dir)).toBeNull();
  });

  it("returns null when port field is missing", () => {
    writeFileSync(join(dir, "agent.json"), JSON.stringify({ pid: 1234 }));
    expect(detectAgentPort(dir)).toBeNull();
  });

  it("returns null when port is not a number", () => {
    writeFileSync(
      join(dir, "agent.json"),
      JSON.stringify({ port: "not-a-number" }),
    );
    expect(detectAgentPort(dir)).toBeNull();
  });
});
