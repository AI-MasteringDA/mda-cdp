import { Topbar } from "@/components/Topbar";
import { GitBranch } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

export default function FunnelPage() {
  return (
    <>
      <Topbar title="Phễu & Cohort" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Phễu chuyển đổi & Cohort
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Tỷ lệ chuyển đổi từng bước: Visitor → Lead → Tư vấn → Ghi danh.
          </p>
        </div>
        <EmptyConfigCard
          icon={GitBranch}
          title="Chưa đủ data cho Funnel"
          description="Cần web tracking (visitor) + Salesforce stage progression (lead → consulted → enrolled). Hiện chỉ có data lead trong dim_lead, chưa có stage timeline."
          ctaLabel="Đi đến Tổng quan Growth"
          ctaHref="/growth"
        />
      </main>
    </>
  );
}
