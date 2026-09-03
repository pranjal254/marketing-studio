/* Bridge client: the studio's one gateway to the REAL Campaign Identification
   agent (Python, via the local dev bridge). Used by Intake (describe → draft →
   iterate → release) and Approvals (the BU gate decision). The Live screen keeps
   its own inline client for now. */

export const LIVE_API =
  (import.meta.env.VITE_LIVE_API as string | undefined) ?? "http://localhost:8787";

/* Shared secret for a HOSTED bridge (Render): sent as a Bearer header on fetches
   and as ?token= on browser-navigated URLs (SSE, document downloads, which cannot
   carry headers). Empty locally — the local bridge runs open. */
export const LIVE_TOKEN = ((import.meta.env.VITE_LIVE_TOKEN as string | undefined) ?? "").trim();

export function authHeaders(): Record<string, string> {
  return LIVE_TOKEN ? { Authorization: `Bearer ${LIVE_TOKEN}` } : {};
}

/* Append the token to a bridge URL the browser navigates to directly. */
export function tokenized(url: string): string {
  if (!LIVE_TOKEN) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(LIVE_TOKEN)}`;
}

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

/* ---------- Agent 2 (Campaign-in-a-Box) payload types ---------- */

export type BoxProofPoint = { claim: string; source_ref: string; status: string };
export type BoxPersona = { persona_id: string; title: string; role_pains: string; rationale: string };

export type BoxPack = {
  version: number; vertical: string; value_proposition: string;
  segment_applicability: Record<string, string>;
  personas: BoxPersona[]; differentiators: string[]; proof_points: BoxProofPoint[];
  ctas: Record<string, string>;
  messaging_angles: { persona_id: string; angle: string; grounding: string }[];
  channel_emphasis: Record<string, string>; gaps: string[];
  intel_mode: string; unverified_share: number;
  lint_findings: { rule_id: string; severity: string; term: string }[];
};

export type BoxChecklistItem = {
  asset_id: string; asset_type: string; label: string; decision: string;
  decision_rationale: string; reuse_ref: string | null; reuse_check_pending: boolean;
  status: string; candidates_evaluated: { asset_ref: string; fitness_score: number }[];
};

export type BoxWorkflowPlan = {
  version: number; window_start: string; window_end: string;
  entries: { asset_id: string; draft_due: string; confirm_due: string; review_gate: string; constraint_chain: string }[];
  feasible: boolean; infeasibility: { reasons: string[]; trade_offs: string[] } | null;
  capacity_note: string;
};

export type BoxManifest = {
  manifest_id: string; version: number; status: string;
  assets: { asset_id: string; canonical_name: string; sha256: string; version: number }[];
};

export type BoxSummary = {
  campaign_id: string; status: string; pack_version: number | null; plan_version: number | null;
  manifest_version: number; confirmations: Record<string, boolean>; escalations: string[];
  folder: string | null; trace_id: string | null; reopened_assets: string[];
};

export type BoxDetail = {
  summary: BoxSummary;
  case: { folder?: string; pack_doc_ref?: string; tracker_ref?: string };
  pack: BoxPack | null;
  checklist: { items: BoxChecklistItem[]; search_performed: boolean } | null;
  outlines: { asset_id: string; title: string; sections: { heading: string }[] }[];
  plan: BoxWorkflowPlan | null;
  manifest: BoxManifest | null;
  completeness_report: {
    diff: { missing: string[]; extra: string[]; version_mismatch: string[] };
    missing_confirmations: string[];
  } | null;
  registered_assets: { asset_id: string; version: number; status: string }[];
};

/* ---------- Agent 3 (Content Repurposing) payload types ---------- */

export type RepurposeSelfCheck = {
  passed: boolean; attempts: number;
  findings: { rule_id: string; severity: string; term: string; detail: string }[];
  unsourced_numeric_tokens: string[]; missing_brand_mention: boolean;
};

export type RepurposeGapNote = { gap_id: string; asset_id: string; section: string; needed: string };

export type RepurposeDraft = {
  asset_id: string; asset_type: string; kind: "flagship" | "derivative"; title: string;
  version: number; filename: string; file_rel: string | null; claim_map_rel: string | null;
  sections: { heading: string; paragraphs: string[] }[];
  claim_markers: { marker: string; claim: string; source_ref: string }[];
  claim_lineage: string[]; self_check: RepurposeSelfCheck; gap_notes: RepurposeGapNote[];
  status: "staged" | "withheld"; rework_of_version: number | null; created_at: string;
};

export type RepurposeDetail = {
  case: {
    status?: string; flagship_asset_id?: string; flagship_version?: number;
    flagship_confirmation?: { actor_id: string; actor_role: string; timestamp: string } | null;
    withheld_assets?: string[]; skipped_assets?: string[];
  } | null;
  status: string | null;
  drafts: RepurposeDraft[];
  inventory: {
    flagship_version: number; method: string; dropped_unverified: number;
    items: { claim_id: string; kind: string; text: string; source_ref: string }[];
  } | null;
  gap_notes: RepurposeGapNote[];
  model: string;
};

/* The REAL Campaign-in-a-Box run, shaped for the studio store's mirror. */
export type BoxSyncInput = {
  liveCampaignId: string;
  status: string;
  checklist: { assetId: string; label: string; decision: string; status: string }[];
  manifest: { version: number; assets: { asset_id: string; sha256: string; version: number }[] } | null;
  records: StsRecord[];
};

export function buildBoxSync(detail: BoxDetail, records: StsRecord[]): BoxSyncInput {
  return {
    liveCampaignId: detail.summary.campaign_id,
    status: detail.summary.status,
    checklist: (detail.checklist?.items ?? []).map((i) => ({
      assetId: i.asset_id, label: i.label, decision: i.decision, status: i.status,
    })),
    manifest: detail.manifest
      ? {
          version: detail.manifest.version,
          assets: detail.manifest.assets.map((a) => ({ asset_id: a.asset_id, sha256: a.sha256, version: a.version })),
        }
      : null,
    records: records.filter(
      (r) => r["shiftai.case.id"] === detail.summary.campaign_id
        && (r["shiftai.agent.id"] === "campaign_in_a_box"
          || r["shiftai.agent.id"] === "content_repurposing"),
    ),
  };
}

/* ---------- fetch ---------- */

export class LiveApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "LiveApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LIVE_API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new LiveApiError(body?.detail ?? `${response.status} ${response.statusText}`, response.status);
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
    return name ? tokenized(`${LIVE_API}/api/documents/${name}`) : null;
  },

  /* ---------- Agent 2: Campaign-in-a-Box ---------- */

  boxPlan: (campaignId: string, actorId: string) =>
    call<{ status: string }>(`/api/box/campaigns/${campaignId}/plan`, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId }),
    }),

  boxDetail: (campaignId: string) => call<BoxDetail>(`/api/box/campaigns/${campaignId}`),

  boxConfirm: (
    campaignId: string, kind: "pack" | "plan", actorId: string,
    deltas?: Record<string, unknown>,
  ) =>
    call<{ status: string }>(`/api/box/campaigns/${campaignId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        kind, decision: deltas ? "modified" : "confirmed", actor_id: actorId,
        deltas: deltas ?? null,
      }),
    }),

  boxConfirmAsset: (campaignId: string, assetId: string, actorId: string) =>
    call<{ asset_id: string; version: number }>(
      `/api/box/campaigns/${campaignId}/assets/${assetId}/confirm`,
      { method: "POST", body: JSON.stringify({ actor_id: actorId, claim_refs: [] }) },
    ),

  boxPackage: (campaignId: string) =>
    call<{ status: string }>(`/api/box/campaigns/${campaignId}/package`, {
      method: "POST", body: "{}",
    }),

  boxReopen: (campaignId: string, assetIds: string[], actorId: string) =>
    call<{ status: string }>(`/api/box/campaigns/${campaignId}/reopen`, {
      method: "POST",
      body: JSON.stringify({ asset_ids: assetIds, actor_id: actorId }),
    }),

  boxTelemetry: () => call<StsRecord[]>("/api/telemetry?limit=1000"),

  /* ---------- Agent 3: Content Repurposing ---------- */

  boxFlagship: (campaignId: string, actorId: string) =>
    call<{ status: string }>(`/api/box/campaigns/${campaignId}/flagship`, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId }),
    }),

  boxDrafts: (campaignId: string) =>
    call<RepurposeDetail>(`/api/box/campaigns/${campaignId}/drafts`),

  boxFlagshipConfirm: (campaignId: string, actorId: string, actorRole: string) =>
    call<{ status: string }>(`/api/box/campaigns/${campaignId}/flagship/confirm`, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId, actor_role: actorRole }),
    }),

  boxFanout: (campaignId: string) =>
    call<{ status: string }>(`/api/box/campaigns/${campaignId}/fanout`, {
      method: "POST", body: "{}",
    }),

  boxRework: (campaignId: string, assetId: string, instruction: string, actorId: string) =>
    call<{ status: string }>(`/api/box/campaigns/${campaignId}/rework`, {
      method: "POST",
      body: JSON.stringify({ asset_id: assetId, instruction, actor_id: actorId }),
    }),

  /* Draft/claim-map download by workspace-relative path (from RepurposeDraft.file_rel). */
  boxDraftUrl: (rel: string | null | undefined): string | null =>
    rel ? tokenized(`${LIVE_API}/api/box/documents?path=${encodeURIComponent(rel)}`) : null,

  boxDocUrl: (folder: string | null | undefined, absoluteRef: string | null | undefined): string | null => {
    if (!folder || !absoluteRef) return null;
    const name = absoluteRef.split(/[\\/]/).pop();
    return name
      ? tokenized(`${LIVE_API}/api/box/documents?path=${encodeURIComponent(`${folder}/${name}`)}`)
      : null;
  },

  boxSnapshotUrl: (folder: string | null | undefined, canonicalName: string): string | null =>
    folder
      ? tokenized(`${LIVE_API}/api/box/documents?path=${encodeURIComponent(`${folder}/final/${canonicalName}`)}`)
      : null,
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
