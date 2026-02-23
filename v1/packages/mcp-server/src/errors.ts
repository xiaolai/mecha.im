import type { MechaLocator } from "@mecha/service";
import {
  MechaNotLocatedError,
  SessionNotFoundError,
} from "@mecha/contracts";

export interface ToolErrorResult {
  content: [{ type: "text"; text: string }];
  isError: true;
}

/**
 * Map any error to an MCP tool error content block.
 * Optionally invalidates locator cache for location/session errors.
 */
export function toolError(
  err: unknown,
  locator?: MechaLocator,
  mechaId?: string,
): ToolErrorResult {
  // Invalidate cache on location or session errors
  if (locator && mechaId) {
    if (err instanceof MechaNotLocatedError || err instanceof SessionNotFoundError) {
      locator.invalidate(mechaId);
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

/** Helper to create a successful text content result. */
export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
