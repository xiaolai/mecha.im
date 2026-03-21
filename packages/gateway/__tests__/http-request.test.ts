import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHttpGateway, GatewayDeniedError } from "../src/http-request.js";

describe("createHttpGateway", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows requests to hosts in the allowlist", async () => {
    const mockResponse = {
      status: 200,
      text: vi.fn().mockResolvedValue('{"ok":true}'),
      headers: new Headers({ "content-type": "application/json" }),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const gw = createHttpGateway({ allowedHosts: ["api.example.com"] });
    const result = await gw.executeRequest("https://api.example.com/data");

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.headers["content-type"]).toBe("application/json");
  });

  it("denies requests to hosts not in the allowlist", async () => {
    const gw = createHttpGateway({ allowedHosts: ["api.example.com"] });

    await expect(
      gw.executeRequest("https://evil.com/steal"),
    ).rejects.toThrow(GatewayDeniedError);

    await expect(
      gw.executeRequest("https://evil.com/steal"),
    ).rejects.toThrow("Host not allowed: evil.com");
  });

  it("supports wildcard host patterns", async () => {
    const mockResponse = {
      status: 200,
      text: vi.fn().mockResolvedValue("ok"),
      headers: new Headers(),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const gw = createHttpGateway({ allowedHosts: ["*.example.com"] });
    const result = await gw.executeRequest("https://api.example.com/data");

    expect(result.status).toBe(200);
  });

  it("wildcard does not match the bare domain", async () => {
    const gw = createHttpGateway({ allowedHosts: ["*.example.com"] });

    await expect(
      gw.executeRequest("https://example.com/data"),
    ).rejects.toThrow(GatewayDeniedError);
  });

  it("sends POST requests with body", async () => {
    const mockResponse = {
      status: 201,
      text: vi.fn().mockResolvedValue("created"),
      headers: new Headers(),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const gw = createHttpGateway({ allowedHosts: ["api.example.com"] });
    const result = await gw.executeRequest("https://api.example.com/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"name":"test"}',
    });

    expect(result.status).toBe(201);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://api.example.com/items",
      expect.objectContaining({
        method: "POST",
        body: '{"name":"test"}',
      }),
    );
  });

  it("defaults method to GET", async () => {
    const mockResponse = {
      status: 200,
      text: vi.fn().mockResolvedValue("ok"),
      headers: new Headers(),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const gw = createHttpGateway({ allowedHosts: ["api.example.com"] });
    await gw.executeRequest("https://api.example.com/data");

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("integrates with circuit breaker (trips after maxFailures)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const gw = createHttpGateway({
      allowedHosts: ["api.example.com"],
      maxFailures: 2,
    });

    // First two failures trip the circuit
    await expect(gw.executeRequest("https://api.example.com/data")).rejects.toThrow("Network error");
    await expect(gw.executeRequest("https://api.example.com/data")).rejects.toThrow("Network error");

    // Third call should be rejected by circuit breaker
    await expect(gw.executeRequest("https://api.example.com/data")).rejects.toThrow("Circuit breaker is open");
  });

  it("throws GatewayDeniedError for invalid URLs", async () => {
    const gw = createHttpGateway({ allowedHosts: ["api.example.com"] });

    await expect(
      gw.executeRequest("not-a-valid-url"),
    ).rejects.toThrow(GatewayDeniedError);
  });

  it("supports PUT and DELETE methods", async () => {
    const mockResponse = {
      status: 204,
      text: vi.fn().mockResolvedValue(""),
      headers: new Headers(),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const gw = createHttpGateway({ allowedHosts: ["api.example.com"] });

    const putResult = await gw.executeRequest("https://api.example.com/items/1", {
      method: "PUT",
      body: '{"name":"updated"}',
    });
    expect(putResult.status).toBe(204);

    const deleteResult = await gw.executeRequest("https://api.example.com/items/1", {
      method: "DELETE",
    });
    expect(deleteResult.status).toBe(204);
  });

  it("uses separate circuit breakers per host", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("fail"));

    const gw = createHttpGateway({
      allowedHosts: ["a.example.com", "b.example.com"],
      maxFailures: 1,
    });

    // Trip circuit for host a
    await expect(gw.executeRequest("https://a.example.com/")).rejects.toThrow("fail");
    // a.example.com circuit is now open
    await expect(gw.executeRequest("https://a.example.com/")).rejects.toThrow("Circuit breaker is open");

    // b.example.com should still work (its own circuit)
    await expect(gw.executeRequest("https://b.example.com/")).rejects.toThrow("fail");
    // b.example.com circuit is now also open after 1 failure
    await expect(gw.executeRequest("https://b.example.com/")).rejects.toThrow("Circuit breaker is open");
  });
});

describe("GatewayDeniedError", () => {
  it("has correct name and message", () => {
    const err = new GatewayDeniedError("evil.com");
    expect(err.name).toBe("GatewayDeniedError");
    expect(err.message).toBe("Host not allowed: evil.com");
    expect(err).toBeInstanceOf(Error);
  });
});
