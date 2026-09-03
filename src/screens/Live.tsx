/* Live bridge console: drives the REAL Campaign Identification agent (Python)
   through the local dev bridge and streams its STS v2 telemetry over SSE.
   Self-contained — it never touches the demo simulation's store. */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowClockwise, ArrowSquareOut, Broadcast, CheckCircle, DownloadSimple, PaperPlaneTilt,
  Pause, Play, Plugs, Robot, WarningCircle, XCircle,
} from "@phosphor-icons/react";
import { Chip } from "../ui";
import { authHeaders, liveApi, tokenized } from "../live";

const API = (import.meta.env.VITE_LIVE_API as string | undefined) ?? "http://localhost:8787";

/* ---------- bridge payload types ---------- */

type Health = {
  status: string; agent_id: string; config_version: string;
  provider: string; model: string; environment: string; kill_switch: "clear" | "paused";
};

type StsRecord = Record<string, unknown> & { "bridge.seq"?: number };

type CaseSummary = {
  case_id: string; status: string; action_class: string | null; campaign_id: string | null;
  topic: string | null; business_unit: string | null; vertical: string | null;
  gap_rounds: number; escalation_reason_code: string | null; doc_ref: string | null;
  trace_id: string | null; updated_at: string | null;
};

type GapQuestion = { field: string; question: string };
type CaseDetail = {
  summary: CaseSummary;
  case: { brief?: { fields?: { name: string; value: string; provenance: string }[]; classification?: { campaign_type: string; priority: string; channel_mix: string[]; segment_relevance: string } | null; conflicts?: { kind: string; conflicting_campaign_id: string; rationale: string; freshness: string }[] } | null; escalation_detail?: Record<string, unknown> };
  gap_request: { round: number; questions: GapQuestion[] } | null;
  approval_task: { routed_to: string; created_at: string } | null;
};

const SAMPLE_COMPLETE = {
  requester: "priya.marketing@levelshift.com",
  objective: "Generate qualified pipeline for the ERP modernization offer in manufacturing accounts",
  business_unit: "Technology",
  vertical: "manufacturing",
  target_segment: "type_3",
  offer_topic: "ERP modernization assessment for mid-market manufacturers",
  channels: "events, email, linkedin",
  timeline_start: "2026-10-01",
  timeline_end: "2026-11-15",
  owner: "priya.marketing@levelshift.com",
  budget_flag: "yes",
  free_text_context: "Follow-up demand from the September manufacturing roundtable; BU plan row 14.",
};

const SAMPLE_INCOMPLETE = {
  requester: "arjun.sales@levelshift.com",
  offer_topic: "Something around AI for financial services",
  vertical: "financial services",
  free_text_context: "Need a campaign soon, details TBC",
};

const FORM_FIELDS: { key: keyof typeof SAMPLE_COMPLETE; label: string; kind?: "date" | "area" }[] = [
  { key: "requester", label: "Requester" },
  { key: "objective", label: "Objective" },
  { key: "business_unit", label: "Business unit" },
  { key: "vertical", label: "Vertical" },
  { key: "target_segment", label: "Target segment" },
  { key: "offer_topic", label: "Offer / topic" },
  { key: "channels", label: "Channels" },
  { key: "timeline_start", label: "Start", kind: "date" },
  { key: "timeline_end", label: "End", kind: "date" },
  { key: "owner", label: "Owner" },
  { key: "budget_flag", label: "Budget approved (yes/no)" },
  { key: "free_text_context", label: "Context", kind: "area" },
];

function statusTone(status: string): "neutral" | "green" | "amber" | "blue" | "red" {
  switch (status) {
    case "approved": return "green";
    case "awaiting_approval": return "blue";
    case "awaiting_input": return "amber";
    case "escalated": return "amber";
    case "rejected": case "failed": return "red";
    default: return "neutral";
  }
}

function eventSummary(r: StsRecord): string {
  const t = String(r["shiftai.event.type"]);
  const parts: string[] = [];
  if (t === "decision_made") {
    parts.push(`L${r["shiftai.decision.layer"]}`, String(r["shiftai.decision.action_class"] ?? "abstained"));
    if (typeof r["shiftai.decision.confidence"] === "number") parts.push(`conf ${(r["shiftai.decision.confidence"] as number).toFixed(2)}`);
    if (r["gen_ai.response.model"]) parts.push(String(r["gen_ai.response.model"]));
    if (r["gen_ai.usage.input_tokens"] != null) parts.push(`${r["gen_ai.usage.input_tokens"]}→${r["gen_ai.usage.output_tokens"]} tok`);
    if (r["shiftai.cost.amount"] != null) parts.push(`$${r["shiftai.cost.amount"]}`);
  } else if (t === "policy_check") {
    parts.push(String(r["shiftai.policy.decision"]));
    const ids = r["shiftai.policy.ids"];
    if (Array.isArray(ids) && ids.length) parts.push(ids.join(", "));
  } else if (t === "case_escalated") {
    parts.push(`tier ${r["shiftai.escalation.tier"]}`, String(r["shiftai.escalation.reason"]), `→ ${r["shiftai.escalation.routed_to"]}`);
  } else if (t === "action_taken") {
    parts.push(String(r["shiftai.action.class"]), String(r["shiftai.action.external_ref"] ?? ""));
  } else if (t === "human_gate") {
    parts.push(String(r["shiftai.hitl.decision"]), `by ${r["shiftai.hitl.actor.role"]}`);
  } else if (t === "case_resolved" || t === "run_summary") {
    parts.push(String(r["shiftai.outcome"]));
    if (r["shiftai.cost.amount"] != null) parts.push(`run $${r["shiftai.cost.amount"]}`);
  } else if (t === "tool_execution") {
    parts.push(String(r["gen_ai.tool.name"]), `${r["shiftai.span.duration_ms"]}ms`);
  } else if (t === "error") {
    parts.push(String(r["error.type"]));
  }
  return parts.filter(Boolean).join(" · ");
}

function eventTone(t: string): "neutral" | "green" | "amber" | "blue" | "red" {
  if (t === "action_taken" || t === "case_resolved") return "green";
  if (t === "case_escalated" || t === "human_gate") return "amber";
  if (t === "error") return "red";
  if (t === "decision_made") return "blue";
  return "neutral";
}

function escalationCitations(detail: Record<string, unknown> | undefined): string[] {
  if (!detail) return [];
  const lines: string[] = [];
  const ids = detail.conflicting_campaign_ids;
  if (Array.isArray(ids) && ids.length) lines.push(`Conflicts with open campaign(s): ${ids.join(", ")}`);
  const evidence = detail.evidence;
  if (Array.isArray(evidence) && evidence.length) lines.push(`BC/F&O evidence: ${evidence.join(", ")}`);
  const split = detail.split_proposal;
  if (Array.isArray(split) && split.length) lines.push(`Proposed split: ${split.join(" | ")}`);
  const terms = detail.matched_terms;
  if (Array.isArray(terms) && terms.length) lines.push(`Compliance-ceiling terms: ${terms.join(", ")}`);
  if (typeof detail.rationale === "string") lines.push(`Agent rationale: ${detail.rationale}`);
  if (typeof detail.control_pause_reason === "string") lines.push(`Control plane: ${detail.control_pause_reason}`);
  return lines;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/* ---------- screen ---------- */

export default function LiveScreen() {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [events, setEvents] = useState<StsRecord[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ ...SAMPLE_COMPLETE });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [actorId, setActorId] = useState("bu.lead@levelshift.com");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionNonce, setSessionNonce] = useState(0);
  const lastSeq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const refreshCases = useCallback(async () => {
    try { setCases(await jsonFetch<CaseSummary[]>("/api/cases")); } catch { /* bridge gone */ }
  }, []);

  const refreshDetail = useCallback(async (caseId: string) => {
    try { setDetail(await jsonFetch<CaseDetail>(`/api/cases/${caseId}`)); } catch { setDetail(null); }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await jsonFetch<Health>("/api/health"));
      setOffline(false);
    } catch { setOffline(true); }
  }, []);

  /* connect: health + SSE with polling fallback */
  useEffect(() => {
    void refreshHealth();
    void refreshCases();
    let poll: number | undefined;
    const source = new EventSource(tokenized(`${API}/api/stream`));
    const onRecord = (r: StsRecord) => {
      const seq = Number(r["bridge.seq"] ?? 0);
      if (seq <= lastSeq.current) return;
      lastSeq.current = seq;
      setEvents((prev) => [...prev.slice(-499), r]);
      const t = String(r["shiftai.event.type"]);
      if (t !== "config_loaded" && t !== "tool_execution") void refreshCases();
      if (t === "human_gate" || t === "case_resolved") void refreshHealth();
    };
    source.onmessage = (e) => onRecord(JSON.parse(e.data) as StsRecord);
    source.onerror = () => {
      if (poll === undefined) {
        poll = window.setInterval(async () => {
          await refreshHealth();
          try {
            const rows = await jsonFetch<StsRecord[]>(`/api/telemetry?after=${lastSeq.current}`);
            rows.forEach(onRecord);
          } catch { /* still offline */ }
        }, 3000);
      }
    };
    return () => { source.close(); if (poll !== undefined) window.clearInterval(poll); };
  }, [refreshCases, refreshHealth, sessionNonce]);

  useEffect(() => { if (selected) void refreshDetail(selected); }, [selected, events.length, refreshDetail]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [events.length]);

  const selectedTrace = useMemo(
    () => cases.find((c) => c.case_id === selected)?.trace_id ?? null,
    [cases, selected],
  );
  const shownEvents = useMemo(
    () => (selectedTrace ? events.filter((e) => e["shiftai.trace.id"] === selectedTrace) : events),
    [events, selectedTrace],
  );

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); setFlash(label); window.setTimeout(() => setFlash(null), 2600); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); await refreshCases(); if (selected) await refreshDetail(selected); }
  }

  function submitRequest(event: FormEvent) {
    event.preventDefault();
    const request: Record<string, string> = {};
    Object.entries(form).forEach(([k, v]) => { if (v.trim()) request[k] = v.trim(); });
    void run("Request sent to the live agent", async () => {
      const outcome = await jsonFetch<{ case_id: string }>("/api/requests", {
        method: "POST", body: JSON.stringify({ source: "form", request }),
      });
      setSelected(outcome.case_id);
      setAnswers({});
    });
  }

  function sendAnswers(caseId: string, questions: GapQuestion[]) {
    const payload: Record<string, string> = {};
    questions.forEach((q) => { const v = answers[q.field]?.trim(); if (v) payload[q.field] = v; });
    void run("Gap answers submitted — agent re-running", () =>
      jsonFetch(`/api/cases/${caseId}/answers`, {
        method: "POST",
        body: JSON.stringify({ answers: payload, actor_id: form.requester || "requester@levelshift.com" }),
      }).then(() => setAnswers({})));
  }

  function decide(caseId: string, decision: "approved" | "rejected") {
    void run(`Brief ${decision} — recorded with identity`, async () => {
      const outcome = await jsonFetch<{ brief?: { campaign_id?: string } | null }>(
        `/api/cases/${caseId}/decision`,
        { method: "POST", body: JSON.stringify({ decision, actor_id: actorId }) },
      );
      // Approval triggers the REAL Campaign-in-a-Box planning pass (spec:
      // event-triggered on brief approval). Fire-and-forget: its STS records
      // arrive on this stream as the run progresses.
      const campaignId = outcome.brief?.campaign_id;
      if (decision === "approved" && campaignId) {
        void jsonFetch(`/api/box/campaigns/${campaignId}/plan`, {
          method: "POST", body: JSON.stringify({ actor_id: actorId }),
        }).catch(() => undefined);
      }
    });
  }

  function freshSession() {
    void run("Fresh session — prior cases archived on disk, clean slate", async () => {
      await jsonFetch("/api/control/reset", { method: "POST", body: "{}" });
      lastSeq.current = 0;
      setEvents([]); setCases([]); setSelected(null); setDetail(null); setAnswers({});
      setSessionNonce((n) => n + 1); // reconnect the SSE stream to the new session
    });
  }

  function toggleKillSwitch() {
    if (!health) return;
    const paused = health.kill_switch !== "paused";
    void run(paused ? "Kill switch engaged — agent pauses before any action" : "Kill switch cleared", () =>
      jsonFetch("/api/control/kill-switch", {
        method: "POST", body: JSON.stringify({ paused, reason: "paused from studio UI" }),
      }).then(() => refreshHealth()));
  }

  if (offline) {
    return (
      <div className="screen-content live-screen">
        <section className="simple-page-header"><div><h1>Live agents</h1><p>Console for the real Campaign Identification agent via the local dev bridge.</p></div></section>
        <div className="live-offline">
          <Plugs size={28} />
          <strong>Bridge offline at {API}</strong>
          <p>Start it, then this screen connects by itself:</p>
          <pre>{`cd Agents\n.venv\\Scripts\\python -m uvicorn c2c_bridge.app:app --port 8787`}</pre>
          <p>Provider comes from <code>Agents/.env</code> (<code>LLM_PROVIDER=azure_openai</code> in dev).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-content live-screen">
      <section className="simple-page-header">
        <div>
          <h1>Live agents</h1>
          <p>Real Campaign Identification agent (Python) over the dev bridge — every row below is an STS v2 record emitted by actual runs{health ? ` · ${health.provider} / ${health.model} · config ${health.config_version}` : ""}.</p>
        </div>
        <div className="live-head-actions">
          <button className="secondary-button" onClick={freshSession} disabled={busy} title="Start a clean session — prior cases stay archived on disk">
            <ArrowClockwise size={15} /> Fresh session
          </button>
          {health && (
            <button className={`secondary-button${health.kill_switch === "paused" ? " danger" : ""}`} onClick={toggleKillSwitch} disabled={busy}>
              {health.kill_switch === "paused" ? <><Play size={15} /> Resume agent</> : <><Pause size={15} /> Kill switch</>}
            </button>
          )}
          <Chip tone={health?.kill_switch === "paused" ? "red" : "green"}>
            <Broadcast size={12} /> {health?.kill_switch === "paused" ? "paused" : "live"}
          </Chip>
        </div>
      </section>

      {flash && <p className="live-flash" role="status"><CheckCircle size={15} /> {flash}</p>}
      {error && <p className="live-error" role="alert"><WarningCircle size={15} /> {error}</p>}

      <div className="live-grid">
        {/* -------- intake -------- */}
        <section className="live-card" aria-label="Submit a campaign request">
          <div className="live-card-head">
            <strong><PaperPlaneTilt size={15} /> New campaign request</strong>
            <span>
              <button className="text-link" onClick={() => setForm({ ...SAMPLE_COMPLETE })}>complete sample</button>
              {" · "}
              <button className="text-link" onClick={() => setForm({ ...SAMPLE_INCOMPLETE, objective: "", business_unit: "", target_segment: "", channels: "", timeline_start: "", timeline_end: "", owner: "", budget_flag: "" })}>incomplete sample</button>
            </span>
          </div>
          <form onSubmit={submitRequest} className="live-intake" noValidate>
            {FORM_FIELDS.map((f) => (
              <div className={`field${f.kind === "area" ? " span2" : ""}`} key={f.key}>
                <label htmlFor={`live-${f.key}`}>{f.label}</label>
                {f.kind === "area" ? (
                  <textarea id={`live-${f.key}`} rows={2} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                ) : (
                  <input id={`live-${f.key}`} type={f.kind === "date" ? "date" : "text"} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                )}
              </div>
            ))}
            <div className="span2 live-submit-row">
              <button type="submit" className="primary-button" disabled={busy}><Robot size={15} /> Send to agent</button>
              <small>Missing fields become targeted gap questions — the agent never invents values.</small>
            </div>
          </form>
        </section>

        {/* -------- cases -------- */}
        <section className="live-card" aria-label="Live cases">
          <div className="live-card-head"><strong>Cases</strong><span>{cases.length} total</span></div>
          <div className="live-cases">
            {cases.length === 0 && <p className="live-empty">No cases yet — send a request.</p>}
            {cases.map((c) => (
              <button key={c.case_id} className={`live-case-row${selected === c.case_id ? " active" : ""}`} onClick={() => setSelected(c.case_id)}>
                <span className="live-case-id">
                  <strong>{c.topic ?? c.case_id}</strong>
                  <small>{c.case_id}{c.business_unit ? ` · ${c.business_unit} / ${c.vertical}` : ""}</small>
                </span>
                <Chip tone={statusTone(c.status)}>{c.status.replace(/_/g, " ")}</Chip>
              </button>
            ))}
          </div>

          {detail && selected && (
            <div className="live-detail">
              <div className="live-card-head">
                <strong>{detail.summary.campaign_id ?? selected}</strong>
                <Chip tone={statusTone(detail.summary.status)}>{detail.summary.status.replace(/_/g, " ")}</Chip>
              </div>

              {detail.summary.status === "awaiting_input" && detail.gap_request && (
                <div className="live-gaps">
                  <p className="meta-label">Gap questions · round {detail.gap_request.round} (answer as the requester)</p>
                  {detail.gap_request.questions.map((q) => (
                    <div className="field" key={q.field}>
                      <label htmlFor={`gap-${q.field}`}>{q.question}</label>
                      <input id={`gap-${q.field}`} value={answers[q.field] ?? ""} placeholder={q.field}
                        onChange={(e) => setAnswers({ ...answers, [q.field]: e.target.value })} />
                    </div>
                  ))}
                  <button className="primary-button" disabled={busy} onClick={() => sendAnswers(selected, detail.gap_request?.questions ?? [])}>Submit answers</button>
                </div>
              )}

              {detail.summary.status === "awaiting_approval" && (
                <div className="live-gate">
                  <p className="meta-label">BU Campaign Lead gate — explicit human decision, recorded with identity</p>
                  <div className="field"><label htmlFor="live-actor">Approver identity</label><input id="live-actor" value={actorId} onChange={(e) => setActorId(e.target.value)} /></div>
                  <div className="live-gate-actions">
                    <button className="primary-button" disabled={busy} onClick={() => decide(selected, "approved")}><CheckCircle size={15} /> Approve brief</button>
                    <button className="secondary-button danger" disabled={busy} onClick={() => decide(selected, "rejected")}><XCircle size={15} /> Reject</button>
                  </div>
                </div>
              )}

              {detail.summary.status === "escalated" && (
                <div className="live-gaps">
                  <p className="meta-label">Escalated · {detail.summary.escalation_reason_code} — human decision required</p>
                  {escalationCitations(detail.case.escalation_detail).map((line) => (
                    <p className="live-note" key={line}><WarningCircle size={13} /> {line}</p>
                  ))}
                  <p className="live-note">
                    {detail.summary.escalation_reason_code === "duplicate_disputed"
                      ? "The agent found an open campaign with the same BU, vertical, topic and window. Reject this request, or change topic/dates (or start a fresh session) and resubmit — the agent never merges or rejects on its own."
                      : "Resolve by rejecting, or clear the cause and resubmit."}
                  </p>
                </div>
              )}

              {detail.summary.doc_ref && (
                <p className="live-note">
                  <DownloadSimple size={14} />{" "}
                  <a className="text-link" href={liveApi.docUrl(detail.summary.doc_ref) ?? "#"} target="_blank" rel="noreferrer">
                    Download brief (.docx) <ArrowSquareOut size={12} />
                  </a>
                </p>
              )}

              {detail.case.brief?.fields && (
                <div className="live-brief">
                  <p className="meta-label">Brief fields (provenance on every value)</p>
                  <div className="live-brief-table">
                    {detail.case.brief.fields.map((f) => (
                      <div key={f.name}><span>{f.name}</span><strong>{f.value}</strong><small>{f.provenance}</small></div>
                    ))}
                  </div>
                  {detail.case.brief.classification && (
                    <p className="live-note">Classified: {detail.case.brief.classification.campaign_type} · {detail.case.brief.classification.priority} priority · {detail.case.brief.classification.channel_mix.join(", ")}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* -------- event stream -------- */}
        <section className="live-card live-stream" aria-label="Telemetry stream">
          <div className="live-card-head">
            <strong>STS v2 event stream</strong>
            <span>
              {selectedTrace && <button className="text-link" onClick={() => setSelected(null)}>show all</button>}
              {selectedTrace ? " trace of selected case" : `${events.length} records`}
            </span>
          </div>
          <div className="live-log" ref={logRef}>
            {shownEvents.length === 0 && <p className="live-empty">Waiting for agent activity…</p>}
            {shownEvents.map((r) => (
              <div className="live-log-row" key={String(r["bridge.seq"])}>
                <small>{String(r["shiftai.timestamp"]).slice(11, 19)}</small>
                <Chip tone={eventTone(String(r["shiftai.event.type"]))}>{String(r["shiftai.event.type"])}</Chip>
                <span>{eventSummary(r)}</span>
                <small className="live-log-case">{String(r["shiftai.case.id"]).slice(0, 17)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
