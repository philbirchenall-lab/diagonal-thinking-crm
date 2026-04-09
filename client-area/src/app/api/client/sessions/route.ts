import { NextResponse } from "next/server";
import { listClientSessions } from "@/lib/client-data";

export async function GET() {
  const sessions = await listClientSessions();

  return NextResponse.json({
    sessions,
  });
}
