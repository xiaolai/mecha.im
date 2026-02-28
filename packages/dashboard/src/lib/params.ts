import { NextResponse } from "next/server";
import { casaName, type CasaName } from "@mecha/core";

/**
 * Parse and validate a CASA name from a route param.
 * Returns [CasaName, null] on success or [null, NextResponse] with a 400 error.
 */
export function parseCasaNameParam(raw: string): [CasaName, null] | [null, NextResponse] {
  try {
    return [casaName(raw), null];
  } catch {
    return [null, NextResponse.json({ error: `Invalid CASA name: ${raw}` }, { status: 400 })];
  }
}
