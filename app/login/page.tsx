"use client";

import { useState } from "react";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { signInWithMagicLink } from "./actions";

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
                Một liên kết đăng nhập đã được gửi đến{" "}
                <strong className="text-foreground">{sent}</strong>. Click link
                để vào dashboard.
              </p>
              <p className="text-[12px] text-muted-2">
                Không thấy mail? Kiểm tra thư mục Spam, hoặc{" "}
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
                Nhập email công ty — chúng tôi gửi link đăng nhập, không cần
                mật khẩu.
              </p>

              <form action={handleSubmit} className="mt-8 space-y-4">
                <div>
                  <label className="text-[12px] font-medium text-foreground">
                    Email công ty
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
                  className="mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-foreground text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {pending ? "Đang gửi..." : "Gửi link đăng nhập"}
                </button>
              </form>
            </>
          )}
        </div>
      </main>

      <footer className="py-6 text-center text-[11px] text-muted-2">
        © 2026 Mastering Data Analytics. Nội bộ.
      </footer>
    </div>
  );
}
