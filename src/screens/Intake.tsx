import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, ArrowsClockwise, FileText, PaperPlaneTilt, Trash } from "@phosphor-icons/react";
import { useStore } from "../store";
import { briefFraming, deriveBrief, stampTime } from "../data";
import { useNav } from "../nav";
import { Chip, EventLine, MicButton, MiniSource, Monogram } from "../ui";
import { InlineDots } from "../loaders";

const channelOptions = ["LinkedIn", "Email nurture", "Sales enablement", "Web / service page", "Community", "Event"];

const BRIEF_ASPECTS = ["Executive angle", "Practical angle", "Tighter objective", "Stronger offer"];

const EXAMPLES = [
  "Build cloud migration intent with financial services CFOs on LinkedIn and email nurture, anchored on our BC delivery experience",
  "Launch an AI readiness webinar campaign for manufacturing operations leaders, with sales enablement and a landing page",
];

type Phase = "describe" | "drafting" | "review" | "sent";

export default function IntakeScreen() {
  const { state, now, viewer, actions } = useStore();
  const { go } = useNav();
  const existingDraft = state.campaigns.find((c) => c.state === "brief_draft" && c.requesterId === viewer.id);
  const [phase, setPhase] = useState<Phase>(existingDraft ? "review" : "describe");
  const [draftId, setDraftId] = useState<string | null>(existingDraft?.id ?? null);
  const [description, setDescription] = useState("");
  const [budgetChoice, setBudgetChoice] = useState("");
  const [aspects, setAspects] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const draft = draftId ? state.campaigns.find((c) => c.id === draftId) : undefined;
  const lead = state.people.find((p) => p.role === "BU Campaign Lead") ?? state.people[0];
  const draftEvents = draftId ? state.events.filter((e) => e.campaignId === draftId).sort((a, b) => a.ts - b.ts) : [];
  const lastRevision = [...draftEvents].reverse().find((e) => e.activity === "revise_brief");
  const derivedFlags = useMemo(() => draft?.request ? deriveBrief(draft.request).derived : { vertical: false, channels: false }, [draft?.request]);

  useEffect(() => {
    if (phase !== "drafting") return;
    const t = window.setTimeout(() => setPhase("review"), 2400);
    return () => window.clearTimeout(t);
  }, [phase]);

  function generate() {
    if (description.trim().length < 20) { setError("Describe the campaign in a sentence or two, so the agent has something real to draft from."); return; }
    setError("");
    const id = actions.draftBrief(description.trim(), deriveBrief(description.trim()));
    setDraftId(id);
    setPhase("drafting");
  }

  function sendDirective(e: FormEvent) {
    e.preventDefault();
    if (!draftId) return;
    if (aspects.length === 0 && !note.trim()) { setError("Pick an aspect or dictate a note, so the agent knows what to change."); return; }
    setError("");
    actions.reviseBrief(draftId, aspects, note.trim());
    setAspects([]); setNote("");
  }

  function patch(p: Parameters<typeof actions.updateBrief>[1]) {
    if (draftId) actions.updateBrief(draftId, p);
  }

  const missing: string[] = [];
  if (draft) {
    if (!draft.vertical) missing.push("Vertical");
    if (!draft.segment) missing.push("Target segment");
    if (!draft.window.start) missing.push("Window start");
    if (!budgetChoice) missing.push("Budget status");
    if (draft.channels.length === 0) missing.push("At least one channel");
  }

  function send() {
    if (!draftId || !draft) return;
    if (missing.length > 0) { setError(`Still needed before ${lead.name.split(" ")[0]} sees this: ${missing.join(", ").toLowerCase()}. Agents never infer these.`); return; }
    setError("");
    actions.sendBrief(draftId);
    setPhase("sent");
  }

  /* ---- Phase: sent (telemetry confirmation) ---- */
  if (phase === "sent" && draftId) {
    const routed = draftEvents.some((e) => e.activity === "route_brief_approval");
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header"><div><h1>Brief sent for approval</h1><p>Verified by you, now with {lead.name}. Live telemetry below; click any line for the full trace.</p></div></section>
        <section className="intake-result">
          <div className="activity-feed embedded">
            {draftEvents.map((e) => <EventLine event={e} key={e.id} />)}
            {!routed && <p className="pending-line">Routing to {lead.name.split(" ")[0]}<InlineDots /></p>}
          </div>
          {routed && (
            <div className="intake-routed">
              <Monogram>CI</Monogram>
              <div>
                <strong>Brief routed for approval</strong>
                <p>{lead.name} ({lead.role}) received the approval task, due in 2 business days. Use the profile menu to view the workspace as {lead.name.split(" ")[0]} and approve it, and the pipeline keeps moving.</p>
                <div className="source-row"><MiniSource>Brief {draft?.briefVersion ?? "v0.1"}</MiniSource><MiniSource>Verified by {viewer.name.split(" ")[0]}</MiniSource></div>
              </div>
            </div>
          )}
          {routed && (
            <div className="intake-result-actions">
              <button className="primary-button" onClick={() => go({ page: "campaigns", campaignId: draftId })}>View campaign</button>
              <button className="secondary-button" onClick={() => go("home")}>Back to home</button>
            </div>
          )}
        </section>
      </div>
    );
  }

  /* ---- Phase: drafting (agent working, telemetry streaming) ---- */
  if (phase === "drafting") {
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header"><div><h1>Drafting your brief</h1><p>Campaign Identification is working. The draft comes back to you first; nothing is routed.</p></div></section>
        <section className="intake-result">
          <div className="activity-feed embedded">
            {draftEvents.map((e) => <EventLine event={e} key={e.id} />)}
            <p className="pending-line">Campaign Identification drafting<InlineDots /></p>
          </div>
        </section>
      </div>
    );
  }

  /* ---- Phase: review (Marketing Lead verifies and iterates) ---- */
  if (phase === "review" && draft) {
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header">
          <div><h1>Review the drafted brief</h1><p>Drafted by Campaign Identification from your request. Verify it, iterate with directives, fill what agents never infer, then send it to {lead.name}.</p></div>
          <Chip tone="blue">Brief {draft.briefVersion ?? "v0.1"} · in draft with you</Chip>
        </section>
        <div className="brief-review-layout">
          <section className="brief-doc">
            <p className="doc-kicker">{draft.bu} · {draft.vertical || "Vertical not set"}</p>
            <input className="brief-name-input" value={draft.name} aria-label="Campaign name" onChange={(e) => patch({ name: e.target.value })} />
            <p className="brief-framing">{briefFraming(draft)}</p>
            {lastRevision && <div className="change-strip revision"><ArrowsClockwise size={14} /><p>{lastRevision.summary}{lastRevision.state?.reason ? ` · "${lastRevision.state.reason}"` : ""}</p></div>}
            <div className="form-grid brief-fields">
              <div className="field field-full">
                <div className="field-label-row"><label htmlFor="br-objective">Objective</label><Chip tone="blue">Agent-derived</Chip></div>
                <input id="br-objective" value={draft.objective} onChange={(e) => patch({ objective: e.target.value })} />
              </div>
              <div className="field field-full">
                <div className="field-label-row"><label htmlFor="br-topic">Offer or topic</label><Chip tone="blue">Agent-derived</Chip></div>
                <input id="br-topic" value={draft.topic} onChange={(e) => patch({ topic: e.target.value })} />
              </div>
              <div className="field">
                <div className="field-label-row"><label htmlFor="br-bu">Business unit</label></div>
                <select id="br-bu" value={draft.bu} onChange={(e) => patch({ bu: e.target.value })}><option>Business Central</option><option>Finance &amp; Operations</option><option>Cross-BU</option></select>
              </div>
              <div className={`field${draft.vertical ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-vertical">Vertical</label>{draft.vertical && derivedFlags.vertical ? <Chip tone="blue">Agent-derived</Chip> : !draft.vertical ? <Chip tone="amber">You provide</Chip> : null}</div>
                <select id="br-vertical" value={draft.vertical} onChange={(e) => patch({ vertical: e.target.value })}><option value="">Select…</option><option>Financial Services</option><option>Manufacturing</option><option>Technology</option></select>
              </div>
              <div className={`field${draft.segment ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-segment">Target segment</label>{!draft.segment && <Chip tone="amber">Never inferred</Chip>}</div>
                <select id="br-segment" value={draft.segment} onChange={(e) => patch({ segment: e.target.value })}><option value="">Select…</option><option>Type 3</option><option>Type 4</option><option>Standard</option></select>
              </div>
              <div className={`field${budgetChoice ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-budget">Budget approved</label>{!budgetChoice && <Chip tone="amber">Never inferred</Chip>}</div>
                <select id="br-budget" value={budgetChoice} onChange={(e) => { setBudgetChoice(e.target.value); patch({ budgetApproved: e.target.value === "Yes" }); }}><option value="">Select…</option><option>Yes</option><option>No</option></select>
              </div>
              <div className={`field${draft.window.start ? "" : " gap"}`}>
                <div className="field-label-row"><label htmlFor="br-start">Window start</label>{!draft.window.start && <Chip tone="amber">You provide</Chip>}</div>
                <input id="br-start" type="date" value={draft.window.start} onChange={(e) => patch({ window: { ...draft.window, start: e.target.value } })} />
              </div>
              <div className="field">
                <div className="field-label-row"><label htmlFor="br-end">Window end</label></div>
                <input id="br-end" type="date" value={draft.window.end} onChange={(e) => patch({ window: { ...draft.window, end: e.target.value } })} />
              </div>
              <fieldset className="field field-full channel-set">
                <div className="field-label-row"><legend>Channels</legend>{derivedFlags.channels && draft.channels.length > 0 && <Chip tone="blue">Agent-derived</Chip>}</div>
                <div className="channel-grid">
                  {channelOptions.map((channel) => (
                    <label key={channel} className="checkbox">
                      <input type="checkbox" checked={draft.channels.includes(channel)}
                        onChange={() => patch({ channels: draft.channels.includes(channel) ? draft.channels.filter((c) => c !== channel) : [...draft.channels, channel] })} />
                      {channel}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>

          <aside className="brief-rail">
            <form className="directive-composer" onSubmit={sendDirective}>
              <div className="directive-head">
                <Monogram size="sm">CI</Monogram>
                <div>
                  <strong>Directive to Campaign Identification</strong>
                  <small>Revisions stay on your side of the gate; each one is recorded with your identity</small>
                </div>
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
                <small>The agent redrafts; you decide when it leaves this page.</small>
                <button type="submit" className="primary-button"><PaperPlaneTilt size={14} /> Send directive</button>
              </div>
            </form>

            <section className="intake-side">
              <h2>Your request</h2>
              <p className="request-quote">"{draft.request}"</p>
              <p className="request-meta">Parsed by Campaign Identification · brief {draft.briefVersion ?? "v0.1"}{lastRevision ? ` · last revised ${stampTime(lastRevision.ts, now)}` : ""}</p>
            </section>

            <section className="send-panel">
              <h2>Send to {lead.name}</h2>
              {missing.length > 0 ? (
                <p className="send-missing">Before this reaches the {lead.role}: <strong>{missing.join(" · ")}</strong>. Agents never infer these.</p>
              ) : (
                <p className="send-ready">Everything is in place. Sending routes the approval task to {lead.name.split(" ")[0]} with a 2-business-day turnaround.</p>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button send-button" onClick={send} disabled={missing.length > 0}><ArrowRight size={15} /> Send to {lead.name.split(" ")[0]} for approval</button>
              <button className="text-button" onClick={() => { if (draftId) { actions.discardDraft(draftId); setDraftId(null); setPhase("describe"); setDescription(""); setBudgetChoice(""); } }}><Trash size={13} /> Discard draft</button>
            </section>
          </aside>
        </div>
      </div>
    );
  }

  /* ---- Phase: describe (AI-first entry) ---- */
  return (
    <div className="screen-content intake-screen">
      <section className="simple-page-header"><div><h1>New campaign request</h1><p>Describe what you need; the Campaign Identification agent drafts the brief. You verify and iterate before anything is routed.</p></div></section>
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
            <small>Campaign Identification drafts from your words and flags what it will not infer: segment, budget and dates stay with you.</small>
          </div>
          <button className="primary-button" onClick={generate}><FileText size={15} /> Draft the brief</button>
        </div>
      </section>
    </div>
  );
}
