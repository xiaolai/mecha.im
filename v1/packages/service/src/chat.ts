import type { ProcessManager } from "@mecha/process";
import {
  ChatRequestFailedError,
} from "@mecha/contracts";
import type {
  MechaChatInputType,
} from "@mecha/contracts";
import { getRuntimeAccess } from "./helpers.js";

// --- mechaChat ---
// Uses getRuntimeAccess directly (not runtimeFetch) because chat errors
// throw ChatRequestFailedError, not the session-specific mapSessionError.
export async function mechaChat(
  pm: ProcessManager,
  input: MechaChatInputType,
): Promise<Response> {
  const { url, token } = await getRuntimeAccess(pm, input.id);
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: input.message }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ChatRequestFailedError(input.id, res.status, res.statusText);
  return res;
}
