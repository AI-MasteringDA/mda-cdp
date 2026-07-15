"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Search, Loader2 } from "lucide-react";
import { NotificationsBell } from "./NotificationsBell";
import { DataHealthBell } from "./DataHealthBell";
import { ApiKeyButton } from "./ApiKeyButton";

export function Topbar({ title }: { title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query.trim()) params.set("q", query.trim());
      else params.delete("q");
      params.delete("page");

      // Search works on /leads (with q param). Tier pages don't support text search
      // → redirect to /leads when query is set so user can find leads across tiers.
      const tierPages = ["/hot-leads", "/warm-leads", "/cool-leads", "/cold-leads", "/dormant-leads"];
      const isTierPage = tierPages.some((r) => pathname.startsWith(r));
      const targetPath = isTierPage && query.trim() ? "/leads" : pathname;
      const supportedRoutes = ["/leads", ...tierPages];
      if (!supportedRoutes.some((r) => pathname.startsWith(r))) return;

      const newUrl = `${targetPath}${params.toString() ? "?" + params.toString() : ""}`;
      startTransition(() => {
        router.push(newUrl, { scroll: false });
      });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--background)]/85 backdrop-blur-2xl">
      <div className="flex h-[68px] items-center gap-6 px-8">
        <h2 className="text-[18px] font-bold tracking-[-0.02em]">{title}</h2>

        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            {pending ? (
              <Loader2
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2 animate-spin"
                strokeWidth={1.75}
              />
            ) : (
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2"
                strokeWidth={1.75}
              />
            )}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm lead..."
              className="h-10 w-80 rounded-xl border border-[var(--border-subtle)] bg-[var(--subtle)] pl-10 pr-3 text-[13px] outline-none transition-all duration-300 placeholder:text-muted-2 focus:border-foreground focus:bg-white focus:w-96"
            />
          </div>
          <ApiKeyButton />
          <DataHealthBell />
          <NotificationsBell />
        </div>
      </div>
    </header>
  );
}
