import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type {
  AppState, ApprovalRecord, Asset, Campaign, Notification, Person, Task, TelemetryEvent,
} from "./types";
import { SCHEMA_VERSION, buildDoc, buildSeed, bumpVersion, fakeHash, initialsOf, makeEvent, reviseDoc, seedAssetsFor, type DerivedBrief } from "./data";
import { buildBoxSync, liveApi, LiveApiError, type BoxSyncInput } from "./live";
import { DEFAULT_PASSWORD, isAdmin } from "./access";

const AUTH_KEY = "shiftai.auth";

const STORAGE_KEY = "shiftai.demo.v3";

let uidSeq = 0;
export function uid(prefix: string): string {
  uidSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${uidSeq}`;
}

type Action =
  | { type: "RESET" }
  | { type: "EVENT"; event: TelemetryEvent }
  | { type: "CAMPAIGN_ADD"; campaign: Campaign }
  | { type: "CAMPAIGN_PATCH"; id: string; patch: Partial<Campaign> }
  | { type: "CAMPAIGN_REMOVE"; id: string }
  | { type: "ASSETS_ADD"; assets: Asset[] }
  | { type: "ASSET_PATCH"; id: string; patch: Partial<Asset> }
  | { type: "TASK_ADD"; task: Task }
  | { type: "TASK_PATCH"; id: string; patch: Partial<Task> }
  | { type: "APPROVAL_ADD"; approval: ApprovalRecord }
  | { type: "NOTIF_ADD"; notif: Notification }
  | { type: "NOTIFS_READ"; personId: string }
  | { type: "PERSON_ADD"; person: Person }
  | { type: "PERSON_PATCH"; id: string; patch: Partial<Person> }
  | { type: "PERSON_REMOVE"; id: string }
  | { type: "VIEWAS"; id: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "RESET": return buildSeed();
    case "EVENT": return { ...state, events: [...state.events, action.event] };
    case "CAMPAIGN_ADD": return { ...state, campaigns: [...state.campaigns, action.campaign] };
    case "CAMPAIGN_PATCH": return { ...state, campaigns: state.campaigns.map((c) => c.id === action.id ? { ...c, ...action.patch } : c) };
    case "CAMPAIGN_REMOVE": return {
      ...state,
      campaigns: state.campaigns.filter((c) => c.id !== action.id),
      assets: state.assets.filter((a) => a.campaignId !== action.id),
      tasks: state.tasks.filter((t) => t.campaignId !== action.id),
      events: state.events.filter((e) => e.campaignId !== action.id),
      notifications: state.notifications.filter((n) => n.campaignId !== action.id),
      approvals: state.approvals.filter((a) => a.campaignId !== action.id),
    };
    case "ASSETS_ADD": return { ...state, assets: [...state.assets, ...action.assets] };
    case "ASSET_PATCH": return { ...state, assets: state.assets.map((a) => a.id === action.id ? { ...a, ...action.patch } : a) };
    case "TASK_ADD": return { ...state, tasks: [...state.tasks, action.task] };
    case "TASK_PATCH": return { ...state, tasks: state.tasks.map((t) => t.id === action.id ? { ...t, ...action.patch } : t) };
    case "APPROVAL_ADD": return { ...state, approvals: [...state.approvals, action.approval] };
    case "NOTIF_ADD": return { ...state, notifications: [...state.notifications, action.notif] };
    case "NOTIFS_READ": return { ...state, notifications: state.notifications.map((n) => n.personId === action.personId ? { ...n, read: true } : n) };
    case "PERSON_ADD": return { ...state, people: [...state.people, action.person] };
    case "PERSON_PATCH": return { ...state, people: state.people.map((p) => p.id === action.id ? { ...p, ...action.patch } : p) };
    case "PERSON_REMOVE": return { ...state, people: state.people.filter((p) => p.id !== action.id) };
    case "VIEWAS": return { ...state, viewAsId: action.id };
    default: return state;
  }
}

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed.schema === SCHEMA_VERSION) return parsed;
    }
  } catch { /* corrupted or unavailable storage falls back to seed */ }
  return buildSeed();
}

/* ---------- Context ---------- */

export type IntakeForm = {
  objective: string; topic: string; bu: string; vertical: string; segment: string;
  owner: string; start: string; end: string; channels: string[]; budget: boolean;
};

/* An approved-for-routing brief coming from the REAL agent (bridge): mirrored into
   the demo store so the rest of the studio journey continues (real steps 1–3,
   simulated steps 4–9 until agents 3–5 are built). */
export type MirrorLiveBrief = {
  caseId: string; name: string; objective: string; topic: string; bu: string;
  vertical: string; segment: string; channels: string[];
  window: { start: string; end: string }; budgetApproved: boolean;
  request: string; briefVersion: string;
};

/* The REAL Campaign-in-a-Box plan mirrored into the studio journey: status,
   checklist and the agent's actual STS telemetry (real model, tokens, cost).
   Shape built by live.buildBoxSync. */
export type SyncLiveBoxInput = BoxSyncInput;

const BOX_ASSET_STATE: Record<string, Asset["state"]> = {
  planned: "planned", in_production: "drafting", reopened: "drafting",
  content_confirmed: "content_confirmed", packaged: "approved",
};

function boxEventSummary(r: Record<string, unknown>): string {
  const type = String(r["shiftai.event.type"]);
  switch (type) {
    case "case_intake": return "Approved brief picked up by Campaign-in-a-Box";
    case "tool_execution": {
      const tool = String(r["gen_ai.tool.name"] ?? "");
      if (tool === "intel.gather") return `Intel gathered (${r["shiftai.intel.mode"] ?? "sourced"}, ${r["shiftai.intel.signal_count"] ?? "?"} signals with provenance)`;
      if (tool === "repository.search") return `Repository reuse scan: ${r["shiftai.repository.candidates"] ?? 0} candidates scored`;
      if (tool === "workspace.create_campaign") return "Campaign workspace created from the versioned template";
      if (tool === "grounding.exclude_unsourced") return "Unsourced claims excluded by grounding (never published)";
      return tool || "Tool executed";
    }
    case "policy_check": return `Policy pass: ${r["shiftai.policy.decision"]}`;
    case "decision_made": {
      const what = String(r["shiftai.decision.action_class"] ?? "");
      if (what === "audience_offer_pack") return "Audience & offer pack drafted (grounded proof points)";
      if (what === "asset_checklist") return "Reuse/adapt/create checklist + outlines decided";
      if (what === "flagship_draft") return "Flagship drafted from the approved outline (sourced claims only)";
      if (what === "claim_inventory") return "Claim inventory extracted from the confirmed flagship (verbatim-verified)";
      if (what.startsWith("derivative:")) return `Channel derivative drafted: ${what.slice(11).replace(/_/g, " ")}`;
      return `Decision: ${what || "abstained"}`;
    }
    case "case_escalated": return `Escalated to ${r["shiftai.escalation.routed_to"]}: ${r["shiftai.learn.reason_code"]}`;
    case "action_taken": {
      const cls = String(r["shiftai.action.class"] ?? "");
      if (cls === "route_for_confirmation") return "Pack + plan routed to the Marketing Lead for confirmation";
      if (cls === "register_package_manifest") return "Campaign-in-a-Box manifest registered (hashed, pending compliance)";
      if (cls === "stage_draft") return `Draft staged in the campaign workspace: ${r["shiftai.draft.asset_id"] ?? "asset"} v${r["shiftai.draft.version"] ?? ""}`;
      return cls;
    }
    case "human_gate": return `Human gate: ${r["shiftai.hitl.decision"]} by ${r["shiftai.hitl.actor.role"]}`;
    case "case_resolved": return "Pack and plan confirmed — assets in production";
    case "run_summary": return `Run complete: ${r["shiftai.outcome"]}`;
    case "error": return `Error: ${r["error.type"]}`;
    default: return type;
  }
}

function boxEventFromSts(
  r: Record<string, unknown> & { "bridge.seq"?: number }, campaignId: string,
): TelemetryEvent | null {
  const seq = r["bridge.seq"];
  const type = String(r["shiftai.event.type"]);
  if (seq == null || type === "config_loaded") return null;
  const human = type === "human_gate";
  const dur = Number(r["shiftai.span.duration_ms"] ?? 0);
  const tokensIn = r["gen_ai.usage.input_tokens"];
  const cost = r["shiftai.cost.scope"] === "span_incremental" && typeof r["shiftai.cost.amount"] === "number"
    ? (r["shiftai.cost.amount"] as number) : 0;
  const isRepurposer = r["shiftai.agent.id"] === "content_repurposing";
  return {
    id: `evb_${seq}`,
    ts: Date.parse(String(r["shiftai.timestamp"])) || Date.now(),
    trace_id: String(r["shiftai.trace.id"] ?? ""),
    run_id: String(r["shiftai.run.id"] ?? `run_b${seq}`),
    span_id: String(r["shiftai.span.id"] ?? `sp_b${seq}`),
    agent: isRepurposer ? "CR" : "CB",
    campaignId,
    activity: type === "tool_execution" ? String(r["gen_ai.tool.name"] ?? type) : type,
    summary: boxEventSummary(r),
    actor: human ? { type: "human" } : { type: "agent" },
    model: r["gen_ai.response.model"] ? String(r["gen_ai.response.model"]) : undefined,
    prompt_version: r["shiftai.prompt.template.version"]
      ? String(r["shiftai.prompt.template.version"]) : undefined,
    tokens: typeof tokensIn === "number"
      ? { input: tokensIn, output: Number(r["gen_ai.usage.output_tokens"] ?? 0) } : undefined,
    cost_usd: cost,
    timing: { llm_ms: type === "decision_made" ? dur : 0, api_ms: type === "tool_execution" ? dur : 0, queue_ms: 0, total_ms: dur },
    outcome: type === "case_escalated" ? "escalated" : type === "error" ? "blocked" : "success",
    sources: [isRepurposer
      ? "Live STS record (Content Repurposing)"
      : "Live STS record (Campaign-in-a-Box)"],
    systemExecuted: !human,
  };
}

type Store = {
  state: AppState;
  now: number;
  viewer: Person;
  /** The signed-in account (null → show the login screen). `viewer` can differ
      only when an AiCoE Admin uses view-as. */
  authed: Person | null;
  login: (email: string, password: string) => string | null;
  logout: () => void;
  toast: string | null;
  showToast: (text: string) => void;
  traceId: string | null;
  openTrace: (traceId: string | null) => void;
  actions: {
    reset: () => void;
    setViewAs: (id: string) => void;
    markAllRead: () => void;
    submitRequest: (form: IntakeForm) => string;
    mirrorLiveBrief: (input: MirrorLiveBrief) => void;
    draftBrief: (description: string, derived: DerivedBrief) => string;
    reviseBrief: (campaignId: string, aspects: string[], note: string) => void;
    updateBrief: (campaignId: string, patch: Partial<Campaign>) => void;
    sendBrief: (campaignId: string) => void;
    discardDraft: (campaignId: string) => void;
    answerGaps: (taskId: string, segment: string, budget: string) => void;
    approveBrief: (taskId: string, liveCampaignId?: string) => void;
    returnBrief: (taskId: string, note: string) => void;
    syncLiveBox: (input: SyncLiveBoxInput) => void;
    completeLivePlanConfirm: (taskId: string) => void;
    confirmPlan: (taskId: string) => void;
    decideConflict: (taskId: string, decision: "recommended" | "operational" | "returned", note?: string) => void;
    completeReview: (taskId: string) => void;
    requestChanges: (taskId: string, aspects: string[], note: string) => void;
    grammarApprove: (taskId: string) => void;
    signOffPackage: (taskId: string) => void;
    reassignTask: (taskId: string, personId: string) => void;
    nudgeTask: (taskId: string) => void;
    addUser: (name: string, email: string, role: Person["role"]) => void;
    updateUser: (id: string, patch: { name?: string; email?: string; role?: Person["role"] }) => void;
    removeUser: (id: string) => void;
  };
};

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside provider");
  return store;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or unavailable */ }
  }, [state]);

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  function later(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  function showToast(text: string) {
    setToast(text);
    later(2600, () => setToast(null));
  }

  function emit(input: Parameters<typeof makeEvent>[0] & { trace: string }) {
    const event = { ...makeEvent(input), id: uid("ev"), span_id: uid("sp"), run_id: uid("run") };
    dispatch({ type: "EVENT", event });
    return event;
  }

  function notify(personId: string, text: string, campaignId?: string) {
    dispatch({ type: "NOTIF_ADD", notif: { id: uid("n"), ts: Date.now(), personId, text, campaignId, read: false } });
  }

  function addTask(task: Omit<Task, "id" | "createdAt" | "remindersSent" | "escalated" | "status">): string {
    const id = uid("t");
    dispatch({ type: "TASK_ADD", task: { ...task, id, createdAt: Date.now(), remindersSent: 0, escalated: false, status: "open" } });
    return id;
  }

  function record(campaignId: string, action: string, byId: string, version?: string, assetId?: string, hash?: string) {
    const person = state.people.find((p) => p.id === byId);
    const approval: ApprovalRecord = {
      id: uid("ap"), campaignId, assetId, action, byId,
      role: person?.role ?? "Viewer", at: Date.now(), version,
      // Content approvals bind to the artifact's content hash; workflow approvals get a record hash.
      hash: hash ?? fakeHash(`${campaignId}-${action}-${Date.now()}`),
    };
    dispatch({ type: "APPROVAL_ADD", approval });
  }

  /* ---- Lightweight auth (SSO replaces this in production) ---- */
  const [authedId, setAuthedId] = useState<string | null>(() => {
    try { return localStorage.getItem(AUTH_KEY); } catch { return null; }
  });
  const authed = authedId ? state.people.find((p) => p.id === authedId) ?? null : null;

  function login(email: string, password: string): string | null {
    const person = state.people.find(
      (p) => p.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!person) return "No workspace account for that email — ask AiCoE to add you (Users page).";
    if (password !== DEFAULT_PASSWORD) return "Incorrect password. AiCoE shares the default password with every account.";
    if (person.status === "Invited") {
      dispatch({ type: "PERSON_PATCH", id: person.id, patch: { status: "Active", lastActive: "Now" } });
    }
    try { localStorage.setItem(AUTH_KEY, person.id); } catch { /* unavailable */ }
    setAuthedId(person.id);
    dispatch({ type: "VIEWAS", id: person.id });
    return null;
  }

  function logout() {
    try { localStorage.removeItem(AUTH_KEY); } catch { /* unavailable */ }
    setAuthedId(null);
  }

  /* Non-admins always act as themselves; view-as is an admin-only instrument. */
  const viewAsPerson = state.people.find((p) => p.id === state.viewAsId);
  const viewer = authed
    ? (isAdmin(authed.role) ? viewAsPerson ?? authed : authed)
    : viewAsPerson ?? state.people[0];

  const actions: Store["actions"] = {
    reset: () => { dispatch({ type: "RESET" }); showToast("Demo data reset to the starting point"); },
    setViewAs: (id) => { dispatch({ type: "VIEWAS", id }); },
    markAllRead: () => dispatch({ type: "NOTIFS_READ", personId: state.viewAsId }),

    submitRequest: (form) => {
      const id = uid("c");
      const trace = uid("tr");
      const code = form.topic.slice(0, 2).toUpperCase();
      const campaign: Campaign = {
        id, code, name: form.topic, bu: form.bu, vertical: form.vertical,
        campaignType: "Demand generation", objective: form.objective, topic: form.topic,
        segment: form.segment, channels: form.channels, window: { start: form.start, end: form.end },
        requesterId: state.viewAsId, ownerId: "rishi", budgetApproved: form.budget,
        state: "brief_pending_approval", step: 1,
      };
      dispatch({ type: "CAMPAIGN_ADD", campaign });
      emit({ ts: Date.now(), trace, agent: "CI", campaignId: id, activity: "validate_brief", summary: "Completeness validated, 9 of 9 required fields present", tokens: { input: 3100, output: 840 }, cost: 0.04, llm: 3800, sources: ["On-demand intake", "Brief template v1.2"] });
      later(700, () => emit({ ts: Date.now(), trace, agent: "CI", campaignId: id, activity: "duplicate_check", summary: "No duplicates or conflicts found in the campaign calendar", cost: 0.01, llm: 900, sources: ["Campaign calendar"] }));
      later(1400, () => emit({ ts: Date.now(), trace, agent: "CI", campaignId: id, activity: "classify_and_draft", summary: "Classified as demand generation, brief draft created in the campaign workspace", tokens: { input: 2400, output: 1100 }, cost: 0.03, llm: 4200, sources: ["Quarterly plan Q3"] }));
      later(2100, () => {
        emit({ ts: Date.now(), trace, agent: "CI", campaignId: id, activity: "route_brief_approval", summary: "Brief approval routed to Marcus Webb, due in 2 business days", cost: 0 });
        addTask({ kind: "brief_approval", campaignId: id, title: "Approve campaign brief", detail: `${form.topic} · brief v1.0 validated`, assigneeId: "marcus", slaHours: 48 });
        notify("marcus", `${form.topic} brief is ready for your approval`, id);
      });
      return id;
    },

    mirrorLiveBrief: (input) => {
      const lead = state.people.find((p) => p.role === "BU Campaign Lead") ?? state.people[0];
      const trace = uid("tr");
      const existing = state.campaigns.find((c) => c.id === input.caseId);
      const campaign: Campaign = {
        id: input.caseId,
        code: (input.name.replace(/[^A-Za-z]/g, "").slice(0, 2) || "LC").toUpperCase(),
        name: input.name, bu: input.bu, vertical: input.vertical,
        campaignType: "Demand generation", objective: input.objective, topic: input.topic,
        segment: input.segment, channels: input.channels, window: input.window,
        requesterId: state.viewAsId, ownerId: state.viewAsId,
        budgetApproved: input.budgetApproved, state: "brief_pending_approval", step: 1,
        request: input.request, briefVersion: input.briefVersion, liveCaseId: input.caseId,
      };
      if (existing) dispatch({ type: "CAMPAIGN_PATCH", id: input.caseId, patch: { ...campaign } });
      else dispatch({ type: "CAMPAIGN_ADD", campaign });
      emit({ ts: Date.now(), trace, agent: "CI", campaignId: input.caseId, activity: "draft_brief", summary: `Brief ${input.briefVersion} drafted by the live Campaign Identification agent (see Live agents for the full STS trace)`, cost: 0, sources: ["Live agent case " + input.caseId] });
      emit({ ts: Date.now(), trace, agent: "CI", campaignId: input.caseId, activity: "route_brief_approval", summary: `Brief approval routed to ${lead.name}, due in 2 business days`, cost: 0, sources: ["Live agent case " + input.caseId] });
      const hasOpenTask = state.tasks.some(
        (t) => t.campaignId === input.caseId && t.kind === "brief_approval" && t.status === "open",
      );
      if (!hasOpenTask) {
        addTask({
          kind: "brief_approval", campaignId: input.caseId, title: "Approve campaign brief",
          detail: `${input.name} · brief ${input.briefVersion} drafted by the live agent, verified by ${viewer.name.split(" ")[0]}`,
          assigneeId: lead.id, slaHours: 48, liveCaseId: input.caseId,
        });
        notify(lead.id, `${input.name} brief (live agent) is ready for your approval`, input.caseId);
      }
    },

    /* ---- AI-first intake: the agent drafts, the Marketing Lead verifies and iterates,
       nothing is routed until sendBrief. ---- */

    draftBrief: (description, derived) => {
      const id = uid("c");
      const trace = uid("tr");
      const code = (derived.name.replace(/[^A-Za-z]/g, "").slice(0, 2) || "NC").toUpperCase();
      const campaign: Campaign = {
        id, code, name: derived.name, bu: derived.bu, vertical: derived.vertical,
        campaignType: "Demand generation", objective: derived.objective, topic: derived.topic,
        segment: "", channels: derived.channels, window: { start: "", end: "" },
        requesterId: state.viewAsId, ownerId: state.viewAsId, budgetApproved: false,
        state: "brief_draft", step: 1, request: description, briefVersion: "v0.1", briefAngle: "balanced",
      };
      dispatch({ type: "CAMPAIGN_ADD", campaign });
      emit({ ts: Date.now(), trace, agent: "CI", campaignId: id, activity: "parse_request", summary: "Request parsed: objective, vertical and channels extracted, gaps flagged for you", tokens: { input: 1900, output: 460 }, cost: 0.02, llm: 2600, sources: ["Your request", "Brief template v1.2"] });
      later(700, () => emit({ ts: Date.now(), trace, agent: "CI", campaignId: id, activity: "duplicate_check", summary: "No duplicates or conflicts found in the campaign calendar", cost: 0.01, llm: 900, sources: ["Campaign calendar"] }));
      later(1500, () => emit({ ts: Date.now(), trace, agent: "CI", campaignId: id, activity: "draft_brief", summary: "Brief v0.1 drafted for your review; nothing is routed until you send it", tokens: { input: 2400, output: 1150 }, cost: 0.03, llm: 4100, state: { previous: "request_received", current: "brief_draft", reason: "Marketing Lead reviews and iterates before anything moves" }, sources: ["Quarterly plan Q3"] }));
      return id;
    },

    reviseBrief: (campaignId, aspects, note) => {
      const campaign = state.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return;
      const has = (a: string) => aspects.includes(a);
      const patch: Partial<Campaign> = {};
      if (has("Executive angle")) patch.briefAngle = "executive";
      if (has("Practical angle")) patch.briefAngle = "practical";
      if (has("Tighter objective")) patch.objective = campaign.objective.split(/[,;.]/)[0].trim();
      if (has("Stronger offer") && !/concrete first step/.test(campaign.topic)) patch.topic = `${campaign.topic.replace(/…$/, "")}, with a concrete first step`;
      const nextVersion = bumpVersion(campaign.briefVersion ?? "v0.1");
      patch.briefVersion = nextVersion;
      dispatch({ type: "CAMPAIGN_PATCH", id: campaignId, patch });
      emit({ ts: Date.now(), trace: uid("tr"), agent: "CI", campaignId, activity: "revise_brief", summary: `Brief revised to ${nextVersion} from your directive (${aspects.join(", ").toLowerCase()})`, tokens: { input: 2100, output: 640 }, cost: 0.03, llm: 2900, sources: ["Marketing Lead directive"], state: { previous: campaign.briefVersion ?? "v0.1", current: nextVersion, reason: note || aspects.join(", ") } });
      showToast(`Brief revised to ${nextVersion}, still with you`);
    },

    updateBrief: (campaignId, patch) => {
      dispatch({ type: "CAMPAIGN_PATCH", id: campaignId, patch });
    },

    sendBrief: (campaignId) => {
      const campaign = state.campaigns.find((c) => c.id === campaignId);
      if (!campaign) return;
      const trace = uid("tr");
      const lead = state.people.find((p) => p.role === "BU Campaign Lead") ?? state.people[0];
      dispatch({ type: "CAMPAIGN_PATCH", id: campaignId, patch: { state: "brief_pending_approval" } });
      emit({ ts: Date.now(), trace, agent: "studio", campaignId, activity: "brief_finalised", summary: `Brief ${campaign.briefVersion ?? "v0.1"} verified by ${viewer.name} and released for approval`, actor: { type: "human", personId: state.viewAsId }, system: false, state: { previous: "brief_draft", current: "brief_pending_approval", reason: "Marketing Lead verified the agent draft and filled the fields agents never infer" } });
      later(700, () => {
        emit({ ts: Date.now(), trace, agent: "CI", campaignId, activity: "route_brief_approval", summary: `Brief approval routed to ${lead.name}, due in 2 business days`, cost: 0.01 });
        addTask({ kind: "brief_approval", campaignId, title: "Approve campaign brief", detail: `Brief ${campaign.briefVersion ?? "v0.1"}, verified by ${viewer.name.split(" ")[0]} before routing`, assigneeId: lead.id, slaHours: 48 });
        notify(lead.id, `${campaign.name} brief is ready for your approval`, campaignId);
      });
      showToast(`Brief sent to ${lead.name} for approval`);
    },

    discardDraft: (campaignId) => {
      dispatch({ type: "CAMPAIGN_REMOVE", id: campaignId });
      showToast("Draft discarded, nothing was routed");
    },

    answerGaps: (taskId, segment, budget) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const trace = uid("tr");
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: `Answered: segment ${segment}, budget ${budget}`, byId: state.viewAsId, at: Date.now() } } });
      dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { segment, budgetApproved: budget === "Yes", state: "brief_pending_approval" } });
      emit({ ts: Date.now(), trace, agent: "CI", campaignId: task.campaignId, activity: "revalidate_brief", summary: "Gap answers received, brief re-validated with 9 of 9 fields", actor: { type: "human", personId: state.viewAsId }, cost: 0.02, llm: 2100, system: false, state: { previous: "awaiting_input", current: "brief_pending_approval", reason: "Requester supplied the missing fields" } });
      later(900, () => {
        emit({ ts: Date.now(), trace, agent: "CI", campaignId: task.campaignId, activity: "route_brief_approval", summary: "Brief approval routed to Marcus Webb, due in 2 business days", cost: 0 });
        addTask({ kind: "brief_approval", campaignId: task.campaignId, title: "Approve campaign brief", detail: "Copilot Cloud Essentials · re-validated brief v1.1", assigneeId: "marcus", slaHours: 48 });
        notify("marcus", "Copilot Cloud Essentials brief re-validated and ready for approval", task.campaignId);
      });
      showToast("Answers sent, brief re-validation queued");
    },

    approveBrief: (taskId, liveCampaignId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const trace = uid("tr");
      const campaign = state.campaigns.find((c) => c.id === task.campaignId);
      const isLive = Boolean(task.liveCaseId ?? campaign?.liveCaseId);
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: "Brief approved", byId: state.viewAsId, at: Date.now() } } });
      record(task.campaignId, "Brief approved", state.viewAsId, "v1.0");
      dispatch({
        type: "CAMPAIGN_PATCH", id: task.campaignId,
        patch: { state: "planning", step: 2, ...(liveCampaignId ? { liveCampaignId } : {}) },
      });
      emit({ ts: Date.now(), trace, agent: "studio", campaignId: task.campaignId, activity: "brief_approved", summary: `Brief approved by ${viewer.name}`, actor: { type: "human", personId: state.viewAsId }, system: false, state: { previous: "brief_pending_approval", current: "planning", reason: "BU Campaign Lead approval recorded with identity and timestamp" } });
      if (isLive) {
        // Steps 2–3 are REAL: on approval the studio triggers the actual
        // Campaign-in-a-Box planning pass on the bridge (spec: planning is
        // event-triggered by brief approval — nobody "runs an agent"). When it
        // finishes, the pack + plan land as a confirmation task in Approvals and
        // the agent's real telemetry is mirrored into this journey.
        const owner = campaign?.ownerId ?? "rishi";
        emit({ ts: Date.now(), trace, agent: "CB", campaignId: task.campaignId, activity: "planning_started", summary: "Approved brief handed to the REAL Campaign-in-a-Box agent — planning pass running (1–3 min)", cost: 0, sources: ["Live agent bridge"] });
        if (liveCampaignId) {
          void (async () => {
            try {
              await liveApi.boxPlan(liveCampaignId, viewer.email);
              const detail = await liveApi.boxDetail(liveCampaignId);
              const records = await liveApi.boxTelemetry();
              actions.syncLiveBox(buildBoxSync(detail, records));
              if (detail.summary.status === "awaiting_confirmation") {
                addTask({
                  kind: "plan_confirm", campaignId: task.campaignId,
                  title: "Confirm audience & offer pack + plan",
                  detail: `${campaign?.name ?? "Campaign"} · proposed by the LIVE Campaign-in-a-Box agent`,
                  assigneeId: owner, slaHours: 48, liveCaseId: liveCampaignId,
                });
                notify(owner, `${campaign?.name ?? "Campaign"}: the real audience & offer pack and plan are ready for your confirmation`, task.campaignId);
              } else {
                notify(owner, `${campaign?.name ?? "Campaign"}: planning finished with status ${detail.summary.status.replace(/_/g, " ")} — see Live agents`, task.campaignId);
              }
            } catch (e) {
              emit({ ts: Date.now(), trace, agent: "CB", campaignId: task.campaignId, activity: "planning_failed", summary: `Planning pass failed: ${e instanceof Error ? e.message : e}`, cost: 0, outcome: "blocked", sources: ["Live agent bridge"] });
              notify(owner, `${campaign?.name ?? "Campaign"}: the planning pass failed — check the bridge (Live agents)`, task.campaignId);
            }
          })();
        }
      } else {
        later(900, () => emit({ ts: Date.now(), trace, agent: "CB", campaignId: task.campaignId, activity: "pull_intel", summary: "SemRush and intel library scan complete", tokens: { input: 8200, output: 1900 }, cost: 0.17, llm: 15000, api: 4800, sources: ["SemRush", "OneDrive intel library"] }));
        later(1900, () => {
          emit({ ts: Date.now(), trace, agent: "CB", campaignId: task.campaignId, activity: "plan_campaign", summary: "Audience & offer pack, 9-asset checklist and workspace created", tokens: { input: 19600, output: 5300 }, cost: 0.55, llm: 37000, sources: ["Brief v1.0", "Workspace template v2.0"] });
          dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { step: 3 } });
          addTask({ kind: "plan_confirm", campaignId: task.campaignId, title: "Confirm audience & offer", detail: `${campaign?.name ?? "Campaign"} · pack and plan proposed by Campaign-in-a-Box`, assigneeId: campaign?.ownerId ?? "rishi", slaHours: 48 });
          notify(campaign?.ownerId ?? "rishi", `${campaign?.name ?? "Campaign"}: audience & offer pack is ready for your confirmation`, task.campaignId);
        });
      }
      showToast("Brief approved and recorded");
    },

    /* Mirror of the REAL Campaign-in-a-Box run: journey position, the actual
       checklist (reuse/adapt/create) and the agent's real telemetry — model that
       ran, real token counts, cost priced by the fleet rate card. Idempotent. */
    syncLiveBox: (input) => {
      const campaign = state.campaigns.find(
        (c) => c.liveCampaignId === input.liveCampaignId || c.id === input.liveCampaignId,
      );
      if (!campaign) return;

      const target: { state: Campaign["state"]; step: number } | null =
        input.status === "awaiting_confirmation" ? { state: "planning", step: 2 }
        : input.status === "in_production" || input.status === "packaging_blocked"
          ? { state: "in_production", step: 4 }
        : input.status === "packaged_pending_compliance"
          ? { state: "packaged_pending_compliance", step: 7 }
        : null;
      if (target && (campaign.state !== target.state || campaign.step !== target.step)) {
        dispatch({ type: "CAMPAIGN_PATCH", id: campaign.id, patch: target });
        if (input.status === "awaiting_confirmation" && campaign.state !== "planning") {
          notify(campaign.ownerId, `${campaign.name}: audience & offer pack + plan await your confirmation in Campaign box (live)`, campaign.id);
        }
      }

      // Real checklist → studio assets (decision + production status per asset).
      const manifestByAsset = new Map(
        (input.manifest?.assets ?? []).map((a) => [a.asset_id, a]),
      );
      const fresh: Asset[] = [];
      input.checklist.forEach((item) => {
        const id = `${campaign.id}-${item.assetId}`;
        const packaged = manifestByAsset.get(item.assetId);
        const patch: Partial<Asset> = {
          state: BOX_ASSET_STATE[item.status] ?? "planned",
          disposition: (item.decision.charAt(0).toUpperCase() + item.decision.slice(1)) as Asset["disposition"],
          version: packaged ? `v${packaged.version}` : item.status === "planned" ? "planned" : "v1",
          hash: packaged ? `${packaged.sha256.slice(0, 4)}…${packaged.sha256.slice(4, 8)}` : "pending",
        };
        const existing = state.assets.find((a) => a.id === id);
        const changed = existing && (
          existing.state !== patch.state || existing.disposition !== patch.disposition
          || existing.version !== patch.version || existing.hash !== patch.hash
        );
        if (existing && changed) dispatch({ type: "ASSET_PATCH", id, patch });
        else if (!existing) fresh.push({
          id, campaignId: campaign.id, name: item.label, assetType: "Word",
          disposition: patch.disposition ?? "Create", ownerTeam: "Content team",
          version: patch.version ?? "planned", state: patch.state ?? "planned",
          claims: 0, hash: patch.hash ?? "pending", versions: [],
        });
      });
      if (fresh.length > 0) dispatch({ type: "ASSETS_ADD", assets: fresh });

      // Real STS records → activity stream (deduped by bridge sequence).
      const seen = new Set(state.events.map((e) => e.id));
      input.records.forEach((r) => {
        const event = boxEventFromSts(r, campaign.id);
        if (event && !seen.has(event.id)) dispatch({ type: "EVENT", event });
      });
    },

    /* Both live confirmations (pack + plan) recorded on the bridge — close the
       Approvals task and move the journey to production. The content stand-in
       lives on the campaign page until Agents 3–4 exist. */
    completeLivePlanConfirm: (taskId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task || task.status === "done") return;
      const campaign = state.campaigns.find((c) => c.id === task.campaignId);
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: "Pack & plan confirmed", byId: state.viewAsId, at: Date.now() } } });
      record(task.campaignId, "Pack & plan confirmed (live agent)", state.viewAsId);
      emit({ ts: Date.now(), trace: uid("tr"), agent: "studio", campaignId: task.campaignId, activity: "plan_confirmed", summary: `Pack and plan confirmed by ${viewer.name} — recorded by the live agent with identity`, actor: { type: "human", personId: state.viewAsId }, system: false, state: { previous: "planning", current: "in_production", reason: "Marketing Lead confirmation recorded by the Campaign-in-a-Box agent" } });
      notify(campaign?.ownerId ?? "rishi", `${campaign?.name ?? "Campaign"}: assets are in production — confirm content per asset on the campaign page`, task.campaignId);
      showToast("Pack & plan confirmed — assets in production");
    },

    returnBrief: (taskId, note) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: "Returned with note", byId: state.viewAsId, at: Date.now(), note } } });
      dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { state: "awaiting_input" } });
      emit({ ts: Date.now(), trace: uid("tr"), agent: "studio", campaignId: task.campaignId, activity: "brief_returned", summary: `Brief returned to requester by ${viewer.name} with a note`, actor: { type: "human", personId: state.viewAsId }, system: false, outcome: "flagged", state: { previous: "brief_pending_approval", current: "awaiting_input", reason: note || "Returned for changes" } });
      const campaign = state.campaigns.find((c) => c.id === task.campaignId);
      if (campaign) notify(campaign.requesterId, `${campaign.name} brief was returned with a note: ${note}`, campaign.id);
      showToast("Brief returned to the requester");
    },

    confirmPlan: (taskId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const trace = uid("tr");
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: "Plan confirmed", byId: state.viewAsId, at: Date.now() } } });
      record(task.campaignId, "Plan confirmed", state.viewAsId, "v1.1");
      dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { state: "in_production", step: 4 } });
      emit({ ts: Date.now(), trace, agent: "studio", campaignId: task.campaignId, activity: "plan_confirmed", summary: `Plan, owners and dates confirmed by ${viewer.name}`, actor: { type: "human", personId: state.viewAsId }, system: false, state: { previous: "planning", current: "in_production", reason: "Marketing confirmation recorded" } });
      const campaign = state.campaigns.find((c) => c.id === task.campaignId);
      later(1000, () => {
        if (campaign && !state.assets.some((a) => a.campaignId === campaign.id)) {
          const checklist = seedAssetsFor(campaign);
          dispatch({ type: "ASSETS_ADD", assets: checklist });
          emit({ ts: Date.now(), trace, agent: "CR", campaignId: task.campaignId, activity: "draft_flagship", summary: "Flagship v1.0 drafted in the campaign workspace, sourced claims only", tokens: { input: 24500, output: 14100 }, cost: 1.69, llm: 89000, assetId: checklist[0].id, sources: ["Claim inventory"] });
          addTask({ kind: "review", campaignId: task.campaignId, assetId: checklist[0].id, title: "Refine and confirm flagship", detail: "Flagship draft v1.0 staged for editorial confirmation", assigneeId: "jen", slaHours: 24 });
        } else {
          emit({ ts: Date.now(), trace, agent: "CR", campaignId: task.campaignId, activity: "draft_flagship", summary: "Flagship draft staged with sourced claims only", tokens: { input: 24500, output: 14100 }, cost: 1.69, llm: 89000, sources: ["Claim inventory"] });
          addTask({ kind: "review", campaignId: task.campaignId, title: "Refine and confirm flagship", detail: "Flagship draft v1.0 staged for editorial confirmation", assigneeId: "jen", slaHours: 24 });
        }
        notify("jen", "A new flagship draft is staged for your editorial confirmation", task.campaignId);
      });
      showToast("Plan confirmed, content drafting started");
    },

    decideConflict: (taskId, decision, note) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const trace = uid("tr");
      const labels = { recommended: "Used agent-recommended direction", operational: "Chose Jen's operational-first direction", returned: "Returned with note" } as const;
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: labels[decision], byId: state.viewAsId, at: Date.now(), note } } });
      record(task.campaignId, `Marketing decision: ${labels[decision]}`, state.viewAsId, "v1.2", task.assetId);
      emit({ ts: Date.now(), trace, agent: "studio", campaignId: task.campaignId, activity: "conflict_resolved", summary: `${labels[decision]} by ${viewer.name}`, actor: { type: "human", personId: state.viewAsId }, assetId: task.assetId, system: false, state: { previous: "in_revision", current: decision === "returned" ? "in_review" : "content_confirmed", reason: note || "Marketing Lead adjudicated the reviewer conflict" } });
      if (decision === "returned") { showToast("Returned to reviewers with your note"); return; }
      if (task.assetId) dispatch({ type: "ASSET_PATCH", id: task.assetId, patch: { state: "content_confirmed" } });
      dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { step: 6 } });
      later(1000, () => {
        emit({ ts: Date.now(), trace, agent: "PK", campaignId: task.campaignId, activity: "assemble_manifest", summary: "Manifest assembled, hashes computed, completeness diff empty", state: { previous: "in_review", current: "packaged_pending_compliance", reason: "All checklist assets content-confirmed" } });
        dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { state: "packaged_pending_compliance", step: 7 } });
      });
      later(2100, () => {
        emit({ ts: Date.now(), trace, agent: "QG", campaignId: task.campaignId, activity: "compliance_pass", summary: "42 checks completed, 0 blocking findings", tokens: { input: 9100, output: 1800 }, cost: 0.28, llm: 12500, sources: ["Rules pack v3.2"] });
        dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { step: 8 } });
        addTask({ kind: "grammar_qa", campaignId: task.campaignId, title: "Final language QA", detail: "Market-facing assets routed for Grammar QA", assigneeId: "tom", slaHours: 24 });
        notify("tom", "BC Cloud Momentum assets passed compliance and await your language QA", task.campaignId);
      });
      showToast("Decision recorded with identity, timestamp and hash");
    },

    completeReview: (taskId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const trace = uid("tr");
      const asset = task.assetId ? state.assets.find((a) => a.id === task.assetId) : undefined;
      const isFlagship = task.title.toLowerCase().includes("flagship") || (asset?.id.endsWith("-a0") ?? false);
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: "Content confirmed", byId: state.viewAsId, at: Date.now() } } });
      if (asset) {
        dispatch({ type: "ASSET_PATCH", id: asset.id, patch: { state: "content_confirmed" } });
        // The approval binds to the exact version and content hash the reviewer saw.
        record(task.campaignId, isFlagship ? "Flagship content confirmed" : `Content confirmed: ${asset.name}`, state.viewAsId, asset.version, asset.id, asset.hash);
      } else if (isFlagship) {
        record(task.campaignId, "Flagship content confirmed", state.viewAsId, "v1.0", task.assetId);
      }
      emit({ ts: Date.now(), trace, agent: "CO", campaignId: task.campaignId, activity: isFlagship ? "flagship_confirmed" : "review_complete", summary: `${asset ? `${asset.name} ${asset.version}` : task.title} confirmed by ${viewer.name}`, actor: { type: "human", personId: state.viewAsId }, assetId: task.assetId, system: false, cost: 0, state: asset ? { previous: "in_review", current: "content_confirmed", reason: `Human confirmation recorded on ${asset.version}, hash ${asset.hash}` } : undefined });
      // Flagship confirmation unlocks the eight-channel fan-out (dynamic campaigns only)
      const planned = state.assets.filter((a) => a.campaignId === task.campaignId && a.state === "planned");
      if (isFlagship && asset && planned.length > 0) {
        const campaign = state.campaigns.find((c) => c.id === task.campaignId);
        later(1400, () => {
          emit({ ts: Date.now(), trace, agent: "CR", campaignId: task.campaignId, activity: "fan_out", summary: `${planned.length} channel derivatives staged from confirmed flagship ${asset.version}`, tokens: { input: 28500, output: 19800 }, cost: 1.24, llm: 72000, sources: [`Flagship ${asset.version}`, "Claim inventory"] });
          planned.forEach((a) => {
            const hash = fakeHash(`${a.id}-v1.0-${Date.now()}`);
            dispatch({ type: "ASSET_PATCH", id: a.id, patch: { state: "in_review", version: "v1.0", hash, versions: [{ version: "v1.0", ts: Date.now(), author: { type: "agent", agent: "CR" }, note: "Staged from the confirmed flagship claim inventory in bulk fan-out mode", hash, doc: campaign ? buildDoc(campaign, a.name) : { kicker: "", title: a.name, body: [] } }] } });
          });
          dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { step: 5, state: "in_review" } });
          notify(campaign?.ownerId ?? "rishi", `${campaign?.name ?? "Campaign"}: 8 derivatives staged from the confirmed flagship`, task.campaignId);
        });
      }
      showToast(asset ? `${asset.name} confirmed on ${asset.version}` : "Review recorded");
    },

    requestChanges: (taskId, aspects, note) => {
      const task = state.tasks.find((t) => t.id === taskId);
      const asset = task?.assetId ? state.assets.find((a) => a.id === task.assetId) : undefined;
      if (!task || !asset) return;
      const trace = uid("tr");
      const reviewerId = state.viewAsId;
      const reviewerName = viewer.name;
      const aspectLine = aspects.join(", ");
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: `Changes requested (${aspectLine})`, byId: reviewerId, at: Date.now(), note } } });
      dispatch({ type: "ASSET_PATCH", id: asset.id, patch: { state: "in_revision" } });
      emit({ ts: Date.now(), trace, agent: "studio", campaignId: task.campaignId, activity: "changes_requested", summary: `${reviewerName} requested changes on ${asset.name} ${asset.version} (${aspectLine.toLowerCase()})`, actor: { type: "human", personId: reviewerId }, assetId: asset.id, system: false, outcome: "flagged", cost: 0, state: { previous: "in_review", current: "in_revision", reason: `${aspectLine} · ${note}` }, sources: [`${asset.name} ${asset.version}`] });
      const nextVersion = bumpVersion(asset.version);
      const latest = asset.versions[asset.versions.length - 1];
      const newHash = fakeHash(`${asset.id}-${nextVersion}-${Date.now()}`);
      later(1500, () => {
        emit({ ts: Date.now(), trace, agent: "CR", campaignId: task.campaignId, activity: "revise_draft", summary: `${asset.name} revised to ${nextVersion} from reviewer feedback, sourced claims unchanged`, tokens: { input: 9800, output: 3400 }, cost: 0.21, llm: 15000, assetId: asset.id, sources: ["Reviewer feedback", "Claim inventory"], state: { previous: "in_revision", current: "in_review", reason: "Revision staged for re-review" } });
        dispatch({ type: "ASSET_PATCH", id: asset.id, patch: {
          version: nextVersion, hash: newHash, state: "in_review",
          versions: [...asset.versions, { version: nextVersion, ts: Date.now(), author: { type: "agent", agent: "CR" }, note: `Revision requested by ${reviewerName} (${aspectLine.toLowerCase()}): ${note}`, hash: newHash, doc: latest ? reviseDoc(latest.doc, aspects) : { kicker: "", title: asset.name, body: [] } }],
        } });
      });
      later(2400, () => {
        emit({ ts: Date.now(), trace, agent: "CO", campaignId: task.campaignId, activity: "stage_reviews", summary: `${asset.name} ${nextVersion} staged and routed back to ${reviewerName}`, cost: 0.01, llm: 600, assetId: asset.id });
        addTask({ kind: "review", campaignId: task.campaignId, assetId: asset.id, title: `Re-review ${asset.name.toLowerCase()}`, detail: `${nextVersion} revised per your feedback (${aspectLine.toLowerCase()})`, assigneeId: reviewerId, slaHours: 24 });
        notify(reviewerId, `${asset.name} ${nextVersion} is ready for your re-review`, task.campaignId);
      });
      showToast("Changes requested, Content Repurposing is revising");
    },

    grammarApprove: (taskId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const trace = uid("tr");
      const campaign = state.campaigns.find((c) => c.id === task.campaignId);
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: "Grammar QA approved", byId: state.viewAsId, at: Date.now() } } });
      record(task.campaignId, "Grammar QA approved", state.viewAsId, "v1.3");
      dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { state: "awaiting_signoff", step: 9 } });
      emit({ ts: Date.now(), trace, agent: "studio", campaignId: task.campaignId, activity: "grammar_qa_approved", summary: `Final language QA approved by ${viewer.name}`, actor: { type: "human", personId: state.viewAsId }, system: false, state: { previous: "grammar_qa", current: "awaiting_signoff", reason: "Language gate cleared" } });
      later(800, () => {
        emit({ ts: Date.now(), trace, agent: "QG", campaignId: task.campaignId, activity: "route_signoff", summary: "Package sign-off routed to the BU Campaign Lead", cost: 0.01 });
        addTask({ kind: "package_signoff", campaignId: task.campaignId, title: "Sign off campaign package", detail: `${campaign?.name ?? "Campaign"} · all gates cleared`, assigneeId: "marcus", slaHours: 48 });
        notify("marcus", `${campaign?.name ?? "A campaign"} package awaits your final sign-off`, task.campaignId);
      });
      showToast("Language QA approved and recorded");
    },

    signOffPackage: (taskId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: "Package signed off", byId: state.viewAsId, at: Date.now() } } });
      record(task.campaignId, "Package signed off & locked", state.viewAsId, "v1.4");
      dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { state: "approved_locked", step: 9 } });
      state.assets.filter((a) => a.campaignId === task.campaignId).forEach((a) => dispatch({ type: "ASSET_PATCH", id: a.id, patch: { state: "approved" } }));
      emit({ ts: Date.now(), trace: uid("tr"), agent: "studio", campaignId: task.campaignId, activity: "package_signed_off", summary: `Package signed off by ${viewer.name} and locked read-only in OneDrive`, actor: { type: "human", personId: state.viewAsId }, system: false, state: { previous: "awaiting_signoff", current: "approved_locked", reason: "Final sign-off recorded, versions locked" } });
      const campaign = state.campaigns.find((c) => c.id === task.campaignId);
      if (campaign) notify(campaign.ownerId, `${campaign.name} is approved, locked and ready for hand-off`, campaign.id);
      showToast("Package signed off and locked");
    },

    reassignTask: (taskId, personId) => {
      const person = state.people.find((p) => p.id === personId);
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { assigneeId: personId, escalated: false, remindersSent: 0, createdAt: Date.now() } });
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        emit({ ts: Date.now(), trace: uid("tr"), agent: "QG", campaignId: task.campaignId, activity: "review_reassigned", summary: `${task.title} reassigned to ${person?.name ?? personId} by ${viewer.name}`, actor: { type: "human", personId: state.viewAsId }, system: false, cost: 0 });
        notify(personId, `${task.title} was reassigned to you`, task.campaignId);
      }
      showToast(`Reassigned to ${person?.name ?? "reviewer"}, turnaround clock restarted`);
    },

    nudgeTask: (taskId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { remindersSent: Math.min(2, task.remindersSent + 1) as 0 | 1 | 2 } });
      emit({ ts: Date.now(), trace: uid("tr"), agent: "QG", campaignId: task.campaignId, activity: "sla_reminder", summary: `Manual reminder sent for ${task.title}`, actor: { type: "human", personId: state.viewAsId }, system: false, cost: 0 });
      notify(task.assigneeId, `Reminder: ${task.title} is waiting on you`, task.campaignId);
      showToast("Reminder sent to the reviewer");
    },

    addUser: (name, email, role) => {
      dispatch({ type: "PERSON_ADD", person: { id: uid("p"), name, initials: initialsOf(name), role, email, status: "Invited", lastActive: "Invite sent" } });
      showToast(`Invite sent to ${name}`);
    },

    updateUser: (id, patch) => {
      const person = state.people.find((p) => p.id === id);
      if (!person) return;
      const next: Partial<Person> = { ...patch };
      if (patch.name) next.initials = initialsOf(patch.name);
      dispatch({ type: "PERSON_PATCH", id, patch: next });
      showToast(`${patch.name ?? person.name}'s details updated`);
    },

    removeUser: (id) => {
      const person = state.people.find((p) => p.id === id);
      dispatch({ type: "PERSON_REMOVE", id });
      showToast(`${person?.name ?? "User"} removed from the workspace`);
    },
  };

  /* Reconciliation: a live campaign left in "planning" with no open plan_confirm
     task means the studio lost the in-flight continuation (page reload during the
     1–3 min planning pass). The agent finished on the bridge regardless — poll it
     and heal: sync the mirror and surface the confirmation task. */
  const reconciled = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = state.campaigns.filter(
      (c) => c.liveCampaignId && c.state === "planning"
        && !reconciled.current.has(c.id)
        && !state.tasks.some((t) => t.campaignId === c.id && t.kind === "plan_confirm" && t.status === "open"),
    );
    if (pending.length === 0) return;
    let cancelled = false;
    let busy = false;
    async function check() {
      if (busy || cancelled) return;
      busy = true;
      try {
        for (const c of pending) {
          if (reconciled.current.has(c.id)) continue;
          try {
            const detail = await liveApi.boxDetail(c.liveCampaignId as string);
            if (cancelled) return;
            const records = await liveApi.boxTelemetry();
            if (cancelled) return;
            actions.syncLiveBox(buildBoxSync(detail, records));
            if (detail.summary.status === "awaiting_confirmation") {
              reconciled.current.add(c.id);
              addTask({
                kind: "plan_confirm", campaignId: c.id,
                title: "Confirm audience & offer pack + plan",
                detail: `${c.name} · proposed by the LIVE Campaign-in-a-Box agent`,
                assigneeId: c.ownerId, slaHours: 48, liveCaseId: c.liveCampaignId,
              });
              notify(c.ownerId, `${c.name}: the real audience & offer pack and plan are ready for your confirmation`, c.id);
            } else if (detail.summary.status !== "planning") {
              reconciled.current.add(c.id); // already past the gate — mirror synced
            }
          } catch (e) {
            if (e instanceof LiveApiError && e.status === 404) {
              // The bridge no longer knows this campaign — its state was reset
              // (restart / new session / free-tier redeploy). Stop polling for
              // good and tell the owner once; the local journey stays intact.
              reconciled.current.add(c.id);
              emit({
                ts: Date.now(), trace: uid("tr"), agent: "studio", campaignId: c.id,
                activity: "live_link_lost", outcome: "blocked", system: true,
                summary: "Live campaign state no longer exists on the agent bridge (it restarted). Create a new campaign to run the live flow again.",
              });
              notify(c.ownerId, `${c.name}: the agent bridge restarted and this campaign's live state is gone — create a new campaign to re-run the flow`, c.id);
            }
            /* otherwise: plan still running or bridge down — try again next tick */
          }
        }
      } finally { busy = false; }
    }
    void check();
    const timer = window.setInterval(() => void check(), 12000);
    return () => { cancelled = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the pending set
  }, [state.campaigns, state.tasks]);

  const store = useMemo<Store>(() => ({
    state, now, viewer, authed, login, logout, toast, showToast, traceId, openTrace: setTraceId, actions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, now, toast, traceId, authedId]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/* ---------- Selectors ---------- */

export function personById(state: AppState, id: string): Person | undefined {
  return state.people.find((p) => p.id === id);
}

export function campaignById(state: AppState, id: string): Campaign | undefined {
  return state.campaigns.find((c) => c.id === id);
}

export function openTasksFor(state: AppState, personId: string): Task[] {
  return state.tasks.filter((t) => t.status === "open" && t.assigneeId === personId).sort((a, b) => a.createdAt - b.createdAt);
}

export function campaignCost(state: AppState, campaignId: string): number {
  return state.events.filter((e) => e.campaignId === campaignId).reduce((sum, e) => sum + e.cost_usd, 0);
}

export function slaInfo(task: Task, now: number): { pct: number; remaining: string; level: "on_pace" | "at_risk" | "escalated" } {
  const total = task.slaHours * 3600000;
  const elapsed = now - task.createdAt;
  const pct = Math.min(1.2, elapsed / total);
  const remainMs = Math.max(0, task.createdAt + total - now);
  const hours = Math.floor(remainMs / 3600000);
  const remaining = remainMs === 0 ? "overdue" : hours >= 1 ? `due in ${hours}h` : `due in ${Math.max(1, Math.round(remainMs / 60000))} min`;
  const level = task.escalated ? "escalated" : pct >= 0.9 ? "at_risk" : "on_pace";
  return { pct, remaining, level };
}

export type Kpis = {
  systemActivities: number; totalActivities: number; agentExecutedPct: number;
  avgCost: number; costCampaigns: number;
  firstPassPct: number; gatePasses: number; gateTotal: number;
  overridePct: number; humanDecisions: number; overrides: number;
  cycleHoursSaved: number;
};

export function computeKpis(state: AppState): Kpis {
  const activities = state.events.filter((e) => e.activity !== "sla_reminder" && e.activity !== "sla_escalation");
  const systemActivities = activities.filter((e) => e.systemExecuted).length;
  const totalActivities = activities.length;
  const costs = state.campaigns
    .filter((c) => c.step >= 4)
    .map((c) => campaignCost(state, c.id))
    .filter((v) => v > 0);
  const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
  const gateEvents = state.events.filter((e) => e.agent === "QG" && e.activity === "compliance_pass");
  const gatePasses = gateEvents.filter((e) => e.outcome !== "blocked").length; // advisory findings do not count against precision
  const decisions = state.tasks.filter((t) => t.status === "done" && t.resolution);
  const overrides = decisions.filter((t) => t.resolution && /operational|Returned/i.test(t.resolution.decision)).length;
  return {
    systemActivities, totalActivities,
    agentExecutedPct: totalActivities ? Math.round((systemActivities / totalActivities) * 100) : 0,
    avgCost, costCampaigns: costs.length,
    firstPassPct: gateEvents.length ? Math.round((gatePasses / gateEvents.length) * 100) : 0,
    gatePasses, gateTotal: gateEvents.length,
    overridePct: decisions.length ? Math.round((overrides / decisions.length) * 100) : 0,
    humanDecisions: decisions.length, overrides,
    cycleHoursSaved: Math.round(systemActivities * 0.55 * 10) / 10, // 33 min saved per system-executed activity (pilot baseline)
  };
}

export function costByAgent(state: AppState): { agent: string; cost: number }[] {
  const byAgent = new Map<string, number>();
  state.events.forEach((e) => {
    if (e.cost_usd > 0) byAgent.set(e.agent, (byAgent.get(e.agent) ?? 0) + e.cost_usd);
  });
  return [...byAgent.entries()].map(([agent, cost]) => ({ agent, cost })).sort((a, b) => b.cost - a.cost);
}
