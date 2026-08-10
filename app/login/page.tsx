import { Sparkles } from "lucide-react";
import { signInWithGoogle } from "./actions";

/**
 * Đăng nhập CHỈ bằng Google. Bỏ magic link vì SMTP mặc định của Supabase chỉ
 * gửi được cho chủ dự án (~4 mail/giờ) → cả team không đăng nhập nổi.
 * Tên miền được chặn ở /auth/callback (xem ALLOWED_EMAIL_DOMAINS).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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

          <h1 className="text-[32px] font-semibold tracking-tight">Đăng nhập</h1>
          <p className="mt-2 text-[14px] text-muted">
            Dùng tài khoản Google công ty (@mastering-da.com).
          </p>

          {error && (
            <div className="mt-6 rounded-lg bg-[#fff5f5] p-3 text-[12px] leading-relaxed text-[var(--hot)]">
              {error}
            </div>
          )}

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

          <p className="mt-6 text-[12px] leading-relaxed text-muted-2">
            Chưa vào được? Liên hệ quản trị để cấp quyền cho email công ty của bạn.
          </p>
        </div>
      </main>

      <footer className="py-6 text-center text-[11px] text-muted-2">
        © 2026 MDA Platform
      </footer>
    </div>
  );
}
