import { Topbar } from "@/components/Topbar";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";
import { Settings as SettingsIcon } from "lucide-react";

export default function SettingsPage() {
  return (
    <>
      <Topbar title="Cài đặt" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <EmptyConfigCard
          icon={SettingsIcon}
          title="Tài khoản cá nhân"
          description="Chưa cấu hình. Sau khi bật lại Auth, trang này sẽ cho đổi email/password/notification settings."
        />
      </main>
    </>
  );
}
