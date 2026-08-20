import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type {
  AppState, ApprovalRecord, Asset, Campaign, Notification, Person, Task, TelemetryEvent,
} from "./types";
import { SCHEMA_VERSION, buildDoc, buildSeed, bumpVersion, fakeHash, initialsOf, makeEvent, reviseDoc, seedAssetsFor } from "./data";

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

type Store = {
  state: AppState;
  now: number;
  viewer: Person;
  toast: string | null;
  showToast: (text: string) => void;
  traceId: string | null;
  openTrace: (traceId: string | null) => void;
  actions: {
    reset: () => void;
    setViewAs: (id: string) => void;
    markAllRead: () => void;
    submitRequest: (form: IntakeForm) => string;
    answerGaps: (taskId: string, segment: string, budget: string) => void;
    approveBrief: (taskId: string) => void;
    returnBrief: (taskId: string, note: string) => void;
    confirmPlan: (taskId: string) => void;
    decideConflict: (taskId: string, decision: "recommended" | "operational" | "returned", note?: string) => void;
    completeReview: (taskId: string) => void;
    requestChanges: (taskId: string, aspects: string[], note: string) => void;
    grammarApprove: (taskId: string) => void;
    signOffPackage: (taskId: string) => void;
    reassignTask: (taskId: string, personId: string) => void;
    nudgeTask: (taskId: string) => void;
    addUser: (name: string, email: string, role: Person["role"]) => void;
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

  const viewer = state.people.find((p) => p.id === state.viewAsId) ?? state.people[0];

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
        emit({ ts: Date.now(), trace, agent: "CI", campaignId: id, activity: "route_brief_approval", summary: "Brief approval routed to Marcus Webb, SLA 2 business days", cost: 0 });
        addTask({ kind: "brief_approval", campaignId: id, title: "Approve campaign brief", detail: `${form.topic} · brief v1.0 validated`, assigneeId: "marcus", slaHours: 48 });
        notify("marcus", `${form.topic} brief is ready for your approval`, id);
      });
      return id;
    },

    answerGaps: (taskId, segment, budget) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const trace = uid("tr");
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: `Answered: segment ${segment}, budget ${budget}`, byId: state.viewAsId, at: Date.now() } } });
      dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { segment, budgetApproved: budget === "Yes", state: "brief_pending_approval" } });
      emit({ ts: Date.now(), trace, agent: "CI", campaignId: task.campaignId, activity: "revalidate_brief", summary: "Gap answers received, brief re-validated with 9 of 9 fields", actor: { type: "human", personId: state.viewAsId }, cost: 0.02, llm: 2100, system: false, state: { previous: "awaiting_input", current: "brief_pending_approval", reason: "Requester supplied the missing fields" } });
      later(900, () => {
        emit({ ts: Date.now(), trace, agent: "CI", campaignId: task.campaignId, activity: "route_brief_approval", summary: "Brief approval routed to Marcus Webb, SLA 2 business days", cost: 0 });
        addTask({ kind: "brief_approval", campaignId: task.campaignId, title: "Approve campaign brief", detail: "Copilot Cloud Essentials · re-validated brief v1.1", assigneeId: "marcus", slaHours: 48 });
        notify("marcus", "Copilot Cloud Essentials brief re-validated and ready for approval", task.campaignId);
      });
      showToast("Answers sent, brief re-validation queued");
    },

    approveBrief: (taskId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const trace = uid("tr");
      const campaign = state.campaigns.find((c) => c.id === task.campaignId);
      dispatch({ type: "TASK_PATCH", id: taskId, patch: { status: "done", resolution: { decision: "Brief approved", byId: state.viewAsId, at: Date.now() } } });
      record(task.campaignId, "Brief approved", state.viewAsId, "v1.0");
      dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { state: "planning", step: 2 } });
      emit({ ts: Date.now(), trace, agent: "studio", campaignId: task.campaignId, activity: "brief_approved", summary: `Brief approved by ${viewer.name}`, actor: { type: "human", personId: state.viewAsId }, system: false, state: { previous: "brief_pending_approval", current: "planning", reason: "BU Campaign Lead approval recorded with identity and timestamp" } });
      later(900, () => emit({ ts: Date.now(), trace, agent: "CB", campaignId: task.campaignId, activity: "pull_intel", summary: "SemRush and intel library scan complete", tokens: { input: 8200, output: 1900 }, cost: 0.17, llm: 15000, api: 4800, sources: ["SemRush", "OneDrive intel library"] }));
      later(1900, () => {
        emit({ ts: Date.now(), trace, agent: "CB", campaignId: task.campaignId, activity: "plan_campaign", summary: "Audience & offer pack, 9-asset checklist and workspace created", tokens: { input: 19600, output: 5300 }, cost: 0.55, llm: 37000, sources: ["Brief v1.0", "Workspace template v2.0"] });
        dispatch({ type: "CAMPAIGN_PATCH", id: task.campaignId, patch: { step: 3 } });
        addTask({ kind: "plan_confirm", campaignId: task.campaignId, title: "Confirm audience & offer", detail: `${campaign?.name ?? "Campaign"} · pack and plan proposed by Campaign-in-a-Box`, assigneeId: campaign?.ownerId ?? "rishi", slaHours: 48 });
        notify(campaign?.ownerId ?? "rishi", `${campaign?.name ?? "Campaign"}: audience & offer pack is ready for your confirmation`, task.campaignId);
      });
      showToast("Brief approved and recorded");
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
      showToast(`Reassigned to ${person?.name ?? "reviewer"}, SLA restarted`);
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

    removeUser: (id) => {
      const person = state.people.find((p) => p.id === id);
      dispatch({ type: "PERSON_REMOVE", id });
      showToast(`${person?.name ?? "User"} removed from the workspace`);
    },
  };

  const store = useMemo<Store>(() => ({
    state, now, viewer, toast, showToast, traceId, openTrace: setTraceId, actions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, now, toast, traceId]);

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
  const remaining = remainMs === 0 ? "overdue" : hours >= 1 ? `${hours}h remaining` : `${Math.max(1, Math.round(remainMs / 60000))} min remaining`;
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
