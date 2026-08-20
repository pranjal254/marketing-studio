import { Check } from "@phosphor-icons/react";
import { useStore } from "../store";
import { useNav } from "../nav";
import { Chip, Monogram } from "../ui";

const waves = [
  { n: "01", weeks: "Weeks 0-4 · In build", tone: "green" as const, title: "Intake & planning foundations", copy: "A validated front door, sourced campaign planning and systematic reuse.", agents: ["CI", "CB"], receives: "Approved brief, audience & offer pack, asset checklist and a campaign workspace." },
  { n: "02", weeks: "Weeks 4-8", tone: "neutral" as const, title: "Content engine", copy: "One flagship becomes eight governed, channel-native derivatives.", agents: ["CR", "CO"], receives: "Flagship draft, 8 channel assets, claim lineage and a managed review cycle." },
  { n: "03", weeks: "Weeks 8-12", tone: "neutral" as const, title: "Governed gate & full flow", copy: "Automated checks, sequenced human approvals and a locked final package.", agents: ["QG", "PK"], receives: "Compliance reports, the approval chain and a locked Campaign-in-a-Box." },
];

const agentNames: Record<string, [string, string]> = {
  CI: ["Campaign Identification", "Brief validation and approval"],
  CB: ["Campaign-in-a-Box", "Audience, offer and workflow plan"],
  CR: ["Content Repurposing", "Flagship and derivative fan-out"],
  CO: ["Collaboration & Iteration", "Comments, revisions and versions"],
  QG: ["Quality Gate & Approval", "Compliance, routing and locking"],
  PK: ["Packaging module", "Manifest, hashes and completeness"],
};

export default function RolloutScreen() {
  const { state } = useStore();
  const { go } = useNav();
  return (
    <div className="screen-content rollout-screen">
      <section className="page-intro"><div><h1>Your path to governed campaign automation</h1><p>Three build waves move Marketing from assisted work to a connected, human-governed campaign flow.</p></div><div className="roadmap-meta"><span><strong>12</strong> weeks</span><span><strong>5</strong> agents</span><span><strong>1</strong> pilot BU</span></div></section>
      <div className="rollout-hero"><div><p className="meta-label inverse">Target operating model</p><h2>From scattered campaign work to one governed journey</h2><p>Each wave runs shadow-first on BC Cloud Momentum. Cut-over happens only after Marketing Lead sign-off.</p></div><div className="maturity-meter"><span>L1</span><span>L2</span><span>L3</span><span className="active">L4 Agentic</span><span>L5</span></div></div>
      <section className="wave-grid">
        {waves.map((wave) => (
          <article className={`wave-card${wave.n === "01" ? " active" : ""}`} key={wave.n}>
            <div className="wave-number">{wave.n}</div>
            <div className="wave-title"><Chip tone={wave.tone}>{wave.weeks}</Chip><h3>{wave.title}</h3><p>{wave.copy}</p></div>
            <div className="wave-agents">
              {wave.agents.map((key) => {
                const runs = state.events.filter((e) => e.agent === key).length;
                return (
                  <button className="wave-agent-row" key={key} onClick={() => go({ page: "activity", agentFilter: key })} title="Open this agent's runs">
                    <Monogram size="sm">{key}</Monogram>
                    <div><strong>{agentNames[key][0]}</strong><small>{agentNames[key][1]}</small></div>
                    <em>{runs > 0 ? `${runs} runs` : "Planned"}</em>
                  </button>
                );
              })}
            </div>
            <div className="wave-output"><small>Marketing receives</small><p>{wave.receives}</p></div>
          </article>
        ))}
      </section>
      <section className="principles-panel"><div><h2>Automation with human authority intact</h2><p>What stays true throughout the rollout.</p></div><div className="principle-grid"><span><Check size={14} weight="bold" /> Every campaign starts from an approved brief</span><span><Check size={14} weight="bold" /> Agents flag and route, never silently edit</span><span><Check size={14} weight="bold" /> Every claim traces to a verified source</span><span><Check size={14} weight="bold" /> Nothing is published in Phase 1</span></div></section>
    </div>
  );
}
