"use client";

import { useState } from "react";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { signInWithMagicLink, signInWithGoogle } from "./actions";

export default function LoginPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await signInWithMagicLink(formData);
    setPending(false);
    if (result?.error) setError(result.error);
    else if (result?.success) setSent(result.email);
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
                Dùng tài khoản Google công ty để vào nhanh.
              </p>

              {/* Google OAuth — cách chính cho cả team (magic link bị giới hạn
                  gửi mail nên chỉ chủ dự án nhận được). */}
              <form action={signInWithGoogle} className="mt-8">
                <button
                  type="submit"
                  className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-white text-[14px] font-medium transition-colors hover:bg-[#f7f8fa]"
                >
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
                    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z" />
                    <path fill="#FBBC05" d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.3C2.8 17.2 2 20.5 2 24s.8 6.8 2.3 9.8l7.4-5.7z" />
                    <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.4 5.7c1.7-5.2 6.6-9.1 12.3-9.1z" />
                  </svg>
                  Đăng nhập với Google
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border-subtle)]" />
                <span className="text-[11px] text-muted-2">hoặc nhận link qua email</span>
                <div className="h-px flex-1 bg-[var(--border-subtle)]" />
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
