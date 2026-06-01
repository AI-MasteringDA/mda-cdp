import { Search, Bell } from "lucide-react";

export function Topbar({ title }: { title: string }) {
  return (
    <header className="hairline-b sticky top-0 z-10 flex h-16 items-center gap-6 bg-white/80 px-8 backdrop-blur-md">
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>

      <div className="ml-auto flex items-center gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2"
            strokeWidth={1.75}
          />
          <input
            type="search"
            placeholder="Tìm học viên, email, SĐT..."
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
