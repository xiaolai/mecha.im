import { NextResponse } from "next/server";
import { ContainerNotFoundError, MechaError } from "@mecha/core";
import { toHttpStatus, toSafeMessage } from "@mecha/contracts";

export function isConflictError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "statusCode" in err && (err as { statusCode: number }).statusCode === 409;
}

export function handleDockerError(err: unknown): NextResponse {
  if (err instanceof ContainerNotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (err instanceof MechaError) {
    return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
  }
  if (isConflictError(err)) {
    return NextResponse.json({ error: "Conflict: container state unchanged" }, { status: 409 });
  }
  throw err;
}
