# ShiftAI Content to Campaign

Functional React + Vite build of the ShiftAI Marketing Studio front-end, driven by sample agent telemetry (STS v1.1).

Every number in the app is computed from the telemetry event log, and every action advances shared state: submit a request, answer the agent's gap questions, resolve reviewer conflicts, approve briefs, sign off packages. Use the profile menu to act as different people (Marketing Lead, BU Campaign Lead, Content Writer, Grammar Reviewer) and complete the pipeline end to end. Click any activity line, KPI, or journey step for the trace behind it (actor, model, tokens, cost, timing, state transition). State persists in localStorage; live campaigns are reconciled against the workspace database on boot, which is the source of truth for them.

Key modules: `src/types.ts` (domain + STS event shapes), `src/data.ts` (seed entities + telemetry), `src/store.tsx` (reducer, action thunks with staged agent simulation, selectors), `src/ui.tsx` (shared components incl. trace drawer), `src/live.ts` (the one client for the agent bridge), `src/screens/Ask.tsx` (the Ask anything assistant), `src/contentSettings.tsx` (per-campaign counts and word limits), `src/screens/*` (one file per screen).

## Run locally

Requirements: Node.js 18 or newer. Tested for compatibility with Node.js 20.13.1.

```bash
npm install
npm run dev
```

Open the local address printed by Vite.

## Production build

```bash
npm run build
npm run preview
```

## Included screens

- Marketing home dashboard
- 12-week activation roadmap
- Campaign journey
- Brief and campaign plan
- Content production workbench
- Five-agent library
- Approval workspace
- Locked Campaign-in-a-Box
- Campaign insights and observability
- Users and roles (human-gate role types, invite flow)
- On-demand campaign intake (agent-validated request form, live telemetry)
- Gap-request task (awaiting_input brief, agent questions)
- SLA watch (live SLA math, nudge and reassign actions)
- Activity log (full filterable STS event stream with trace drawer)
- Ask anything (Beta): a chat assistant at `/ask`, currently hidden from the sidebar
- Content settings: how many of each asset a campaign needs and how long each should run

The app uses local sample data and requires no API keys or backend services.

## Ask anything (Beta)

**Currently hidden.** The sidebar entry and the Cmd/Ctrl+K shortcut are commented
out in `App.tsx`; the page, its route, the role permissions and the backend are
all intact, so `/ask` still answers if you navigate to it directly.

`/ask` is a chat assistant that answers questions
about the workspace by **looking them up** in the agents' own records: campaigns,
drafts, reviewer feedback, gate findings, content settings and the telemetry
rollup. Each answer shows the lookups behind it, so no figure has to be taken on
trust, and a references column keeps cited records open-able after the next
question.

Conversations persist. The bridge database is the record, so a thread survives a
browser, a device and a restart; localStorage caches the last thread for instant
reopen and sessionStorage tracks which thread each tab has open, so two tabs can
sit in different conversations. Every storage read is wrapped, because a browser
with site data blocked should lose the convenience, not the page.

It is deliberately limited in this release:

- **Read-only.** No tool writes and none invokes an agent. Creating a campaign or
  clearing a gate through chat would route around the human gates the agents are
  built on, so an answer that wants an action points at the screen that does it.
- **Bounded.** At most six lookups per question. Running out produces an honest
  "I ran out of lookups", never a guess.
- **Not access-controlled.** The assistant reads the workspace, not your slice of
  it. That is what makes it useful and it is also why real per-user authorisation
  is now load-bearing rather than nice to have. Until SSO lands, treat it as
  having the reach of the workspace.
- **Says when it does not know.** An answer that cites nothing is labelled as
  such rather than presented as fact.

It needs a running bridge. Without one it says so instead of guessing.

## Content settings

Between confirming the flagship and the derivative fan-out, a Content Writer can
set how many variants of each asset the agent writes and the word range for each.
Counts are capped by the agent's versioned config, not by this UI: a request over
the ceiling comes back clamped with a note explaining the correction. Each save is
a new identity-stamped version.
