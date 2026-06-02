"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Search, Bell, Loader2 } from "lucide-react";

export function Topbar({ title }: { title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  // Sync query state nếu URL thay đổi từ ngoài
  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  // Debounced URL update
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query.trim()) {
        params.set("q", query.trim());
      } else {
        params.delete("q");
      }
      params.delete("page"); // reset pagination on new search

      // Chỉ apply filter cho các route có support
      const supportedRoutes = ["/leads", "/hot-leads", "/cold-leads"];
      if (!supportedRoutes.some((r) => pathname.startsWith(r))) return;

      const newUrl = `${pathname}${params.toString() ? "?" + params.toString() : ""}`;
      startTransition(() => {
        router.push(newUrl, { scroll: false });
      });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pathname]);

  return (
    <header className="hairline-b sticky top-0 z-10 flex h-16 items-center gap-6 bg-white/80 px-8 backdrop-blur-md">
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>

      <div className="ml-auto flex items-center gap-3">
        <div className="relative">
          {pending ? (
            <Loader2
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2"
              strokeWidth={1.75}
            />
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên, email, SĐT..."
            className="h-9 w-72 rounded-lg border border-[var(--border-subtle)] bg-subtle pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-2 focus:border-[var(--accent)] focus:bg-white"
          />
        </div>
        <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle">
          <Bell className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
