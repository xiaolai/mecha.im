export interface MechaControlMessage {
  __mecha: true;
  type: string;
  id?: string;
  code?: number;
  message?: string;
}

export type WsParseResult =
  | { kind: "binary"; data: Uint8Array }
  | { kind: "text"; data: string }
  | { kind: "mecha-session"; id: string }
  | { kind: "mecha-exit"; code: number }
  | { kind: "mecha-error"; message: string };

/**
 * Parse a WebSocket message event.data into a typed result.
 * Expects ws.binaryType = "arraybuffer" so binary arrives as ArrayBuffer.
 */
export function parseWsMessage(data: ArrayBuffer | string): WsParseResult {
  if (data instanceof ArrayBuffer) {
    return { kind: "binary", data: new Uint8Array(data) };
  }

  const text = data;
  if (text.charAt(0) === "{") {
    try {
      const msg = JSON.parse(text) as Partial<MechaControlMessage> & { type: string };
      if (msg.__mecha) {
        if (msg.type === "session" && msg.id) {
          return { kind: "mecha-session", id: msg.id };
        }
        if (msg.type === "exit") {
          return { kind: "mecha-exit", code: typeof msg.code === "number" ? msg.code : -1 };
        }
        if (msg.type === "error") {
          return { kind: "mecha-error", message: msg.message ?? "Unknown error" };
        }
      }
    } catch {
      // not valid JSON — fall through to plain text
    }
  }

  return { kind: "text", data: text };
}
