import { Topbar } from "@/components/Topbar";
import { Lightbulb } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

export default function AIPlannerPage() {
  return (
    <>
      <Topbar title="AI Planner" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Kế hoạch tăng trưởng — AI đề xuất
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Claude đọc số thật từ tầng metric → sinh giả thuyết tăng trưởng + kế hoạch thử nghiệm.
            AI không tự thực thi — chỉ đề xuất, người quyết.
          </p>
        </div>
        <EmptyConfigCard
          icon={Lightbulb}
          title="Chưa cấu hình AI Planner"
          description="Cần (1) Attribution data + (2) Funnel data + (3) Anthropic API key. Sau đó Claude đọc số từ DB và đề xuất 'cắt kênh X, tăng kênh Y' với confidence + dữ liệu chứng minh."
          ctaLabel="Đi đến Tổng quan Growth"
          ctaHref="/growth"
        />
      </main>
    </>
  );
}
