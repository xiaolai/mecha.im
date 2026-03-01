import { describe, it, expect, vi, afterEach } from "vitest";
import { issueTicket, consumeTicket, purgeTickets } from "../src/ws-tickets.js";

describe("ws-tickets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues and consumes a ticket", () => {
    const ticket = issueTicket();
    expect(typeof ticket).toBe("string");
    expect(ticket.length).toBeGreaterThan(0);
    expect(consumeTicket(ticket)).toBe(true);
  });

  it("rejects already-consumed ticket", () => {
    const ticket = issueTicket();
    consumeTicket(ticket);
    expect(consumeTicket(ticket)).toBe(false);
  });

  it("rejects unknown ticket", () => {
    expect(consumeTicket("nonexistent")).toBe(false);
  });

  it("rejects expired ticket", () => {
    const ticket = issueTicket();
    // Advance time past TTL
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    expect(consumeTicket(ticket)).toBe(false);
  });

  it("purges expired tickets", () => {
    const ticket = issueTicket();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    purgeTickets();
    expect(consumeTicket(ticket)).toBe(false);
  });

  it("purge keeps non-expired tickets", () => {
    const ticket = issueTicket();
    purgeTickets(); // ticket is fresh, should survive
    expect(consumeTicket(ticket)).toBe(true);
  });
});
