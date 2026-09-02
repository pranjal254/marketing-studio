/* Bridge client: the studio's one gateway to the REAL Campaign Identification
   agent (Python, via the local dev bridge). Used by Intake (describe → draft →
   iterate → release) and Approvals (the BU gate decision). The Live screen keeps
   its own inline client for now. */

export const LIVE_API =
  (import.meta.env.VITE_LIVE_API as string | undefined) ?? "http://localhost:8787";

/* ---------- payload types (bridge contracts) ---------- */

export type LiveHealth = {
  status: string; agent_id: string; config_version: string;
  provider: string; model: string; environment: string; kill_switch: "clear" | "paused";
};

export type LiveBriefField = { name: string; value: string; provenance: string };

export type LiveBrief = {
  campaign_id: string; case_id: string; version: number; status: string;
  fields: LiveBriefField[];
  classification: {
    campaign_type: string; priority: string; channel_mix: string[]; segment_relevance: string;
    field_rationale: Record<string, string>;
  } | null;
  conflicts: { kind: string; conflicting_campaign_id: string; rationale: string; freshness: string }[];
};

export type LiveGapQuestion = { field: string; question: string };

export type LiveOutcome = {
  case_id: string; trace_id: string; status: string; action_class: string | null;
  brief: LiveBrief | null;
  gap_request: { round: number; questions: LiveGapQuestion[] } | null;
  escalation_reason: string | null; doc_ref: string | null;
};

export type LiveRequestFields = {
  requester: string | null; objective: string | null; business_unit: string | null;
  vertical: string | null; target_segment: string | null; offer_topic: string | null;
  channels: string[]; timeline_start: string | null; timeline_end: string | null;
  owner: string | null; budget_flag: boolean | null; free_text_context: string | null;
  derived_fields: Record<string, string>;
};

export type LiveCaseSummary = {
  case_id: string; status: string; action_class: string | null; campaign_id: string | null;
  topic: string | null; business_unit: string | null; vertical: string | null;
  gap_rounds: number; escalation_reason_code: string | null; doc_ref: string | null;
  trace_id: string | null; brief_version: number | null; returned_note: string | null;
  last_directive: { note: string; aspects: string[]; by: string } | null;
  derived_fields: Record<string, string>;
  request: LiveRequestFields | null;
};

export type LiveCaseDetail = {
  summary: LiveCaseSummary;
  case: { brief?: LiveBrief | null };
  gap_request: { round: number; questions: LiveGapQuestion[] } | null;
  approval_task: { routed_to: string; created_at: string } | null;
};

export type StsRecord = Record<string, unknown> & { "bridge.seq"?: number };

/* ---------- fetch ---------- */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LIVE_API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export const liveApi = {
  health: () => call<LiveHealth>("/api/health"),

  submitDescription: (description: string, requesterEmail: string) =>
    call<LiveOutcome>("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        source: "adhoc",
        hold_for_verification: true,
        request: {
          free_text_context: description,
          requester: requesterEmail,
          owner: requesterEmail,
        },
      }),
    }),

  getCase: (caseId: string) => call<LiveCaseDetail>(`/api/cases/${caseId}`),

  submitAnswers: (caseId: string, answers: Record<string, string>, actorId: string, release: boolean) =>
    call<LiveOutcome>(`/api/cases/${caseId}/answers`, {
      method: "POST",
      body: JSON.stringify({ answers, actor_id: actorId, release_after: release }),
    }),

  revise: (caseId: string, directive: string, aspects: string[], actorId: string) =>
    call<LiveOutcome>(`/api/cases/${caseId}/revise`, {
      method: "POST",
      body: JSON.stringify({ directive, aspects, actor_id: actorId }),
    }),

  decide: (caseId: string, decision: "approved" | "rejected" | "returned", actorId: string, notes?: string) =>
    call<LiveOutcome>(`/api/cases/${caseId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, actor_id: actorId, notes: notes ?? null }),
    }),

  telemetry: async (traceId?: string | null): Promise<StsRecord[]> => {
    const rows = await call<StsRecord[]>("/api/telemetry?limit=1000");
    return traceId ? rows.filter((r) => r["shiftai.trace.id"] === traceId) : rows;
  },

  docUrl: (docRef: string | null | undefined): string | null => {
    if (!docRef) return null;
    const name = docRef.split(/[\\/]/).pop();
    return name ? `${LIVE_API}/api/documents/${name}` : null;
  },
};

/* ---------- value mapping: agent slugs <-> studio labels ---------- */

export const VERTICAL_LABEL: Record<string, string> = {
  financial_services: "Financial Services",
  manufacturing: "Manufacturing",
  technology: "Technology",
};
export const VERTICAL_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(VERTICAL_LABEL).map(([slug, label]) => [label, slug]),
);

export const SEGMENT_LABEL: Record<string, string> = {
  type_3: "Type 3",
  type_4: "Type 4",
  standard: "Standard",
};
export const SEGMENT_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SEGMENT_LABEL).map(([slug, label]) => [label, slug]),
);

/* Studio channel labels -> canonical agent slugs (loose match on read). */
export const CHANNEL_SLUG: Record<string, string> = {
  "LinkedIn": "linkedin",
  "Email nurture": "email",
  "Sales enablement": "sales_enablement",
  "Web / service page": "web",
  "Community": "community",
  "Event": "events",
};

export function channelChecked(agentChannels: string[], label: string): boolean {
  const slug = CHANNEL_SLUG[label] ?? label.toLowerCase();
  return agentChannels.some((c) => c === slug || c.includes(slug) || slug.includes(c));
}

/* One-line rendering of an STS record for intake's activity feed. */
export function stsSummary(record: StsRecord): string {
  const type = String(record["shiftai.event.type"]);
  switch (type) {
    case "case_intake": return "Request received by Campaign Identification";
    case "config_loaded": return "Business Capability config loaded";
    case "tool_execution": {
      const tool = String(record["gen_ai.tool.name"] ?? "");
      if (tool === "layer1.extract_fields") return "Fields extracted from your words (quoted provenance)";
      if (tool === "layer3.revise_fields") return "Fields revised per your directive";
      if (tool === "workspace.upload_document") return "Brief document written to the workspace";
      return tool;
    }
    case "policy_check": return `Policy pass: ${record["shiftai.policy.decision"]} (completeness ${record["shiftai.intake.completeness_score"] ?? "-"})`;
    case "decision_made": return `Decision (L${record["shiftai.decision.layer"]}): ${record["shiftai.decision.action_class"] ?? "abstained"} · confidence ${record["shiftai.decision.confidence"]}`;
    case "case_escalated": return `Escalated (tier ${record["shiftai.escalation.tier"]}): ${record["shiftai.escalation.reason"]} → ${record["shiftai.escalation.routed_to"]}`;
    case "action_taken": return "Brief routed for approval (recorded, idempotent)";
    case "human_gate": return `Human gate: ${record["shiftai.hitl.decision"]} by ${record["shiftai.hitl.actor.role"]}`;
    case "case_resolved": return `Case resolved: ${record["shiftai.outcome"]}`;
    case "run_summary": return `Run summary: ${record["shiftai.outcome"]}`;
    case "error": return `Error: ${record["error.type"]}`;
    default: return type;
  }
}

export function stsMeta(record: StsRecord): string {
  const parts: string[] = [];
  if (record["gen_ai.response.model"]) parts.push(String(record["gen_ai.response.model"]));
  if (record["gen_ai.usage.input_tokens"] != null)
    parts.push(`${record["gen_ai.usage.input_tokens"]}→${record["gen_ai.usage.output_tokens"]} tok`);
  if (record["shiftai.cost.amount"] != null) parts.push(`$${record["shiftai.cost.amount"]}`);
  if (record["shiftai.span.duration_ms"] != null) parts.push(`${record["shiftai.span.duration_ms"]}ms`);
  return parts.join(" · ");
}
