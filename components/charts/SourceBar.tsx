"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

type SourceData = { name: string; touchpoints: number; leads: number; color: string };

export function SourceBar({ data, metric = "touchpoints" }: { data: SourceData[]; metric?: "touchpoints" | "leads" }) {
  const formatted = data.map((d) => ({
    name: d.name,
    value: metric === "touchpoints" ? d.touchpoints : d.leads,
    color: d.color,
  }));

  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f5f5f7" vertical={false} />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#86868b" }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#86868b" }}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid #e5e5ea",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [Number(value).toLocaleString("vi-VN"), metric === "touchpoints" ? "Touchpoints" : "Leads"]}
            cursor={{ fill: "#f5f5f7" }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {formatted.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
