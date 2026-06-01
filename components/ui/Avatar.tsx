import { initials } from "@/lib/utils";

export function Avatar({
  name,
  color = "#f5f5f7",
  size = 36,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{
        width: size,
        height: size,
        background: color,
        color: "#1d1d1f",
        fontSize: Math.max(11, size * 0.36),
      }}
    >
      {initials(name)}
    </div>
  );
}
