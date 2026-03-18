import { logEvent } from "../event-log.js";
import { isValidName } from "../../shared/validation.js";
import { log } from "../../shared/logger.js";

const FLEET_INTERNAL_SECRET = process.env.MECHA_FLEET_INTERNAL_SECRET;

export async function callBot(botName: string, message: string): Promise<string> {
  if (!isValidName(botName)) {
    return `Error: invalid bot name "${botName}" (must be lowercase alphanumeric + hyphens, 1-32 chars)`;
  }
  // Use fleet API proxy if available (works across Docker networks), else direct DNS
  const fleetUrl = process.env.MECHA_FLEET_URL;
  const url = fleetUrl
    ? `${fleetUrl}/bot/${encodeURIComponent(botName)}/prompt`
    : `http://mecha-${botName}:3000/prompt`;
  const start = Date.now();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (FLEET_INTERNAL_SECRET) {
    headers["x-mecha-internal-auth"] = FLEET_INTERNAL_SECRET;
    if (fleetUrl) headers["Authorization"] = `Bearer ${FLEET_INTERNAL_SECRET}`;
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 min timeout
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent({ type: "mecha_call", target: botName, duration: Date.now() - start, success: false, error: msg });
    return `Error: could not reach bot "${botName}" — ${msg}`;
  }

  if (resp.status === 409) {
    logEvent({ type: "mecha_call", target: botName, duration: Date.now() - start, success: false, error: "busy" });
    return `Error: bot "${botName}" is busy processing another request`;
  }

  if (!resp.ok) {
    logEvent({ type: "mecha_call", target: botName, duration: Date.now() - start, success: false, error: `HTTP ${resp.status}` });
    return `Error: bot "${botName}" returned HTTP ${resp.status}`;
  }

  // Parse SSE stream and collect text
  const reader = resp.body?.getReader();
  if (!reader) {
    logEvent({ type: "mecha_call", target: botName, duration: Date.now() - start, success: false, error: "no body" });
    return "Error: no response body";
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const textParts: string[] = [];
  let parseErrors = 0;

  // SSE parser: accumulate event blocks (event + data lines), dispatch on blank line
  let currentData: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line === "") {
        // End of SSE event block — process accumulated data
        if (currentData.length > 0) {
          const joined = currentData.join("\n");
          try {
            const data = JSON.parse(joined);
            if (data.content) textParts.push(data.content);
            if (data.message && !data.task_id) textParts.push(`[error: ${data.message}]`);
          } catch {
            parseErrors++;
          }
        }
        currentData = [];
      } else if (line.startsWith("data: ")) {
        currentData.push(line.slice(6));
      } else if (line.startsWith("data:")) {
        currentData.push(line.slice(5));
      }
    }
  }

  // Process any trailing event block without final blank line
  if (currentData.length > 0) {
    const joined = currentData.join("\n");
    try {
      const data = JSON.parse(joined);
      if (data.content) textParts.push(data.content);
    } catch {
      parseErrors++;
    }
  }

  if (parseErrors > 0) {
    log.warn(`mecha_call to "${botName}": ${parseErrors} malformed SSE data chunk(s) skipped`);
  }

  const result = textParts.join("") || "(empty response)";
  logEvent({ type: "mecha_call", target: botName, duration: Date.now() - start, success: true });
  return result;
}
