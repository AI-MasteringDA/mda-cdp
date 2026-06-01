import { Topbar } from "@/components/Topbar";
import { Sparkles, Plus } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

export default function TemplatesPage() {
  return (
    <>
      <Topbar title="Templates AI" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Prompt templates</h1>
            <p className="mt-1 text-[14px] text-muted">
              Template cho Claude AI sinh nội dung cá nhân hóa theo hồ sơ 360°.
            </p>
          </div>
          <button className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-white hover:opacity-90">
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Thêm template
          </button>
        </div>

        <EmptyConfigCard
          icon={Sparkles}
          title="Chưa cấu hình Claude AI"
          description="Cần thêm ANTHROPIC_API_KEY vào .env.local + tạo template trong DB. Sau đó AI panel trong hồ sơ lead sẽ sinh email nháp cá nhân hóa."
          ctaLabel="Hướng dẫn cài đặt"
          ctaHref="/integrations"
        />
      </main>
    </>
  );
}
