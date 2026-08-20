import { useState } from "react";
import { ArrowRight, ShieldCheck } from "@phosphor-icons/react";
import { useStore } from "../store";
import { agentMeta, governance } from "../data";
import { useNav } from "../nav";
import { Chip, Modal, Monogram } from "../ui";

export default function AgentsScreen() {
  const { state, now } = useStore();
  const { go } = useNav();
  const [govOpen, setGovOpen] = useState(false);

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
              <div className="model-line"><small>Runtime</small><strong>{agent.runtime}{agent.prompt_version ? ` · prompt ${agent.prompt_version}` : ""}</strong></div>
              <div className="agent-stats">
                <div><small>Autonomy</small><strong>{runs.length ? Math.round((autonomous / runs.length) * 100) : 0}%</strong></div>
                <div><small>Runs</small><strong>{runs.length}</strong></div>
                <div><small>AI cost</small><strong>${cost.toFixed(2)}</strong></div>
              </div>
              <div className="guardrail-line"><ShieldCheck size={16} /><p><small>Autonomy boundary</small><strong>{agent.autonomyLine}</strong></p></div>
              <button className="agent-open" onClick={() => go({ page: "activity", agentFilter: agent.key })}>
                {runs.length ? `View ${runs.length} runs${lastRun ? `, last ${Math.max(1, Math.round((now - lastRun) / 3600000))}h ago` : ""}` : "No runs yet"} <ArrowRight size={13} />
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
