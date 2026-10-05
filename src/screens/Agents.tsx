import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "@phosphor-icons/react";
import { useStore } from "../store";
import { agentMeta, governance, stampTime } from "../data";
import { useNav } from "../nav";
import { Chip, Modal, Monogram } from "../ui";
import { liveApi, type LiveFleetMeta } from "../live";

/* The seed data names the models the spec routes each agent to. A deployment
   may substitute: dev serves everything from an Azure deployment, so showing
   the routed name would misreport what is actually answering. When the bridge
   is reachable we show what it says is really running, and note the routed
   target beside it; offline we fall back to the seed descriptor. */
function useLiveRuntimes(): LiveFleetMeta | null {
  const [meta, setMeta] = useState<LiveFleetMeta | null>(null);
  useEffect(() => {
    let cancelled = false;
    liveApi
      .fleetMeta()
      .then((m) => { if (!cancelled) setMeta(m); })
      .catch(() => { /* bridge down: the seed descriptor stands in */ });
    return () => { cancelled = true; };
  }, []);
  return meta;
}

function runtimeFor(key: string, meta: LiveFleetMeta | null): string | null {
  if (!meta) return null;
  const perAgent: Record<string, { model: string } | undefined> = {
    CI: { model: meta.model },
    CB: meta.box,
    CR: meta.repurposing,
    CO: meta.collaboration,
    QG: meta.quality_gate,
  };
  return perAgent[key]?.model ?? null;
}

export default function AgentsScreen() {
  const { state, now } = useStore();
  const { go } = useNav();
  const [govOpen, setGovOpen] = useState(false);
  const fleet = useLiveRuntimes();

  return (
    <div className="screen-content agents-screen">
      <section className="simple-page-header"><div><h1>Your Content to Campaign team</h1><p>Six build units with live run counts and autonomy computed from telemetry. Click an agent's runs for its event log.</p></div><button className="secondary-button" onClick={() => setGovOpen(true)}>Governance settings</button></section>
      <div className="agent-library-grid">
        {agentMeta.map((agent) => {
          const runs = state.events.filter((e) => e.agent === agent.key);
          const autonomous = runs.filter((e) => e.systemExecuted).length;
          const lastRun = runs.length ? Math.max(...runs.map((e) => e.ts)) : null;
          const cost = runs.reduce((s, e) => s + e.cost_usd, 0);
          return (
            <article className="agent-card" key={agent.key}>
              <div className="agent-card-top"><Monogram size="lg">{agent.key}</Monogram><Chip tone="blue">{agent.kind}</Chip></div>
              <h2>{agent.name}</h2>
              <p>{agent.purpose}</p>
              {(() => {
                const running = runtimeFor(agent.key, fleet);
                return (
                  <div className="model-line">
                    <small>Runtime</small>
                    <strong>
                      {running ?? agent.runtime}
                      {agent.prompt_version ? ` · prompt ${agent.prompt_version}` : ""}
                    </strong>
                    {running && running !== agent.model && (
                      <small className="model-routed">routed as {agent.runtime}</small>
                    )}
                  </div>
                );
              })()}
              <div className="agent-stats">
                <div><small>Autonomy</small><strong>{runs.length ? Math.round((autonomous / runs.length) * 100) : 0}%</strong></div>
                <div><small>Runs</small><strong>{runs.length}</strong></div>
                <div><small>AI cost</small><strong>${cost.toFixed(2)}</strong></div>
              </div>
              <div className="guardrail-line"><ShieldCheck size={16} /><p><small>Autonomy boundary</small><strong>{agent.autonomyLine}</strong></p></div>
              <button className="agent-open" onClick={() => go({ page: "activity", agentFilter: agent.key })}>
                {runs.length ? `View ${runs.length} runs${lastRun ? ` · last ${stampTime(lastRun, now)}` : ""}` : "No runs yet"} <ArrowRight size={13} />
              </button>
            </article>
          );
        })}
      </div>
      {govOpen && (
        <Modal title="Governance settings" onClose={() => setGovOpen(false)}>
          <div className="gov-grid">
            <div><small>Rules pack</small><strong>{governance.rulesPack}</strong></div>
            <div><small>Routing policy</small><strong>{governance.routingPolicy}</strong></div>
            <div><small>Telemetry standard</small><strong>{governance.telemetryStandard}</strong></div>
            <div><small>Brief template</small><strong>{governance.briefTemplate}</strong></div>
            <div><small>Workspace template</small><strong>{governance.workspaceTemplate}</strong></div>
          </div>
          <p>Rules and routing policy are owned by Marketing; agents add no rules of their own. Version drift against this baseline is surfaced per run in the trace drawer.</p>
          <p className="explain-note">Fleet guardrails: BC / F&amp;O independence, Copilot scope, "ShiftAI" as one word, no unsourced competitor or ROI claims, and no external publish or send without the human approval gates.</p>
        </Modal>
      )}
    </div>
  );
}
