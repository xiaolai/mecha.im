import { randomBytes } from "node:crypto";

const TICKET_TTL_MS = 30_000; // 30 seconds
const tickets = new Map<string, number>();

/** Issue a single-use, short-lived ticket for WebSocket auth. */
export function issueTicket(): string {
  const ticket = randomBytes(24).toString("base64url");
  tickets.set(ticket, Date.now());
  return ticket;
}

/** Validate and consume a ticket. Returns true once, then ticket is deleted. */
export function consumeTicket(ticket: string): boolean {
  const ts = tickets.get(ticket);
  if (ts === undefined) return false;
  tickets.delete(ticket);
  return Date.now() - ts < TICKET_TTL_MS;
}

/** Purge expired tickets (called periodically or on demand). */
export function purgeTickets(): void {
  const cutoff = Date.now() - TICKET_TTL_MS;
  for (const [ticket, ts] of tickets) {
    if (ts < cutoff) tickets.delete(ticket);
  }
}
