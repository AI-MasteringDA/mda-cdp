import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSecretMetadata, setSecret, clearSecret, SECRET_KEYS } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/** GET — return metadata only (presence + last 4 chars + updated info) */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const meta = await getSecretMetadata(SECRET_KEYS.ANTHROPIC);
  return NextResponse.json(meta);
}

/** POST — save new key { value: "sk-ant-..." } */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { value?: string } | null;
  const value = body?.value?.trim();
  if (!value) {
    return NextResponse.json({ error: "Missing value" }, { status: 400 });
  }
  if (!value.startsWith("sk-ant-") || value.length < 30) {
    return NextResponse.json(
      { error: "Định dạng Anthropic API key không hợp lệ (phải bắt đầu bằng 'sk-ant-')" },
      { status: 400 }
    );
  }

  await setSecret(SECRET_KEYS.ANTHROPIC, value, user.email);

  return NextResponse.json({
    ok: true,
    display_hint: `...${value.slice(-4)}`,
    updated_by_email: user.email,
  });
}

/** DELETE — remove key (fall back to env) */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearSecret(SECRET_KEYS.ANTHROPIC);
  return NextResponse.json({ ok: true });
}
