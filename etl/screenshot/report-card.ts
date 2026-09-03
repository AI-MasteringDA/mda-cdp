/**
 * DỰNG THẺ CHỮ CỦA BÁO CÁO — dùng chung cho bot bắn thật
 * (etl/screenshot/radar-snapshot.ts) và bản xem trước
 * (etl/debug/preview-text-card.ts). Để chung một chỗ vì đúng cái bẫy vừa gặp
 * 2026-09-03: hai nơi dựng số riêng thì sớm muộn cũng trôi ra hai kết quả.
 *
 * VÌ SAO KHÔNG DÙNG GẠCH NGANG "━━ BI ━━" NỮA (user chốt 2026-09-03):
 * trên điện thoại dòng đó bị xuống hàng giữa chừng, nhìn như chữ bị gạch bỏ và
 * đẩy phần "(đang tuyển sinh…)" rơi xuống dòng dưới. Nay tách khối bằng đường
 * kẻ thật của thẻ Lark (tag "hr") và xếp số vào lưới 2 cột (fields + is_short)
 * — đọc trên màn hình dọc không phải cuộn ngang, không có dòng nào bị gãy.
 */

export type Kpi = { rows: { k: string; v: string; d: string[] }[]; range: string };
export type Course = { code: string; days: number; leads: number; H: number; W: number; C: number; P: number; Un: number } | null;

type El = Record<string, unknown>;
const short = (label: string, value: string): El => ({ is_short: true, text: { tag: "lark_md", content: `**${label}**\n${value}` } });

/** Một khối cho mỗi mảng (BI / FA). */
function section(name: string, icon: string, k: Kpi, c: Course): El[] {
  const g = (n: string) => k.rows.find(x => x.k === n)?.v ?? "0";
  // "SMAX 34 · SF 2" — nguồn của Hot mới, để dưới dạng chú thích nhỏ.
  const src = (k.rows.find(x => x.k === "Hot mới")?.d || []).find(x => x.startsWith("SMAX")) || "";
  const out: El[] = [
    { tag: "div", text: { tag: "lark_md", content: c ? `**${icon} ${name}** · đang tuyển sinh **${c.code}** — ngày thứ ${c.days}` : `**${icon} ${name}**` } },
    { tag: "div", fields: [
      short("Lead mới", g("Lead mới")),
      short("🔥 Hot mới", g("Hot mới")),
      short("Cold · Warm · Prospect", `${g("Cold")} · ${g("Warm")} · ${g("Prospect")}`),
      short("Chưa phản hồi", g("Chưa phản hồi")),
    ] },
  ];
  if (src) out.push({ tag: "note", elements: [{ tag: "lark_md", content: `Hot mới đến từ ${src}` }] });
  if (c) {
    const pc = (v: number) => c.leads ? Math.round(v / c.leads * 100) + "%" : "0%";
    out.push({ tag: "div", text: { tag: "lark_md", content: `Luỹ kế cả khoá **${c.code}** — **${c.leads}** lead` } });
    out.push({ tag: "div", fields: [
      short("🔥 Hot", `${c.H}  ·  ${pc(c.H)}`),
      short("Warm", `${c.W}  ·  ${pc(c.W)}`),
      short("Cold", `${c.C}  ·  ${pc(c.C)}`),
      short("Prospect", `${c.P}  ·  ${pc(c.P)}`),
    ] });
  }
  return out;
}

export function buildCard(bi: Kpi, fa: Kpi, cBI: Course, cFA: Course) {
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/");
  const elements: El[] = [
    { tag: "div", text: { tag: "lark_md", content: `**Báo cáo ngày ${today}**` } },
    { tag: "note", elements: [{ tag: "lark_md", content: `Kỳ báo cáo: ${bi.range.replace(/^🗓\s*/, "")}` }] },
    { tag: "hr" },
    ...section("BI", "🎓", bi, cBI),
    { tag: "hr" },
    ...section("FA", "📈", fa, cFA),
    { tag: "hr" },
    { tag: "note", elements: [{ tag: "lark_md", content: "Nguồn: SMAX + Salesforce · Automation Bot — Mastering Data Analytics" }] },
  ];
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: "📋 CHECK LEADS / TAG / PROCESS" }, template: "green" },
      elements,
    },
  };
}

/** Vẽ lại thẻ ra chữ để xem trước trong terminal — KHÔNG gửi đi đâu. */
export function renderPreview(card: ReturnType<typeof buildCard>): string {
  const W = 62, line = "─".repeat(W);
  const strip = (s: string) => s.replace(/\*\*/g, "");
  const out: string[] = ["┌" + line + "┐", "│ 📋 CHECK LEADS / TAG / PROCESS", "├" + line + "┤"];
  for (const el of card.card.elements as El[]) {
    const tag = el.tag as string;
    if (tag === "hr") { out.push("├" + line + "┤"); continue }
    if (tag === "note") {
      for (const n of (el.elements as { content: string }[])) out.push("│ " + strip(n.content));
      continue;
    }
    if (el.fields) {
      const f = (el.fields as { text: { content: string } }[]).map(x => strip(x.text.content).split("\n"));
      for (let i = 0; i < f.length; i += 2) {
        const [aL, aV] = f[i], [bL, bV] = f[i + 1] ?? ["", ""];
        out.push("│ " + aL.padEnd(30) + bL);
        out.push("│ " + aV.padEnd(30) + bV);
      }
      continue;
    }
    out.push("│ " + strip((el.text as { content: string }).content));
  }
  out.push("└" + line + "┘");
  return out.join("\n");
}
