import { useState } from "react";
import { useStore } from "../store";
import { agentMeta } from "../data";
import { useNav } from "../nav";
import { EventLine } from "../ui";

export default function ActivityScreen() {
  const { state } = useStore();
  const { nav } = useNav();
  const [agentFilter, setAgentFilter] = useState(nav.agentFilter ?? "all");
  const [campaignFilter, setCampaignFilter] = useState(nav.campaignId ?? "all");
  const [query, setQuery] = useState("");

  const events = [...state.events]
    .sort((a, b) => b.ts - a.ts)
    .filter((e) => agentFilter === "all" || e.agent === agentFilter)
    .filter((e) => campaignFilter === "all" || e.campaignId === campaignFilter)
    .filter((e) => !query.trim() || `${e.summary} ${e.activity}`.toLowerCase().includes(query.trim().toLowerCase()));

  const totalCost = events.reduce((s, e) => s + e.cost_usd, 0);

  return (
    <div className="screen-content activity-screen">
      <section className="simple-page-header"><div><h1>Activity log</h1><p>The full STS v1.1 event stream. Every row opens its trace: actor, model, tokens, cost, timing and state transition.</p></div></section>
      <div className="log-filters">
        <div className="field"><label htmlFor="log-search">Search</label><input id="log-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search summaries and activities…" /></div>
        <div className="field"><label htmlFor="log-agent">Agent</label><select id="log-agent" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}><option value="all">All agents</option>{agentMeta.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}<option value="studio">Marketing Studio</option></select></div>
        <div className="field"><label htmlFor="log-campaign">Campaign</label><select id="log-campaign" value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}><option value="all">All campaigns</option>{state.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <p className="log-meta">{events.length} events · ${totalCost.toFixed(2)} total cost in view</p>
      <section className="activity-feed">
        {events.length === 0 && <div className="empty-panel embedded"><p>No events match these filters.</p></div>}
        {events.map((e) => <EventLine event={e} showCampaign key={e.id} />)}
      </section>
    </div>
  );
}
