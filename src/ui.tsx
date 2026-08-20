import { useEffect, useState, type ReactNode } from "react";

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
import { ArrowSquareOut, ArrowsClockwise, Microphone, X } from "@phosphor-icons/react";
import { useRef } from "react";
import type { Asset, AssetState, CampaignState, TelemetryEvent } from "./types";
import { agentMeta, fullStamp, stampTime } from "./data";
import { personById, useStore } from "./store";

export function Avatar({ initials, size }: { initials: string; size?: "sm" }) {
  return <span className={`avatar${size === "sm" ? " sm" : ""}`}>{initials}</span>;
}

export function Monogram({ children, size = "md" }: { children: ReactNode; size?: "sm" | "md" | "lg" }) {
  return <span className={`monogram ${size}`}>{children}</span>;
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "blue" | "red" }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function MiniSource({ children }: { children: ReactNode }) {
  return <span className="source-chip">{children}</span>;
}

const campaignStateLabels: Record<CampaignState, { label: string; tone: "neutral" | "green" | "amber" | "blue" }> = {
  awaiting_input: { label: "Awaiting input", tone: "amber" },
  brief_pending_approval: { label: "Brief pending approval", tone: "amber" },
  planning: { label: "Planning", tone: "blue" },
  in_production: { label: "In production", tone: "blue" },
  in_review: { label: "In review", tone: "amber" },
  packaged_pending_compliance: { label: "In compliance", tone: "blue" },
  awaiting_signoff: { label: "Awaiting sign-off", tone: "amber" },
  approved_locked: { label: "Approved & locked", tone: "green" },
};

export function CampaignStateChip({ state }: { state: CampaignState }) {
  const s = campaignStateLabels[state];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

const assetStateLabels: Record<AssetState, { label: string; tone: "neutral" | "green" | "amber" | "blue" }> = {
  planned: { label: "Planned", tone: "neutral" },
  drafting: { label: "Drafting", tone: "blue" },
  in_review: { label: "In review", tone: "amber" },
  in_revision: { label: "In revision", tone: "amber" },
  content_confirmed: { label: "Confirmed", tone: "green" },
  approved: { label: "Approved", tone: "green" },
};

export function AssetStateChip({ state }: { state: AssetState }) {
  const s = assetStateLabels[state];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

export function ProgressSteps({ active = 6 }: { active?: number }) {
  return (
    <div className="progress-steps" aria-label={`${active} of 9 campaign steps complete`}>
      {Array.from({ length: 9 }, (_, i) => <span key={i} className={i < active ? "done" : i === active ? "current" : ""} />)}
    </div>
  );
}

/* Close a <details> menu when the user clicks anywhere outside it */
export function useAutoCloseDetails(ref: { current: HTMLDetailsElement | null }) {
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref]);
}

export function Menu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useAutoCloseDetails(ref);
  return (
    <details className="menu" ref={ref}>
      <summary aria-label="More options">{label}</summary>
      <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).open = false}>{children}</div>
    </details>
  );
}

export function Modal({ title, onClose, children, wide, xl }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; xl?: boolean }) {
  useEscape(onClose);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${xl ? " xl" : wide ? " wide" : ""}`}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return <div className="toast" role="status">{toast}</div>;
}

/* ---------- Document viewer (workspace copy of the OneDrive file) ---------- */

export function DocView({ asset }: { asset: Asset }) {
  const { state, now, showToast } = useStore();
  const versions = asset.versions;
  const [sel, setSel] = useState(versions.length - 1);
  // A new revision arriving jumps the viewer to it
  useEffect(() => { setSel(versions.length - 1); }, [versions.length, asset.id]);

  if (versions.length === 0) {
    return (
      <div className="empty-panel embedded">
        <p>Not drafted yet. Content Repurposing stages this derivative from the confirmed flagship's claim inventory; the document appears here the moment the fan-out runs.</p>
      </div>
    );
  }

  const idx = Math.min(sel, versions.length - 1);
  const v = versions[idx];
  const isLatest = idx === versions.length - 1;
  const isRevision = idx > 0 && v.author.type === "agent";
  const author = v.author.type === "human" ? personById(state, v.author.personId) : undefined;

  return (
    <div className="doc-view">
      <div className="doc-view-bar">
        <div className="doc-versions" role="tablist" aria-label="Document versions">
          {versions.map((ver, i) => (
            <button key={ver.version} role="tab" aria-selected={i === idx} className={i === idx ? "active" : ""} onClick={() => setSel(i)}>{ver.version}</button>
          ))}
        </div>
        <button className="secondary-button onedrive-button" onClick={() => showToast(`Demo workspace: in production this opens ${asset.name} ${v.version}.docx in the OneDrive campaign workspace`)}>
          <ArrowSquareOut size={14} /> Open in OneDrive
        </button>
      </div>
      <div className="doc-meta">
        {v.author.type === "agent" ? <Monogram size="sm">{v.author.agent}</Monogram> : <Avatar initials={author?.initials ?? "?"} />}
        <span>
          <strong>{v.author.type === "agent" ? agentName(v.author.agent) : author?.name ?? "Unknown"}</strong>
          <small title={fullStamp(v.ts)}>{stampTime(v.ts, now)} · hash <code>{v.hash}</code></small>
        </span>
        {isLatest ? <AssetStateChip state={asset.state} /> : <Chip>Superseded</Chip>}
      </div>
      <div className={`change-strip${isRevision ? " revision" : ""}`}>
        <ArrowsClockwise size={14} />
        <p>{v.note}</p>
      </div>
      <div className="document-preview">
        <p className="doc-kicker">{v.doc.kicker}</p>
        <h2>{v.doc.title}</h2>
        {v.doc.body.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
      </div>
    </div>
  );
}

export function DocModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  return (
    <Modal title={`${asset.name} · ${asset.version}`} onClose={onClose} xl>
      <DocView asset={asset} />
    </Modal>
  );
}

/* ---------- Speech to text (browser Web Speech API, no external service) ---------- */

type RecognitionCtor = new () => {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
};

function speechCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function MicButton({ onText }: { onText: (transcript: string) => void }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<InstanceType<RecognitionCtor> | null>(null);
  useEffect(() => () => recRef.current?.stop(), []);
  const Ctor = typeof window !== "undefined" ? speechCtor() : undefined;
  if (!Ctor) return null;

  function toggle() {
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Ctor!();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results, (r) => r[0].transcript).join(" ").trim();
      if (text) onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <button type="button" className={`mic-button${listening ? " listening" : ""}`} aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate with your voice"} title={listening ? "Listening, click to stop" : "Dictate with your voice"} onClick={toggle}>
      <Microphone size={14} weight={listening ? "fill" : "regular"} />
    </button>
  );
}

/* ---------- Telemetry / explainability ---------- */

export function agentName(key: TelemetryEvent["agent"]): string {
  if (key === "studio") return "Marketing Studio";
  return agentMeta.find((a) => a.key === key)?.name ?? key;
}

export function EventLine({ event, showCampaign }: { event: TelemetryEvent; showCampaign?: boolean }) {
  const { state, now, openTrace } = useStore();
  const campaign = state.campaigns.find((c) => c.id === event.campaignId);
  const actorPerson = event.actor.personId ? personById(state, event.actor.personId) : undefined;
  return (
    <button className="event-line" onClick={() => openTrace(event.trace_id)} title="Open trace">
      <Monogram size="sm">{event.agent === "studio" ? "ES" : event.agent}</Monogram>
      <span className="event-main">
        <strong>{event.summary}</strong>
        <small title={fullStamp(event.ts)}>
          {showCampaign && campaign ? `${campaign.name} · ` : ""}
          {stampTime(event.ts, now)}
          {actorPerson ? ` by ${actorPerson.name}` : ""}
        </small>
      </span>
      {event.outcome === "escalated" ? <Chip tone="amber">Escalated</Chip>
        : event.outcome === "flagged" ? <Chip tone="amber">Flagged</Chip>
        : event.outcome === "blocked" ? <Chip tone="red">Blocked</Chip>
        : event.cost_usd > 0 ? <span className="event-cost">${event.cost_usd.toFixed(2)}</span>
        : <Chip tone="green">Done</Chip>}
    </button>
  );
}

export function TraceDrawer() {
  const { state, now, traceId, openTrace } = useStore();
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") openTrace(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTrace]);
  if (!traceId) return null;
  const events = state.events.filter((e) => e.trace_id === traceId).sort((a, b) => a.ts - b.ts);
  if (events.length === 0) return null;
  const campaign = state.campaigns.find((c) => c.id === events[0].campaignId);
  const totalCost = events.reduce((s, e) => s + e.cost_usd, 0);
  return (
    <div className="overlay drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) openTrace(null); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Telemetry trace">
        <div className="drawer-head">
          <div>
            <p className="meta-label">STS v1.1 trace · <code>{traceId}</code></p>
            <h2>{campaign?.name ?? "Fleet"}</h2>
          </div>
          <button className="icon-button" aria-label="Close trace" onClick={() => openTrace(null)}><X size={16} /></button>
        </div>
        <p className="drawer-sub">{events.length} span{events.length > 1 ? "s" : ""} · total cost ${totalCost.toFixed(2)} · every field below is emitted by the agent and read natively by Marketing Studio.</p>
        <div className="trace-spans">
          {events.map((e) => {
            const actorPerson = e.actor.personId ? personById(state, e.actor.personId) : undefined;
            return (
              <div className="span-card" key={e.id}>
                <div className="span-top">
                  <Monogram size="sm">{e.agent === "studio" ? "ES" : e.agent}</Monogram>
                  <div><strong>{e.summary}</strong><small title={fullStamp(e.ts)}>{agentName(e.agent)} · {stampTime(e.ts, now)}</small></div>
                </div>
                <dl className="span-grid">
                  <div><dt>Actor</dt><dd>{e.actor.type === "human" ? `Human · ${actorPerson?.name ?? "unknown"}` : e.actor.type === "system" ? "Deterministic module" : "Agent"}</dd></div>
                  <div><dt>Activity</dt><dd><code>{e.activity}</code></dd></div>
                  {e.model && <div><dt>Model</dt><dd><code>{e.model}</code> · prompt {e.prompt_version}</dd></div>}
                  {e.rules_pack && <div><dt>Rules pack</dt><dd>{e.rules_pack}</dd></div>}
                  {e.tokens && <div><dt>Tokens</dt><dd>{e.tokens.input.toLocaleString()} in / {e.tokens.output.toLocaleString()} out</dd></div>}
                  <div><dt>Cost</dt><dd>${e.cost_usd.toFixed(2)}</dd></div>
                  <div><dt>Timing</dt><dd>llm {e.timing.llm_ms}ms · api {e.timing.api_ms}ms · queue {e.timing.queue_ms}ms</dd></div>
                  {e.state && <div className="span-state"><dt>State</dt><dd><code>{e.state.previous}</code> → <code>{e.state.current}</code><br /><em>{e.state.reason}</em></dd></div>}
                  {e.sources.length > 0 && <div className="span-state"><dt>Sources</dt><dd>{e.sources.join(" · ")}</dd></div>}
                  <div><dt>Run</dt><dd><code>{e.run_id}</code></dd></div>
                  <div><dt>Span</dt><dd><code>{e.span_id}</code></dd></div>
                </dl>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
