import { cn } from "@/lib/utils";

const COLORS = {
  connected: "bg-[#34c759]",
  success: "bg-[#34c759]",
  running: "bg-[#0071e3]",
  pending: "bg-[#ff9500]",
  scheduled: "bg-[#ff9500]",
  error: "bg-[#ff3b30]",
  failed: "bg-[#ff3b30]",
  disconnected: "bg-[#8e8e93]",
} as const;

const LABELS: Record<string, string> = {
  connected: "Đã kết nối",
  success: "Thành công",
  running: "Đang chạy",
  pending: "Chờ xác thực",
  scheduled: "Đã lên lịch",
  error: "Lỗi",
  failed: "Thất bại",
  disconnected: "Chưa kết nối",
};

export function StatusDot({
  status,
  label,
  size = 6,
}: {
  status: keyof typeof COLORS;
  label?: boolean | string;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn("inline-block rounded-full", COLORS[status])}
        style={{ width: size, height: size }}
      />
      {label !== false && (
        <span className="text-[12px] text-muted">
          {typeof label === "string" ? label : LABELS[status]}
        </span>
      )}
    </span>
  );
}
