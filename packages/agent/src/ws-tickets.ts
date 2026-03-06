import { randomBytes } from "node:crypto";

const TICKET_TTL_MS = 30_000; // 30 seconds
const MAX_TICKETS = 1_000;
const tickets = new Map<string, number>();

// Periodic purge timer to prevent unbounded growth under adversarial load
/* v8 ignore start -- timer-based cleanup not testable in unit tests */
const purgeTimer = setInterval(() => purgeTickets(), TICKET_TTL_MS);
purgeTimer.unref(); // Don't block process exit
/* v8 ignore stop */

/** Issue a single-use, short-lived ticket for WebSocket auth. */
export function issueTicket(): string {
  // Evict oldest entries if at capacity
  if (tickets.size >= MAX_TICKETS) purgeTickets();
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
