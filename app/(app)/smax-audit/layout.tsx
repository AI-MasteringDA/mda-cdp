import { Topbar } from "@/components/Topbar";
import { SmaxAuditTabs } from "@/components/SmaxAuditTabs";

export default function SmaxAuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="SMAX Audit" />
      <SmaxAuditTabs />
      {children}
    </>
  );
}
