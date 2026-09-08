/* New campaign request — wired to the REAL Campaign Identification agent via the
   dev bridge. Describe → the agent extracts what you actually said (quoted
   provenance) and flags what it will never infer → you fill gaps / iterate with
   directives (real revision rounds) → send routes it to the BU Campaign Lead.
   The demo simulation is gone from this screen: no bridge, no intake. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight, ArrowsClockwise, FileText, PaperPlaneTilt, Plugs, Trash, WarningCircle,
} from "@phosphor-icons/react";
import { useStore } from "../store";
import { useNav } from "../nav";
import { Chip, MicButton, MiniSource, Modal, Monogram, MultiSelect } from "../ui";
import { DocPreviewModal, PreviewLink, type PreviewTarget } from "../DocPreview";
import { InlineDots } from "../loaders";
import {
  CHANNEL_SLUG, LIVE_API, SEGMENT_LABEL, SEGMENT_SLUG, VERTICAL_LABEL, VERTICAL_SLUG,
  authHeaders, channelChecked, liveApi, stsMeta, stsSummary,
  type LiveCaseDetail, type StsRecord,
} from "../live";

const STORAGE_KEY = "shiftai.live.intake";
const PENDING_KEY = "shiftai.live.intake.pending"; // set before the POST so a reload
// mid-draft can re-find the case the agent created (runs take 15–90s)
const DRAFT_KEY = "shiftai.live.intake.draft"; // form edits + description survive
// reloads and directive rounds — the user never re-types what they already gave
const channelOptions = Object.keys(CHANNEL_SLUG);
const BRIEF_ASPECTS = ["Executive angle", "Practical angle", "Tighter objective", "Stronger offer"];
const EXAMPLES = [
  "Build cloud migration intent with financial services CFOs on LinkedIn and email nurture, anchored on our BC delivery experience",
  "Launch an AI readiness webinar campaign for manufacturing operations leaders, with sales enablement and a landing page",
];

type Phase = "checking" | "offline" | "describe" | "drafting" | "review" | "sent" | "escalated";

type FormState = {
  objective: string; topic: string; bu: string; vertical: string[]; segment: string[];
  budget: string; start: string; end: string; channels: string[];
};

const EMPTY_FORM: FormState = {
  objective: "", topic: "", bu: "", vertical: [], segment: [], budget: "",
  start: "", end: "", channels: [],
};

/* Multi-value agent fields arrive as a comma-joined slug string. */
function labelsFromSlugs(raw: string | null | undefined, labels: Record<string, string>): string[] {
  if (!raw) return [];
  return raw.split(",").map((t) => t.trim()).filter(Boolean).map((s) => labels[s] ?? s);
}

function formFromDetail(detail: LiveCaseDetail): FormState {
  const request = detail.summary.request;
  if (!request) return EMPTY_FORM;
  return {
    objective: request.objective ?? "",
    topic: request.offer_topic ?? "",
    bu: request.business_unit ?? "",
    vertical: labelsFromSlugs(request.vertical, VERTICAL_LABEL),
    segment: labelsFromSlugs(request.target_segment, SEGMENT_LABEL),
    budget: request.budget_flag === null ? "" : request.budget_flag ? "Yes" : "No",
    start: request.timeline_start ?? "",
    end: request.timeline_end ?? "",
    channels: channelOptions.filter((label) => channelChecked(request.channels ?? [], label)),
  };
}

/* Agent-derived values win where they exist; the user's saved edits fill what the
   agent left empty — a directive round or reload never erases typed input. */
function mergeForm(fromDetail: FormState, saved: FormState | null): FormState {
  if (!saved) return fromDetail;
  return {
    objective: fromDetail.objective || saved.objective,
    topic: fromDetail.topic || saved.topic,
    bu: fromDetail.bu || saved.bu,
    vertical: fromDetail.vertical.length > 0 ? fromDetail.vertical : saved.vertical,
    segment: fromDetail.segment.length > 0 ? fromDetail.segment : saved.segment,
    budget: fromDetail.budget || saved.budget,
    start: fromDetail.start || saved.start,
    end: fromDetail.end || saved.end,
    channels: fromDetail.channels.length > 0 ? fromDetail.channels : saved.channels,
  };
}

function readDraft(): { form: FormState; description: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { form?: Partial<FormState>; description?: string };
    return {
      form: { ...EMPTY_FORM, ...(parsed.form ?? {}) },
      description: parsed.description ?? "",
    };
  } catch { return null; }
}

function answersFromForm(form: FormState): Record<string, string> {
  const answers: Record<string, string> = {};
  if (form.objective.trim()) answers.objective = form.objective.trim();
  if (form.topic.trim()) answers.offer_topic = form.topic.trim();
  if (form.bu.trim()) answers.business_unit = form.bu.trim();
  if (form.vertical.length > 0)
    answers.vertical = form.vertical.map((v) => VERTICAL_SLUG[v] ?? v).join(", ");
  if (form.segment.length > 0)
    answers.target_segment = form.segment.map((s) => SEGMENT_SLUG[s] ?? s).join(", ");
  if (form.budget) answers.budget_flag = form.budget === "Yes" ? "yes" : "no";
  if (form.start) answers.timeline_start = form.start;
  if (form.end) answers.timeline_end = form.end;
  if (form.channels.length > 0)
    answers.channels = form.channels.map((label) => CHANNEL_SLUG[label] ?? label).join(",");
  return answers;
}

/* Everything the directive round may have changed, for the deltas modal. */
type FieldDelta = { label: string; before: string; after: string };

function requestDeltas(
  before: LiveCaseDetail["summary"]["request"] | null | undefined,
  after: LiveCaseDetail["summary"]["request"] | null | undefined,
): FieldDelta[] {
  const fields: [string, string][] = [
    ["objective", "Objective"], ["offer_topic", "Offer / topic"],
    ["business_unit", "Business unit"], ["vertical", "Vertical"],
    ["target_segment", "Target segment"], ["timeline_start", "Window start"],
    ["timeline_end", "Window end"],
  ];
  const read = (r: typeof before, key: string): string => {
    const v = (r as Record<string, unknown> | null | undefined)?.[key];
    return Array.isArray(v) ? v.join(", ") : String(v ?? "").trim();
  };
  const deltas: FieldDelta[] = [];
  for (const [key, label] of fields) {
    const b = read(before, key);
    const a = read(after, key);
    if (a !== b) deltas.push({ label, before: b || "(empty)", after: a || "(empty)" });
  }
  const bCh = read(before, "channels");
  const aCh = read(after, "channels");
  if (aCh !== bCh) deltas.push({ label: "Channels", before: bCh || "(empty)", after: aCh || "(empty)" });
  return deltas;
}

export default function IntakeScreen() {
  const { viewer, actions } = useStore();
  const { go } = useNav();
  const [phase, setPhase] = useState<Phase>("checking");
  const [caseId, setCaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LiveCaseDetail | null>(null);
  const [events, setEvents] = useState<StsRecord[]>([]);
  const [description, setDescription] = useState(() => readDraft()?.description ?? "");
  const [form, setForm] = useState<FormState>(() => readDraft()?.form ?? EMPTY_FORM);
  const [aspects, setAspects] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Result of the latest directive round: which draft fields the agent actually
  // rewrote (so the change is visible in place, not implied).
  const [lastDirective, setLastDirective] = useState<{
    changed: { field: "objective" | "topic"; label: string; before: string }[];
  } | null>(null);
  // Full before/after field diff of the latest directive round, shown in a modal
  // the moment the round completes.
  const [directiveDeltas, setDirectiveDeltas] = useState<FieldDelta[] | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const mounted = useRef(true);

  // The draft survives reloads and directive rounds: every edit is saved locally
  // and merged back over whatever the agent returns (agent values win only where
  // the user typed nothing).
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, description }));
    } catch { /* storage unavailable */ }
  }, [form, description]);

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ }
  }

  useEffect(() => {
    mounted.current = true; // StrictMode re-runs effects after a simulated unmount;
    return () => { mounted.current = false; }; // the ref must be re-armed on re-mount
  }, []);

  const refreshEvents = useCallback(async (traceId: string | null | undefined) => {
    if (!traceId) return;
    try {
      const rows = await liveApi.telemetry(traceId);
      if (mounted.current) setEvents(rows);
    } catch { /* feed is cosmetic; the case detail is the source of truth */ }
  }, []);

  const loadCase = useCallback(async (id: string): Promise<Phase> => {
    const d = await liveApi.getCase(id);
    if (!mounted.current) return "describe";
    setDetail(d);
    setForm(mergeForm(formFromDetail(d), readDraft()?.form ?? null));
    void refreshEvents(d.summary.trace_id);
    switch (d.summary.status) {
      case "awaiting_input":
      case "draft_review": return "review";
      case "awaiting_approval": return "sent";
      case "escalated": return "escalated";
      default: return "describe"; // approved/rejected/failed → this draft is finished
    }
  }, [refreshEvents]);

  /* connect: bridge health, then resume any in-flight intake case. A pending-submit
     marker survives reloads/remounts while the agent is still drafting: we poll the
     case list until the run this browser started shows up, then adopt it. */
  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;
    const read = (key: string): string | null => {
      try { return localStorage.getItem(key); } catch { return null; }
    };
    const clear = (key: string) => {
      try { localStorage.removeItem(key); } catch { /* fine */ }
    };

    async function adoptNewestOpenCase(): Promise<boolean> {
      const cases = await fetch(`${LIVE_API}/api/cases`, { headers: authHeaders() }).then((r) => r.json()) as
        { case_id: string; status: string; request?: { requester?: string | null } | null }[];
      const mine = cases.find(
        (c) => (c.status === "awaiting_input" || c.status === "draft_review")
          && c.request?.requester === viewer.email,
      );
      if (!mine) return false;
      const next = await loadCase(mine.case_id);
      if (cancelled) return true;
      setCaseId(mine.case_id);
      try { localStorage.setItem(STORAGE_KEY, mine.case_id); } catch { /* fine */ }
      clear(PENDING_KEY);
      setPhase(next);
      return true;
    }

    (async () => {
      try {
        await liveApi.health();
      } catch {
        if (!cancelled) setPhase("offline");
        return;
      }
      const stored = read(STORAGE_KEY);
      if (stored) {
        try {
          const next = await loadCase(stored);
          if (cancelled) return;
          if (next === "describe") clear(STORAGE_KEY);
          else setCaseId(stored);
          setPhase(next);
          return;
        } catch {
          clear(STORAGE_KEY);
        }
      }
      if (read(PENDING_KEY)) {
        // a draft was submitted from this browser and is (or was) in flight
        if (!cancelled && !(await adoptNewestOpenCase())) {
          setPhase("drafting");
          poll = window.setInterval(() => {
            void adoptNewestOpenCase().then((found) => {
              if (found && poll !== undefined) window.clearInterval(poll);
            });
          }, 3000);
          window.setTimeout(() => {
            if (poll !== undefined) window.clearInterval(poll);
            clear(PENDING_KEY);
            if (!cancelled) setPhase((p) => (p === "drafting" ? "describe" : p));
          }, 150_000);
        }
        return;
      }
      if (!cancelled) setPhase("describe");
    })();
    return () => {
      cancelled = true;
      if (poll !== undefined) window.clearInterval(poll);
    };
  }, [loadCase, viewer.email]);

  function rememberCase(id: string | null) {
    setCaseId(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage unavailable */ }
  }

  async function generate() {
    if (description.trim().length < 20) {
      setError("Describe the campaign in a sentence or two, so the agent has something real to draft from.");
      return;
    }
    setError("");
    setPhase("drafting");
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ts: Date.now() })); } catch { /* fine */ }
    try {
      const outcome = await liveApi.submitDescription(description.trim(), viewer.email);
      try { localStorage.removeItem(PENDING_KEY); } catch { /* fine */ }
      rememberCase(outcome.case_id);
      const next = await loadCase(outcome.case_id);
      setPhase(next === "describe" ? "escalated" : next);
    } catch (e) {
      try { localStorage.removeItem(PENDING_KEY); } catch { /* fine */ }
      setError(e instanceof Error ? e.message : String(e));
      setPhase("describe");
    }
  }

  async function sendDirective() {
    if (!caseId) return;
    if (aspects.length === 0 && !note.trim()) {
      setError("Pick an aspect or dictate a note, so the agent knows what to change.");
      return;
    }
    setError(""); setBusy(true);
    const beforeRequest = detail?.summary.request ?? null;
    const beforeObjective = beforeRequest?.objective ?? "";
    const beforeTopic = beforeRequest?.offer_topic ?? "";
    try {
      await liveApi.revise(caseId, note.trim(), aspects, viewer.email);
      const d = await liveApi.getCase(caseId);
      if (mounted.current) {
        setDetail(d);
        setForm(mergeForm(formFromDetail(d), readDraft()?.form ?? null));
        void refreshEvents(d.summary.trace_id);
        const changed: { field: "objective" | "topic"; label: string; before: string }[] = [];
        if ((d.summary.request?.objective ?? "") !== beforeObjective)
          changed.push({ field: "objective", label: "Objective", before: beforeObjective });
        if ((d.summary.request?.offer_topic ?? "") !== beforeTopic)
          changed.push({ field: "topic", label: "Offer / topic", before: beforeTopic });
        setLastDirective({ changed });
        // The full field-by-field diff opens in a modal so the change is
        // unambiguous, not implied.
        setDirectiveDeltas(requestDeltas(beforeRequest, d.summary.request));
      }
      setAspects([]); setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const revisedField = (field: "objective" | "topic") =>
    lastDirective?.changed.some((c) => c.field === field) ?? false;

  const trunc = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  const gapFields = new Set(detail?.gap_request?.questions.map((q) => q.field) ?? []);
  const derived = detail?.summary.derived_fields ?? {};
  const missing: string[] = [];
  if (phase === "review") {
    if (form.vertical.length === 0) missing.push("Vertical");
    if (form.segment.length === 0) missing.push("Target segment");
    if (!form.start) missing.push("Window start");
    if (!form.end) missing.push("Window end");
    if (!form.budget) missing.push("Budget status");
    if (form.channels.length === 0) missing.push("At least one channel");
    if (!form.objective.trim()) missing.push("Objective");
    if (!form.topic.trim()) missing.push("Offer or topic");
    if (!form.bu.trim()) missing.push("Business unit");
  }

  async function send() {
    if (!caseId || missing.length > 0) return;
    setError(""); setBusy(true);
    try {
      const outcome = await liveApi.submitAnswers(caseId, answersFromForm(form), viewer.email, true);
      await refreshEvents(outcome.trace_id);
      if (outcome.status === "awaiting_approval" && outcome.brief) {
        actions.mirrorLiveBrief({
          caseId,
          name: form.topic || "New campaign",
          objective: form.objective,
          topic: form.topic,
          bu: form.bu,
          vertical: form.vertical.join(", "),
          segment: form.segment.join(", "),
          channels: form.channels,
          window: { start: form.start, end: form.end },
          budgetApproved: form.budget === "Yes",
          request: description || (detail?.summary.request?.free_text_context ?? ""),
          briefVersion: `v${outcome.brief.version}`,
        });
        clearDraft();
        await loadCase(caseId);
        setPhase("sent");
      } else if (outcome.status === "escalated") {
        await loadCase(caseId);
        setPhase("escalated");
      } else {
        await loadCase(caseId); // more gaps surfaced — stay in review with fresh questions
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  function startOver() {
    rememberCase(null);
    clearDraft();
    setDetail(null); setEvents([]); setForm(EMPTY_FORM); setDescription("");
    setAspects([]); setNote(""); setError(""); setLastDirective(null);
    setDirectiveDeltas(null);
    setPhase("describe");
  }

  /* Back to the original brief text: the current draft stays archived with the
     agent; the description is preserved for rewriting and re-submission. */
  function rewriteBrief() {
    const original = detail?.summary.request?.free_text_context ?? description;
    rememberCase(null);
    setDetail(null); setEvents([]); setForm(EMPTY_FORM);
    setAspects([]); setNote(""); setError(""); setLastDirective(null);
    setDirectiveDeltas(null);
    setDescription(original);
    setPhase("describe");
  }

  function fieldChip(field: string, label?: string) {
    if (derived[field]) return <Chip tone="blue">Agent-derived</Chip>;
    if (gapFields.has(field)) return <Chip tone="amber">{label ?? "You provide"}</Chip>;
    return null;
  }

  const feed = (
    <div className="activity-feed embedded live-intake-feed">
      {events.map((r) => (
        <div className="live-log-row" key={String(r["bridge.seq"])}>
          <small>{String(r["shiftai.timestamp"]).slice(11, 19)}</small>
          <span>{stsSummary(r)}</span>
          <small className="live-log-case">{stsMeta(r)}</small>
        </div>
      ))}
    </div>
  );

  /* ---- offline / checking ---- */
  if (phase === "checking") {
    return <div className="screen-content intake-screen"><p className="pending-line">Connecting to the Campaign Identification agent<InlineDots /></p></div>;
  }
  if (phase === "offline") {
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header"><div><h1>New campaign request</h1><p>This flow runs on the real Campaign Identification agent — no simulation.</p></div></section>
        <div className="live-offline">
          <Plugs size={28} />
          <strong>Agent bridge offline at {LIVE_API}</strong>
          <p>Start it, then reload this page:</p>
          <pre>{`cd Agents\n.venv\\Scripts\\python -m uvicorn c2c_bridge.app:app --port 8787`}</pre>
        </div>
      </div>
    );
  }

  /* ---- escalated (duplicate / BC-F&O / compliance) ---- */
  if (phase === "escalated" && detail) {
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header"><div><h1>The agent flagged this request</h1><p>It proposes and flags — a human decides. Nothing was routed.</p></div></section>
        <section className="intake-result">
          <div className="live-gaps">
            <p className="meta-label">Escalated · {detail.summary.escalation_reason_code}</p>
            <p className="live-note"><WarningCircle size={14} /> Routed to a human queue for a decision. Adjust the request (topic, dates, scope) and start again, or resolve it from the Live agents screen.</p>
          </div>
          {feed}
          <div className="intake-result-actions">
            <button className="primary-button" onClick={startOver}>Start a new request</button>
            <button className="secondary-button" onClick={() => go("live")}>Open Live agents</button>
          </div>
        </section>
      </div>
    );
  }

  /* ---- sent ---- */
  if (phase === "sent" && detail) {
    const lead = detail.approval_task?.routed_to ?? "bu-campaign-lead-queue";
    const docUrl = liveApi.docUrl(detail.summary.doc_ref);
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header"><div><h1>Brief sent for approval</h1><p>Drafted and routed by the real agent; verified by you. Live STS telemetry below.</p></div></section>
        <section className="intake-result">
          {feed}
          <div className="intake-routed">
            <Monogram>CI</Monogram>
            <div>
              <strong>Brief routed for approval</strong>
              <p>The approval task is with the BU Campaign Lead ({lead}), due in 2 business days. Switch personas via the profile menu and approve it on the Approvals page — the decision is recorded by the real agent.</p>
              <div className="source-row">
                <MiniSource>Brief v{detail.summary.brief_version ?? 1}</MiniSource>
                <MiniSource>Verified by {viewer.name.split(" ")[0]}</MiniSource>
                <PreviewLink url={docUrl} title={`Campaign brief v${detail.summary.brief_version ?? 1}`} onOpen={setPreview} />
                {docUrl && <a className="text-link" href={docUrl} target="_blank" rel="noreferrer">Download .docx</a>}
              </div>
            </div>
          </div>
          {preview && <DocPreviewModal target={preview} onClose={() => setPreview(null)} />}
          <div className="intake-result-actions">
            <button className="primary-button" onClick={() => caseId && go({ page: "campaigns", campaignId: caseId })}>View campaign</button>
            <button className="secondary-button" onClick={startOver}>New request</button>
          </div>
        </section>
      </div>
    );
  }

  /* ---- drafting ---- */
  if (phase === "drafting") {
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header"><div><h1>Drafting your brief</h1><p>The real Campaign Identification agent is working — extraction, duplicate check, classification. Nothing is routed.</p></div></section>
        <section className="intake-result">
          {feed}
          <p className="pending-line">Campaign Identification drafting — extraction, duplicate check, gap analysis (15–90s depending on the model)<InlineDots /></p>
        </section>
      </div>
    );
  }

  /* ---- review ---- */
  if (phase === "review" && detail) {
    const returnedNote = detail.summary.returned_note;
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header">
          <div><h1>Review the drafted brief</h1><p>Drafted by the live agent from your request. Fields it derived carry your own words as provenance; amber fields are still needed. Iterate, fill, then send.</p></div>
          <div className="intake-header-actions">
            <Chip tone="blue">Case {caseId?.slice(0, 12)} · {detail.summary.status === "draft_review" ? `brief v${detail.summary.brief_version ?? 1} in draft` : "gaps open"}</Chip>
            <button type="button" className="secondary-button" onClick={rewriteBrief} disabled={busy}>
              <ArrowsClockwise size={13} /> Rewrite the brief
            </button>
            <button type="button" className="secondary-button" onClick={startOver} disabled={busy}>
              <FileText size={13} /> New campaign
            </button>
          </div>
        </section>
        {returnedNote && (
          <div className="change-strip revision"><ArrowsClockwise size={14} /><p>Returned by the BU Campaign Lead: "{returnedNote}" — revise and send again.</p></div>
        )}
        {lastDirective && (lastDirective.changed.length > 0 ? (
          <div className="change-strip applied">
            <ArrowsClockwise size={14} />
            <p>
              Directive applied — the agent rewrote{" "}
              {lastDirective.changed.map((c) => `${c.label} (was: "${trunc(c.before)}")`).join(" · ")}.
              The new wording is highlighted in the draft below.
            </p>
          </div>
        ) : (
          <div className="change-strip">
            <ArrowsClockwise size={14} />
            <p>The agent reviewed your directive but kept the draft unchanged — try a more specific instruction (e.g. "rewrite the objective around qualified pipeline for mid-market plants").</p>
          </div>
        ))}
        <div className="brief-review-layout">
          <section className="brief-doc">
            <p className="doc-kicker">{form.bu || "Business unit not set"} · {form.vertical.length > 0 ? form.vertical.join(", ") : "Vertical not set"}</p>
            <div className="form-grid brief-fields">
              <div className={`field field-full${revisedField("objective") ? " field-revised" : ""}`}>
                <div className="field-label-row">
                  <label htmlFor="br-objective">Objective</label>
                  {revisedField("objective") ? <Chip tone="green">Updated by directive</Chip> : fieldChip("objective")}
                </div>
                <input id="br-objective" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />
                {derived.objective && <small className="field-provenance">"{derived.objective}"</small>}
              </div>
              <div className={`field field-full${revisedField("topic") ? " field-revised" : ""}`}>
                <div className="field-label-row">
                  <label htmlFor="br-topic">Offer or topic</label>
                  {revisedField("topic") ? <Chip tone="green">Updated by directive</Chip> : fieldChip("offer_topic")}
                </div>
                <input id="br-topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
              </div>
              <div className="field">
                <div className="field-label-row"><label htmlFor="br-bu">Business unit</label>{fieldChip("business_unit")}</div>
                <input id="br-bu" value={form.bu} list="bu-options" onChange={(e) => setForm({ ...form, bu: e.target.value })} />
                <datalist id="bu-options"><option>Business Central</option><option>Finance &amp; Operations</option><option>Technology</option></datalist>
              </div>
              <div className={`field${form.vertical.length > 0 ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-vertical">Vertical(s)</label>{fieldChip("vertical")}</div>
                <MultiSelect
                  id="br-vertical" options={Object.values(VERTICAL_LABEL)} value={form.vertical}
                  onChange={(vertical) => setForm({ ...form, vertical })}
                  placeholder="Select one or more industries…"
                />
              </div>
              <div className={`field${form.segment.length > 0 ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-segment">Target segment(s)</label>{form.segment.length === 0 && fieldChip("target_segment", "You provide")}</div>
                <MultiSelect
                  id="br-segment" options={Object.values(SEGMENT_LABEL)} value={form.segment}
                  onChange={(segment) => setForm({ ...form, segment })}
                  placeholder="Select one or more segments…"
                />
              </div>
              <div className={`field${form.budget ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-budget">Budget approved</label>{!form.budget && <Chip tone="amber">You provide</Chip>}</div>
                <select id="br-budget" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}><option value="">Select…</option><option>Yes</option><option>No</option></select>
              </div>
              <div className={`field${form.start ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-start">Window start</label>{!form.start && <Chip tone="amber">You provide</Chip>}</div>
                <input id="br-start" type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </div>
              <div className={`field${form.end ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-end">Window end</label>{!form.end && <Chip tone="amber">You provide</Chip>}</div>
                <input id="br-end" type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </div>
              <fieldset className="field field-full channel-set">
                <div className="field-label-row"><legend>Channels</legend>{fieldChip("channels")}</div>
                <div className="channel-grid">
                  {channelOptions.map((channel) => (
                    <label key={channel} className="checkbox">
                      <input type="checkbox" checked={form.channels.includes(channel)}
                        onChange={() => setForm({
                          ...form,
                          channels: form.channels.includes(channel)
                            ? form.channels.filter((c) => c !== channel)
                            : [...form.channels, channel],
                        })} />
                      {channel}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            {feed}
          </section>

          <aside className="brief-rail">
            <form className="directive-composer" onSubmit={(e) => { e.preventDefault(); void sendDirective(); }}>
              <div className="directive-head">
                <Monogram size="sm">CI</Monogram>
                <div>
                  <strong>Directive to Campaign Identification</strong>
                  <small>The real agent redrafts the two lines below; every round is recorded with your identity</small>
                </div>
              </div>
              <div className="directive-current">
                <small>Current draft — what the agent will redraft</small>
                <p><strong>Objective:</strong> {detail.summary.request?.objective?.trim() || "— (nothing extracted yet)"}</p>
                <p><strong>Offer / topic:</strong> {detail.summary.request?.offer_topic?.trim() || "— (nothing extracted yet)"}</p>
              </div>
              <div>
                <p className="meta-label">What should change?</p>
                <div className="aspect-row">
                  {BRIEF_ASPECTS.map((a) => (
                    <button type="button" key={a} className={`aspect-pill${aspects.includes(a) ? " active" : ""}`} aria-pressed={aspects.includes(a)} onClick={() => { setAspects((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]); setError(""); }}>{a}</button>
                  ))}
                </div>
              </div>
              <div className="field"><label htmlFor="br-note">Instruction (type or dictate)</label><div className="input-with-mic"><input id="br-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. lead with the executive outcome" /><MicButton onText={(t) => setNote((prev) => prev ? `${prev} ${t}` : t)} /></div></div>
              <div className="directive-foot">
                <small>{busy ? "Agent revising…" : "The agent redrafts; you decide when it leaves this page."}</small>
                <button type="submit" className="primary-button" disabled={busy} aria-busy={busy}>{busy ? <><span className="btn-spinner" aria-hidden="true" /> Agent revising…</> : <><PaperPlaneTilt size={14} /> Send directive</>}</button>
              </div>
            </form>

            <section className="intake-side">
              <h2>Your request</h2>
              <p className="request-quote">"{detail.summary.request?.free_text_context ?? description}"</p>
              <p className="request-meta">Parsed by the live Campaign Identification agent · gap round {detail.summary.gap_rounds ?? 0}</p>
            </section>

            <section className="send-panel">
              <h2>Send for approval</h2>
              {missing.length > 0 ? (
                <p className="send-missing">Before this reaches the BU Campaign Lead: <strong>{missing.join(" · ")}</strong>. The agent never infers these.</p>
              ) : (
                <p className="send-ready">Everything is in place. Sending records your verification and routes the real approval task.</p>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button send-button" onClick={() => void send()} disabled={missing.length > 0 || busy} aria-busy={busy}>{busy ? <><span className="btn-spinner" aria-hidden="true" /> Sending — the agent re-validates…</> : <><ArrowRight size={15} /> Send for approval</>}</button>
              <button className="text-button" onClick={startOver} disabled={busy}><Trash size={13} /> Start over (draft stays archived with the agent)</button>
            </section>
          </aside>
        </div>
        {directiveDeltas && (
          <Modal title="What your directive changed" onClose={() => setDirectiveDeltas(null)}>
            {directiveDeltas.length === 0 ? (
              <p className="live-note">The agent reviewed your directive but changed nothing. Try a more specific instruction, for example: "rewrite the objective around qualified pipeline for mid-market plants".</p>
            ) : (
              <div className="delta-list">
                {directiveDeltas.map((d) => (
                  <div className="delta-row" key={d.label}>
                    <p className="meta-label">{d.label}</p>
                    <p className="delta-before">{d.before}</p>
                    <p className="delta-after">{d.after}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="primary-button" onClick={() => setDirectiveDeltas(null)}>Looks right</button>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  /* ---- describe ---- */
  return (
    <div className="screen-content intake-screen">
      <section className="simple-page-header"><div><h1>New campaign request</h1><p>Describe what you need; the real Campaign Identification agent drafts the brief. You verify and iterate before anything is routed.</p></div></section>
      <section className="intake-hero">
        <label htmlFor="in-describe">Describe the campaign (type or dictate)</label>
        <div className="textarea-with-mic">
          <textarea id="in-describe" rows={4} value={description} onChange={(e) => { setDescription(e.target.value); setError(""); }}
            placeholder="e.g. Build cloud migration intent with financial services CFOs on LinkedIn and email nurture, anchored on our BC delivery experience" />
          <MicButton onText={(t) => setDescription((prev) => prev ? `${prev} ${t}` : t)} />
        </div>
        <div className="example-row">
          <span>Try:</span>
          {EXAMPLES.map((ex) => <button key={ex.slice(0, 18)} type="button" onClick={() => { setDescription(ex); setError(""); }}>{ex.split(" ").slice(0, 5).join(" ")}…</button>)}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="intake-hero-foot">
          <div className="intake-hero-agent">
            <Monogram size="sm">CI</Monogram>
            <small>The live agent extracts everything your words support, dates in any format included, and labels inferred values with the text that implies them. Whatever the text cannot support stays with you as an explicit gap.</small>
          </div>
          <button className="primary-button" onClick={() => void generate()}><FileText size={15} /> Draft the brief</button>
        </div>
      </section>
    </div>
  );
}
