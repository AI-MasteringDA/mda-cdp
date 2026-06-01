import { Topbar } from "@/components/Topbar";
import { Avatar } from "@/components/ui/Avatar";
import { Chip } from "@/components/ui/Chip";
import { StatusDot } from "@/components/ui/StatusDot";
import { getTeamMembers } from "@/lib/supabase/queries";
import { UserPlus, Users } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

const ROLE_VARIANT: Record<string, "hot" | "warm" | "outline"> = {
  Admin: "hot",
  Manager: "warm",
  Tvv: "outline",
  Viewer: "outline",
};

export default async function TeamPage() {
  const members = await getTeamMembers();
  const activeCount = members.filter((m) => m.active).length;

  return (
    <>
      <Topbar title="Nhân sự" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Team & phân quyền</h1>
            <p className="mt-1 text-[14px] text-muted">
              Đọc từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">profiles</code>.
              {members.length > 0 && ` ${activeCount}/${members.length} đang hoạt động.`}
            </p>
          </div>
          <button className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-white hover:opacity-90">
            <UserPlus className="h-4 w-4" strokeWidth={1.75} />
            Mời thành viên
          </button>
        </div>

        {members.length === 0 ? (
          <EmptyConfigCard
            icon={Users}
            title="Chưa có thành viên nào"
            description="Khi user đăng ký qua Supabase Auth, trigger tự tạo row trong profiles. Hiện auth bị bypass — bật lại login để có user."
          />
        ) : (
          <div className="hairline overflow-hidden rounded-2xl bg-white">
            <table className="w-full text-[13px]">
              <thead className="hairline-b bg-subtle">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-2 font-medium">
                  <th className="px-6 py-3">Thành viên</th>
                  <th className="px-6 py-3">Vai trò</th>
                  <th className="px-6 py-3">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-subtle">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} color={m.avatarColor} size={32} />
                        <div>
                          <div className="text-[13px] font-medium">{m.name}</div>
                          <div className="text-[11px] text-muted-2">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <Chip variant={ROLE_VARIANT[m.role] ?? "outline"}>{m.role}</Chip>
                    </td>
                    <td className="px-6 py-3">
                      <StatusDot
                        status={m.active ? "connected" : "disconnected"}
                        label={m.active ? "Hoạt động" : "Đã tắt"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
