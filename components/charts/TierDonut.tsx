"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

type TierData = { name: string; value: number; color: string };

export function TierDonut({ data }: { data: TierData[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex h-[260px] items-center gap-4">
      <div className="relative h-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={95}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "white",
                border: "1px solid #e5e5ea",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value, name) => [`${Number(value).toLocaleString("vi-VN")} leads`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[24px] font-semibold tabular-nums">
            {total.toLocaleString("vi-VN")}
          </div>
          <div className="text-[11px] text-muted-2 uppercase tracking-wider">tổng lead</div>
        </div>
      </div>
      <div className="flex w-[160px] flex-col gap-2.5">
        {data.map((d) => {
          const pct = total ? (d.value / total * 100) : 0;
          return (
            <div key={d.name} className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: d.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium truncate">{d.name}</span>
                  <span className="text-[12px] tabular-nums text-muted">
                    {d.value.toLocaleString("vi-VN")}
                  </span>
                </div>
                <div className="mt-0.5 h-0.5 w-full rounded bg-subtle overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{ width: `${pct}%`, background: d.color }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
