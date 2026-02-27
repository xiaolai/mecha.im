import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaFind } from "@mecha/service";
import { getProcessManager, getMechaDir } from "@/lib/pm-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const pm = getProcessManager();
    const mechaDir = getMechaDir();
    const casas = casaFind(mechaDir, pm, {});
    return NextResponse.json(casas);
  } catch (err) {
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.exitCode === 1 ? 400 : 500 });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
