import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCredentialStore } from "@mecha/gateway";
import type { CredentialStore } from "@mecha/gateway";
import { GATEWAY_TOOLS, handleGatewayTool, type GatewayToolOpts } from "../../src/mcp/gateway-tools.js";

describe("GATEWAY_TOOLS", () => {
  it("exports a single gateway_http_request tool", () => {
    expect(GATEWAY_TOOLS).toHaveLength(1);
    expect(GATEWAY_TOOLS[0]!.name).toBe("gateway_http_request");
  });

  it("defines url as required in inputSchema", () => {
    const schema = GATEWAY_TOOLS[0]!.inputSchema;
    expect(schema.required).toContain("url");
    expect(schema.properties).toHaveProperty("url");
    expect(schema.properties).toHaveProperty("method");
    expect(schema.properties).toHaveProperty("headers");
    expect(schema.properties).toHaveProperty("body");
  });
});

describe("handleGatewayTool", () => {
  let secretsDir: string;
  let credentialStore: CredentialStore;

  function makeOpts(overrides?: Partial<GatewayToolOpts>): GatewayToolOpts {
    return {
      credentialStore,
      botName: "alice",
      allowedHosts: ["api.example.com"],
      ...overrides,
    };
  }

  beforeEach(() => {
    secretsDir = mkdtempSync(join(tmpdir(), "gw-tools-test-"));
    credentialStore = createCredentialStore(secretsDir);
    // Grant gateway_outbound access by default
    credentialStore.grantAccess("gateway_outbound", "alice");
  });

  afterEach(() => {
    rmSync(secretsDir, { recursive: true, force: true });
  });

  it("returns error for unknown tool name", async () => {
    const result = await handleGatewayTool(makeOpts(), "unknown_tool", {});

    expect(result.content[0]!.text).toContain("Unknown gateway tool");
    expect(result.isError).toBe(true);
  });

  it("returns error when url is missing", async () => {
    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", {});

    expect(result.content[0]!.text).toContain("Missing required: url");
    expect(result.isError).toBe(true);
  });

  it("returns error when url is empty string", async () => {
    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", { url: "" });

    expect(result.content[0]!.text).toContain("Missing required: url");
    expect(result.isError).toBe(true);
  });

  it("returns error when url is not a string", async () => {
    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", { url: 123 });

    expect(result.content[0]!.text).toContain("Missing required: url");
    expect(result.isError).toBe(true);
  });

  it("returns error for invalid HTTP method", async () => {
    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", {
      url: "https://api.example.com/test",
      method: "PATCH",
    });

    expect(result.content[0]!.text).toContain("Invalid method");
    expect(result.isError).toBe(true);
  });

  it("returns error when method is not a string", async () => {
    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", {
      url: "https://api.example.com/test",
      method: 42,
    });

    expect(result.content[0]!.text).toContain("Invalid method");
    expect(result.isError).toBe(true);
  });

  it("returns error for invalid headers (array)", async () => {
    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", {
      url: "https://api.example.com/test",
      headers: ["bad"],
    });

    expect(result.content[0]!.text).toContain("Invalid headers");
    expect(result.isError).toBe(true);
  });

  it("returns error for invalid headers (null)", async () => {
    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", {
      url: "https://api.example.com/test",
      headers: null,
    });

    expect(result.content[0]!.text).toContain("Invalid headers");
    expect(result.isError).toBe(true);
  });

  it("returns access denied when bot lacks gateway_outbound grant", async () => {
    credentialStore.revokeAccess("gateway_outbound", "alice");

    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", {
      url: "https://api.example.com/test",
    });

    expect(result.content[0]!.text).toContain("Access denied");
    expect(result.content[0]!.text).toContain("gateway_outbound");
    expect(result.isError).toBe(true);
  });

  it("returns access denied when host is not in allowlist", async () => {
    const result = await handleGatewayTool(makeOpts(), "gateway_http_request", {
      url: "https://evil.example.com/data",
    });

    expect(result.content[0]!.text).toContain("Access denied");
    expect(result.content[0]!.text).toContain("Host not allowed");
    expect(result.isError).toBe(true);
  });

  it("defaults method to GET when not specified", async () => {
    // Host not in allowlist will trigger GatewayDeniedError,
    // but the key thing is it passes the url/method validation
    const result = await handleGatewayTool(
      makeOpts({ allowedHosts: [] }),
      "gateway_http_request",
      { url: "https://any.example.com/test" },
    );

    // Should reach the gateway (access denied by host), not the method validation
    expect(result.content[0]!.text).toContain("Access denied");
    expect(result.isError).toBe(true);
  });

  it("ignores body arg when not a string", async () => {
    // body as number should be treated as undefined (ignored, not an error)
    // This will still fail due to host not in allowlist, but proves body validation passes
    const result = await handleGatewayTool(
      makeOpts({ allowedHosts: [] }),
      "gateway_http_request",
      { url: "https://any.example.com/test", body: 123 },
    );

    expect(result.content[0]!.text).toContain("Access denied");
    expect(result.isError).toBe(true);
  });
});
