import { useEffect, useState, type FormEvent } from "react";
import { CaretRight, Check, Clock, FileText, PaperPlaneTilt, Timer, Warning } from "@phosphor-icons/react";
import { openTasksFor, personById, slaInfo, useStore } from "../store";
import { briefFraming, fullStamp, stampTime } from "../data";
import { liveApi, type LiveCaseDetail } from "../live";
import { LivePlanReview } from "../boxPanels";
import { useNav } from "../nav";
import { AssetStateChip, Avatar, CampaignStateChip, Chip, DocModal, DocView, Menu, MicButton, MiniSource, Monogram } from "../ui";
import type { Asset, Campaign, Task } from "../types";
import { DotsThree } from "@phosphor-icons/react";

export default function ApprovalsScreen() {
  const { state, now, viewer, actions } = useStore();
  const { nav } = useNav();
  const myTasks = openTasksFor(state, viewer.id);
  const [selectedId, setSelectedId] = useState<string | null>(nav.taskId ?? myTasks[0]?.id ?? null);

  useEffect(() => {
    if (nav.taskId) setSelectedId(nav.taskId);
  }, [nav.taskId]);

  const selected = state.tasks.find((t) => t.id === selectedId && t.status === "open" && t.assigneeId === viewer.id) ?? myTasks[0] ?? null;
  const reviewWatch = state.tasks.filter((t) => t.status === "open" && t.kind === "review").sort((a, b) => a.createdAt - b.createdAt);
  const canManageSla = viewer.role === "Marketing Lead" || viewer.role === "AiCoE Admin";

  return (
    <div className="screen-content approvals-screen">
      <section className="simple-page-header"><div><h1>Review with the full context</h1><p>Every decision includes the asset, source lineage, rules and approval history. You are acting as {viewer.name}, {viewer.role}.</p></div>{myTasks.length > 0 && <Chip tone="amber">{myTasks.length} task{myTasks.length > 1 ? "s" : ""} assigned to you</Chip>}</section>
      <div className="approval-layout">
        <aside className="approval-queue">
          <div className="queue-heading"><h2>My queue</h2><span>{myTasks.length} open</span></div>
          {myTasks.length === 0 && <div className="queue-empty"><p>No open tasks for {viewer.name}.</p><p>Switch person via the profile menu to see other queues.</p></div>}
          {myTasks.map((task) => {
            const campaign = state.campaigns.find((c) => c.id === task.campaignId);
            return (
              <button key={task.id} className={`queue-item${selected?.id === task.id ? " active" : ""}`} onClick={() => setSelectedId(task.id)}>
                <div><strong>{task.title}</strong><small>{campaign?.name} · {stampTime(task.createdAt, now)}</small></div>
                <CaretRight size={14} />
              </button>
            );
          })}
        </aside>
        {selected ? <TaskDetail task={selected} /> : (
          <section className="approval-detail empty-detail"><h3>All clear</h3><p>Nothing waits on {viewer.name} right now. Agents keep executing and new gates will land here.</p></section>
        )}
      </div>

      {selected && <ChainPanel campaignId={selected.campaignId} />}

      <section className="sla-watch">
        <div><h2>Turnaround watch</h2><p>Live from open review tasks. Reminders go out automatically at 50% and 90% of each review window; persistent stalls escalate to the Marketing Lead.</p></div>
        <div className="sla-rows">
          {reviewWatch.length === 0 && <p className="sla-empty">No open reviews. New review tasks appear here with how much time remains.</p>}
          {reviewWatch.map((task) => {
            const info = slaInfo(task, now);
            const assignee = personById(state, task.assigneeId);
            const campaign = state.campaigns.find((c) => c.id === task.campaignId);
            return (
              <div key={task.id}>
                <span className={`sla-icon${info.level === "at_risk" ? " amber" : info.level === "escalated" ? " red" : ""}`}>{info.level === "escalated" ? <Warning size={15} /> : info.level === "at_risk" ? <Timer size={15} /> : <Clock size={15} />}</span>
                <p><strong>{task.title} · {campaign?.name}</strong><small>{assignee?.name}, {info.remaining} · {task.remindersSent === 0 ? "no reminders yet" : `${task.remindersSent} reminder${task.remindersSent > 1 ? "s" : ""} sent`}</small></p>
                {info.level === "escalated" && canManageSla ? (
                  <Menu label={<span className="secondary-button sla-action">Act <CaretRight size={12} /></span>}>
                    <button onClick={() => actions.nudgeTask(task.id)}>Send reminder now</button>
                    {state.people.filter((p) => p.status === "Active" && p.id !== task.assigneeId && p.role !== "Viewer").slice(0, 4).map((p) => (
                      <button key={p.id} onClick={() => actions.reassignTask(task.id, p.id)}>Reassign to {p.name}</button>
                    ))}
                  </Menu>
                ) : info.level === "escalated" ? <Chip tone="red">Escalated</Chip>
                  : info.level === "at_risk" ? (canManageSla ? <button className="secondary-button sla-action" onClick={() => actions.nudgeTask(task.id)}>Nudge</button> : <Chip tone="amber">At risk</Chip>)
                  : <Chip tone="green">On pace</Chip>}
              </div>
            );
          })}
        </div>
      </section>
      {reviewWatch.some((t) => t.assigneeId === viewer.id) && (
        <p className="sla-note">Reviews assigned to you appear in your queue above; completing them clears the watch row.</p>
      )}
    </div>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const { state, actions, viewer, showToast } = useStore();
  const campaign = state.campaigns.find((c) => c.id === task.campaignId)!;
  const [docAsset, setDocAsset] = useState<Asset | null>(null);
  const [deciding, setDeciding] = useState(false);

  if (task.kind === "conflict") return <ConflictDetail task={task} />;
  if (task.kind === "gaps") return <GapsDetail task={task} />;
  if (task.kind === "review") return <ReviewDetail task={task} />;

  /* Pack + plan proposed by the REAL Campaign-in-a-Box agent: the confirmation
     gate lives here in Approvals like every other human decision, and is
     recorded by the agent itself. */
  if (task.kind === "plan_confirm" && task.liveCaseId) {
    return (
      <section className="approval-detail">
        <div className="approval-detail-head"><div><div className="title-line"><h2>{task.title}</h2><CampaignStateChip state={campaign.state} /></div><p>{campaign.name} · {task.detail}</p></div></div>
        <div className="gap-body">
          <LivePlanReview task={task} />
          <div className="agent-recommendation"><Monogram size="sm">CB</Monogram><div><p className="meta-label">Why this is in front of you</p><p className="gate-why">The live Campaign-in-a-Box agent assembled this pack and plan from the approved brief — sourced intel, grounded proof points, a reuse-scanned checklist and a back-planned calendar. The orchestrator never confirms its own output: your confirmation (or delta) is recorded by the agent with your identity, and starts content production.</p></div></div>
        </div>
      </section>
    );
  }

  /* A brief backed by a REAL agent case: the decision goes through the bridge first
     (identity-stamped human gate in the agent), then the demo journey continues. */
  async function approveLive() {
    if (deciding) return;
    setDeciding(true);
    try {
      let liveCampaignId: string | undefined;
      if (task.liveCaseId) {
        const outcome = await liveApi.decide(task.liveCaseId, "approved", viewer.email);
        liveCampaignId = outcome.brief?.campaign_id;
      }
      actions.approveBrief(task.id, liveCampaignId);
    } catch (e) {
      showToast(`Live agent gate refused: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDeciding(false);
    }
  }

  async function returnLive(note: string) {
    if (deciding) return;
    setDeciding(true);
    try {
      if (task.liveCaseId) await liveApi.decide(task.liveCaseId, "returned", viewer.email, note);
      actions.returnBrief(task.id, note);
    } catch (e) {
      showToast(`Live agent gate refused: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDeciding(false);
    }
  }

  const briefRows = [
    ["Objective", campaign.objective], ["Business unit", campaign.bu], ["Vertical", campaign.vertical],
    ["Segment", campaign.segment || "Not set"], ["Channels", campaign.channels.join(" + ")],
    ["Window", `${campaign.window.start} to ${campaign.window.end}`],
  ];

  const copy: Record<string, { heading: string; body: string; cta: string; act: () => void }> = {
    brief_approval: { heading: "Campaign brief", body: task.liveCaseId ? "This brief was drafted and routed by the LIVE Campaign Identification agent. Your decision is recorded by the agent itself (identity + timestamp) before the journey continues; nothing advances without this gate." : "This is the complete brief: agent-drafted, verified by the Marketing Lead before it reached you, with its provenance and the original request below. Approving starts planning; nothing advances without this gate.", cta: "Approve brief", act: () => void approveLive() },
    plan_confirm: { heading: "Audience & offer pack", body: "Campaign-in-a-Box proposed the audience pack, a 9-asset checklist and the workspace. The orchestrator never confirms its own output; your confirmation starts content drafting.", cta: "Confirm plan", act: () => actions.confirmPlan(task.id) },
    grammar_qa: { heading: "Final language QA", body: "All assets passed the automated gate (0 blocking findings). You are the final language gate on market-facing content; read any document below, then approve. Approval routes the package to BU sign-off.", cta: "Approve language QA", act: () => actions.grammarApprove(task.id) },
    package_signoff: { heading: "Package sign-off", body: "Every asset is content-confirmed with human identity recorded, 42 checks passed and Grammar QA is approved. Read any document below before you sign; signing off locks the package read-only in OneDrive.", cta: "Sign off & lock package", act: () => actions.signOffPackage(task.id) },
  };
  const c = copy[task.kind];
  const showAssets = task.kind === "grammar_qa" || task.kind === "package_signoff";
  return (
    <section className="approval-detail">
      <div className="approval-detail-head"><div><div className="title-line"><h2>{task.title}</h2><CampaignStateChip state={campaign.state} /></div><p>{campaign.name} · {task.detail}</p></div></div>
      <div className="gap-body">
        {task.kind === "brief_approval"
          ? <BriefReview campaign={campaign} liveCaseId={task.liveCaseId} />
          : <div><p className="meta-label">{c.heading}</p><div className="brief-grid">{briefRows.map(([k, v]) => <div key={k}><small>{k}</small><strong>{v}</strong></div>)}</div></div>}
        {showAssets && <AssetListPanel campaignId={task.campaignId} onOpen={setDocAsset} />}
        <div className="agent-recommendation"><Monogram size="sm">{task.kind === "package_signoff" || task.kind === "grammar_qa" ? "QG" : task.kind === "plan_confirm" ? "CB" : "CI"}</Monogram><div><p className="meta-label">Why this is in front of you</p><p className="gate-why">{c.body}</p></div></div>
      </div>
      <DecisionFooter
        task={task}
        cta={deciding ? "Recording your decision…" : c.cta}
        onDecide={c.act}
        busy={deciding}
        allowReturn={task.kind === "brief_approval"}
        onReturn={task.kind === "brief_approval" ? (note) => void returnLive(note) : undefined}
      />
      {docAsset && <DocModal asset={docAsset} onClose={() => setDocAsset(null)} />}
    </section>
  );
}

/* The full brief document as the approver sees it: agent framing, every field,
   provenance (drafted, revised by directive, verified) and the original request.
   For a LIVE case the real agent's brief is loaded from the bridge — per-field
   provenance, classification, conflicts and the generated .docx — so the
   Campaign Lead reviews the actual document, not the studio's mirror. */

const LIVE_FIELD_LABELS: Record<string, string> = {
  objective: "Objective", offer_topic: "Offer or topic", business_unit: "Business unit",
  vertical: "Vertical", target_segment: "Target segment", budget_flag: "Budget",
  timeline_start: "Window start", timeline_end: "Window end", owner: "Owner",
  channels: "Channels",
};

function BriefReview({ campaign, liveCaseId }: { campaign: Campaign; liveCaseId?: string }) {
  const { state, now, openTrace } = useStore();
  const [live, setLive] = useState<LiveCaseDetail | null>(null);
  const [liveUnavailable, setLiveUnavailable] = useState(false);
  useEffect(() => {
    if (!liveCaseId) return;
    let cancelled = false;
    liveApi.getCase(liveCaseId)
      .then((d) => { if (!cancelled) setLive(d); })
      .catch(() => { if (!cancelled) setLiveUnavailable(true); });
    return () => { cancelled = true; };
  }, [liveCaseId]);

  const events = state.events.filter((e) => e.campaignId === campaign.id);
  const drafted = events.find((e) => e.activity === "draft_brief");
  const validated = events.find((e) => e.activity === "validate_brief");
  const revisions = events.filter((e) => e.activity === "revise_brief");
  const finalised = [...events].reverse().find((e) => e.activity === "brief_finalised");
  const verifier = finalised?.actor.personId ? personById(state, finalised.actor.personId) : undefined;
  const provTrace = finalised ?? drafted ?? validated;
  const requester = personById(state, campaign.requesterId);

  const liveBrief = live?.case.brief ?? null;
  const docUrl = liveApi.docUrl(live?.summary.doc_ref);
  const classification = liveBrief?.classification ?? null;

  const rows: [string, string][] = [
    ["Objective", campaign.objective],
    ["Offer or topic", campaign.topic],
    ["Business unit", campaign.bu],
    ["Vertical", campaign.vertical || "Not set"],
    ["Target segment", campaign.segment || "Not set"],
    ["Budget", campaign.budgetApproved ? "Approved" : "Not approved"],
    ["Campaign window", campaign.window.start ? `${campaign.window.start} to ${campaign.window.end || "open"}` : "Not set"],
    ["Campaign type", campaign.campaignType],
    ["Channels", campaign.channels.join(" + ")],
  ];

  return (
    <div className="brief-review">
      <div className="brief-review-doc">
        <p className="doc-kicker">{campaign.bu} · {campaign.vertical || "Vertical not set"}</p>
        <h3 className="brief-review-title">{campaign.name}</h3>
        {docUrl && (
          <a className="brief-doc-link" href={docUrl} target="_blank" rel="noreferrer">
            <FileText size={17} />
            <span>
              <strong>Open the agent-generated brief (.docx)</strong>
              <small>The exact document the agent wrote to the workspace — what you approve is what is filed</small>
            </span>
            <CaretRight size={14} />
          </a>
        )}
        <p className="brief-framing">{briefFraming(campaign)}</p>
        {liveBrief ? (
          <>
            <p className="meta-label">Brief v{liveBrief.version} as drafted by the agent · provenance on every field</p>
            <div className="brief-grid live-fields">
              {liveBrief.fields
                .filter((f) => f.name in LIVE_FIELD_LABELS)
                .map((f) => (
                  <div key={f.name}>
                    <small>{LIVE_FIELD_LABELS[f.name]}</small>
                    <strong>{f.value || "—"}</strong>
                    <em className="field-provenance">{f.provenance}</em>
                  </div>
                ))}
            </div>
            {classification && (
              <p className="brief-classification">
                Classified by the agent: <strong>{classification.campaign_type.replace(/_/g, " ")}</strong> ·{" "}
                <strong>{classification.priority}</strong> priority · channels{" "}
                {classification.channel_mix.join(", ")} · {classification.segment_relevance}
              </p>
            )}
            {(liveBrief.conflicts?.length ?? 0) > 0 && (
              <p className="brief-conflicts">
                <Warning size={13} /> The agent flagged {liveBrief.conflicts.length} calendar
                conflict{liveBrief.conflicts.length > 1 ? "s" : ""}:{" "}
                {liveBrief.conflicts.map((c) => `${c.conflicting_campaign_id} (${c.rationale})`).join(" · ")}
              </p>
            )}
          </>
        ) : (
          <>
            {liveCaseId && liveUnavailable && (
              <p className="brief-live-note">Live document unavailable (agent bridge offline) — showing the studio's mirrored summary. Start the bridge and reopen this task for the full brief.</p>
            )}
            <div className="brief-grid">
              {rows.map(([k, v]) => <div key={k}><small>{k}</small><strong>{v}</strong></div>)}
            </div>
          </>
        )}
      </div>
      <div className="brief-provenance">
        <Monogram size="sm">CI</Monogram>
        <div>
          <strong>{drafted ? `Drafted by Campaign Identification from ${requester?.name.split(" ")[0] ?? "the requester"}'s request` : "Validated by Campaign Identification, 9 of 9 required fields"}</strong>
          <small>
            Brief {campaign.briefVersion ?? "v1.0"}
            {revisions.length > 0 ? ` · ${revisions.length} revision${revisions.length > 1 ? "s" : ""} by Marketing Lead directive` : ""}
            {verifier && finalised ? ` · verified and sent by ${verifier.name}, ${stampTime(finalised.ts, now)}` : ""}
          </small>
        </div>
        {provTrace && <button className="trace-link" onClick={() => openTrace(provTrace.trace_id)}>Trace</button>}
      </div>
      {campaign.request && (
        <div className="brief-request">
          <small>Original request from {requester?.name ?? "the requester"}</small>
          <p>"{campaign.request}"</p>
        </div>
      )}
    </div>
  );
}

const FEEDBACK_ASPECTS = ["Tone", "Factual accuracy", "Length", "CTA", "Audience fit"];

function ReviewDetail({ task }: { task: Task }) {
  const { state, actions } = useStore();
  const campaign = state.campaigns.find((c) => c.id === task.campaignId)!;
  const asset = task.assetId ? state.assets.find((a) => a.id === task.assetId) : undefined;
  const [requesting, setRequesting] = useState(false);
  const [aspects, setAspects] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const isRevision = (asset?.versions.length ?? 0) > 1;

  function toggleAspect(a: string) {
    setAspects((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
    setError("");
  }
  function sendFeedback(e: FormEvent) {
    e.preventDefault();
    if (aspects.length === 0) { setError("Pick at least one aspect so the agent knows what to change."); return; }
    actions.requestChanges(task.id, aspects, note.trim() || "See selected aspects");
  }

  return (
    <section className="approval-detail">
      <div className="approval-detail-head"><div><div className="title-line"><h2>{task.title}</h2>{asset && <AssetStateChip state={asset.state} />}</div><p>{campaign.name} · {task.detail}</p></div></div>
      <div className="gap-body">
        {asset ? <DocView asset={asset} /> : (
          <div className="brief-grid"><div><small>Objective</small><strong>{campaign.objective}</strong></div><div><small>Vertical</small><strong>{campaign.vertical}</strong></div><div><small>Window</small><strong>{campaign.window.start} to {campaign.window.end}</strong></div></div>
        )}
        <div className="agent-recommendation"><Monogram size="sm">{isRevision ? "CR" : "CO"}</Monogram><div><p className="meta-label">Why this is in front of you</p><p className="gate-why">{isRevision
          ? "Content Repurposing revised this document from your structured feedback; the change note above states exactly what it did. Compare versions with the tabs, then confirm or send it back again."
          : "The Collaboration agent staged this document for your review, in the platform. Confirm it, or request changes with structured feedback and the agent revises it; either way your identity is recorded and agents can never confirm content."}</p></div></div>
      </div>
      <div className="decision-footer">
        {requesting && asset ? (
          <form className="directive-composer" onSubmit={sendFeedback}>
            <div className="directive-head">
              <Monogram size="sm">CR</Monogram>
              <div>
                <strong>Directive to Content Repurposing</strong>
                <small>Routed as the agent's revision instruction on {asset.version} · recorded with your identity in the telemetry log</small>
              </div>
            </div>
            <div>
              <p className="meta-label">What should change?</p>
              <div className="aspect-row">
                {FEEDBACK_ASPECTS.map((a) => (
                  <button type="button" key={a} className={`aspect-pill${aspects.includes(a) ? " active" : ""}`} aria-pressed={aspects.includes(a)} onClick={() => toggleAspect(a)}>{a}</button>
                ))}
              </div>
            </div>
            <div className="field"><label htmlFor="feedback-note">Instruction (optional, type or dictate)</label><div className="input-with-mic"><input id="feedback-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. opening reads too formal for this channel" /><MicButton onText={(t) => setNote((prev) => prev ? `${prev} ${t}` : t)} /></div></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="directive-foot">
              <small>Sourced claims stay locked; the agent revises language, never evidence.</small>
              <div className="feedback-actions">
                <button type="button" className="text-button" onClick={() => { setRequesting(false); setError(""); }}>Cancel</button>
                <button type="submit" className="primary-button"><PaperPlaneTilt size={15} /> Send directive</button>
              </div>
            </div>
          </form>
        ) : (
          <>
            <div><small>Your decision is recorded with identity, timestamp, {asset ? `version ${asset.version} and its content hash` : "asset version and content hash"}.</small></div>
            {asset && <button className="secondary-button" onClick={() => setRequesting(true)}>Request changes</button>}
            <button className="primary-button" onClick={() => actions.completeReview(task.id)}><Check size={15} weight="bold" /> Confirm content{asset ? ` (${asset.version})` : ""}</button>
          </>
        )}
      </div>
    </section>
  );
}

function AssetListPanel({ campaignId, onOpen }: { campaignId: string; onOpen: (a: Asset) => void }) {
  const { state } = useStore();
  const assets = state.assets.filter((a) => a.campaignId === campaignId);
  if (assets.length === 0) return null;
  return (
    <div>
      <p className="meta-label">Read the content · {assets.length} documents in the campaign workspace</p>
      <div className="asset-open-list">
        {assets.map((a) => (
          <button key={a.id} onClick={() => onOpen(a)} title={`Open ${a.name}`}>
            <span className="file-icon"><FileText size={13} /></span>
            <span className="asset-open-name"><strong>{a.name}</strong><small>{a.version} · hash <code>{a.hash}</code></small></span>
            <AssetStateChip state={a.state} />
            <CaretRight size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}

function DecisionFooter({ task, cta, onDecide, allowReturn, onReturn, busy }: { task: Task; cta: string; onDecide: () => void; allowReturn?: boolean; onReturn?: (note: string) => void; busy?: boolean }) {
  const { actions } = useStore();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const submitReturn = (text: string) => (onReturn ? onReturn(text) : actions.returnBrief(task.id, text));
  return (
    <div className="decision-footer">
      {returning ? (
        <form className="return-form" onSubmit={(e: FormEvent) => { e.preventDefault(); if (note.trim() && !busy) { submitReturn(note.trim()); } }}>
          <div className="field"><label htmlFor="return-note">Note to the requester (type or dictate)</label><div className="input-with-mic"><input id="return-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs to change before approval?" /><MicButton onText={(t) => setNote((prev) => prev ? `${prev} ${t}` : t)} /></div></div>
          <button type="submit" className="secondary-button" disabled={!note.trim() || busy} aria-busy={busy}>{busy ? <><span className="btn-spinner" aria-hidden="true" /> Sending back…</> : "Send back"}</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => setReturning(false)}>Cancel</button>
        </form>
      ) : (
        <>
          <div><small>Your decision is recorded with identity, timestamp, asset version and content hash.</small>{allowReturn && <button className="text-button" disabled={busy} onClick={() => setReturning(true)}>Return with note</button>}</div>
          <button className="primary-button" onClick={onDecide} disabled={busy} aria-busy={busy}>{busy ? <span className="btn-spinner" aria-hidden="true" /> : <Check size={15} weight="bold" />} {cta}</button>
        </>
      )}
    </div>
  );
}

function ConflictDetail({ task }: { task: Task }) {
  const { state, actions } = useStore();
  const campaign = state.campaigns.find((c) => c.id === task.campaignId)!;
  const jen = personById(state, "jen")!;
  const marcus = personById(state, "marcus")!;
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  return (
    <section className="approval-detail">
      <div className="approval-detail-head"><div><div className="title-line"><h2>Executive LinkedIn post</h2><Chip tone="amber">Decision needed</Chip></div><p>{campaign.name} · Version 1.2, public asset</p></div></div>
      <div className="review-context">
        <div className="reviewers-block"><p className="meta-label">Conflicting feedback</p>
          <article><Avatar initials={jen.initials} /><div><strong>{jen.name} · {jen.role}</strong><p>Lead with the operational reality. It feels credible and gives the audience a useful starting point.</p></div></article>
          <article><Avatar initials={marcus.initials} /><div><strong>{marcus.name} · {marcus.role}</strong><p>Lead with the outcome. Executives need to understand the value before the implementation context.</p></div></article>
        </div>
        <div className="agent-recommendation"><Monogram size="sm">CO</Monogram><div><p className="meta-label">Agent recommendation</p><strong>Use an outcome-led opening, anchored immediately by operational evidence.</strong><p>This retains Marcus’s executive framing while preserving Jen’s credibility concern. No sourced claim changes are required. The agent surfaces and recommends; it never adjudicates.</p><div className="source-row"><MiniSource>Feedback round 2</MiniSource><MiniSource>Brief v1.2</MiniSource></div></div></div>
      </div>
      <div className="compliance-summary"><div className="panel-heading"><div><p className="meta-label">Automated gate</p><h2>Compliance report</h2></div><Chip tone="green">0 blocking · 1 advisory</Chip></div>
        <div className="checks-row"><span><Check size={13} weight="bold" /> Sourced claims</span><span><Check size={13} weight="bold" /> BC / F&amp;O separation</span><span><Check size={13} weight="bold" /> Copilot scope</span><span><Check size={13} weight="bold" /> Brand terminology</span></div>
        <div className="advisory"><span className="advisory-icon"><Warning size={14} /></span><div><strong>TONE-04, advisory</strong><p>Opening may read as implementation-first for an executive audience. Consider leading with the business outcome.</p></div><Chip>Advisory only</Chip></div>
      </div>
      <div className="decision-footer">
        {returning ? (
          <form className="return-form" onSubmit={(e: FormEvent) => { e.preventDefault(); if (note.trim()) actions.decideConflict(task.id, "returned", note.trim()); }}>
            <div className="field"><label htmlFor="conflict-note">Note to reviewers (type or dictate)</label><div className="input-with-mic"><input id="conflict-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the next revision address?" /><MicButton onText={(t) => setNote((prev) => prev ? `${prev} ${t}` : t)} /></div></div>
            <button type="submit" className="secondary-button" disabled={!note.trim()}>Send back</button>
            <button type="button" className="text-button" onClick={() => setReturning(false)}>Cancel</button>
          </form>
        ) : (
          <>
            <div><small>Your decision is recorded with identity, timestamp, asset version and content hash, then packaging and compliance run automatically.</small><button className="text-button" onClick={() => setReturning(true)}>Return with note</button></div>
            <button className="secondary-button" onClick={() => actions.decideConflict(task.id, "operational")}>Choose Jen’s direction</button>
            <button className="primary-button" onClick={() => actions.decideConflict(task.id, "recommended")}>Use recommended direction</button>
          </>
        )}
      </div>
    </section>
  );
}

function GapsDetail({ task }: { task: Task }) {
  const { state, actions } = useStore();
  const campaign = state.campaigns.find((c) => c.id === task.campaignId)!;
  const [segment, setSegment] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState("");
  function send(e: FormEvent) {
    e.preventDefault();
    if (!segment || !budget) { setError("Answer both questions so the brief can re-validate."); return; }
    actions.answerGaps(task.id, segment, budget);
  }
  return (
    <section className="approval-detail">
      <div className="approval-detail-head"><div><div className="title-line"><h2>{campaign.name} brief</h2><Chip tone="amber">Awaiting input</Chip></div><p>Submitted by you · the agent holds the brief in <code>awaiting_input</code></p></div></div>
      <div className="gap-body">
        <div><p className="meta-label">Validated so far</p><div className="brief-grid"><div><small>Objective</small><strong>{campaign.objective}</strong></div><div><small>Business unit</small><strong>{campaign.bu}</strong></div><div><small>Vertical</small><strong>{campaign.vertical}</strong></div><div><small>Channels</small><strong>{campaign.channels.join(" + ")}</strong></div><div><small>Window</small><strong>{campaign.window.start} to {campaign.window.end}</strong></div><div><small>Owner</small><strong>{personById(state, campaign.ownerId)?.name}</strong></div></div></div>
        <div className="agent-recommendation">
          <Monogram size="sm">CI</Monogram>
          <div className="gap-form-wrap">
            <p className="meta-label">Gap request from Campaign Identification</p>
            <strong>Two required fields are missing. The agent never infers them.</strong>
            <form className="gap-form" onSubmit={send} noValidate>
              <div className="field"><label htmlFor="gap-segment">Which target segment is this campaign for?</label><select id="gap-segment" value={segment} onChange={(e) => setSegment(e.target.value)}><option value="">Select…</option><option>Type 3</option><option>Type 4</option><option>Standard</option></select></div>
              <div className="field"><label htmlFor="gap-budget">Is budget approved for external production?</label><select id="gap-budget" value={budget} onChange={(e) => setBudget(e.target.value)}><option value="">Select…</option><option>Yes</option><option>No</option><option>Not yet, pending Q3 review</option></select></div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="gap-actions"><small>Answers go straight back to the agent; the brief re-validates and routes to Marcus Webb for approval.</small><button type="submit" className="primary-button"><PaperPlaneTilt size={15} /> Send answers</button></div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChainPanel({ campaignId }: { campaignId: string }) {
  const { state, now } = useStore();
  const chain = state.approvals.filter((a) => a.campaignId === campaignId).sort((a, b) => a.at - b.at);
  const campaign = state.campaigns.find((c) => c.id === campaignId);
  if (!campaign) return null;
  return (
    <section className="approval-chain">
      <div><h2>Human authority remains visible</h2><p>{chain.length === 0 ? "No human approvals recorded yet for this campaign." : `The recorded approval chain for ${campaign.name}. Every entry carries identity, role, timestamp and hash.`}</p></div>
      <div className="chain-flow">
        {chain.length === 0 && <p className="chain-empty">Approvals appear here the moment they are recorded.</p>}
        {chain.map((a, i) => {
          const person = personById(state, a.byId);
          return (
            <span className="chain-person complete" key={a.id}>
              {i > 0 && <i className="chain-sep" aria-hidden="true"><CaretRight size={12} /></i>}
              <Avatar initials={person?.initials ?? "?"} />
              <b>{a.action}</b>
              <small>{person?.name} · {stampTime(a.at, now)}</small>
              <code className="chain-hash">{a.hash}</code>
            </span>
          );
        })}
      </div>
      <Menu label={<span className="icon-button" aria-hidden="true"><DotsThree size={18} weight="bold" /></span>}>
        <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(chain, null, 2))}>Copy chain as JSON</button>
      </Menu>
    </section>
  );
}
