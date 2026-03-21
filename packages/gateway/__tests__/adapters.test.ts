import { describe, it, expect } from "vitest";
import { githubAdapter, ADAPTER_REGISTRY } from "../src/adapters.js";

describe("GatewayAdapters", () => {
  describe("githubAdapter", () => {
    it("parses webhook with x-github-event header", () => {
      const event = githubAdapter.parseWebhook!(
        { "x-github-event": "pull_request" },
        { action: "opened", number: 42 },
      );
      expect(event).not.toBeNull();
      expect(event!.adapter).toBe("github");
      expect(event!.event).toBe("pull_request");
      expect(event!.payload).toEqual({ action: "opened", number: 42 });
    });

    it("returns null without x-github-event header", () => {
      const event = githubAdapter.parseWebhook!({}, { data: "test" });
      expect(event).toBeNull();
    });
  });

  describe("ADAPTER_REGISTRY", () => {
    it("contains all 5 adapters", () => {
      expect(Object.keys(ADAPTER_REGISTRY).sort()).toEqual([
        "discord", "email", "github", "linear", "slack",
      ]);
    });

    it("each adapter has a name", () => {
      for (const [key, adapter] of Object.entries(ADAPTER_REGISTRY)) {
        expect(adapter.name).toBe(key);
      }
    });
  });
});
