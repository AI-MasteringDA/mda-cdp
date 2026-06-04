"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ROUTES: Record<string, { path: string; label: string }> = {
  d: { path: "/dashboard",     label: "Dashboard" },
  h: { path: "/hot-leads",     label: "Hot Leads" },
  w: { path: "/warm-leads",    label: "Warm Leads" },
  c: { path: "/cool-leads",    label: "Cool Leads" },
  n: { path: "/dormant-leads", label: "Dormant Leads" },
  a: { path: "/leads",         label: "All Leads" },
  g: { path: "/growth",        label: "Growth" },
  s: { path: "/sync-jobs",     label: "Sync Jobs" },
  i: { path: "/integrations",  label: "Integrations" },
  "?": { path: "", label: "" }, // help
};

export function KeyboardNav() {
  const router = useRouter();
  const [waitingForG, setWaitingForG] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function onKey(e: KeyboardEvent) {
      // Don't intercept in inputs/textareas/contenteditable
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) return;

      // Modifier keys (Ctrl/Cmd) → skip
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // ? → show help
      if (e.key === "?" && !waitingForG) {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      // ESC closes help
      if (e.key === "Escape") {
        setShowHelp(false);
        setWaitingForG(false);
        setShowHint(false);
        return;
      }

      // Start `g` chord
      if (!waitingForG && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setWaitingForG(true);
        setShowHint(true);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          setWaitingForG(false);
          setShowHint(false);
        }, 1500);
        return;
      }

      // Second key after g
      if (waitingForG) {
        e.preventDefault();
        if (timer) clearTimeout(timer);
        const key = e.key.toLowerCase();
        const route = ROUTES[key];
        setWaitingForG(false);
        setShowHint(false);
        if (route && route.path) {
          router.push(route.path);
        }
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [waitingForG, router]);

  return (
    <>
      {showHint && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] hairline rounded-xl bg-foreground px-4 py-2 text-white shadow-xl">
          <span className="text-[12px]">
            <kbd className="font-mono rounded bg-white/20 px-1.5 py-0.5 mr-1">g</kbd>
            + {Object.entries(ROUTES).filter(([k]) => k !== "?").slice(0, 6).map(([k, r]) => (
              <span key={k} className="mr-2">
                <kbd className="font-mono rounded bg-white/20 px-1.5 py-0.5 mr-0.5">{k}</kbd>
                {r.label.toLowerCase()}
              </span>
            ))}
          </span>
        </div>
      )}

      {showHelp && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="hairline w-[440px] rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="text-[16px] font-semibold tracking-tight">⌨️ Phím tắt</h3>
              <button onClick={() => setShowHelp(false)} className="text-[11px] text-muted-2 hover:text-foreground">
                ESC để đóng
              </button>
            </div>

            <div className="space-y-3">
              <Section title="Navigation (gõ g + phím)">
                <Row keys={["g", "d"]} label="Dashboard" />
                <Row keys={["g", "h"]} label="Hot Leads" />
                <Row keys={["g", "w"]} label="Warm Leads" />
                <Row keys={["g", "c"]} label="Cool Leads" />
                <Row keys={["g", "n"]} label="Dormant Leads" />
                <Row keys={["g", "a"]} label="All Leads" />
                <Row keys={["g", "g"]} label="Growth" />
                <Row keys={["g", "s"]} label="Sync Jobs" />
                <Row keys={["g", "i"]} label="Integrations" />
              </Section>

              <Section title="Sidebar">
                <Row keys={["Ctrl", "B"]} label="Toggle sidebar collapse" />
              </Section>

              <Section title="Help">
                <Row keys={["?"]} label="Hiện / ẩn cheatsheet này" />
                <Row keys={["ESC"]} label="Đóng modal" />
              </Section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold mb-1.5">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[12px]">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="mx-0.5 text-muted-2">+</span>}
            <kbd className="hairline rounded-md bg-subtle px-1.5 py-0.5 text-[11px] font-mono font-semibold text-foreground">{k}</kbd>
          </span>
        ))}
      </div>
    </div>
  );
}
