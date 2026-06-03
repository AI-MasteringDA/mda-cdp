"use client";

import dynamic from "next/dynamic";

// ssr: false ensures recharts only loads on browser, avoiding any SSR issues
export const TierDonut = dynamic(
  () => import("./TierDonut").then((m) => m.TierDonut),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export const SourceBar = dynamic(
  () => import("./SourceBar").then((m) => m.SourceBar),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export const EventTypeBar = dynamic(
  () => import("./EventTypeBar").then((m) => m.EventTypeBar),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export const DailyActivityArea = dynamic(
  () => import("./DailyActivityArea").then((m) => m.DailyActivityArea),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export const ConversionLine = dynamic(
  () => import("./ConversionLine").then((m) => m.ConversionLine),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

function ChartSkeleton() {
  return (
    <div className="h-[260px] rounded-lg bg-subtle animate-pulse flex items-center justify-center text-[12px] text-muted-2">
      Đang tải chart...
    </div>
  );
}
