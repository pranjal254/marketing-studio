# ShiftAI Content to Campaign

Functional React + Vite build of the ShiftAI Marketing Studio front-end, driven by sample agent telemetry (STS v1.1).

Every number in the app is computed from the telemetry event log, and every action advances shared state: submit a request, answer the agent's gap questions, resolve reviewer conflicts, approve briefs, sign off packages. Use the profile menu to act as different people (Marketing Lead, BU Campaign Lead, Content Writer, Grammar Reviewer) and complete the pipeline end to end. Click any activity line, KPI, or journey step for the trace behind it (actor, model, tokens, cost, timing, state transition). State persists in localStorage; "Reset demo data" in the profile menu restores the seed.

Key modules: `src/types.ts` (domain + STS event shapes), `src/data.ts` (seed entities + telemetry), `src/store.tsx` (reducer, action thunks with staged agent simulation, selectors), `src/ui.tsx` (shared components incl. trace drawer), `src/screens/*` (one file per screen).

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

The app uses local sample data and requires no API keys or backend services.
