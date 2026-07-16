"use client";

import { useState } from "react";
import { initials } from "@/lib/utils";

/**
 * Avatar ảnh thật (Zalo/Facebook, từ SMAX) khi có, fallback chữ cái nếu
 * không có ảnh hoặc ảnh lỗi (link SMAX có chữ ký hết hạn — ETL refresh liên
 * tục nhưng vẫn có thể lệch nhịp với client).
 */
export function Avatar({
  name,
  color = "#f5f5f7",
  size = 36,
  src,
}: {
  name: string;
  color?: string;
  size?: number;
  src?: string | null;
}) {
  const [broken, setBroken] = useState(false);

  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- ảnh ngoại vùng (Zalo/Facebook CDN), domain không cố định nên next/image không phù hợp
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

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
