import type {
  AgentKey, AgentMeta, AppState, ApprovalRecord, Asset, AssetVersion, Campaign, DocContent,
  Notification, Person, Role, Task, TelemetryEvent,
} from "./types";

export const SCHEMA_VERSION = 6;

/* ---------- People ---------- */

export const seedPeople: Person[] = [
  { id: "rishi", name: "Rishi Patel", initials: "RP", role: "Marketing Lead", email: "rishi.patel@levelshift.com", status: "Active", lastActive: "Now" },
  { id: "marcus", name: "Marcus Webb", initials: "MW", role: "BU Campaign Lead", email: "marcus.webb@levelshift.com", status: "Active", lastActive: "1 hour ago" },
  { id: "sofia", name: "Sofia Reyes", initials: "SR", role: "BU Campaign Lead", email: "sofia.reyes@levelshift.com", status: "Active", lastActive: "Yesterday" },
  { id: "jen", name: "Jen Cook", initials: "JC", role: "Content Writer", email: "jen.cook@levelshift.com", status: "Active", lastActive: "12 minutes ago" },
  { id: "tom", name: "Tom Aldridge", initials: "TA", role: "Grammar / Quality Reviewer", email: "tom.aldridge@levelshift.com", status: "Active", lastActive: "2 days ago" },
  { id: "dan", name: "Dan Okafor", initials: "DO", role: "AiCoE Admin", email: "dan.okafor@levelshift.com", status: "Active", lastActive: "3 hours ago" },
  { id: "leah", name: "Leah Novak", initials: "LN", role: "Viewer", email: "leah.novak@levelshift.com", status: "Invited", lastActive: "Invite sent" },
];

export const roleTypes: { name: Role; gate: string; description: string }[] = [
  { name: "BU Campaign Lead", gate: "Brief approval and final sign-off", description: "Approves the campaign brief at intake and signs off the locked package (steps 01 and 09)." },
  { name: "Marketing Lead", gate: "Content decisions (step 05)", description: "Owns mid-journey content decisions and resolves reviewer conflicts at the collaboration gate." },
  { name: "Content Writer", gate: "Flagship confirmation (step 04)", description: "Drafts the flagship asset and confirms content before the eight-channel fan-out." },
  { name: "Grammar / Quality Reviewer", gate: "Grammar QA (step 08)", description: "Reviews routed assets for grammar and quality after the automated compliance checks." },
  { name: "AiCoE Admin", gate: "Agent governance", description: "Owns agent runtimes, guardrails and scenario promotions. Does not approve campaign content." },
  { name: "Viewer", gate: "No gate, read-only", description: "Read-only access to campaigns, packages and insights." },
];

/* ---------- Agents ---------- */

export const agentMeta: AgentMeta[] = [
  { key: "CI", name: "Campaign Identification", kind: "AI agent", purpose: "Turns requests into complete, approved campaign briefs.", runtime: "Claude Sonnet 5", model: "claude-sonnet-5", prompt_version: "p-2.4", guardrail: "Validates and flags, never approves", autonomyLine: "May validate, classify, flag and draft briefs. May not approve briefs, reject requests, or alter the quarterly plan." },
  { key: "CB", name: "Campaign-in-a-Box", kind: "Hybrid", purpose: "Plans the campaign, finds reusable assets and packages final outputs.", runtime: "Claude Opus 5 + workflow engine", model: "claude-opus-5", prompt_version: "p-3.1", guardrail: "Proposes plans, never confirms them", autonomyLine: "May research, define, plan and package confirmed assets. May not confirm its own outputs or modify repository content." },
  { key: "CR", name: "Content Repurposing", kind: "AI agent", purpose: "Drafts one flagship, then creates eight channel-native derivatives.", runtime: "Claude Opus 5", model: "claude-opus-5", prompt_version: "p-2.9", guardrail: "Drafts only from sourced claims", autonomyLine: "May draft, self-check, stage and regenerate. May not confirm content, bypass flagship-first sequencing, or publish anywhere." },
  { key: "CO", name: "Collaboration & Iteration", kind: "AI agent", purpose: "Consolidates comments, manages versions and escalates conflicts.", runtime: "Claude Sonnet 5", model: "claude-sonnet-5", prompt_version: "p-1.8", guardrail: "Never resolves reviewer conflicts", autonomyLine: "May stage, notify, consolidate and apply textual edits. May not confirm content, resolve conflicts, or alter sourced claims." },
  { key: "QG", name: "Quality Gate & Approval", kind: "Hybrid", purpose: "Checks rules, routes human gates and locks approved packages.", runtime: "Rules engine + Claude Sonnet 5", model: "claude-sonnet-5", prompt_version: "p-2.2", guardrail: "Flags and blocks, never edits", autonomyLine: "May check, report, block, route, record and lock within policy. Zero authority over approval decisions or rule waivers." },
  { key: "PK", name: "Packaging module", kind: "Deterministic", purpose: "Assembles the manifest: completeness, naming, hashes. No LLM.", runtime: "Marketing Studio workflow engine", guardrail: "Packaging is transactional, partial manifests impossible", autonomyLine: "Deterministic module. Only content-confirmed assets with a human confirmation record can enter a package." },
];

export const governance = {
  rulesPack: "v3.2",
  routingPolicy: "v1.4",
  telemetryStandard: "STS v1.1",
  briefTemplate: "v1.2",
  workspaceTemplate: "v2.0",
};

/* ---------- Journey ---------- */

export const journeySteps: { n: number; title: string; owner: string; agent: AgentKey | "human"; gate: string; phase: number }[] = [
  { n: 1, title: "Campaign request intake", owner: "Campaign Identification", agent: "CI", gate: "BU Lead approves brief", phase: 0 },
  { n: 2, title: "Audience & offer", owner: "Campaign-in-a-Box", agent: "CB", gate: "Marketing confirms pack", phase: 0 },
  { n: 3, title: "Asset plan & workflow", owner: "Campaign-in-a-Box", agent: "CB", gate: "Owners confirmed", phase: 0 },
  { n: 4, title: "Content drafting", owner: "Content Repurposing", agent: "CR", gate: "Flagship confirmed", phase: 1 },
  { n: 5, title: "Collaboration & iteration", owner: "Collaboration Agent", agent: "CO", gate: "Marketing Lead decision", phase: 1 },
  { n: 6, title: "Campaign packaging", owner: "Packaging module", agent: "PK", gate: "Runs automatically", phase: 1 },
  { n: 7, title: "Compliance checks", owner: "Quality Gate", agent: "QG", gate: "42 rules", phase: 2 },
  { n: 8, title: "Human review routing", owner: "Quality Gate", agent: "QG", gate: "Grammar QA", phase: 2 },
  { n: 9, title: "Approval sign-off", owner: "BU Campaign Lead", agent: "human", gate: "Package locked", phase: 2 },
];

export const phaseLabels = ["Intake & planning", "Production & assembly", "Compliance & approval"];

/* ---------- Campaign identity colors ----------
   One tone per campaign, assigned deterministically from its id.
   Palette is the validated chart set plus teal; identity only, never semantic. */

export type CampaignTone = { accent: string; ink: string; soft: string; line: string };

export const campaignTones: CampaignTone[] = [
  { accent: "#456bb6", ink: "#34518d", soft: "#e9eff9", line: "#c8d6ef" },
  { accent: "#047857", ink: "#065f46", soft: "#e2f3ec", line: "#b9dfcf" },
  { accent: "#b45309", ink: "#8a4a06", soft: "#fbf0df", line: "#ecd9b8" },
  { accent: "#db2777", ink: "#9d1f5a", soft: "#fbe9f2", line: "#f2c4da" },
  { accent: "#0e7490", ink: "#155e75", soft: "#e2f2f7", line: "#bcdfe9" },
];

export function campaignTone(id: string, campaigns?: { id: string }[]): CampaignTone {
  // Position in the workspace keeps the first five campaigns visually distinct;
  // the hash fallback covers contexts without the campaign list.
  const idx = campaigns?.findIndex((c) => c.id === id) ?? -1;
  if (idx >= 0) return campaignTones[idx % campaignTones.length];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return campaignTones[h % campaignTones.length];
}

/* CSS custom properties a component can spread onto style={} */
export function toneVars(id: string, campaigns?: { id: string }[]): Record<string, string> {
  const t = campaignTone(id, campaigns);
  return { "--tone": t.accent, "--tone-ink": t.ink, "--tone-soft": t.soft, "--tone-line": t.line };
}

/* ---------- Helpers ---------- */

export function fakeHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return `${hex.slice(0, 4)}…${hex.slice(4, 8)}`;
}

export function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

export function relTime(ts: number, now: number): string {
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/* Activity timestamp: relative while fresh, then an actual date and time.
   "just now" / "24 min ago" / "Today 14:32" / "Yesterday 09:15" / "18 Aug, 14:32" / "18 Aug 2025" */
export function stampTime(ts: number, now: number): string {
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(ts);
  const ref = new Date(now);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === ref.toDateString()) return `Today ${time}`;
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return `Yesterday ${time}`;
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (d.getFullYear() === ref.getFullYear()) return `${date}, ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* Full timestamp for hover tooltips on activity lines */
export function fullStamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ---------- Telemetry seed ---------- */

let evSeq = 0;
let traceSeq = 100;

type EvInput = {
  ts: number;
  agent: TelemetryEvent["agent"];
  campaignId: string;
  activity: string;
  summary: string;
  trace?: string;
  actor?: TelemetryEvent["actor"];
  state?: TelemetryEvent["state"];
  tokens?: { input: number; output: number };
  cost?: number;
  llm?: number;
  api?: number;
  queue?: number;
  outcome?: TelemetryEvent["outcome"];
  sources?: string[];
  assetId?: string;
  system?: boolean;
};

export function makeEvent(e: EvInput): TelemetryEvent {
  evSeq += 1;
  const meta = agentMeta.find((a) => a.key === e.agent);
  const llm = e.llm ?? 0;
  const api = e.api ?? 120;
  const queue = e.queue ?? 40;
  return {
    id: `ev_${evSeq.toString().padStart(4, "0")}`,
    ts: e.ts,
    trace_id: e.trace ?? `tr_${(traceSeq += 1)}`,
    run_id: `run_${(1000 + evSeq).toString()}`,
    span_id: `sp_${evSeq.toString().padStart(4, "0")}`,
    agent: e.agent,
    campaignId: e.campaignId,
    activity: e.activity,
    summary: e.summary,
    actor: e.actor ?? { type: e.agent === "PK" || e.agent === "studio" ? "system" : "agent" },
    state: e.state,
    model: llm > 0 ? meta?.model : undefined,
    prompt_version: llm > 0 ? meta?.prompt_version : undefined,
    rules_pack: e.agent === "QG" ? governance.rulesPack : undefined,
    tokens: e.tokens,
    cost_usd: e.cost ?? 0,
    timing: { llm_ms: llm, api_ms: api, queue_ms: queue, total_ms: llm + api + queue },
    outcome: e.outcome ?? "success",
    sources: e.sources ?? [],
    assetId: e.assetId,
    systemExecuted: e.system ?? true,
  };
}

/* ---------- AI-first intake: deterministic brief derivation ----------
   Stand-in for the Campaign Identification agent's request parsing. It extracts what
   the description actually states and leaves the rest as explicit gaps; segment,
   budget and dates are never inferred, they stay with the human. */

export type DerivedBrief = {
  name: string; objective: string; topic: string; bu: string; vertical: string; channels: string[];
  derived: { vertical: boolean; channels: boolean };
};

export function deriveBrief(description: string): DerivedBrief {
  const d = description.toLowerCase();
  let vertical = "";
  if (/(finserv|financial|bank|insur)/.test(d)) vertical = "Financial Services";
  else if (/(manufactur|factory|plant|industrial)/.test(d)) vertical = "Manufacturing";
  else if (/(tech|copilot|cloud|saas|software|ai )/.test(d)) vertical = "Technology";
  let bu = "Business Central";
  if (/(finance & operations|f&o|\bfno\b)/.test(d)) bu = "Finance & Operations";
  else if (/cross[- ]bu/.test(d)) bu = "Cross-BU";
  const channels: string[] = [];
  if (/linkedin|social/.test(d)) channels.push("LinkedIn");
  if (/email|nurture|newsletter/.test(d)) channels.push("Email nurture");
  if (/sales|enablement|battle/.test(d)) channels.push("Sales enablement");
  if (/\bweb\b|landing|service page|seo/.test(d)) channels.push("Web / service page");
  if (/community|forum/.test(d)) channels.push("Community");
  if (/event|webinar|roundtable|conference/.test(d)) channels.push("Event");
  const firstSentence = (description.split(/[.!?]\s/)[0] ?? description).trim().replace(/[.!?]+$/, "");
  const objective = firstSentence ? firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1) : "New campaign";
  const stop = new Set(["a", "an", "the", "for", "to", "in", "of", "our", "we", "and", "on", "with", "that", "build", "create", "drive", "launch", "campaign", "want", "need", "help", "is", "are"]);
  const words = firstSentence.split(/\s+/).filter((w) => w && !stop.has(w.toLowerCase())).slice(0, 3)
    .map((w) => { const c = w.replace(/[^\w&-]/g, ""); return c.charAt(0).toUpperCase() + c.slice(1); });
  const name = words.length ? words.join(" ") : "New Campaign";
  const topic = vertical ? `${name} for ${vertical}` : name;
  return { name, objective, topic, bu, vertical, channels, derived: { vertical: vertical !== "", channels: channels.length > 0 } };
}

/* The agent's positioning paragraph on the draft brief; the angle is what directives flip */
export function briefFraming(c: Pick<Campaign, "topic" | "vertical" | "briefAngle">): string {
  const v = c.vertical || "the target vertical";
  const t = c.topic.replace(/…$/, "").toLowerCase();
  switch (c.briefAngle) {
    case "executive":
      return `Executives fund outcomes, not activity. This campaign positions "${t}" as an operating result for ${v} leaders: the business case leads, implementation detail follows in the supporting assets, and every claim will trace to the confirmed inventory.`;
    case "practical":
      return `Lead with the first practical step. This campaign gives ${v} teams a concrete starting point on "${t}", keeps the promise narrow and provable, and routes the deeper evidence through the flagship asset. Every claim will trace to the confirmed inventory.`;
    default:
      return `Position LevelShift on "${t}" for ${v}, grounded in delivery experience rather than category claims. The flagship asset carries the argument and the channel derivatives adapt it; every claim will trace to the confirmed inventory.`;
  }
}

/* ---------- Document content (stand-in for the OneDrive workspace files) ---------- */

export function buildDoc(c: Pick<Campaign, "bu" | "vertical" | "topic">, assetName: string): DocContent {
  const kicker = `${c.bu} · ${c.vertical}`;
  switch (assetName) {
    case "LinkedIn company post": return { kicker, title: "What changes first, and what stays", body: [
      `Most ${c.vertical} teams we meet do not need another platform pitch. They need a clear view of which processes move first and why.`,
      "That question rarely gets a straight answer. Vendors lead with capability lists, analysts lead with maturity models, and the team in the middle is left to guess at a sequence. The result is a programme that starts everywhere at once and lands nowhere in particular.",
      "Our new flagship article lays out the sequence we actually run with clients: confirm the platform baseline first, move the highest-friction processes next, and keep a governance rhythm the business can sustain after the consultants leave.",
      "The baseline matters because it removes the largest source of rework. In our delivery experience, programmes that skip it spend the second quarter re-litigating decisions the first quarter thought were settled.",
      "Friction matters because it is measurable. The process your operations team complains about weekly is a better first move than the one that demos well, and the article shows how to score that honestly.",
      "None of this requires a big-bang commitment. Each move is scoped to be reversible, evidenced and owned by a named person on your side.",
      "Read the practical path in the full article. Link in the first comment.",
    ] };
    case "Executive LinkedIn post": return { kicker, title: "The outcome case, before the implementation detail", body: [
      `Executives do not fund migrations; they fund outcomes. The strongest ${c.vertical} programmes we support start by naming the operating result they need, then sequence the platform work behind it.`,
      "That ordering sounds obvious, but most business cases run the other way: they open with the platform decision and back into the benefits. Sponsors are then asked to underwrite technology risk without a clear statement of the operating change it buys.",
      "The evidence from our client base is consistent. Teams that separate readiness, priority and change capacity reach a governed steady state in one quarter. Teams that treat those as one workstream take three, and spend the difference on rework.",
      "There is also a cost argument that rarely gets made. A sequenced programme concentrates spend on the processes with proven friction, which means the first invoice maps to the first measurable relief rather than to groundwork the business cannot see.",
      "The governance rhythm is the part most programmes skip: a weekly operational review and a monthly sponsor checkpoint, each with a named owner. It sounds light; it is what keeps the sequence honest once the initial energy fades.",
      "The full article sets out the ninety-day sequence we use with clients today, including the baseline checklist and the scoring model for process friction.",
    ] };
    case "Email nurture snippet": return { kicker, title: "Subject: the first ninety days, mapped", body: [
      "Most teams stall on sequencing rather than technology. The platform question gets answered in a workshop; the order-of-operations question follows the programme around for a year.",
      "Our new guide maps the first ninety days into three governed moves: confirm the baseline, move the highest-friction process, set the review rhythm that keeps both honest.",
      "Each move comes with the checklist we use in delivery: what evidence to collect, who signs it, and what has to be true before the next move starts.",
      "It also names the two failure patterns we see most often, the everything-at-once programme and the pilot that never graduates, and shows the early signals of each.",
      "It is a ten-minute read with a one-page checklist your team can use as-is, without a discovery call and without reformatting it for your steering pack.",
      "Get the guide from the link below, no form required.",
    ] };
    case "Sales battle card": return { kicker, title: "Talk track: lead with sequence, not features", body: [
      "Opening position: LevelShift delivers a governed path, not a big-bang migration. Anchor on the three-move sequence from the flagship article and keep the conversation on operating outcomes, not module comparisons.",
      "Discovery questions that open the right conversation: which process generates the most weekly friction today; who owns the platform baseline; what happened to the last modernisation attempt and why did it stall.",
      "Objection, \"we are not ready\": readiness is the first move, not a prerequisite. The baseline assessment confirms it in two weeks and produces the evidence pack the sponsor needs either way.",
      "Objection, \"we already have a partner\": we are not asking them to switch, we are asking to run the baseline. The output is theirs to keep; the sequence sells itself or it does not.",
      "Objection, \"the timing is wrong\": the sequence is built from reversible moves. The cost of starting the baseline now is two weeks of access; the cost of waiting is another quarter of the friction they already named.",
      "Proof point: every claim on this card traces to the confirmed claim inventory, sourced from LevelShift delivery experience. If a prospect asks for the evidence behind any line, it exists and is citable.",
      "Do not promise: custom integrations in phase one, migration dates before the baseline completes, or any outcome not present in the claim inventory.",
    ] };
    case "Executive one-pager": return { kicker, title: "The one-page view for executive sponsors", body: [
      "Purpose: give sponsors the whole programme on one page: the operating outcome, the three-move sequence and the governance rhythm that keeps it on track.",
      "The outcome, stated plainly: a governed operating platform where the highest-friction processes have moved, the controls the business relies on are intact, and the team can evidence both.",
      "Move one, confirm the baseline: two weeks, read-only access, a findings pack the sponsor keeps. This is where hidden dependencies and unowned processes surface, while they are still cheap to address.",
      "Move two, sequence the friction: the processes scored highest for weekly operational drag move first. Each move is scoped to be reversible and carries a named business owner, not just a technical one.",
      "Move three, set the rhythm: a weekly operational review and a monthly sponsor checkpoint. Thirty minutes each, standing agenda, decisions minuted with owners.",
      "Decision asked of the sponsor: confirm the baseline assessment and name the first process to move.",
      "Everything on this page traces to sourced claims; nothing is projected beyond the evidence.",
    ] };
    case "AEO / FAQ extract": return { kicker, title: "Questions buyers actually ask", body: [
      "What moves first? The highest-friction process with the clearest owner, confirmed against the platform baseline. Friction is scored from operational data, not stakeholder enthusiasm.",
      "How long until value? Teams typically reach a governed steady state within one quarter of the first move. The first measurable relief usually lands inside the first six weeks, because the first move targets a process the team already tracks.",
      "What does the baseline assessment involve? Two weeks, read-only access, and a findings pack covering platform readiness, process dependencies and control coverage. The pack belongs to the client regardless of what happens next.",
      "Who governs the change? A named rhythm: weekly operational review, monthly sponsor checkpoint. Both have standing agendas and minuted decisions, so governance survives personnel changes.",
      "What if we have already started with another approach? The baseline is additive. It either validates the current sequence or shows precisely where it drifts, and the evidence pack is useful in both cases.",
      "What does it cost to find out? Two weeks of scoped access. There is no commitment to the later moves until the baseline evidence supports them.",
    ] };
    case "Community draft": return { kicker, title: "A sequence worth discussing", body: [
      "We are frequently asked how organisations should determine the sequencing of their modernisation initiatives. The considered answer involves separating platform readiness from process priority and change capacity.",
      "Those three factors get conflated constantly. Readiness is a property of the platform and its dependencies. Priority is a property of the business friction. Capacity is a property of the team asked to absorb the change. A programme plan that treats them as one number will be wrong in at least two directions.",
      `Our latest flagship article presents a three-move framework validated across ${c.vertical} engagements: baseline first, friction-ranked moves second, governance rhythm throughout.`,
      "The part that generates the most discussion is the friction scoring. We rank candidate processes by measured weekly drag rather than by strategic narrative, and the resulting order is often not the one the steering committee expected.",
      "There is a fair counter-argument: sometimes the strategically loud process deserves to move first for reasons a friction score cannot see. We address that in the article with an explicit override step, which requires the sponsor to document the reasoning.",
      "We would welcome the community's perspective on which process should move first and the reasoning behind it, particularly from teams that have run a sequence like this more than once.",
    ] };
    case "Service-page brief": return { kicker, title: "Service page: structure and message brief", body: [
      "Hero: one clear promise, no feature list. Subhead names the three-move sequence. Primary action is booking the baseline assessment; nothing else competes with it above the fold.",
      "Section one, baseline assessment: two weeks, read-only access, findings pack the client keeps. Proof point: baseline findings have redirected the first move in a majority of engagements, sourced from the claim inventory.",
      "Section two, sequencing workshop: friction-scored process ranking with named owners per move. Proof point: the scoring model and an anonymised example ranking from a delivery engagement.",
      "Section three, governance rhythm: the weekly operational review and monthly sponsor checkpoint, described as deliverables with standing agendas, not as ceremony.",
      "Tone: evidence-led and specific. No superlatives, no unsourced statistics, no competitor naming. Every number on the page must trace to the claim inventory.",
      "CTA: book the baseline assessment. Secondary: read the flagship article. No third action; the page has one job.",
    ] };
    default: return { kicker, title: c.topic.charAt(0).toUpperCase() + c.topic.slice(1), body: [
      `For ${c.vertical} leaders, this is not simply a technology decision. It is an opportunity to create a more responsive operating foundation while protecting the controls that matter.`,
      "The pressure to move is real, and so is the cost of moving badly. Most organisations in this position have lived through at least one modernisation programme that promised transformation and delivered a longer backlog. The scepticism that leaves behind is rational, and any credible plan has to answer it with sequence and evidence rather than ambition.",
      "The most effective programmes begin by separating platform readiness, process priorities and change capacity. Readiness is a property of the platform and its dependencies; priority is a property of the business friction; capacity is a property of the team absorbing the change. Treating them as one conversation produces plans that are wrong in ways nobody can quite name. Treating them separately creates a practical sequence teams can understand and govern.",
      "Three moves matter in the first ninety days: confirm the platform baseline, sequence the highest-friction processes and set a governance rhythm the business can keep.",
      "The baseline comes first because it is the cheapest place to be wrong. Two weeks of read-only assessment surfaces the undocumented dependencies, the processes with no clear owner and the controls that exist in policy but not in practice. Every one of those findings is inexpensive to address before the first move and expensive after it.",
      "Sequencing by friction, rather than by strategy-deck prominence, is the second discipline. The process that costs the operations team hours every week is a better first move than the one with the best demo, because its improvement is felt immediately and measured easily. That early, visible relief is what buys the programme its second quarter.",
      "The governance rhythm is deliberately unglamorous: a weekly operational review and a monthly sponsor checkpoint, each thirty minutes, each with a standing agenda and minuted decisions. Programmes rarely fail for lack of ambition; they fail when nobody notices the drift until it is a quarter wide. The rhythm is the drift detector.",
      "None of this is theoretical. The sequence described here is the one LevelShift runs in delivery today, and every claim in this article traces to the confirmed claim inventory behind it. The practical starting point is a conversation about your baseline, and that conversation takes an hour, not a quarter.",
    ] };
  }
}

/* Deterministic dummy revision, applied per feedback aspect (stand-in for the CR agent's redraft) */
export function reviseDoc(doc: DocContent, aspects: string[]): DocContent {
  const has = (a: string) => aspects.some((x) => x.toLowerCase().startsWith(a));
  let body = doc.body.slice();
  if (has("tone")) body[0] = "Here it is without the polish: most teams do not have a sequencing problem, they have a starting-point problem. Pick the highest-friction process, confirm the baseline, move.";
  if (has("audience")) body[0] = "For the practitioners here rather than the sponsors: this is the sequence we would actually run, in the order we would run it.";
  if (has("length") && body.length > 3) body = [body[0], body[1], body[body.length - 1]];
  if (has("cta")) body[body.length - 1] = "One question for the comments: which process would you move first, and what is blocking it today?";
  if (has("fact")) body = [...body, "Every claim in this revision was re-checked against the confirmed claim inventory; no new claims were introduced."];
  return { ...doc, body };
}

export function bumpVersion(v: string): string {
  const m = /^v(\d+)\.(\d+)$/.exec(v);
  return m ? `v${m[1]}.${Number(m[2]) + 1}` : `${v}.1`;
}

/* ---------- Asset scaffolding ---------- */

const derivativeNames: [string, string, number][] = [
  ["LinkedIn company post", "Social", 12],
  ["Executive LinkedIn post", "Social", 9],
  ["Email nurture snippet", "Email", 6],
  ["Sales battle card", "Enablement", 15],
  ["Executive one-pager", "PDF", 18],
  ["AEO / FAQ extract", "Web", 11],
  ["Community draft", "Social", 7],
  ["Service-page brief", "Web", 10],
];

/* Checklist for a newly confirmed plan: flagship drafted first, derivatives wait for fan-out */
export function seedAssetsFor(campaign: Campaign): Asset[] {
  const ts = Date.now();
  const flagship: Asset = {
    id: `${campaign.id}-a0`, campaignId: campaign.id, name: "Research flagship article", assetType: "Word",
    disposition: "Create", ownerTeam: "Content team", version: "v1.0", state: "in_review", claims: 18,
    hash: fakeHash(`${campaign.id}-a0-v1.0`),
    versions: [{ version: "v1.0", ts, author: { type: "agent", agent: "CR" }, note: "Drafted from sourced claims only; 18-claim inventory attached", hash: fakeHash(`${campaign.id}-a0-v1.0`), doc: buildDoc(campaign, "Research flagship article") }],
  };
  const rest = derivativeNames.map(([name, assetType, claims], i): Asset => ({
    id: `${campaign.id}-a${i + 1}`, campaignId: campaign.id, name, assetType,
    disposition: i === 0 || i === 3 ? "Adapt" : i === 2 ? "Reuse" : "Create",
    ownerTeam: i < 2 ? "Digital marketing" : i === 3 ? "Sales enablement" : "Content team",
    version: "planned", state: "planned", claims, hash: "pending", versions: [],
  }));
  return [flagship, ...rest];
}

/* The workspace starts EMPTY: no dummy campaigns, tasks or telemetry. Real
   campaigns enter through the New Campaign request flow (backed by the live
   Campaign Identification agent over the dev bridge) and everything downstream
   builds on those. People/personas stay seeded — they are the login identities. */
export function buildSeed(): AppState {
  evSeq = 0;
  traceSeq = 100;
  return {
    schema: SCHEMA_VERSION,
    viewAsId: "rishi",
    people: seedPeople,
    campaigns: [],
    assets: [],
    tasks: [],
    events: [],
    approvals: [],
    notifications: [],
  };
}


/* Historical weekly autonomy (fleet archive aggregate, weeks 1-12 of the pilot) */
export const weeklyAutonomy: { week: number; rate: number }[] = [
  { week: 1, rate: 27 }, { week: 2, rate: 31 }, { week: 3, rate: 34 }, { week: 4, rate: 39 },
  { week: 5, rate: 43 }, { week: 6, rate: 49 }, { week: 7, rate: 55 }, { week: 8, rate: 61 },
  { week: 9, rate: 68 }, { week: 10, rate: 72 }, { week: 11, rate: 78 }, { week: 12, rate: 84 },
];

export const scenarioPromotions = [
  { id: "sp1", agent: "CO" as AgentKey, title: "Executive tone recommendation", evidence: "5 consistent human decisions", grade: "B+", status: "proposed" as const },
  { id: "sp2", agent: "CI" as AgentKey, title: "Duplicate campaign handling", evidence: "7 consistent decisions", grade: "A", status: "proposed" as const },
  { id: "sp3", agent: "QG" as AgentKey, title: "FAQ named-mention rule", evidence: "Promoted 12 Aug, human approved", grade: "A", status: "active" as const },
];

export const flagshipDoc = {
  kicker: "Business Central · Financial Services",
  title: "Cloud momentum starts with a clear view of what changes and what stays",
  paragraphs: [
    "For Financial Services leaders, moving Business Central to the cloud is not simply an infrastructure decision. It is an opportunity to create a more responsive operating foundation while protecting the controls that matter.",
    "The pressure to move is real, and so is the cost of moving badly. Most finance organisations have lived through at least one modernisation programme that promised transformation and delivered a longer backlog. Any credible cloud plan has to answer that scepticism with sequence and evidence rather than ambition.",
    "The most effective programmes begin by separating platform readiness, process priorities and change capacity. Readiness is a property of the platform and its dependencies; priority is a property of the business friction; capacity is a property of the team absorbing the change. This creates a practical sequence that teams can understand and govern.",
    "Three moves matter in the first ninety days: confirm the platform baseline, sequence the highest-friction processes and set a governance rhythm the business can keep.",
    "The baseline comes first because it is the cheapest place to be wrong. Two weeks of read-only assessment surfaces undocumented dependencies, processes with no clear owner and controls that exist in policy but not in practice, while every one of those findings is still inexpensive to address.",
    "Sequencing by measured friction, rather than by strategy-deck prominence, is the second discipline. The reconciliation process that costs the finance team hours every close is a better first move than the module with the best demo, because its improvement is felt immediately and measured easily.",
    "The governance rhythm is deliberately unglamorous: a weekly operational review and a monthly sponsor checkpoint, each with a standing agenda and minuted decisions. Programmes rarely fail for lack of ambition; they fail when nobody notices the drift until it is a quarter wide.",
    "None of this is theoretical. The sequence described here is the one LevelShift runs in Financial Services delivery today, and every claim in this article traces to the confirmed claim inventory behind it.",
  ],
  source: "LevelShift BC delivery overview, p. 8",
};
