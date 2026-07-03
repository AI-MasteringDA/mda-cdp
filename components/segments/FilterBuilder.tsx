"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { FIELD_META, OP_META, type FilterField, type FilterGroup, type FilterOp, type FilterRule } from "@/lib/segments/types";

const FIELDS_BY_CATEGORY: Record<string, FilterField[]> = {
  Score: ["score"],
  Source: ["source", "stage"],
  SF: ["sf_rating", "sf_product", "sf_status"],
  Activity: ["chat_count","chat_staff_count","email_open_count","email_click_count","email_reply_count","form_submit_count","login_count","conversion_count"],
  Recency: ["chat_days","email_days","form_days","silent_days"],
  Owner: ["assignee","company"],
};

export function FilterBuilder({
  initial,
  onChange,
}: {
  initial?: FilterGroup;
  onChange: (filters: FilterGroup) => void;
}) {
  const [group, setGroup] = useState<FilterGroup>(
    initial ?? { logic: "AND", rules: [{ field: "score", op: "gte", value: 70 } as FilterRule] }
  );

  useEffect(() => { onChange(group); }, [group, onChange]);

  const updateRule = (idx: number, patch: Partial<FilterRule>) => {
    setGroup((g) => {
      const rules = [...g.rules];
      const cur = rules[idx] as FilterRule;
      rules[idx] = { ...cur, ...patch };
      return { ...g, rules };
    });
  };

  const removeRule = (idx: number) => {
    setGroup((g) => ({ ...g, rules: g.rules.filter((_, i) => i !== idx) }));
  };

  const addRule = () => {
    setGroup((g) => ({ ...g, rules: [...g.rules, { field: "source", op: "eq", value: "smax" } as FilterRule] }));
  };

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] text-muted-2">
        <span>Logic:</span>
        <select
          value={group.logic}
          onChange={(e) => setGroup((g) => ({ ...g, logic: e.target.value as "AND" | "OR" }))}
          className="press h-7 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] outline-none focus:border-foreground"
        >
          <option value="AND">TẤT CẢ (AND)</option>
          <option value="OR">BẤT KỲ (OR)</option>
        </select>
      </div>

      <div className="space-y-2">
        {group.rules.map((rule, idx) => (
          "logic" in rule ? null : (
            <RuleRow
              key={idx}
              rule={rule as FilterRule}
              onChange={(patch) => updateRule(idx, patch)}
              onRemove={() => removeRule(idx)}
            />
          )
        ))}
      </div>

      <button
        onClick={addRule}
        className="press mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-[var(--border-subtle)] px-3 py-1.5 text-[12px] text-muted hover:bg-subtle hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Thêm điều kiện
      </button>
    </div>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  onChange: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
}) {
  const meta = FIELD_META[rule.field];
  const availableOps = (Object.keys(OP_META) as FilterOp[]).filter((op) =>
    OP_META[op].forTypes.includes(meta.type)
  );
  const needsValue = OP_META[rule.op]?.needsValue ?? true;

  const handleFieldChange = useCallback((newField: FilterField) => {
    const newMeta = FIELD_META[newField];
    const opValid = OP_META[rule.op]?.forTypes.includes(newMeta.type);
    onChange({
      field: newField,
      op: opValid ? rule.op : (newMeta.type === "number" ? "gte" : "eq"),
      value: newMeta.type === "number" ? 0 : (newMeta.enumValues?.[0] ?? ""),
    });
  }, [rule.op, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={rule.field}
        onChange={(e) => handleFieldChange(e.target.value as FilterField)}
        className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] outline-none focus:border-foreground"
      >
        {Object.entries(FIELDS_BY_CATEGORY).map(([category, fields]) => (
          <optgroup key={category} label={category}>
            {fields.map((f) => (
              <option key={f} value={f}>{FIELD_META[f].label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        value={rule.op}
        onChange={(e) => onChange({ op: e.target.value as FilterOp })}
        className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] outline-none focus:border-foreground"
      >
        {availableOps.map((op) => (
          <option key={op} value={op}>{OP_META[op].label}</option>
        ))}
      </select>

      {needsValue && (meta.type === "enum" ? (
        <select
          value={String(rule.value ?? "")}
          onChange={(e) => onChange({ value: e.target.value })}
          className="press h-8 min-w-32 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] outline-none focus:border-foreground"
        >
          {(meta.enumValues ?? []).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          type={meta.type === "number" ? "number" : "text"}
          value={String(rule.value ?? "")}
          onChange={(e) => onChange({ value: meta.type === "number" ? Number(e.target.value) : e.target.value })}
          className="press h-8 min-w-32 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] outline-none focus:border-foreground"
          placeholder={meta.type === "number" ? "0" : "..."}
        />
      ))}

      <button
        onClick={onRemove}
        className="press rounded-md p-1.5 text-muted-2 hover:bg-red-50 hover:text-red-600"
        title="Xoá điều kiện"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
