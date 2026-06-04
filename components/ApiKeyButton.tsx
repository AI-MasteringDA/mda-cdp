"use client";

import { useState, useEffect, useRef } from "react";
import { Key, X, Eye, EyeOff, Check, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/Toast";

type SecretMeta = {
  present: boolean;
  display_hint: string | null;
  updated_at: string | null;
  updated_by_email: string | null;
};

export function ApiKeyButton() {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<SecretMeta | null>(null);
  const [input, setInput] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Fetch metadata on mount + when modal opens
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/secrets/anthropic-key");
        if (!res.ok) return;
        const data = (await res.json()) as SecretMeta;
        if (!cancelled) setMeta(data);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function save() {
    const val = input.trim();
    if (!val) {
      toast.error("Vui lòng paste key vào");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/secrets/anthropic-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: val }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Đã lưu Anthropic API key", `Display: ${data.display_hint}`);
      setMeta({
        present: true,
        display_hint: data.display_hint,
        updated_at: new Date().toISOString(),
        updated_by_email: data.updated_by_email,
      });
      setInput("");
    } catch (e) {
      toast.error("Lưu thất bại", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    if (!confirm("Xoá Anthropic API key? AI sẽ dùng ANTHROPIC_API_KEY từ env (nếu có) hoặc lỗi.")) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/secrets/anthropic-key", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Đã xoá Anthropic API key");
      setMeta({ present: false, display_hint: null, updated_at: null, updated_by_email: null });
    } catch (e) {
      toast.error("Xoá thất bại", (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function fmtRelative(iso: string | null): string {
    if (!iso) return "";
    const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffMin < 1) return "vừa xong";
    if (diffMin < 60) return `${diffMin}m trước`;
    if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h trước`;
    return `${Math.floor(diffMin / (60 * 24))}d trước`;
  }

  const isSet = meta?.present === true;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="press relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-muted transition-all hover:bg-[var(--subtle)] hover:text-foreground"
        title={isSet ? `Anthropic key đã set (${meta?.display_hint})` : "Set Anthropic API key cho AI"}
      >
        <Key className="h-4 w-4" strokeWidth={1.75} />
        {isSet && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--success)] border-2 border-white">
            <Check className="h-2 w-2 text-white" strokeWidth={3} />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[440px] hairline rounded-2xl bg-white shadow-xl overflow-hidden z-50">
          <div className="hairline-b px-4 py-3 flex items-center justify-between bg-subtle">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-foreground" strokeWidth={1.75} />
              <h3 className="text-[14px] font-semibold">Anthropic API Key</h3>
            </div>
            <button onClick={() => setOpen(false)} className="press text-muted-2 hover:text-foreground">
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Current status */}
            {isSet ? (
              <div className="rounded-lg bg-[#f0fdf4] p-3 border border-[#bbf7d0]">
                <div className="flex items-center gap-2 mb-1">
                  <Check className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={2} />
                  <span className="text-[12px] font-semibold text-[#15803d]">Đã set key</span>
                </div>
                <div className="text-[12px] text-[#166534] space-y-0.5">
                  <div>
                    <span className="font-mono text-muted-2">sk-ant-...</span>
                    <span className="font-mono font-semibold">{meta?.display_hint?.replace("...", "")}</span>
                  </div>
                  <div className="text-[11px] text-muted">
                    Set bởi <strong>{meta?.updated_by_email}</strong> · {fmtRelative(meta?.updated_at ?? null)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-[#fef9c3] p-3 border border-[#fde68a]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[12px] font-semibold text-[#854d0e]">⚠️ Chưa có key</span>
                </div>
                <p className="text-[11px] text-[#854d0e] leading-relaxed">
                  AI Insights và Growth Plan sẽ không hoạt động. Lấy key từ{" "}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium"
                  >
                    console.anthropic.com
                  </a>{" "}
                  → paste vào dưới.
                </p>
              </div>
            )}

            {/* Input */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-2 font-semibold mb-1.5">
                {isSet ? "Thay key mới" : "Paste key Anthropic"}
              </label>
              <div className="relative">
                <input
                  type={showInput ? "text" : "password"}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full h-10 rounded-lg border border-[var(--border-subtle)] bg-white pl-3 pr-10 text-[12px] font-mono outline-none focus:border-foreground"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowInput((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 press p-1 text-muted-2 hover:text-foreground"
                  title={showInput ? "Ẩn" : "Hiện"}
                >
                  {showInput ? (
                    <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-2 leading-relaxed">
                Key bắt đầu bằng <code className="font-mono">sk-ant-</code> · lưu vào Supabase (workspace-shared) ·
                user khác login cùng workspace cũng tự nhận key này.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving || !input.trim()}
                className="press inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50 flex-1 justify-center"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {isSet ? "Cập nhật key" : "Lưu key"}
              </button>
              {isSet && (
                <button
                  onClick={clearKey}
                  disabled={deleting}
                  className="press inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-2 text-[12px] font-medium text-[var(--hot)] hover:bg-[#fef2f2] disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  Xoá
                </button>
              )}
            </div>

            {/* Security note */}
            <div className="rounded-lg bg-subtle p-2.5">
              <p className="text-[10px] text-muted leading-relaxed">
                🔒 <strong>Bảo mật</strong>: key lưu trong <code className="font-mono">workspace_secret</code> table với
                RLS chặn client đọc trực tiếp. Chỉ server-side API (service role) đọc raw value để gọi Claude.
                Display chỉ hiện 4 ký tự cuối.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
