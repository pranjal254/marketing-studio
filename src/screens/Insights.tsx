import { useState } from "react";
import { CaretDown, TrendDown, TrendUp } from "@phosphor-icons/react";
import { campaignCost, computeKpis, costByAgent, useStore } from "../store";
import { scenarioPromotions, weeklyAutonomy } from "../data";
import { useNav } from "../nav";
import { Chip, Modal, Monogram, agentName } from "../ui";

export default function InsightsScreen() {
  const { state } = useStore();
  const { go } = useNav();
  const [range, setRange] = useState<12 | 4>(12);
  const [explain, setExplain] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<string | null>(null);
  const kpis = computeKpis(state);

  const weeks = weeklyAutonomy.slice(-range);
  const points = weeks.map((w, i) => ({
    x: 6 + (i * 88) / Math.max(1, weeks.length - 1),
    y: 46 - (w.rate / 100) * 40,
    ...w,
  }));
  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const rawCosts = costByAgent(state).filter((a) => a.agent !== "studio");
  const totalCost = rawCosts.reduce((s, a) => s + a.cost, 0);
  const agentCosts = [
    ...rawCosts.slice(0, 3),
    ...(rawCosts.length > 3 ? [{ agent: "other", cost: rawCosts.slice(3).reduce((s, a) => s + a.cost, 0) }] : []),
  ];
  const donutPalette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
  let acc = 0;
  const donutStops = agentCosts.map((a, i) => {
    const share = (a.cost / totalCost) * 100;
    const from = acc; acc += share;
    return `${donutPalette[i]} ${from.toFixed(1)}% ${Math.max(from, acc - 0.8).toFixed(1)}%, #fff ${Math.max(from, acc - 0.8).toFixed(1)}% ${acc.toFixed(1)}%`;
  }).join(", ");

  const producing = state.campaigns.filter((c) => campaignCost(state, c.id) > 0);
  const maxCost = Math.max(...producing.map((c) => campaignCost(state, c.id)), 6);

  const explains: Record<string, { title: string; body: string }> = {
    autonomy: { title: "Autonomy rate", body: `System-executed activities (${kpis.systemActivities}) divided by all logged activities (${kpis.totalActivities}). Excludes reminder pings. Recomputed from the event log on every action you take.` },
    override: { title: "Override rate", body: `Human decisions that went against the agent recommendation or returned work (${kpis.overrides}) divided by all recorded human decisions (${kpis.humanDecisions}). A low rate with human gates intact is the health signal, zero would mean the gates are rubber stamps.` },
    gate: { title: "Gate precision", body: `Compliance runs that were clean on the first pass (${kpis.gatePasses} of ${kpis.gateTotal}). Advisory findings do not count against precision; blocking findings do.` },
    cost: { title: "Cost per campaign", body: `Average of per-campaign cost_usd sums across ${kpis.costCampaigns} campaigns in production. The $6.00 envelope is policy from the tech-stack briefing; premium models run only where writing quality is the product.` },
  };

  return (
    <div className="screen-content insights-screen">
      <section className="simple-page-header"><div><h1>Campaign intelligence</h1><p>Every figure is computed live from {state.events.length} telemetry events. Click a metric for its formula.</p></div>
        <div className="filter-row"><button onClick={() => setRange(range === 12 ? 4 : 12)}>Last {range} weeks <CaretDown size={12} /></button></div>
      </section>

      <section className="insight-kpis">
        <button className="kpi-tile" onClick={() => setExplain("autonomy")}><small>Autonomy rate</small><strong>{kpis.agentExecutedPct}%</strong><span className="positive"><TrendUp size={12} weight="bold" /> live</span><p>{kpis.systemActivities} of {kpis.totalActivities} activities system-executed</p></button>
        <button className="kpi-tile" onClick={() => setExplain("override")}><small>Override rate</small><strong>{kpis.overridePct}%</strong><span className="positive"><TrendDown size={12} weight="bold" /> live</span><p>{kpis.overrides} of {kpis.humanDecisions} human decisions overrode the agent</p></button>
        <button className="kpi-tile" onClick={() => setExplain("gate")}><small>Gate precision</small><strong>{kpis.firstPassPct}%</strong><span className="positive"><TrendUp size={12} weight="bold" /> live</span><p>{kpis.gatePasses} of {kpis.gateTotal} compliance runs with no blocking findings</p></button>
        <button className="kpi-tile" onClick={() => setExplain("cost")}><small>Cost / campaign</small><strong>${kpis.avgCost.toFixed(2)}</strong><span className="positive">${(6 - kpis.avgCost).toFixed(2)} below cap</span><p>Averaged across {kpis.costCampaigns} producing campaigns</p></button>
      </section>
      {explain && <Modal title={explains[explain].title} onClose={() => setExplain(null)}><p>{explains[explain].body}</p></Modal>}

      <section className="chart-grid">
        <article className="chart-card large">
          <div className="panel-heading"><div><p className="meta-label">Autonomy trajectory</p><h2>More work completed independently</h2></div><Chip tone="green">Week {weeks[weeks.length - 1].week}: {weeks[weeks.length - 1].rate}%</Chip></div>
          <div className="line-chart-svg">
            <svg viewBox="0 0 100 52" preserveAspectRatio="none" aria-label={`Weekly autonomy rate from ${weeks[0].rate}% to ${weeks[weeks.length - 1].rate}%`}>
              {[25, 50, 75, 100].map((v) => <line key={v} x1="6" x2="94" y1={46 - (v / 100) * 40} y2={46 - (v / 100) * 40} className="svg-grid" />)}
              <polyline points={polyline} className="svg-line" />
              {points.map((p) => <circle key={p.week} cx={p.x} cy={p.y} r="1.4" className="svg-dot"><title>Week {p.week}: {p.rate}%</title></circle>)}
              <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2" className="svg-dot end" />
            </svg>
            <div className="x-labels">{points.filter((_, i) => i % 2 === 0 || points.length <= 6).map((p) => <span key={p.week}>W{p.week}</span>)}</div>
          </div>
          <p className="chart-foot">Weekly aggregate from the pilot telemetry archive; the live rate above continues the series.</p>
        </article>

        <article className="chart-card">
          <div className="panel-heading"><div><p className="meta-label">Cost attribution</p><h2>${totalCost.toFixed(2)} total AI spend</h2></div></div>
          <div className="cost-donut" style={{ background: `conic-gradient(${donutStops})` }} role="img" aria-label="AI cost split by agent"><div><strong>${totalCost.toFixed(2)}</strong><span>all campaigns</span></div></div>
          <div className="legend-list">
            {agentCosts.map((a, i) => (
              <span key={a.agent}><i style={{ background: donutPalette[i] }}></i>{a.agent === "other" ? "Other agents" : agentName(a.agent as never)} <b>${a.cost.toFixed(2)}</b></span>
            ))}
          </div>
        </article>

        <article className="chart-card">
          <div className="panel-heading"><div><p className="meta-label">Envelope discipline</p><h2>Cost per campaign vs $6.00 cap</h2></div></div>
          <div className="bar-rows">
            {producing.map((c) => {
              const cost = campaignCost(state, c.id);
              return (
                <div key={c.id}>
                  <span>{c.name.length > 20 ? `${c.name.slice(0, 19)}…` : c.name}</span>
                  <b><i style={{ width: `${Math.min(100, (cost / maxCost) * 100)}%` }}></i></b>
                  <em>${cost.toFixed(2)}</em>
                </div>
              );
            })}
          </div>
          <p className="chart-foot">Sum of cost_usd per campaign. Click a campaign in Campaigns for the event-level breakdown.</p>
        </article>

        <article className="chart-card">
          <div className="panel-heading"><div><p className="meta-label">Learning loop</p><h2>Scenario promotions</h2></div><Chip tone="blue">{scenarioPromotions.filter((s) => s.status === "proposed").length} proposed</Chip></div>
          <div className="promotion-list">
            {scenarioPromotions.map((s) => (
              <div key={s.id}>
                <Monogram size="sm">{s.agent}</Monogram>
                <p><strong>{s.title}</strong><small>{s.evidence} · evidence grade {s.grade}</small></p>
                {s.status === "active" ? <Chip tone="green">Active</Chip> : <button onClick={() => setPromotion(s.id)}>Review</button>}
              </div>
            ))}
          </div>
        </article>
      </section>

      {promotion && (() => {
        const s = scenarioPromotions.find((x) => x.id === promotion)!;
        return (
          <Modal title={s.title} onClose={() => setPromotion(null)}>
            <p><strong>{agentName(s.agent)}</strong> proposes handling this scenario autonomously, based on {s.evidence.toLowerCase()} (evidence grade {s.grade}, from <code>saams.evidence_grade</code>).</p>
            <p>Promotion is a human-approved change owned by AiCoE jointly with Marketing. No existing guardrail, human gate or approval authority changes.</p>
            <div className="intake-result-actions"><button className="secondary-button" onClick={() => { setPromotion(null); go({ page: "agents", agentFilter: s.agent }); }}>View agent guardrails</button><button className="primary-button" onClick={() => setPromotion(null)}>Close</button></div>
          </Modal>
        );
      })()}
    </div>
  );
}
