import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerChatRoutes } from "../../src/routes/chat.js";

describe("chat routes (stub)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerChatRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 501 not implemented", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello" },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toContain("Agent SDK");
  });
});
