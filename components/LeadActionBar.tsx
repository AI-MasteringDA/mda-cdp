"use client";

import { useState } from "react";
import { Phone, Mail, Copy, MessageCircle, Check, ExternalLink, Sparkles } from "lucide-react";
import type { Lead } from "@/types/lead";

export function LeadActionBar({ lead }: { lead: Lead }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const hasPhone = !!lead.phone && lead.phone !== "—";
  const hasEmail = !!lead.email && lead.email !== "—";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
      {/* Call */}
      <a
        href={hasPhone ? `tel:${lead.phone}` : undefined}
        onClick={(e) => !hasPhone && e.preventDefault()}
        className={`press inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
          hasPhone
            ? "bg-foreground text-white hover:opacity-90"
            : "bg-subtle text-muted-2 cursor-not-allowed"
        }`}
        title={hasPhone ? `Gọi ${lead.phone}` : "Chưa có số điện thoại"}
      >
        <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
        Gọi
      </a>

      {/* Email */}
      <a
        href={hasEmail ? `mailto:${lead.email}` : undefined}
        onClick={(e) => !hasEmail && e.preventDefault()}
        className={`press inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
          hasEmail
            ? "border border-[var(--border-subtle)] bg-white hover:bg-subtle"
            : "bg-subtle text-muted-2 cursor-not-allowed"
        }`}
        title={hasEmail ? `Gửi email tới ${lead.email}` : "Chưa có email"}
      >
        <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
        Email
      </a>

      {/* SMS / Chat */}
      {hasPhone && (
        <a
          href={`sms:${lead.phone}`}
          className="press inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-2 text-[13px] font-medium hover:bg-subtle"
          title="Nhắn SMS"
        >
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          SMS
        </a>
      )}

      {/* Copy phone */}
      {hasPhone && (
        <button
          onClick={() => copyToClipboard(lead.phone, "phone")}
          className="press inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-2 text-[13px] font-medium hover:bg-subtle"
          title="Copy số điện thoại"
        >
          {copied === "phone" ? (
            <>
              <Check className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={1.75} />
              Đã copy SĐT
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              Copy SĐT
            </>
          )}
        </button>
      )}

      {/* Copy email */}
      {hasEmail && (
        <button
          onClick={() => copyToClipboard(lead.email, "email")}
          className="press inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-2 text-[13px] font-medium hover:bg-subtle"
          title="Copy email"
        >
          {copied === "email" ? (
            <>
              <Check className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={1.75} />
              Đã copy email
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              Copy email
            </>
          )}
        </button>
      )}

      {/* Salesforce link */}
      {lead.source === "salesforce" && (
        <a
          href={`https://mda-da.lightning.force.com/lightning/r/Lead/${lead.id}/view`}
          target="_blank"
          rel="noopener noreferrer"
          className="press inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-2 text-[13px] font-medium hover:bg-subtle"
          title="Mở trong Salesforce"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          Mở SF
        </a>
      )}

      {/* AI Insights trigger */}
      <button
        onClick={() => {
          document.getElementById("ai-insights")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        className="press ml-auto inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-yellow-400 to-orange-500 px-3 py-2 text-[13px] font-medium text-white hover:opacity-90"
        title="Cuộn đến AI Insights"
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        AI gợi ý
      </button>
    </div>
  );
}
