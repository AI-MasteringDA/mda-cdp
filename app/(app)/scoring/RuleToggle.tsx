"use client";

import { useState, useTransition } from "react";
import { Toggle } from "@/components/ui/Toggle";
import { toggleScoringRule } from "./actions";

export function RuleToggle({
  ruleId,
  initial,
}: {
  ruleId: string;
  initial: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  return (
    <Toggle
      checked={enabled}
      disabled={pending}
      onChange={(next) => {
        setEnabled(next);
        startTransition(async () => {
          const result = await toggleScoringRule(ruleId, next);
          if (result?.error) setEnabled(!next);
        });
      }}
    />
  );
}
