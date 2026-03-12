import { describe, it, expect, vi, afterEach } from "vitest";
import { botUrl } from "./api";

describe("botUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns path as-is when no /dashboard/ in pathname", () => {
    vi.stubGlobal("window", { location: { pathname: "/" } });
    expect(botUrl("/api/sessions")).toBe("/api/sessions");
  });

  it("prepends prefix when /dashboard/ is found in pathname", () => {
    vi.stubGlobal("window", { location: { pathname: "/bot1/dashboard/" } });
    expect(botUrl("/api/sessions")).toBe("/bot1/api/sessions");
  });

  it("normalizes path without leading slash", () => {
    vi.stubGlobal("window", { location: { pathname: "/" } });
    expect(botUrl("api/sessions")).toBe("/api/sessions");
  });

  it("handles nested prefix paths", () => {
    vi.stubGlobal("window", { location: { pathname: "/a/b/dashboard/settings" } });
    expect(botUrl("/health")).toBe("/a/b/health");
  });
});
