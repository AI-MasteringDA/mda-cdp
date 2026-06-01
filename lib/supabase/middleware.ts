import { NextResponse, type NextRequest } from "next/server";

// DEV MODE — auth bypass. Sẽ bật lại sau khi backend xong.
// TODO V2: uncomment Supabase auth check + redirect logic
export async function updateSession(_request: NextRequest) {
  return NextResponse.next();
}
