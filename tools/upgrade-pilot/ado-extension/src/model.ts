export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface UpgradeItem {
  package: string;
  from?: string;
  to?: string;
  reason?: string;
  jump?: string;
  severity?: Severity;
  advisories?: string[];
  why_manual?: string;
}

export interface Finding {
  id?: string;
  package?: string;
  target?: string;
  title?: string;
  severity?: Severity;
  source?: string;
  actionable?: boolean;
}

export interface Plan {
  branch?: string;
  policy?: { name?: string; note?: string };
  may_automerge?: boolean;
  gate_reason?: string;
  auto?: UpgradeItem[];
  review?: UpgradeItem[];
  deferred?: Array<{ package?: string; why?: string }>;
  unfixable?: Finding[];
  base_image?: Finding[];
}

export interface Applied {
  summary?: string;
  applied?: unknown[];
  reverted?: unknown[];
  skipped?: unknown[];
}

export interface Evidence {
  plan: Plan;
  findings: Finding[];
  applied?: Applied;
}

export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    if (finding.severity && finding.severity in counts) counts[finding.severity] += 1;
  }
  return counts;
}

export function searchableRows(evidence: Evidence): UpgradeItem[] {
  return [...(evidence.plan.auto ?? []), ...(evidence.plan.review ?? [])];
}