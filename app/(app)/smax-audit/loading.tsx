/**
 * Hiện ngay khi đổi khoảng ngày / đổi tab — thay vì để trang đứng im
 * trong lúc server truy vấn (khoảng 1 năm mất vài giây).
 */
export default function SmaxAuditLoading() {
  return (
    <main className="mx-auto max-w-[1280px] px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-[220px] animate-pulse rounded-lg bg-subtle" />
          <div className="h-4 w-[420px] animate-pulse rounded bg-subtle" />
        </div>
        <div className="h-9 w-[150px] animate-pulse rounded-lg bg-subtle" />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bezel">
            <div className="bezel-inner space-y-4 p-6">
              <div className="h-3 w-[90px] animate-pulse rounded bg-subtle" />
              <div className="h-9 w-[110px] animate-pulse rounded-lg bg-subtle" />
              <div className="h-3 w-[130px] animate-pulse rounded bg-subtle" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="bezel">
          <div className="bezel-inner p-6">
            <div className="mb-6 h-4 w-[200px] animate-pulse rounded bg-subtle" />
            <div className="flex h-[180px] items-end gap-[3px]">
              {[38, 55, 70, 44, 62, 35, 50, 78, 46, 66, 58, 84, 52, 72, 60].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 animate-pulse rounded-t-[4px] bg-subtle"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="bezel">
          <div className="bezel-inner space-y-4 p-6">
            <div className="h-4 w-[160px] animate-pulse rounded bg-subtle" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-[120px] animate-pulse rounded bg-subtle" />
                <div className="h-2.5 w-full animate-pulse rounded bg-subtle" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
