import { describe, it, expect, vi } from "vitest";
import {
  createRemoteExecutor,
  type LocalChatFn,
  type RemoteFetchFn,
  type NodeLookupFn,
} from "../src/remote-executor.js";

describe("createRemoteExecutor", () => {
  const fakeNode = { name: "spark01", host: "10.0.0.1", port: 7700, apiKey: "key1" };

  function makeExecutor(overrides?: {
    localChat?: LocalChatFn;
    remoteFetch?: RemoteFetchFn;
    nodeLookup?: NodeLookupFn;
  }) {
    const localChat: LocalChatFn = overrides?.localChat ?? vi.fn().mockResolvedValue({
      response: "local result",
      costUsd: 0.05,
    });

    const remoteFetch: RemoteFetchFn = overrides?.remoteFetch ?? vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: "remote result", costUsd: 0.10 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const nodeLookup: NodeLookupFn = overrides?.nodeLookup ?? vi.fn().mockReturnValue(fakeNode);

    const executor = createRemoteExecutor({ localChat, remoteFetch, nodeLookup });
    return { executor, localChat, remoteFetch, nodeLookup };
  }

  describe("local routing", () => {
    it("routes to local bot when name has no @ symbol", async () => {
      const { executor, localChat, remoteFetch } = makeExecutor();

      const result = await executor({
        bot: "researcher",
        prompt: "Find topics",
        stepRunId: "run-1:research:abc",
      });

      expect(result.output).toBe("local result");
      expect(result.costUsd).toBe(0.05);
      expect(localChat).toHaveBeenCalledWith({
        bot: "researcher",
        prompt: "Find topics",
        sessionId: "run-1:research:abc",
      });
      expect(remoteFetch).not.toHaveBeenCalled();
    });

    it("passes correct bot name for local execution", async () => {
      const localChat = vi.fn().mockResolvedValue({ response: "ok", costUsd: 0 });
      const { executor } = makeExecutor({ localChat });

      await executor({
        bot: "my-writer",
        prompt: "Write draft",
        stepRunId: "run-2:write:def",
      });

      expect(localChat).toHaveBeenCalledWith(
        expect.objectContaining({ bot: "my-writer" }),
      );
    });
  });

  describe("remote routing", () => {
    it("routes to remote node when bot name contains @", async () => {
      const { executor, remoteFetch, localChat, nodeLookup } = makeExecutor();

      const result = await executor({
        bot: "developer@spark01",
        prompt: "Build feature",
        stepRunId: "run-1:build:xyz",
      });

      expect(result.output).toBe("remote result");
      expect(result.costUsd).toBe(0.10);
      expect(nodeLookup).toHaveBeenCalledWith("spark01");
      expect(remoteFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          node: fakeNode,
          path: "/bots/developer/query",
          method: "POST",
          body: expect.objectContaining({
            message: "Build feature",
            sessionId: "run-1:build:xyz",
          }),
        }),
      );
      expect(localChat).not.toHaveBeenCalled();
    });

    it("throws when remote node is not found", async () => {
      const nodeLookup = vi.fn().mockReturnValue(undefined);
      const { executor } = makeExecutor({ nodeLookup });

      await expect(
        executor({
          bot: "writer@unknown-node",
          prompt: "Write",
          stepRunId: "run-1:write:abc",
        }),
      ).rejects.toThrow('Remote node "unknown-node" not found');
    });

    it("throws on non-OK remote response", async () => {
      const remoteFetch = vi.fn().mockResolvedValue(
        new Response("Internal Server Error", { status: 500 }),
      );
      const { executor } = makeExecutor({ remoteFetch });

      await expect(
        executor({
          bot: "dev@spark01",
          prompt: "Build",
          stepRunId: "run-1:build:abc",
        }),
      ).rejects.toThrow("HTTP 500");
    });

    it("includes timeout and budgetUsd in remote request body", async () => {
      const remoteFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ response: "done", costUsd: 0.20 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const { executor } = makeExecutor({ remoteFetch });

      await executor({
        bot: "analyst@spark01",
        prompt: "Analyze",
        stepRunId: "run-1:analyze:abc",
        timeout: "5m",
        budgetUsd: 1.50,
      });

      expect(remoteFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            timeout: "5m",
            budgetUsd: 1.50,
          }),
        }),
      );
    });

    it("handles response without costUsd", async () => {
      const remoteFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ response: "no cost info" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const { executor } = makeExecutor({ remoteFetch });

      const result = await executor({
        bot: "helper@spark01",
        prompt: "Help",
        stepRunId: "run-1:help:abc",
      });

      expect(result.output).toBe("no cost info");
      expect(result.costUsd).toBeUndefined();
    });

    it("handles response without response field", async () => {
      const remoteFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ costUsd: 0.01 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const { executor } = makeExecutor({ remoteFetch });

      const result = await executor({
        bot: "helper@spark01",
        prompt: "Help",
        stepRunId: "run-1:help:def",
      });

      expect(result.output).toBe("");
    });

    it("URL-encodes bot name in path", async () => {
      const remoteFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ response: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const { executor } = makeExecutor({ remoteFetch });

      await executor({
        bot: "my bot@spark01",
        prompt: "Test",
        stepRunId: "run-1:test:abc",
      });

      expect(remoteFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `/bots/${encodeURIComponent("my bot")}/query`,
        }),
      );
    });
  });
});
