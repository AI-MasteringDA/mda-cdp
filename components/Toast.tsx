"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";

type ToastKind = "success" | "error" | "info" | "warning";
type Toast = { id: number; kind: ToastKind; title: string; description?: string; ttl: number };

type ToastContextValue = {
  show: (toast: Omit<Toast, "id" | "ttl"> & { ttl?: number }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let nextId = 0;

  const show = useCallback((t: Omit<Toast, "id" | "ttl"> & { ttl?: number }) => {
    const id = ++nextId;
    setToasts((arr) => [...arr, { ...t, id, ttl: t.ttl ?? 4000 }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((arr) => arr.filter((t) => t.id !== id));
  }, []);

  const ctxValue: ToastContextValue = {
    show,
    success: (title, description) => show({ kind: "success", title, description }),
    error: (title, description) => show({ kind: "error", title, description }),
    info: (title, description) => show({ kind: "info", title, description }),
    warning: (title, description) => show({ kind: "warning", title, description }),
  };

  return (
    <ToastContext.Provider value={ctxValue}>
      {children}
      <div className="fixed bottom-6 right-6 z-[80] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Graceful fallback so components don't crash if used outside provider
    return {
      show: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
    };
  }
  return ctx;
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setShow(true));
    const timer = setTimeout(() => {
      setShow(false);
      setTimeout(onClose, 200);
    }, toast.ttl);
    return () => clearTimeout(timer);
  }, [toast.ttl, onClose]);

  const styles: Record<ToastKind, { icon: typeof CheckCircle2; bg: string; iconColor: string }> = {
    success: { icon: CheckCircle2, bg: "bg-[#f0fdf4]", iconColor: "text-[var(--success)]" },
    error:   { icon: XCircle,      bg: "bg-[#fef2f2]", iconColor: "text-[var(--hot)]" },
    info:    { icon: Info,         bg: "bg-[#eff6ff]", iconColor: "text-[var(--accent)]" },
    warning: { icon: AlertTriangle, bg: "bg-[#fef9c3]", iconColor: "text-[var(--warm)]" },
  };
  const { icon: Icon, bg, iconColor } = styles[toast.kind];

  return (
    <div
      className={`pointer-events-auto hairline ${bg} flex w-[360px] items-start gap-3 rounded-xl p-4 shadow-xl transition-all duration-200 ease-out ${
        show ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{toast.title}</div>
        {toast.description && (
          <div className="mt-0.5 text-[12px] text-muted">{toast.description}</div>
        )}
      </div>
      <button
        onClick={() => {
          setShow(false);
          setTimeout(onClose, 200);
        }}
        className="press text-muted-2 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
