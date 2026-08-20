export type PageKey =
  | "home" | "rollout" | "campaigns" | "agents" | "approvals"
  | "library" | "insights" | "users" | "intake" | "activity";

export type Role =
  | "Marketing Lead" | "BU Campaign Lead" | "Content Writer"
  | "Grammar / Quality Reviewer" | "AiCoE Admin" | "Viewer";

export type AgentKey = "CI" | "CB" | "CR" | "CO" | "QG" | "PK";

export type Person = {
  id: string;
  name: string;
  initials: string;
  role: Role;
  email: string;
  status: "Active" | "Invited";
  lastActive: string;
};

export type CampaignState =
  | "awaiting_input"
  | "brief_pending_approval"
  | "planning"
  | "in_production"
  | "in_review"
  | "packaged_pending_compliance"
  | "awaiting_signoff"
  | "approved_locked";

export type Campaign = {
  id: string;
  code: string;
  name: string;
  bu: string;
  vertical: string;
  campaignType: string;
  objective: string;
  topic: string;
  segment: string;
  channels: string[];
  window: { start: string; end: string };
  requesterId: string;
  ownerId: string;
  budgetApproved: boolean;
  state: CampaignState;
  step: number; // 1..9 journey position
};

export type AssetState = "planned" | "drafting" | "in_review" | "in_revision" | "content_confirmed" | "approved";

// Rendered stand-in for the versioned Word document in the OneDrive workspace
export type DocContent = {
  kicker: string;
  title: string;
  body: string[];
};

export type AssetVersion = {
  version: string;
  ts: number;
  author: { type: "agent"; agent: AgentKey } | { type: "human"; personId: string };
  note: string; // provenance: how this version came to exist (draft, revision reason, edit pass)
  hash: string;
  doc: DocContent;
};

export type Asset = {
  id: string;
  campaignId: string;
  name: string;
  assetType: string;
  disposition: "Create" | "Adapt" | "Reuse";
  ownerTeam: string;
  version: string;
  state: AssetState;
  claims: number;
  hash: string;
  versions: AssetVersion[]; // oldest first; version/hash above mirror the last entry
};

export type TaskKind = "conflict" | "gaps" | "brief_approval" | "plan_confirm" | "package_signoff" | "grammar_qa" | "review";

export type Task = {
  id: string;
  kind: TaskKind;
  campaignId: string;
  assetId?: string;
  title: string;
  detail: string;
  assigneeId: string;
  createdAt: number;
  slaHours: number;
  remindersSent: 0 | 1 | 2;
  escalated: boolean;
  status: "open" | "done";
  resolution?: { decision: string; byId: string; at: number; note?: string };
};

// ShiftAI Telemetry Standard (STS) v1.1 event envelope
export type TelemetryEvent = {
  id: string;
  ts: number;
  trace_id: string;
  run_id: string;
  span_id: string;
  agent: AgentKey | "studio";
  campaignId: string;
  activity: string;
  summary: string;
  actor: { type: "agent" | "human" | "system"; personId?: string };
  state?: { previous: string; current: string; reason: string };
  model?: string;
  prompt_version?: string;
  rules_pack?: string;
  tokens?: { input: number; output: number };
  cost_usd: number;
  timing: { llm_ms: number; api_ms: number; queue_ms: number; total_ms: number };
  outcome: "success" | "flagged" | "blocked" | "escalated" | "info";
  sources: string[];
  assetId?: string;
  systemExecuted: boolean; // counts toward the 46-activity autonomy measure
};

export type ApprovalRecord = {
  id: string;
  campaignId: string;
  assetId?: string;
  action: string;
  byId: string;
  role: Role;
  at: number;
  version?: string;
  hash: string;
};

export type Notification = {
  id: string;
  ts: number;
  personId: string;
  text: string;
  campaignId?: string;
  read: boolean;
};

export type AgentMeta = {
  key: AgentKey;
  name: string;
  kind: "AI agent" | "Hybrid" | "Deterministic";
  purpose: string;
  runtime: string;
  model?: string;
  prompt_version?: string;
  guardrail: string;
  autonomyLine: string;
};

export type AppState = {
  schema: number;
  viewAsId: string;
  people: Person[];
  campaigns: Campaign[];
  assets: Asset[];
  tasks: Task[];
  events: TelemetryEvent[];
  approvals: ApprovalRecord[];
  notifications: Notification[];
};
