import { Topbar } from "@/components/Topbar";
import { ArrowLeftRight } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

export default function ReverseSyncPage() {
  return (
    <>
      <Topbar title="Đồng bộ ngược" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">Đẩy điểm về Salesforce</h1>
          <p className="mt-1 text-[14px] text-muted">
            Map field app ↔ custom field Salesforce. TVV sẽ thấy hot_score ngay trong Salesforce Contact.
          </p>
        </div>

        <EmptyConfigCard
          icon={ArrowLeftRight}
          title="Chưa kết nối Salesforce"
          description="Cần OAuth 2.0 Connected App trên Salesforce + custom field MDA_Hot_Score__c, MDA_Cold_Score__c trên Contact. Sau đó cron sẽ push điểm hàng đêm."
          ctaLabel="Đến Nguồn data → Salesforce"
          ctaHref="/integrations/salesforce"
        />
      </main>
    </>
  );
}
