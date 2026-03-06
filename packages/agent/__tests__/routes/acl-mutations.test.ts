import { describe, it, expect, vi, type Mock } from "vitest";
import Fastify from "fastify";
import { registerAclRoutes } from "../../src/routes/acl.js";

function makeAclEngine() {
  return {
    grant: vi.fn() as Mock,
    revoke: vi.fn() as Mock,
    check: vi.fn() as Mock,
    listRules: vi.fn().mockReturnValue([]) as Mock,
    listConnections: vi.fn() as Mock,
    save: vi.fn() as Mock,
  };
}

describe("POST /acl/grant", () => {
  it("grants a valid capability", async () => {
    const acl = makeAclEngine();
    const app = Fastify();
    registerAclRoutes(app, { acl });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/acl/grant",
      payload: { source: "alice", target: "bob", capability: "query" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(acl.grant).toHaveBeenCalledWith("alice", "bob", ["query"]);
    expect(acl.save).toHaveBeenCalled();
    await app.close();
  });

  it("rejects invalid capability", async () => {
    const acl = makeAclEngine();
    const app = Fastify();
    registerAclRoutes(app, { acl });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/acl/grant",
      payload: { source: "alice", target: "bob", capability: "chat" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid capability");
    await app.close();
  });

  it("rejects missing fields", async () => {
    const acl = makeAclEngine();
    const app = Fastify();
    registerAclRoutes(app, { acl });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/acl/grant",
      payload: { source: "alice" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("required");
    await app.close();
  });
});

describe("POST /acl/revoke", () => {
  it("revokes an existing rule", async () => {
    const acl = makeAclEngine();
    const app = Fastify();
    registerAclRoutes(app, { acl });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/acl/revoke",
      payload: { source: "alice", target: "bob", capability: "query" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(acl.revoke).toHaveBeenCalledWith("alice", "bob", ["query"]);
    expect(acl.save).toHaveBeenCalled();
    await app.close();
  });

  it("rejects invalid capability", async () => {
    const acl = makeAclEngine();
    const app = Fastify();
    registerAclRoutes(app, { acl });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/acl/revoke",
      payload: { source: "a", target: "b", capability: "invalid" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid capability");
    await app.close();
  });

  it("rejects missing fields", async () => {
    const acl = makeAclEngine();
    const app = Fastify();
    registerAclRoutes(app, { acl });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/acl/revoke",
      payload: { target: "bob" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("required");
    await app.close();
  });
});
