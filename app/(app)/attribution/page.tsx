import { Topbar } from "@/components/Topbar";
import { BarChart3 } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

export default function AttributionPage() {
  return (
    <>
      <Topbar title="Attribution" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Kênh nào ra học viên thật?
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Cần: định nghĩa "1 học viên", multi-touch attribution rule, và spend data từ marketing.
          </p>
        </div>
        <EmptyConfigCard
          icon={BarChart3}
          title="Chưa đủ data cho Attribution"
          description="Cần kết nối Salesforce (xác định ai đã đóng tiền) + ingest spend data từ Google/FB/TikTok Ads. Sau đó tính CAC từng kênh và highlight kênh ra học viên thật."
          ctaLabel="Đi đến Tổng quan Growth"
          ctaHref="/growth"
        />
      </main>
    </>
  );
}
