"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Top progress bar that animates on route transitions.
 * Shows immediately on link click, fades when new pathname renders.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Hook into all link clicks within the document.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let progressInterval: ReturnType<typeof setInterval> | null = null;

    function startProgress() {
      setVisible(true);
      setProgress(15);
      progressInterval = setInterval(() => {
        setProgress((p) => {
          if (p >= 90) return p;
          return p + (100 - p) * 0.08;
        });
      }, 200);
    }

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http") || anchor.target === "_blank") return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      // Only start progress for in-app navigations
      if (href === pathname) return;
      startProgress();
    }

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (timer) clearTimeout(timer);
      if (progressInterval) clearInterval(progressInterval);
    };
  }, [pathname]);

  // When pathname changes, finish the bar
  useEffect(() => {
    if (!visible) return;
    setProgress(100);
    const t = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed top-0 left-0 right-0 z-[100]">
      <div
        className="h-[2px] bg-foreground shadow-[0_0_8px_rgba(0,0,0,0.4)] transition-all duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
