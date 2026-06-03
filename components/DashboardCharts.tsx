"use client";

import { TierDonut } from "./charts/TierDonut";
import { SourceBar } from "./charts/SourceBar";
import { EventTypeBar } from "./charts/EventTypeBar";
import { DailyActivityArea } from "./charts/DailyActivityArea";

type TierData = { name: string; value: number; color: string };
type SourceData = { name: string; touchpoints: number; leads: number; color: string };
type EventData = { label: string; value: number; color: string };
type DailyData = { day: string; chat: number; email: number; conversion: number; other: number };

export function DashboardCharts({
  tiers,
  sources,
  eventTypes,
  daily,
}: {
  tiers: TierData[];
  sources: SourceData[];
  eventTypes: EventData[];
  daily: DailyData[];
}) {
  return (
    <>
      {daily.length > 0 && (
        <section className="mt-8 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold">Hoạt động theo ngày</h3>
            <p className="mt-0.5 text-[12px] text-muted">Stack chat / email / conversion</p>
          </div>
          <DailyActivityArea data={daily} />
        </section>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {tiers.length > 0 && (
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold">Phân bố Lead theo tier</h3>
              <p className="mt-0.5 text-[12px] text-muted">NÓNG / ẤM / MÁT / NGỦ ĐÔNG</p>
            </div>
            <TierDonut data={tiers} />
          </section>
        )}
        {sources.length > 0 && (
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold">Nguồn data</h3>
              <p className="mt-0.5 text-[12px] text-muted">Touchpoints theo source</p>
            </div>
            <SourceBar data={sources} metric="touchpoints" />
          </section>
        )}
      </div>

      {eventTypes.length > 0 && (
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold">Loại event</h3>
            <p className="mt-0.5 text-[12px] text-muted">Tổng số event mỗi loại</p>
          </div>
          <EventTypeBar data={eventTypes} />
        </section>
      )}
    </>
  );
}
