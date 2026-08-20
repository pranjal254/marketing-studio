import { useState } from "react";
import { ArrowRight, ArrowUpRight, CaretRight, Check, Clock, FileText } from "@phosphor-icons/react";
import { campaignCost, openTasksFor, personById, useStore } from "../store";
import { flagshipDoc, journeySteps, phaseLabels, relTime, toneVars } from "../data";
import { useNav } from "../nav";
import { AssetStateChip, Avatar, CampaignStateChip, Chip, DocModal, MiniSource, Monogram, ProgressSteps, agentName } from "../ui";
import type { Asset, Campaign } from "../types";

export default function CampaignsScreen() {
  const { state, now } = useStore();
  const { nav, go } = useNav();
  const selected = nav.campaignId ? state.campaigns.find((c) => c.id === nav.campaignId) : undefined;
  if (selected) return <CampaignDetail campaign={selected} />;

  const ordered = [...state.campaigns].sort((a, b) => (a.state === "approved_locked" ? 1 : 0) - (b.state === "approved_locked" ? 1 : 0) || b.step - a.step);
  return (
    <div className="screen-content campaigns-screen">
      <section className="simple-page-header"><div><h1>Campaigns</h1><p>Every campaign in the workspace, color-coded, with its journey position, live cost and what the agents did last.</p></div></section>
      <section className="campaign-listing">
        {ordered.map((c) => {
          const cost = campaignCost(state, c.id);
          const open = state.tasks.filter((t) => t.campaignId === c.id && t.status === "open");
          const owner = personById(state, c.ownerId);
          const latest = [...state.events].reverse().find((e) => e.campaignId === c.id);
          return (
            <article className="campaign-line" key={c.id} style={toneVars(c.id, state.campaigns)} role="button" tabIndex={0}
              onClick={() => go({ page: "campaigns", campaignId: c.id })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go({ page: "campaigns", campaignId: c.id }); } }}>
              <span className="line-dot" aria-hidden="true" />
              <Monogram size="lg">{c.code}</Monogram>
              <div className="line-main">
                <h3>{c.name}</h3>
                <p>{c.vertical} · {c.campaignType}</p>
                <CampaignStateChip state={c.state} />
              </div>
              <div className="line-journey">
                <small>Journey</small>
                <strong>{c.state === "approved_locked" ? "Complete" : `Step ${c.step} of 9`}</strong>
                <ProgressSteps active={c.state === "approved_locked" ? 9 : c.step - 1} />
              </div>
              <div className="line-col">
                <small>Waiting on</small>
                <strong>{open.length === 0 ? (c.state === "approved_locked" ? "Nobody" : "Agents") : personById(state, open[0].assigneeId)?.name.split(" ")[0]}</strong>
              </div>
              <div className="line-col">
                <small>AI cost</small>
                <strong>${cost.toFixed(2)}</strong>
              </div>
              <div className="line-agent">
                {latest && (
                  <>
                    <span className="line-agent-name"><i aria-hidden="true" />{agentName(latest.agent)}</span>
                    <small>{relTime(latest.ts, now)}</small>
                  </>
                )}
              </div>
              <div className="line-owner">
                <Avatar size="sm" initials={owner?.initials ?? "?"} />
                <small>{owner?.name} · owner</small>
              </div>
              <span className="row-arrow"><CaretRight size={16} /></span>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function CampaignDetail({ campaign }: { campaign: Campaign }) {
  const { state, now, viewer, openTrace } = useStore();
  const { go } = useNav();
  const [tab, setTab] = useState<"journey" | "plan" | "content">("journey");
  const [docAsset, setDocAsset] = useState<Asset | null>(null);
  const cost = campaignCost(state, campaign.id);
  const assets = state.assets.filter((a) => a.campaignId === campaign.id);
  const openTasks = state.tasks.filter((t) => t.campaignId === campaign.id && t.status === "open");
  const events = state.events.filter((e) => e.campaignId === campaign.id).sort((a, b) => b.ts - a.ts);
  const myTask = openTasksFor(state, viewer.id).find((t) => t.campaignId === campaign.id);
  const flagship = assets.find((a) => a.id.endsWith("-a0"));
  const derivatives = assets.filter((a) => !a.id.endsWith("-a0"));

  return (
    <div className="screen-content campaign-screen" style={toneVars(campaign.id, state.campaigns)}>
      <button className="breadcrumb breadcrumb-link" onClick={() => go("campaigns")}>Campaigns <CaretRight size={11} /> <span className="crumb-tone">{campaign.name}</span></button>
      <section className="campaign-header">
        <div className="campaign-title-block"><Monogram size="lg">{campaign.code}</Monogram><div><div className="title-line"><h1>{campaign.name}</h1><CampaignStateChip state={campaign.state} /></div><p>{campaign.vertical} {campaign.campaignType.toLowerCase()} · {campaign.window.start} to {campaign.window.end}</p></div></div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => { navigator.clipboard?.writeText(`${campaign.name}: step ${campaign.step} of 9, ${campaign.state.replace(/_/g, " ")}, AI cost $${cost.toFixed(2)}, ${openTasks.length} open gate(s).`); }}>Copy summary</button>
          {myTask && <button className="primary-button" onClick={() => go({ page: "approvals", taskId: myTask.id })}>Open your task</button>}
        </div>
      </section>
      <section className="campaign-summary-strip">
        <div><small>Journey progress</small><strong>{campaign.state === "approved_locked" ? "9 of 9 steps" : `${campaign.step} of 9 steps`}</strong><ProgressSteps active={campaign.state === "approved_locked" ? 9 : campaign.step - 1} /></div>
        <div><small>Content assets</small><strong>{assets.length === 0 ? "Not planned yet" : `${assets.length} registered`}</strong><span>{assets.length > 0 ? "1 flagship + 8 derivatives" : "Checklist arrives at step 3"}</span></div>
        <div><small>Waiting on</small><strong>{openTasks.length === 0 ? "Agents executing" : personById(state, openTasks[0].assigneeId)?.name}</strong><span>{openTasks.length === 0 ? "No human gate open" : openTasks[0].title}</span></div>
        <div><small>AI cost so far</small><strong>${cost.toFixed(2)}</strong><span>Within $6.00 envelope</span></div>
      </section>
      <div className="tab-bar" role="tablist">
        <button role="tab" aria-selected={tab === "journey"} className={tab === "journey" ? "active" : ""} onClick={() => setTab("journey")}>Journey</button>
        <button role="tab" aria-selected={tab === "plan"} className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>Brief &amp; plan</button>
        {assets.length > 0 && <button role="tab" aria-selected={tab === "content"} className={tab === "content" ? "active" : ""} onClick={() => setTab("content")}>Content production</button>}
      </div>

      {tab === "journey" && (
        <div className="journey-view">
          <section className="journey-phases">
            {phaseLabels.map((label, phase) => (
              <div className="phase-group" key={label}>
                <div className="phase-group-title">{label}</div>
                <div className="journey-grid">
                  {journeySteps.filter((s) => s.phase === phase).map((step) => {
                    const done = campaign.state === "approved_locked" || campaign.step > step.n;
                    const active = campaign.state !== "approved_locked" && campaign.step === step.n;
                    const stepEvents = events.filter((e) => e.ts && stepActivityMatch(step.n, e.activity));
                    return (
                      <article key={step.n} className={`journey-step ${done ? "complete" : active ? "active" : "upcoming"}`}>
                        <div className="step-top"><span className="step-num">0{step.n}</span>{done ? <Chip tone="green">Complete</Chip> : active ? <Chip tone="amber">In progress</Chip> : <Chip>Upcoming</Chip>}</div>
                        <h3>{step.title}</h3>
                        <p>{step.owner}</p>
                        <div className={`gate-line ${active ? "human" : ""}`}>
                          {active && openTasks[0] ? <Avatar initials={personById(state, openTasks[0].assigneeId)?.initials ?? "?"} /> : <span className="gate-icon">{done ? <Check size={12} weight="bold" /> : <Clock size={13} />}</span>}
                          <span className="gate-text"><small>{active ? "Waiting on" : done ? "Cleared" : "Gate"}</small><strong title={active && openTasks[0] ? personById(state, openTasks[0].assigneeId)?.name : step.gate}>{active && openTasks[0] ? personById(state, openTasks[0].assigneeId)?.name : step.gate}</strong></span>
                          {stepEvents.length > 0 && <button className="trace-link" onClick={() => openTrace(stepEvents[0].trace_id)}>Trace</button>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
          <section className="journey-detail">
            <div className="detail-agent"><Monogram>{events[0] && events[0].agent !== "studio" ? events[0].agent : "ES"}</Monogram><div><p className="meta-label">Latest activity</p><h2>{events[0]?.summary ?? "No activity yet"}</h2><p>{events[0] ? `${relTime(events[0].ts, now)} · click any journey step's Trace for the telemetry behind it.` : "Telemetry appears as soon as an agent runs."}</p></div></div>
            <div className="detail-metrics">
              <div><small>Events logged</small><strong>{events.length}</strong></div>
              <div><small>Human approvals</small><strong>{state.approvals.filter((a) => a.campaignId === campaign.id).length}</strong></div>
              <div><small>AI cost</small><strong>${cost.toFixed(2)}</strong></div>
              <button onClick={() => go({ page: "activity", campaignId: campaign.id })}>Full activity log</button>
            </div>
          </section>
        </div>
      )}

      {tab === "plan" && (
        <div className="plan-view">
          <section className="brief-card">
            <div className="panel-heading"><div><p className="meta-label">Brief · {campaign.state === "awaiting_input" ? "awaiting input" : campaign.step > 1 ? "approved" : "pending approval"}</p><h2>{campaign.objective}</h2></div>{campaign.step > 1 && <Chip tone="green">Approved by {personById(state, state.approvals.find((a) => a.campaignId === campaign.id && a.action === "Brief approved")?.byId ?? "marcus")?.name}</Chip>}</div>
            <div className="brief-grid">
              <div><small>Business unit</small><strong>{campaign.bu}</strong></div>
              <div><small>Vertical</small><strong>{campaign.vertical}</strong></div>
              <div><small>Campaign type</small><strong>{campaign.campaignType}</strong></div>
              <div><small>Primary segment</small><strong>{campaign.segment || "Not set (gap open)"}</strong></div>
              <div><small>Budget</small><strong>{campaign.budgetApproved ? "Approved" : "Not confirmed"}</strong></div>
              <div><small>Campaign window</small><strong>{campaign.window.start} to {campaign.window.end}</strong></div>
            </div>
            <div className="proof-box"><FileText size={18} /><div><strong>Offer framing</strong><p>{campaign.topic}. Grounded in LevelShift delivery experience; every claim traces to a verified source.</p></div></div>
            <div className="source-row"><MiniSource>Quarterly plan Q3</MiniSource><MiniSource>SemRush</MiniSource><MiniSource>Brand guidelines</MiniSource></div>
          </section>
          <section className="asset-plan-card">
            <div className="panel-heading"><div><p className="meta-label">Reuse before create</p><h2>Asset checklist</h2></div><span className="small-link">{assets.length || "0"} registered</span></div>
            {assets.length === 0 ? (
              <div className="empty-panel embedded"><p>The checklist is generated by Campaign-in-a-Box at step 3, after the brief is approved. Nothing to show yet, and that is the honest state.</p></div>
            ) : (
              <div className="asset-table">
                {assets.slice(0, 6).map((a) => (
                  <div key={a.id}><span className="file-icon"><FileText size={14} /></span><strong>{a.name}</strong><Chip tone={a.disposition === "Reuse" ? "green" : "neutral"}>{a.disposition}</Chip><span>{a.ownerTeam}</span></div>
                ))}
              </div>
            )}
            {assets.length > 6 && <button className="table-link" onClick={() => setTab("content")}>View all {assets.length} assets <ArrowRight size={13} /></button>}
          </section>
        </div>
      )}

      {tab === "content" && flagship && flagship.versions.length > 0 && (() => {
        const fdoc = flagship.versions[flagship.versions.length - 1].doc;
        return (
        <div className="content-view">
          <section className="flagship-panel">
            <div className="doc-toolbar"><div><span className="file-icon lg"><FileText size={16} /></span><div><strong>{fdoc.title.slice(0, 44)}…</strong><small>Flagship article {flagship.version} · <AssetStateChip state={flagship.state} /></small></div></div><button onClick={() => setDocAsset(flagship)}>Open document <ArrowUpRight size={13} /></button></div>
            <div className="document-preview">
              <p className="doc-kicker">{fdoc.kicker}</p>
              <h2>{fdoc.title}</h2>
              <p>{fdoc.body[0]}</p>
              <div className="inline-source">1 <span>{flagshipDoc.source}</span></div>
              <p>{fdoc.body[1]}</p>
            </div>
            <div className="doc-footer"><div><Avatar initials={personById(state, "jen")!.initials} /><span><strong>{flagship.state === "content_confirmed" || flagship.state === "approved" ? "Jen Cook confirmed content" : "Awaiting editorial confirmation"}</strong><small>Version {flagship.version} · hash <code>{flagship.hash}</code> · {flagship.versions.length} version{flagship.versions.length > 1 ? "s" : ""}</small></span></div><div><Chip tone="green">{flagship.claims} sourced claims</Chip></div></div>
          </section>
          <section className="derivative-panel">
            <div className="panel-heading"><div><p className="meta-label">Create once, repurpose systematically</p><h2>{derivatives.length} channel derivatives</h2></div></div>
            <p className="panel-copy">Every derivative is built from the confirmed flagship claim inventory, not from scratch. Click any document to read it, with its full version history.</p>
            <div className="derivative-list">
              {derivatives.map((a) => {
                const myTask = state.tasks.find((t) => t.assetId === a.id && t.status === "open" && t.assigneeId === viewer.id);
                return (
                  <button key={a.id} onClick={() => myTask ? go({ page: "approvals", taskId: myTask.id }) : setDocAsset(a)} title={myTask ? "Open your review task" : `Read ${a.name}`}>
                    <span className="file-icon lg"><FileText size={15} /></span>
                    <span><strong>{a.name}</strong><small>{a.state === "planned" ? "Awaiting fan-out" : `${a.version}${a.versions.length > 1 ? ` · ${a.versions.length} versions` : ""} · hash `}{a.state !== "planned" && <code>{a.hash}</code>}</small></span>
                    <AssetStateChip state={a.state} />
                    <CaretRight size={14} />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
        );
      })()}

      {docAsset && <DocModal asset={docAsset} onClose={() => setDocAsset(null)} />}
    </div>
  );
}

function stepActivityMatch(step: number, activity: string): boolean {
  const map: Record<number, string[]> = {
    1: ["validate_brief", "duplicate_check", "classify_and_draft", "route_brief_approval", "revalidate_brief", "brief_approved", "brief_returned"],
    2: ["pull_intel", "plan_campaign"],
    3: ["plan_campaign", "plan_confirmed", "reuse_scan"],
    4: ["draft_flagship", "flagship_confirmed", "fan_out"],
    5: ["stage_reviews", "consolidate_reviews", "conflict_escalation", "conflict_resolved", "review_complete", "changes_requested", "revise_draft"],
    6: ["assemble_manifest"],
    7: ["compliance_pass"],
    8: ["grammar_qa_approved", "route_signoff", "sla_reminder", "sla_escalation"],
    9: ["package_signed_off"],
  };
  return (map[step] ?? []).includes(activity);
}
