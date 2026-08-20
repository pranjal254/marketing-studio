import { useState, type ReactNode } from "react";
import { ArrowRight, CalendarBlank, CaretRight, ListChecks, Package, Plus, Robot, SealCheck, SquaresFour } from "@phosphor-icons/react";
import { computeKpis, campaignCost, openTasksFor, personById, slaInfo, useStore } from "../store";
import { roleTypes, stampTime } from "../data";
import { useNav } from "../nav";
import { Avatar, CampaignStateChip, Chip, EventLine, Modal, Monogram, ProgressSteps } from "../ui";
import type { Task } from "../types";

const taskChipTone = (task: Task): "amber" | "blue" => (task.kind === "conflict" || task.kind === "gaps" ? "amber" : "blue");

type Tile = { key: string; label: string; value: string; sub: string; formula: string };

export default function HomeScreen() {
  const { state, now, viewer } = useStore();
  const { go } = useNav();
  const [explain, setExplain] = useState<Tile | null>(null);
  const kpis = computeKpis(state);
  const myTasks = openTasksFor(state, viewer.id);
  const inFlight = state.campaigns.filter((c) => c.state !== "approved_locked").sort((a, b) => b.step - a.step);
  const recent = [...state.events].sort((a, b) => b.ts - a.ts).slice(0, 4);
  const role = viewer.role;
  const gate = roleTypes.find((r) => r.name === role)?.gate ?? "";

  const greeting = new Date(now).getHours() < 12 ? "Good morning" : new Date(now).getHours() < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const orgTiles: Tile[] = [
    { key: "agent", label: "Agent-executed", value: `${kpis.agentExecutedPct}%`, sub: `${kpis.systemActivities} of ${kpis.totalActivities} activities`, formula: "System-executed telemetry activities divided by all activities in the event log. Reminder and escalation pings are excluded. Click any activity in the feed below to see its full trace." },
    { key: "firstpass", label: "First-pass approval", value: `${kpis.firstPassPct}%`, sub: `${kpis.gatePasses} of ${kpis.gateTotal} runs, no blocking findings`, formula: "Quality Gate compliance runs that finished with zero blocking findings, divided by all compliance runs in the log. Advisory findings do not count against precision." },
    { key: "cycle", label: "Cycle time saved", value: `${kpis.cycleHoursSaved}h`, sub: "vs pilot manual baseline", formula: "System-executed activities × 33 minutes, the measured manual median for the same activities in the pilot baseline." },
    { key: "cost", label: "AI cost / campaign", value: `$${kpis.avgCost.toFixed(2)}`, sub: `Across ${kpis.costCampaigns} campaigns in production`, formula: "Sum of cost_usd across each campaign's telemetry events, averaged over campaigns that reached content production. The envelope is $6.00." },
  ];

  const myApprovals = state.approvals.filter((a) => a.byId === viewer.id);
  const touched = new Set(state.tasks.filter((t) => t.assigneeId === viewer.id).map((t) => t.campaignId)).size;
  const nextSla = myTasks[0] ? slaInfo(myTasks[0], now) : null;
  const personalTiles: Tile[] = [
    { key: "open", label: "Open for you", value: String(myTasks.length), sub: myTasks[0] ? myTasks[0].title : "Queue is clear", formula: "Open tasks in the shared queue where you are the assignee. Reassignments move a task out of this count immediately." },
    { key: "due", label: "Next due", value: nextSla ? nextSla.remaining.replace(" remaining", "") : "None", sub: myTasks[0] ? `SLA ${myTasks[0].slaHours}h window` : "No SLA running against you", formula: "SLA countdown on your oldest open task: the task's SLA window minus the time since it was routed to you. Reminder pings go out at 50% and 90% of the window." },
    { key: "decisions", label: "Your decisions", value: String(myApprovals.length), sub: "Recorded in the approval chain", formula: "Approval-chain records where you are the recorded actor. Each carries the artifact version and content hash it applied to, so a decision can never silently apply to changed content." },
    { key: "touch", label: "Campaigns you touch", value: String(touched), sub: "Via tasks routed to you", formula: "Distinct campaigns that have routed at least one task to you, open or completed." },
  ];

  let lede: string;
  let tiles: Tile[];
  let actions: ReactNode;
  let showNeeds = true;
  if (role === "BU Campaign Lead") {
    lede = "Briefs to approve and packages to sign off. Your gate opens and closes every campaign.";
    tiles = orgTiles;
    actions = (<>
      <button className="primary-button" onClick={() => go("approvals")}><SealCheck size={16} weight="bold" /> Open approvals{myTasks.length > 0 ? ` (${myTasks.length})` : ""}</button>
      <button className="outline-button" onClick={() => go("campaigns")}><SquaresFour size={16} /> View campaigns</button>
    </>);
  } else if (role === "Content Writer") {
    lede = "Flagship confirmations and reviews routed to you, and the campaigns behind them.";
    tiles = personalTiles;
    actions = (<>
      <button className="primary-button" onClick={() => go("approvals")}><SealCheck size={16} weight="bold" /> Open your reviews{myTasks.length > 0 ? ` (${myTasks.length})` : ""}</button>
      <button className="outline-button" onClick={() => go("library")}><Package size={16} /> Package library</button>
    </>);
  } else if (role === "Grammar / Quality Reviewer") {
    lede = "Final language QA routed to you after the automated compliance checks.";
    tiles = personalTiles;
    actions = (<>
      <button className="primary-button" onClick={() => go("approvals")}><SealCheck size={16} weight="bold" /> Open QA queue{myTasks.length > 0 ? ` (${myTasks.length})` : ""}</button>
      <button className="outline-button" onClick={() => go("activity")}><ListChecks size={16} /> Activity log</button>
    </>);
  } else if (role === "AiCoE Admin") {
    lede = "Fleet health, guardrails and cost across the agent estate. You govern agents, not campaign content.";
    tiles = orgTiles;
    actions = (<>
      <button className="primary-button" onClick={() => go("agents")}><Robot size={16} weight="bold" /> Agent operations</button>
      <button className="outline-button" onClick={() => go("activity")}><ListChecks size={16} /> Activity log</button>
    </>);
  } else if (role === "Viewer") {
    lede = "Read-only view of campaigns, packages and outcomes.";
    tiles = orgTiles;
    showNeeds = false;
    actions = (<button className="outline-button" onClick={() => go("campaigns")}><SquaresFour size={16} /> View campaigns</button>);
  } else {
    lede = "Here's what needs your attention across Marketing.";
    tiles = orgTiles;
    actions = (<>
      <button className="primary-button" onClick={() => go("intake")}><Plus size={16} weight="bold" /> New campaign request</button>
      <button className="outline-button" onClick={() => go("rollout")}><CalendarBlank size={16} /> View agent workflow</button>
    </>);
  }

  return (
    <div className="screen-content home-screen">
      <section className="welcome-row">
        <div><p className="meta-label">{dateLabel} · {role}</p><h1>{greeting}, {viewer.name.split(" ")[0]}</h1><p className="lede">{lede}</p></div>
        <div className="welcome-actions">{actions}</div>
      </section>

      <section className="kpi-band" aria-label={tiles === orgTiles ? "Campaign KPIs" : "Your workload"}>
        {tiles.map((tile) => (
          <button className="kpi-tile" key={tile.key} onClick={() => setExplain(tile)} title="How is this computed?">
            <p>{tile.label}</p><strong>{tile.value}</strong><small>{tile.sub}</small>
          </button>
        ))}
      </section>
      {explain && (
        <Modal title={explain.label} onClose={() => setExplain(null)}>
          <p className="explain-value">{explain.value}</p>
          <p>{explain.formula}</p>
          <p className="explain-note">Computed live from {state.events.length} telemetry events (STS v1.1) and the shared task queue. It changes as you act in the app.</p>
        </Modal>
      )}

      {showNeeds && (
        <>
          <div className="section-heading"><div><h2>Needs you</h2><p>Your gate: {gate}</p></div><button onClick={() => go("approvals")}>View all <ArrowRight size={13} /></button></div>
          {myTasks.length === 0 ? (
            <section className="empty-panel"><h3>Nothing needs you right now</h3><p>Agents are executing. New decisions will appear here and in your notifications.</p></section>
          ) : (
            <section className="needs-grid">
              {myTasks.slice(0, 2).map((task) => {
                const campaign = state.campaigns.find((c) => c.id === task.campaignId);
                return (
                  <article className="need-card" key={task.id}>
                    <div className="card-top"><Chip tone={taskChipTone(task)}>{task.kind === "gaps" ? "Awaiting your input" : task.kind === "conflict" ? "Due today" : "Decision"}</Chip><span className="card-age">{stampTime(task.createdAt, now)}</span></div>
                    <div className="person-row"><Avatar initials={viewer.initials} /><div><p className="role-line">{viewer.role}</p><h3>{task.title}</h3></div></div>
                    <p className="card-copy">{task.detail}</p>
                    <div className="context-line">{campaign?.name}</div>
                    <div className="card-footer"><CampaignStateChip state={campaign?.state ?? "planning"} /><button onClick={() => go({ page: "approvals", taskId: task.id })}>Open task</button></div>
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}

      <div className="section-heading"><div><h2>In flight</h2><p>Campaigns moving through the workflow</p></div><button onClick={() => go("campaigns")}>View campaigns <ArrowRight size={13} /></button></div>
      <section className="campaign-list">
        {inFlight.map((c) => {
          const cost = campaignCost(state, c.id);
          const openTasks = state.tasks.filter((t) => t.campaignId === c.id && t.status === "open");
          const nextGate = openTasks[0] ? personById(state, openTasks[0].assigneeId)?.name : "Agents executing";
          return (
            <article className="campaign-row" key={c.id} onClick={() => go({ page: "campaigns", campaignId: c.id })}>
              <Monogram>{c.code}</Monogram>
              <div className="campaign-main"><div className="title-line"><h3>{c.name}</h3><CampaignStateChip state={c.state} /></div><p>{c.vertical} · {c.campaignType}</p><ProgressSteps active={c.step - 1} /></div>
              <div className="campaign-stat"><small>Current step</small><strong>{["", "Intake", "Audience & offer", "Asset plan", "Drafting", "Review", "Packaging", "Compliance", "Grammar QA", "Sign-off"][c.step]}</strong><span>{c.step} of 9</span></div>
              <div className="campaign-stat"><small>Waiting on</small><strong>{nextGate}</strong><span>{cost > 0 ? `$${cost.toFixed(2)} spent` : "No spend yet"}</span></div>
              <span className="row-arrow"><CaretRight size={16} /></span>
            </article>
          );
        })}
      </section>

      <div className="section-heading"><div><h2>Just happened</h2><p>Latest telemetry, click any line for the full trace</p></div><button onClick={() => go("activity")}>Open activity log <ArrowRight size={13} /></button></div>
      <section className="activity-feed">
        {recent.map((e) => <EventLine event={e} showCampaign key={e.id} />)}
      </section>
    </div>
  );
}
