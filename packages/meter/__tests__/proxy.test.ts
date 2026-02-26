import { describe, it, expect } from "vitest";
import { parseCasaPath, buildUpstreamHeaders } from "../src/proxy.js";

describe("proxy", () => {
  describe("parseCasaPath", () => {
    it("parses /casa/{name}/v1/messages", () => {
      const result = parseCasaPath("/casa/researcher/v1/messages");
      expect(result).toEqual({ casa: "researcher", upstreamPath: "/v1/messages" });
    });

    it("parses CASA name with hyphens and numbers", () => {
      const result = parseCasaPath("/casa/my-bot-3/v1/messages");
      expect(result).toEqual({ casa: "my-bot-3", upstreamPath: "/v1/messages" });
    });

    it("returns null for non-matching paths", () => {
      expect(parseCasaPath("/v1/messages")).toBeNull();
      expect(parseCasaPath("/casa/")).toBeNull();
      expect(parseCasaPath("/casa/name")).toBeNull();
      expect(parseCasaPath("/other/path")).toBeNull();
    });

    it("returns null for invalid CASA names", () => {
      expect(parseCasaPath("/casa/UPPER/v1/messages")).toBeNull();
      expect(parseCasaPath("/casa/has_underscore/v1/messages")).toBeNull();
    });
  });

  describe("buildUpstreamHeaders", () => {
    it("sets host to api.anthropic.com", () => {
      const headers = buildUpstreamHeaders({ "host": "localhost:7600" });
      expect(headers["host"]).toBe("api.anthropic.com");
    });

    it("strips hop-by-hop headers", () => {
      const headers = buildUpstreamHeaders({
        "connection": "keep-alive",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        "x-api-key": "sk-test",
      });
      expect(headers["connection"]).toBeUndefined();
      expect(headers["keep-alive"]).toBeUndefined();
      expect(headers["transfer-encoding"]).toBeUndefined();
      expect(headers["x-api-key"]).toBe("sk-test");
    });

    it("passes through auth headers unchanged", () => {
      const headers = buildUpstreamHeaders({
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      });
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
    });

    it("joins array header values", () => {
      const headers = buildUpstreamHeaders({
        "accept": ["application/json", "text/plain"],
      });
      expect(headers["accept"]).toBe("application/json, text/plain");
    });

    it("skips undefined values", () => {
      const headers = buildUpstreamHeaders({ "x-custom": undefined });
      expect(headers["x-custom"]).toBeUndefined();
    });
  });
});
