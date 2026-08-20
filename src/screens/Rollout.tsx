import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowRight, Check, Clock, HourglassMedium, LockSimple, Robot, UserCircle } from "@phosphor-icons/react";
import { campaignCost, personById, slaInfo, useStore } from "../store";
import { agentMeta, journeySteps, phaseLabels, stampTime, toneVars } from "../data";
import { useNav } from "../nav";
import { Avatar, CampaignStateChip, Chip, Monogram } from "../ui";
import type { AgentKey, AppState, Campaign, Role, Task } from "../types";

/* ---------- Pipeline model ---------- */

type NodeStatus = "done" | "active" | "waiting" | "upcoming";

type GateDef = {
  id: string;
  after: number; // gate sits after this journey step
  title: string;
  role: Role;
  matchTask: (t: Task) => boolean;
  matchApproval: (action: string) => boolean;
};

const GATES: GateDef[] = [
  { id: "g1", after: 1, title: "Brief approval", role: "BU Campaign Lead", matchTask: (t) => t.kind === "brief_approval" || t.kind === "gaps", matchApproval: (a) => a === "Brief approved" },
  { id: "g3", after: 3, title: "Plan confirmation", role: "Marketing Lead", matchTask: (t) => t.kind === "plan_confirm", matchApproval: (a) => a === "Plan confirmed" },
  { id: "g4", after: 4, title: "Flagship confirmation", role: "Content Writer", matchTask: (t) => t.kind === "review" && (t.assetId?.endsWith("-a0") || t.title.toLowerCase().includes("flagship")), matchApproval: (a) => a === "Flagship content confirmed" },
  { id: "g5", after: 5, title: "Content decision", role: "Marketing Lead", matchTask: (t) => t.kind === "conflict" || (t.kind === "review" && !t.assetId?.endsWith("-a0") && !t.title.toLowerCase().includes("flagship")), matchApproval: (a) => a.startsWith("Marketing decision") || a.startsWith("Content confirmed") },
  { id: "g8", after: 8, title: "Grammar QA", role: "Grammar / Quality Reviewer", matchTask: (t) => t.kind === "grammar_qa", matchApproval: (a) => a === "Grammar QA approved" },
  { id: "g9", after: 9, title: "Package sign-off", role: "BU Campaign Lead", matchTask: (t) => t.kind === "package_signoff", matchApproval: (a) => a === "Package signed off & locked" },
];

/* Chain order the work actually flows through */
const CHAIN = ["s1", "g1", "s2", "s3", "g3", "s4", "g4", "s5", "g5", "s6", "s7", "s8", "g8", "g9", "lock"];

type GateInfo = {
  def: GateDef;
  status: NodeStatus;
  personId?: string;
  task?: Task;
  approvalAt?: number;
  approvalHash?: string;
};

function computeGate(def: GateDef, campaign: Campaign, state: AppState): GateInfo {
  const openTask = state.tasks.find((t) => t.campaignId === campaign.id && t.status === "open" && def.matchTask(t));
  if (openTask) return { def, status: "waiting", personId: openTask.assigneeId, task: openTask };
  const approval = [...state.approvals].reverse().find((a) => a.campaignId === campaign.id && def.matchApproval(a.action));
  const fallback = state.people.find((p) => p.role === def.role)?.id;
  if (approval) return { def, status: "done", personId: approval.byId, approvalAt: approval.at, approvalHash: approval.hash };
  if (campaign.state === "approved_locked" || campaign.step > def.after) return { def, status: "done", personId: fallback };
  return { def, status: "upcoming", personId: fallback };
}

function stepStatus(campaign: Campaign, n: number): NodeStatus {
  if (campaign.state === "approved_locked" || campaign.step > n) return "done";
  if (campaign.step === n) return "active";
  return "upcoming";
}

/* ---------- Custom nodes ---------- */

const STATUS_LABEL: Record<NodeStatus, string> = { done: "Complete", active: "Running", waiting: "Waiting", upcoming: "Queued" };

function StatusBadge({ status, label }: { status: NodeStatus; label?: string }) {
  return (
    <span className={`wf-status ${status}`}>
      {status === "done" ? <Check size={11} weight="bold" /> : status === "active" ? <i className="wf-run-dot" aria-hidden="true" /> : status === "waiting" ? <HourglassMedium size={11} /> : <Clock size={11} />}
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

function FlowHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" className="wf-handle" />
      <Handle type="source" position={Position.Right} id="out" className="wf-handle" />
      <Handle type="target" position={Position.Top} id="inTop" className="wf-handle" />
      <Handle type="source" position={Position.Bottom} id="outBottom" className="wf-handle" />
    </>
  );
}

function AgentFlowNode({ data }: NodeProps) {
  const d = data as { n: number; agent: AgentKey; title: string; owner: string; status: NodeStatus };
  return (
    <div className={`wf-node wf-agent ${d.status}`}>
      <FlowHandles />
      <div className="wf-node-top"><span className="wf-mono">{d.agent}</span><span className="wf-kind"><Robot size={11} /> AI agent</span><span className="wf-step">0{d.n}</span></div>
      <strong>{d.title}</strong>
      <small>{d.owner}</small>
      <span className="wf-bar" aria-hidden="true"><i /></span>
      <StatusBadge status={d.status} />
    </div>
  );
}

function GateFlowNode({ data }: NodeProps) {
  const d = data as { title: string; status: NodeStatus; initials: string; person: string };
  const label = d.status === "waiting" ? `Waiting on ${d.person.split(" ")[0]}` : d.status === "done" ? `Cleared by ${d.person.split(" ")[0]}` : STATUS_LABEL[d.status];
  return (
    <div className={`wf-node wf-gate ${d.status}`}>
      <FlowHandles />
      <div className="wf-node-top"><span className="wf-avatar">{d.initials}</span><span className="wf-kind human"><UserCircle size={11} /> Human gate</span></div>
      <strong>{d.title}</strong>
      <small>{d.person}</small>
      <span className="wf-bar" aria-hidden="true"><i /></span>
      <StatusBadge status={d.status} label={label} />
    </div>
  );
}

function LockFlowNode({ data }: NodeProps) {
  const d = data as { status: NodeStatus };
  return (
    <div className={`wf-node wf-lock ${d.status}`}>
      <FlowHandles />
      <span className="wf-lock-orb"><LockSimple size={15} weight={d.status === "done" ? "fill" : "regular"} /></span>
      <strong>Package locked</strong>
      <StatusBadge status={d.status} label={d.status === "done" ? "Locked" : "Queued"} />
    </div>
  );
}

function PhaseFlowNode({ data }: NodeProps) {
  const d = data as { label: string; steps: string };
  return (
    <div className="wf-phase">
      <strong>{d.label}</strong>
      <small>{d.steps}</small>
    </div>
  );
}

const nodeTypes: NodeTypes = { agent: AgentFlowNode, gate: GateFlowNode, lock: LockFlowNode, phase: PhaseFlowNode };

/* ---------- Screen ---------- */

export default function RolloutScreen() {
  const { state, now, viewer, openTrace } = useStore();
  const { nav, go } = useNav();
  const ordered = useMemo(() => [...state.campaigns].sort((a, b) => (a.state === "approved_locked" ? 1 : 0) - (b.state === "approved_locked" ? 1 : 0) || b.step - a.step), [state.campaigns]);
  const [campaignId, setCampaignId] = useState<string>(nav.campaignId ?? ordered[0]?.id);
  const campaign = state.campaigns.find((c) => c.id === campaignId) ?? ordered[0];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const gates = useMemo(() => {
    const map = new Map<string, GateInfo>();
    GATES.forEach((g) => map.set(g.id, computeGate(g, campaign, state)));
    return map;
  }, [campaign, state]);

  const { nodes, edges } = useMemo(() => {
    // Three-row snake, five chain slots per row. Agents sit on the row line,
    // human gates drop slightly below it, so every handoff to a person reads as a dip.
    const COLS = 5, SLOT_W = 200, ROW_H = 252, GATE_DROP = 62;
    const slot = (id: string) => CHAIN.indexOf(id);
    const pos = (id: string, drop: number) => ({ x: (slot(id) % COLS) * SLOT_W, y: Math.floor(slot(id) / COLS) * ROW_H + drop });
    const stagger = (id: string) => ({ "--i": slot(id) } as CSSProperties);
    const phaseNodes: Node[] = phaseLabels.map((label, i) => ({
      id: `phase-${i}`, type: "phase", position: { x: -190, y: i * ROW_H + 28 },
      draggable: false, selectable: false, focusable: false, style: { pointerEvents: "none" },
      data: { label, steps: `Steps 0${i * 3 + 1} to 0${i * 3 + 3}` },
    }));
    const stepNodes: Node[] = journeySteps.filter((s) => s.agent !== "human").map((s) => ({
      id: `s${s.n}`, type: "agent", position: pos(`s${s.n}`, 0), draggable: false, selected: selectedId === `s${s.n}`, style: stagger(`s${s.n}`),
      data: { n: s.n, agent: s.agent as AgentKey, title: s.title, owner: s.owner, status: stepStatus(campaign, s.n) },
    }));
    const gateNodes: Node[] = GATES.map((g) => {
      const info = gates.get(g.id)!;
      const person = info.personId ? personById(state, info.personId) : undefined;
      return {
        id: g.id, type: "gate", position: pos(g.id, GATE_DROP), draggable: false, selected: selectedId === g.id, style: stagger(g.id),
        data: { title: g.title, status: info.status, initials: person?.initials ?? "?", person: person?.name ?? g.role },
      };
    });
    const lockNode: Node = {
      id: "lock", type: "lock", position: pos("lock", 30), draggable: false, selected: selectedId === "lock", style: stagger("lock"),
      data: { status: campaign.state === "approved_locked" ? "done" : "upcoming" },
    };
    const all = [...phaseNodes, ...stepNodes, ...gateNodes, lockNode];
    const byId = new Map(all.map((n) => [n.id, n]));
    const edgeList: Edge[] = [];
    for (let i = 0; i < CHAIN.length - 1; i++) {
      const from = CHAIN[i], to = CHAIN[i + 1];
      const target = byId.get(to);
      const tStatus = (target?.data as { status: NodeStatus }).status;
      const live = tStatus === "active" || tStatus === "waiting";
      const done = tStatus === "done";
      const wraps = Math.floor(i / COLS) !== Math.floor((i + 1) / COLS);
      const stroke = done ? "#0a9268" : live ? "#d97706" : "#cfcfd6";
      edgeList.push({
        id: `${from}-${to}`, source: from, target: to,
        // Curved edges within a row, orthogonal only for the row wrap
        type: wraps ? "smoothstep" : "default",
        sourceHandle: wraps ? "outBottom" : "out", targetHandle: wraps ? "inTop" : "in",
        animated: done || live,
        className: done ? "edge-done" : live ? "edge-live" : "edge-next",
        ...(wraps ? { pathOptions: { borderRadius: 20 } } : {}),
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 13, height: 13 },
        style: { stroke, strokeWidth: live ? 2.2 : done ? 1.9 : 1.5, strokeDasharray: done || live ? "7 5" : "3 5" },
      } as Edge);
    }
    return { nodes: all, edges: edgeList };
  }, [campaign, gates, state, selectedId]);

  // Selecting a campaign focuses its live node
  useEffect(() => {
    const liveId = CHAIN.find((id) => {
      const n = nodes.find((x) => x.id === id);
      const s = (n?.data as { status: NodeStatus } | undefined)?.status;
      return s === "active" || s === "waiting";
    });
    setSelectedId(liveId ?? (campaign.state === "approved_locked" ? "lock" : "s1"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const cost = campaignCost(state, campaign.id);
  const waitingGate = [...gates.values()].find((g) => g.status === "waiting");
  const waitingName = waitingGate?.personId ? personById(state, waitingGate.personId)?.name : undefined;
  const headSub = campaign.state === "approved_locked"
    ? "All nine steps complete, package locked read-only"
    : waitingGate
      ? `Step ${campaign.step} of 9 · waiting on ${waitingName ?? waitingGate.def.role} at ${waitingGate.def.title.toLowerCase()}`
      : `Step ${campaign.step} of 9 · agents executing, no human gate open`;

  return (
    <div className="screen-content rollout-screen" style={toneVars(campaign.id, state.campaigns)}>
      <section className="simple-page-header">
        <div><h1>Agent workflow</h1><p>The live pipeline behind every campaign: agents execute, people hold the gates. Click any node for its specification and telemetry.</p></div>
        <div className="wf-cost"><small>AI cost this campaign</small><strong>${cost.toFixed(2)}</strong></div>
      </section>

      <div className="wf-picker" role="tablist" aria-label="Choose a campaign">
        {ordered.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === campaign.id} className={`wf-pick${c.id === campaign.id ? " active" : ""}`} style={toneVars(c.id, state.campaigns)} onClick={() => setCampaignId(c.id)}>
            <i className="wf-pick-dot" aria-hidden="true" />{c.name}
            <em>{c.state === "approved_locked" ? "Locked" : `Step ${c.step} of 9`}</em>
          </button>
        ))}
      </div>

      <div className="wf-layout">
        <section className="wf-canvas" aria-label={`${campaign.name} pipeline`}>
          <div className="wf-canvas-head">
            <div className="wf-head-left">
              <div><strong>{campaign.name}</strong><CampaignStateChip state={campaign.state} /></div>
              <small className="wf-head-sub">{headSub}</small>
            </div>
            <div className="wf-legend">
              <span><i className="wf-leg agent" /> Agent</span>
              <span><i className="wf-leg gate" /> Human gate</span>
              <span><i className="wf-leg done" /> Completed</span>
              <span><i className="wf-leg live" /> Live now</span>
            </div>
          </div>
          <ReactFlow
            key={campaign.id}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
            minZoom={0.35}
            maxZoom={1.6}
            nodesConnectable={false}
            nodesDraggable={false}
            zoomOnScroll={false}
            panOnScroll
            onNodeClick={(_, node) => { if (node.type !== "phase") setSelectedId(node.id); }}
          >
            <Background gap={18} size={1.5} color="#dfdfe6" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </section>
        <NodeDetailPanel campaign={campaign} selectedId={selectedId} gates={gates} onOpenTrace={openTrace} onGo={go} viewerId={viewer.id} now={now} />
      </div>
      <p className="wf-footnote">Agents execute the numbered steps and emit STS v1.1 telemetry as they run. Every amber node is a person with authority; nothing clears a gate on its own.</p>
    </div>
  );
}

/* ---------- Detail panel ---------- */

function NodeDetailPanel({ campaign, selectedId, gates, onOpenTrace, onGo, viewerId, now }: {
  campaign: Campaign; selectedId: string | null; gates: Map<string, GateInfo>;
  onOpenTrace: (t: string) => void; onGo: ReturnType<typeof useNav>["go"]; viewerId: string; now: number;
}) {
  const { state } = useStore();

  if (!selectedId) return <aside className="wf-panel"><p className="wf-panel-empty">Click a node in the pipeline to inspect it.</p></aside>;

  if (selectedId === "lock") {
    const locked = campaign.state === "approved_locked";
    return (
      <aside className="wf-panel">
        <p className="meta-label">Terminal state</p>
        <h2>Package locked</h2>
        <p className="wf-panel-copy">{locked ? `${campaign.name} is signed off and locked read-only in OneDrive. The manifest, hashes and approval chain are in the package library.` : "Once the BU Campaign Lead signs off, the package locks read-only with its manifest, hashes and full approval chain."}</p>
        {locked && <button className="secondary-button" onClick={() => onGo("library")}>Open package library <ArrowRight size={13} /></button>}
      </aside>
    );
  }

  if (selectedId.startsWith("g")) {
    const info = gates.get(selectedId);
    if (!info) return null;
    const person = info.personId ? personById(state, info.personId) : undefined;
    const sla = info.task ? slaInfo(info.task, now) : null;
    return (
      <aside className="wf-panel">
        <p className="meta-label">Human gate</p>
        <h2>{info.def.title}</h2>
        <div className="wf-person-row">
          <Avatar initials={person?.initials ?? "?"} />
          <span><strong>{person?.name ?? "Unassigned"}</strong><small>{info.def.role}</small></span>
          <StatusBadge status={info.status} />
        </div>
        {info.status === "waiting" && info.task && (
          <>
            <p className="wf-panel-copy">{info.task.title}: {info.task.detail}. Assigned {stampTime(info.task.createdAt, now)}{sla ? `, ${sla.remaining}` : ""}{info.task.escalated ? ", escalated" : ""}.</p>
            {info.task.assigneeId === viewerId
              ? <button className="primary-button" onClick={() => onGo({ page: "approvals", taskId: info.task!.id })}>Open your task <ArrowRight size={13} /></button>
              : <p className="wf-panel-note">Only {person?.name.split(" ")[0]} can clear this gate. Agents wait; the SLA watch nudges automatically.</p>}
          </>
        )}
        {info.status === "done" && (
          <p className="wf-panel-copy">Cleared{person ? ` by ${person.name}` : ""}{info.approvalAt ? ` ${stampTime(info.approvalAt, now)}` : ""}{info.approvalHash ? <> · recorded with hash <code>{info.approvalHash}</code></> : ""}.</p>
        )}
        {info.status === "upcoming" && (
          <p className="wf-panel-copy">Not reached yet. When the pipeline arrives here, the Quality Gate routes the decision to the {info.def.role} with a 2-business-day SLA.</p>
        )}
      </aside>
    );
  }

  // Agent step node
  const n = Number(selectedId.slice(1));
  const step = journeySteps[n - 1];
  const meta = agentMeta.find((a) => a.key === step.agent);
  const runs = state.events.filter((e) => e.agent === step.agent && e.campaignId === campaign.id);
  const totalCost = runs.reduce((s, e) => s + e.cost_usd, 0);
  const tokens = runs.reduce((s, e) => s + (e.tokens ? e.tokens.input + e.tokens.output : 0), 0);
  const llmRuns = runs.filter((e) => e.timing.llm_ms > 0);
  const avgLlm = llmRuns.length ? Math.round(llmRuns.reduce((s, e) => s + e.timing.llm_ms, 0) / llmRuns.length) : 0;
  const last = runs[runs.length - 1];

  return (
    <aside className="wf-panel">
      <p className="meta-label">Step 0{n} · {meta?.kind ?? "AI agent"}</p>
      <div className="wf-person-row">
        <Monogram>{step.agent}</Monogram>
        <span><strong>{meta?.name ?? step.owner}</strong><small>{meta?.runtime}{meta?.prompt_version ? ` · prompt ${meta.prompt_version}` : ""}</small></span>
        <StatusBadge status={stepStatus(campaign, n)} />
      </div>
      <p className="wf-panel-copy">{meta?.purpose}</p>
      <div className="wf-spec"><small>Autonomy boundary</small><p>{meta?.autonomyLine}</p></div>
      <div className="wf-telemetry">
        <div><small>Runs here</small><strong>{runs.length}</strong></div>
        <div><small>AI cost</small><strong>${totalCost.toFixed(2)}</strong></div>
        <div><small>Tokens</small><strong>{tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens}</strong></div>
        <div><small>Avg LLM time</small><strong>{avgLlm > 0 ? `${(avgLlm / 1000).toFixed(1)}s` : "n/a"}</strong></div>
      </div>
      {last ? (
        <div className="wf-last-run">
          <small>Last run on this campaign · {stampTime(last.ts, now)}</small>
          <p>{last.summary}</p>
          <div className="wf-panel-actions">
            <button className="secondary-button" onClick={() => onOpenTrace(last.trace_id)}>Open trace</button>
            <button className="text-link" onClick={() => onGo({ page: "activity", agentFilter: step.agent })}>All {step.agent} runs <ArrowRight size={12} /></button>
          </div>
        </div>
      ) : (
        <p className="wf-panel-note">No runs on {campaign.name} yet. Telemetry lands here the moment this agent executes.</p>
      )}
      <div className="wf-guardrail"><Chip tone="green">{meta?.guardrail}</Chip></div>
    </aside>
  );
}
