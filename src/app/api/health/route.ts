import { NextResponse } from "next/server";

/** Liveness for a host or a monitor. Public by design and returns nothing about the data. */
export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
