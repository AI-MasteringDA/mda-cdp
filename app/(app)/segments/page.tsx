import { Topbar } from "@/components/Topbar";
import { PieChart } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

export default function SegmentsPage() {
  return (
    <>
      <Topbar title="Phân khúc giá trị" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Phân khúc chốt tốt bất thường
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Nhóm có tỷ lệ chốt cao hơn baseline ≥2 lần — export tệp lookalike.
          </p>
        </div>
        <EmptyConfigCard
          icon={PieChart}
          title="Chưa đủ data cho phân khúc"
          description="Cần ≥3-6 tháng data lead + outcome (chốt/không chốt) để clustering. Có thể dùng Python sklearn KMeans hoặc rule-based segmentation."
          ctaLabel="Đi đến Tổng quan Growth"
          ctaHref="/growth"
        />
      </main>
    </>
  );
}
