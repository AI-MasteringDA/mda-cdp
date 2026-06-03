"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type DayData = { day: string; chat: number; email: number; conversion: number; other: number };

export function DailyActivityArea({ data }: { data: DayData[] }) {
  return (
    <div className="h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colChat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="colEmail" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="colConv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.7} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f5f5f7" vertical={false} />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#86868b" }}
            interval="preserveStartEnd"
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
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          <Area type="monotone" dataKey="chat" name="Chat" stackId="1" stroke="#3b82f6" fill="url(#colChat)" />
          <Area type="monotone" dataKey="email" name="Email" stackId="1" stroke="#f59e0b" fill="url(#colEmail)" />
          <Area type="monotone" dataKey="conversion" name="Conversion" stackId="1" stroke="#22c55e" fill="url(#colConv)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
