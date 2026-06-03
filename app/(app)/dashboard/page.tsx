import { Topbar } from "@/components/Topbar";
import { DashboardTabs } from "@/components/DashboardTabs";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <>
      <Topbar title="Tổng quan" />
      <DashboardTabs />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="rounded-2xl bg-white p-8 text-center">
          <h1 className="text-[22px] font-semibold">Dashboard minimal test</h1>
          <p className="mt-2 text-[13px] text-muted">
            Nếu bạn thấy trang này load OK = framework + tabs OK, lỗi nằm ở data queries.
          </p>
          <a href="/dashboard/funnel" className="mt-4 inline-block text-[13px] underline text-[var(--accent)]">
            Thử /dashboard/funnel (đơn giản, ít query)
          </a>
        </div>
      </main>
    </>
  );
}
