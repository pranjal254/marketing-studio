import { ArrowRight, X } from "@phosphor-icons/react";
import type { Campaign } from "./types";
import { stampTime, toneVars } from "./data";
import { campaignCost, costByAgent, openTasksFor, personById, slaInfo, useStore } from "./store";
import { useNav } from "./nav";
import { Avatar, CampaignStateChip, Chip, Monogram, agentName } from "./ui";

/* Dockable context panel: structured cards over live telemetry, scoped to what the
   user is looking at. It answers and routes with citations (traces, hashes,
   identities); gates are cleared only in Approvals. No persona, no free prose. */

export function ContextPanel({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const { nav } = useNav();
  const campaign = nav.campaignId ? state.campaigns.find((c) => c.id === nav.campaignId) : undefined;

  return (
    <aside className="ctx-panel" aria-label="Context panel">
      <div className="ctx-head">
        <div><strong>Context</strong><small>{campaign ? campaign.name : "Workspace"}</small></div>
        <button className="icon-button" aria-label="Close context panel" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="ctx-body">
        {campaign ? <CampaignContext campaign={campaign} /> : <WorkspaceContext />}
      </div>
      <p className="ctx-foot">Every figure cites live telemetry. Decisions still happen at the gates.</p>
    </aside>
  );
}

function CampaignContext({ campaign }: { campaign: Campaign }) {
  const { state, now, openTrace } = useStore();
  const { go } = useNav();
  const openTasks = state.tasks.filter((t) => t.campaignId === campaign.id && t.status === "open");
  const cost = campaignCost(state, campaign.id);
  const events = state.events.filter((e) => e.campaignId === campaign.id);
  const latest = [...events].reverse().slice(0, 3);
  const chain = [...state.approvals].filter((a) => a.campaignId === campaign.id).sort((a, b) => b.at - a.at).slice(0, 3);
  const byAgent = new Map<string, number>();
  events.forEach((e) => { if (e.cost_usd > 0) byAgent.set(e.agent, (byAgent.get(e.agent) ?? 0) + e.cost_usd); });
  const agentRows = [...byAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <div style={toneVars(campaign.id, state.campaigns)}>
      <section className="ctx-card">
        <div className="ctx-card-head"><h3>Status</h3><CampaignStateChip state={campaign.state} /></div>
        <div className="ctx-rows">
          <div className="ctx-row"><span>Journey</span><strong>{campaign.state === "approved_locked" ? "Complete" : `Step ${campaign.step} of 9`}</strong></div>
          {openTasks[0] ? (() => {
            const sla = slaInfo(openTasks[0], now);
            const person = personById(state, openTasks[0].assigneeId);
            return (
              <>
                <div className="ctx-row"><span>Waiting on</span><strong>{person?.name}</strong></div>
                <div className="ctx-row"><span>Gate</span><strong>{openTasks[0].title}</strong></div>
                <div className="ctx-row"><span>Turnaround</span><strong>{sla.level === "escalated" ? "Escalated" : sla.remaining === "overdue" ? "Overdue" : sla.remaining.replace("due in", "Due in")}</strong></div>
              </>
            );
          })() : (
            <div className="ctx-row"><span>Waiting on</span><strong>{campaign.state === "approved_locked" ? "Nobody, locked" : "Agents executing"}</strong></div>
          )}
        </div>
      </section>

      <section className="ctx-card">
        <div className="ctx-card-head"><h3>AI cost</h3><strong className="ctx-money">${cost.toFixed(2)}</strong></div>
        <div className="ctx-rows">
          {agentRows.map(([agent, c]) => (
            <div className="ctx-row" key={agent}><span>{agentName(agent as Parameters<typeof agentName>[0])}</span><strong>${c.toFixed(2)}</strong></div>
          ))}
        </div>
        <small className="ctx-cite">{events.length} events · within the $6.00 envelope</small>
      </section>

      <section className="ctx-card">
        <div className="ctx-card-head"><h3>Approval chain</h3><button className="text-link" onClick={() => go("approvals")}>All <ArrowRight size={11} /></button></div>
        {chain.length === 0 && <p className="ctx-empty">No human approvals recorded yet.</p>}
        {chain.map((a) => {
          const person = personById(state, a.byId);
          return (
            <div className="ctx-approval" key={a.id}>
              <Avatar initials={person?.initials ?? "?"} />
              <span><strong>{a.action}</strong><small>{person?.name} · {stampTime(a.at, now)} · <code>{a.hash}</code></small></span>
            </div>
          );
        })}
      </section>

      <section className="ctx-card">
        <div className="ctx-card-head"><h3>Latest runs</h3><button className="text-link" onClick={() => go({ page: "activity", campaignId: campaign.id })}>Log <ArrowRight size={11} /></button></div>
        {latest.map((e) => (
          <button className="ctx-run" key={e.id} onClick={() => openTrace(e.trace_id)} title="Open trace">
            <Monogram size="sm">{e.agent === "studio" ? "MS" : e.agent}</Monogram>
            <span><strong>{e.summary}</strong><small>{stampTime(e.ts, now)} · trace <code>{e.trace_id}</code></small></span>
          </button>
        ))}
      </section>
    </div>
  );
}

function WorkspaceContext() {
  const { state, now, viewer, openTrace } = useStore();
  const { go } = useNav();
  const myTasks = openTasksFor(state, viewer.id);
  const digest = state.events.filter((e) => e.actor.type !== "human" && e.ts >= now - 7 * 86400000);
  const digestCost = digest.reduce((s, e) => s + e.cost_usd, 0);
  const escalated = state.tasks.filter((t) => t.status === "open" && t.escalated);
  const fleet = costByAgent(state).slice(0, 4);
  const latest = [...state.events].reverse().slice(0, 3);

  return (
    <div>
      <section className="ctx-card">
        <div className="ctx-card-head"><h3>Your queue</h3><Chip tone={myTasks.length > 0 ? "amber" : "green"}>{myTasks.length} open</Chip></div>
        {myTasks.length === 0 && <p className="ctx-empty">Nothing waits on {viewer.name.split(" ")[0]}.</p>}
        {myTasks.slice(0, 3).map((t) => (
          <button className="ctx-run" key={t.id} onClick={() => go({ page: "approvals", taskId: t.id })}>
            <span><strong>{t.title}</strong><small>{state.campaigns.find((c) => c.id === t.campaignId)?.name} · {slaInfo(t, now).remaining}</small></span>
          </button>
        ))}
      </section>

      <section className="ctx-card">
        <div className="ctx-card-head"><h3>Agents, last 7 days</h3><strong className="ctx-money">${digestCost.toFixed(2)}</strong></div>
        <div className="ctx-rows">
          <div className="ctx-row"><span>Activities executed</span><strong>{digest.length}</strong></div>
          <div className="ctx-row"><span>Campaigns touched</span><strong>{new Set(digest.map((e) => e.campaignId)).size}</strong></div>
          <div className="ctx-row"><span>Escalated to humans</span><strong>{digest.filter((e) => e.outcome === "escalated").length}</strong></div>
        </div>
      </section>

      {escalated.length > 0 && (
        <section className="ctx-card">
          <div className="ctx-card-head"><h3>Escalations</h3><Chip tone="red">{escalated.length}</Chip></div>
          {escalated.map((t) => (
            <button className="ctx-run" key={t.id} onClick={() => go(t.assigneeId === viewer.id ? { page: "approvals", taskId: t.id } : "approvals")}>
              <span><strong>{t.title}</strong><small>{state.campaigns.find((c) => c.id === t.campaignId)?.name} · {personById(state, t.assigneeId)?.name}</small></span>
            </button>
          ))}
        </section>
      )}

      <section className="ctx-card">
        <div className="ctx-card-head"><h3>Fleet cost</h3><button className="text-link" onClick={() => go("agents")}>Agents <ArrowRight size={11} /></button></div>
        <div className="ctx-rows">
          {fleet.map(({ agent, cost }) => (
            <div className="ctx-row" key={agent}><span>{agentName(agent as Parameters<typeof agentName>[0])}</span><strong>${cost.toFixed(2)}</strong></div>
          ))}
        </div>
      </section>

      <section className="ctx-card">
        <div className="ctx-card-head"><h3>Latest runs</h3><button className="text-link" onClick={() => go("activity")}>Log <ArrowRight size={11} /></button></div>
        {latest.map((e) => (
          <button className="ctx-run" key={e.id} onClick={() => openTrace(e.trace_id)} title="Open trace">
            <Monogram size="sm">{e.agent === "studio" ? "MS" : e.agent}</Monogram>
            <span><strong>{e.summary}</strong><small>{stampTime(e.ts, now)} · trace <code>{e.trace_id}</code></small></span>
          </button>
        ))}
      </section>
    </div>
  );
}
