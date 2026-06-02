"use client";

import { useState } from "react";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { signInWithMagicLink } from "./actions";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await signInWithMagicLink(formData);
    setPending(false);
    if (result?.error) setError(result.error);
    else if (result?.success) setSent(result.email);
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <main className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-[380px]">
          <div className="mb-10 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground">
              <Sparkles className="h-4 w-4 text-white" strokeWidth={1.75} />
            </div>
            <span className="text-[14px] font-semibold tracking-tight">
              MDA Platform
            </span>
          </div>

          {sent ? (
            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#dcfce7]">
                <CheckCircle2
                  className="h-6 w-6 text-[var(--success)]"
                  strokeWidth={1.75}
                />
              </div>
              <h1 className="text-[28px] font-semibold tracking-tight">
                Kiểm tra email
              </h1>
              <p className="text-[14px] text-muted leading-relaxed">
                Link đăng nhập đã gửi đến{" "}
                <strong className="text-foreground">{sent}</strong>.
              </p>
              <p className="text-[12px] text-muted-2">
                Không thấy mail? Kiểm tra Spam, hoặc{" "}
                <button
                  onClick={() => setSent(null)}
                  className="text-[var(--accent)] hover:underline"
                >
                  thử lại
                </button>
                .
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-[32px] font-semibold tracking-tight">
                Đăng nhập
              </h1>
              <p className="mt-2 text-[14px] text-muted">
                Dùng tài khoản Google công ty hoặc email magic link.
              </p>

              <button
                onClick={handleGoogleLogin}
                disabled={googleLoading}
                className="mt-8 flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-white text-[14px] font-medium text-foreground transition-colors hover:bg-subtle disabled:opacity-60"
              >
                <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.7 33 30 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l6.3-6.3C34.5 5.4 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5c11.3 0 20.5-9.2 20.5-20.5 0-1.4-.1-2.7-.5-4z"/>
                </svg>
                {googleLoading ? "Đang chuyển..." : "Đăng nhập với Google"}
              </button>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border-subtle)]"></div>
                <span className="text-[11px] uppercase tracking-wider text-muted-2">hoặc</span>
                <div className="h-px flex-1 bg-[var(--border-subtle)]"></div>
              </div>

              <form action={handleSubmit} className="space-y-3">
                <div>
                  <label className="text-[12px] font-medium text-foreground">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="ban@mastering-da.com"
                    className="mt-1.5 h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-white px-3 text-[14px] outline-none transition-colors placeholder:text-muted-2 focus:border-[var(--accent)]"
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-[#fff5f5] p-3 text-[12px] text-[var(--hot)]">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="flex h-11 w-full items-center justify-center rounded-lg bg-foreground text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {pending ? "Đang gửi..." : "Gửi magic link qua email"}
                </button>
              </form>
            </>
          )}
        </div>
      </main>

      <footer className="py-6 text-center text-[11px] text-muted-2">
        © 2026 MDA Platform
      </footer>
    </div>
  );
}
