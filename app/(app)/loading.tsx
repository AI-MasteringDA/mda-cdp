import { Topbar } from "@/components/Topbar";

export default function Loading() {
  return (
    <>
      <Topbar title="Đang tải..." />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        {/* Header skeleton */}
        <div className="mb-6 space-y-2 animate-pulse">
          <div className="h-7 w-64 rounded bg-subtle" />
          <div className="h-4 w-96 rounded bg-subtle" />
        </div>

        {/* KPI row skeleton */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="hairline rounded-2xl bg-white p-5 animate-pulse"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="h-3 w-24 rounded bg-subtle mb-3" />
              <div className="h-7 w-20 rounded bg-subtle" />
            </div>
          ))}
        </div>

        {/* Content card skeleton */}
        <div className="hairline rounded-2xl bg-white animate-pulse">
          <div className="hairline-b px-6 py-4">
            <div className="h-4 w-48 rounded bg-subtle mb-2" />
            <div className="h-3 w-72 rounded bg-subtle" />
          </div>
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded bg-subtle" />
                <div className="h-3 rounded bg-subtle" style={{ width: `${60 + (i % 4) * 10}%` }} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
