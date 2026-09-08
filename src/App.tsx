import { Suspense, lazy, useContext, useEffect, useMemo, useRef, useState, useTransition, type ComponentType } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import {
  ArrowClockwise, Bell, BellSlash, Broadcast, CaretDown, ChartLineUp, Checks, CurrencyDollar,
  FlowArrow, HourglassMedium, House, ListChecks, MagnifyingGlass, Package, Question, Robot,
  SealCheck, SidebarSimple, SignOut, SquaresFour, UsersThree, Warning, type Icon,
} from "@phosphor-icons/react";
import type { AppState, PageKey, Person } from "./types";
import { fullStamp, roleTypes, stampTime, toneVars } from "./data";
import { StoreProvider, campaignCost, costByAgent, openTasksFor, slaInfo, personById, useStore } from "./store";
import { NavTransitionContext, useNav, type NavTarget } from "./nav";
import { Avatar, MicButton, Modal, Toast, TraceDrawer, agentName, useAutoCloseDetails } from "./ui";
import { AppSplash, PageLoader } from "./loaders";
import { ContextPanel } from "./panel";
import { LiveTaskSync } from "./gatePanel";
import { canAccess, isAdmin } from "./access";
import LoginScreen from "./Login";

/* Each screen is its own route-level chunk; the loader map doubles as the
   prefetch registry so hovering a nav item warms the chunk before the click. */
const screenLoaders: Record<PageKey, () => Promise<{ default: ComponentType }>> = {
  home: () => import("./screens/Home"),
  campaigns: () => import("./screens/Campaigns"),
  agents: () => import("./screens/Agents"),
  approvals: () => import("./screens/Approvals"),
  library: () => import("./screens/Library"),
  insights: () => import("./screens/Insights"),
  activity: () => import("./screens/Activity"),
  users: () => import("./screens/Users"),
  intake: () => import("./screens/Intake"),
  rollout: () => import("./screens/Rollout"),
  live: () => import("./screens/Live"),
};

const HomeScreen = lazy(screenLoaders.home);
const CampaignsScreen = lazy(screenLoaders.campaigns);
const AgentsScreen = lazy(screenLoaders.agents);
const ApprovalsScreen = lazy(screenLoaders.approvals);
const LibraryScreen = lazy(screenLoaders.library);
const InsightsScreen = lazy(screenLoaders.insights);
const ActivityScreen = lazy(screenLoaders.activity);
const UsersScreen = lazy(screenLoaders.users);
const IntakeScreen = lazy(screenLoaders.intake);
const RolloutScreen = lazy(screenLoaders.rollout);
const LiveScreen = lazy(screenLoaders.live);

function prefetch(page: PageKey) {
  void screenLoaders[page]();
}

const navItems: { key: PageKey; label: string; icon: Icon }[] = [
  { key: "home", label: "Home", icon: House },
  { key: "campaigns", label: "Campaigns", icon: SquaresFour },
  { key: "agents", label: "Agents", icon: Robot },
  { key: "approvals", label: "Approvals", icon: SealCheck },
  { key: "library", label: "Package library", icon: Package },
  { key: "insights", label: "Insights", icon: ChartLineUp },
  { key: "activity", label: "Activity", icon: ListChecks },
  { key: "live", label: "Live agents", icon: Broadcast },
  { key: "users", label: "Users", icon: UsersThree },
];

const pageTitles: Record<PageKey, string> = {
  home: "Home", campaigns: "Campaigns", agents: "Agents", approvals: "Approvals",
  library: "Package library", insights: "Insights", activity: "Activity",
  users: "Users & roles", intake: "New campaign request", rollout: "Agent workflow",
  live: "Live agents",
};

/* ---- Ask/act intents: deterministic answers over live state, rendered as cited cards.
   The bar answers and routes; it never clears a gate. ---- */

type AnswerRow = { key: string; primary: string; secondary?: string; value?: string; target?: PageKey | NavTarget };
type AnswerCard = { key: string; icon: Icon; title: string; note: string; rows: AnswerRow[] };

const ASK_SUGGESTIONS = ["campaign costs", "what is stalled", "open gates", "agent fleet"];

function buildAnswers(q: string, state: AppState, viewer: Person, now: number): AnswerCard[] {
  const cards: AnswerCard[] = [];
  const openTasks = state.tasks.filter((t) => t.status === "open");

  if (/cost|spend|budget|\$|expensive/.test(q)) {
    const rows = state.campaigns
      .map((c) => ({ c, cost: campaignCost(state, c.id) }))
      .filter((x) => x.cost > 0)
      .sort((a, b) => b.cost - a.cost)
      .map(({ c, cost }): AnswerRow => ({ key: c.id, primary: c.name, secondary: c.state === "approved_locked" ? "Locked" : `Step ${c.step} of 9`, value: `$${cost.toFixed(2)}`, target: { page: "campaigns", campaignId: c.id } }));
    cards.push({ key: "cost", icon: CurrencyDollar, title: "AI cost by campaign", note: `Live from ${state.events.length} telemetry events`, rows });
  }

  if (/stall|overdue|escalat|block|late|risk|stuck/.test(q)) {
    const rows = openTasks
      .map((t) => ({ t, sla: slaInfo(t, now) }))
      .filter((x) => x.sla.level !== "on_pace" || x.sla.remaining === "overdue")
      .sort((a, b) => b.sla.pct - a.sla.pct)
      .map(({ t, sla }): AnswerRow => ({
        key: t.id, primary: t.title,
        secondary: `${state.campaigns.find((c) => c.id === t.campaignId)?.name} · ${personById(state, t.assigneeId)?.name}`,
        value: sla.level === "escalated" ? "Escalated" : sla.remaining === "overdue" ? "Overdue" : sla.remaining.replace("due in", "Due in"),
        target: t.assigneeId === viewer.id ? { page: "approvals", taskId: t.id } : "approvals",
      }));
    cards.push({ key: "stalled", icon: Warning, title: "At risk or stalled", note: "Open gates past 90% of their review window, or escalated", rows });
  }

  if (/wait|gate|who|pending|approvals? open|blocking/.test(q)) {
    const rows = openTasks.map((t): AnswerRow => ({
      key: t.id, primary: state.campaigns.find((c) => c.id === t.campaignId)?.name ?? "Campaign",
      secondary: t.title, value: personById(state, t.assigneeId)?.name.split(" ")[0],
      target: t.assigneeId === viewer.id ? { page: "approvals", taskId: t.id } : "approvals",
    }));
    cards.push({ key: "gates", icon: HourglassMedium, title: "Open human gates", note: "Every open decision and who holds it", rows });
  }

  if (/agent|fleet|autonomy|runs?\b/.test(q)) {
    const runCount = new Map<string, number>();
    state.events.forEach((e) => runCount.set(e.agent, (runCount.get(e.agent) ?? 0) + 1));
    const rows = costByAgent(state).slice(0, 5).map(({ agent, cost }): AnswerRow => ({
      key: agent, primary: agentName(agent as Parameters<typeof agentName>[0]),
      secondary: `${runCount.get(agent) ?? 0} runs`, value: `$${cost.toFixed(2)}`, target: "agents",
    }));
    cards.push({ key: "fleet", icon: Robot, title: "Agent fleet", note: "Runs and cost from the event log", rows });
  }

  return cards;
}

function AskBar() {
  const { state, now, viewer } = useStore();
  const { go } = useNav();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const answers = q ? buildAnswers(q, state, viewer, now) : [];
    const campaigns = state.campaigns.filter((c) => q && c.name.toLowerCase().includes(q));
    const tasks = openTasksFor(state, viewer.id).filter((t) => !q || t.title.toLowerCase().includes(q) || q.includes("task") || q.includes("approv"));
    return { answers, campaigns, tasks };
  }, [query, state, viewer, now]);

  function pick(target?: PageKey | NavTarget) {
    if (target) go(target);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="ask-wrap">
      <div className={`ask-bar as-input${open ? " open" : ""}`}>
        <MagnifyingGlass size={16} />
        <input ref={inputRef} value={query} placeholder="Ask the studio or search…" aria-label="Ask the studio or search campaigns and tasks"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        <MicButton onText={(t) => { setQuery(t); setOpen(true); inputRef.current?.focus(); }} />
        <kbd>⌘K</kbd>
      </div>
      {open && (
        <div className="ask-popover">
          {!query.trim() && (
            <div className="ask-suggest">
              {ASK_SUGGESTIONS.map((s) => (
                <button key={s} onMouseDown={(e) => { e.preventDefault(); setQuery(s); inputRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
          )}
          {results.answers.map((card) => {
            const CardIcon = card.icon;
            return (
              <div className="ask-answer" key={card.key}>
                <div className="ask-answer-head"><CardIcon size={14} /><strong>{card.title}</strong><small>{card.note}</small></div>
                {card.rows.length === 0 && <p className="ask-empty">Nothing matches right now, which is the honest answer.</p>}
                {card.rows.slice(0, 5).map((r) => (
                  <button key={r.key} className="ask-answer-row" onMouseDown={() => pick(r.target)}>
                    <span><strong>{r.primary}</strong>{r.secondary && <small>{r.secondary}</small>}</span>
                    {r.value && <em>{r.value}</em>}
                  </button>
                ))}
              </div>
            );
          })}
          {results.campaigns.length > 0 && <p className="meta-label">Campaigns</p>}
          {results.campaigns.map((c) => (
            <button className="ask-result" key={c.id} onMouseDown={() => pick({ page: "campaigns", campaignId: c.id })}>
              <strong>{c.name}</strong><small>Step {c.step} of 9 · {c.state.replace(/_/g, " ")}</small>
            </button>
          ))}
          <p className="meta-label">{query.trim() ? "Your matching tasks" : "Your open tasks"}</p>
          {results.tasks.length === 0 && <p className="ask-empty">Nothing open for {viewer.name.split(" ")[0]}.</p>}
          {results.tasks.slice(0, 4).map((t) => (
            <button className="ask-result" key={t.id} onMouseDown={() => pick({ page: "approvals", taskId: t.id })}>
              <strong>{t.title}</strong><small>{state.campaigns.find((c) => c.id === t.campaignId)?.name}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationsBell() {
  const { state, now, viewer, actions } = useStore();
  const { go } = useNav();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mine = state.notifications.filter((n) => n.personId === viewer.id).sort((a, b) => b.ts - a.ts);
  const unread = mine.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button aria-label={`Notifications, ${unread} unread`} aria-expanded={open} className={`notification${open ? " open" : ""}${unread > 0 ? " has-unread" : ""}`} onClick={() => setOpen(!open)}>
        <Bell size={18} weight={unread > 0 ? "duotone" : "regular"} />{unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <div className="notif-head-title"><strong>Notifications</strong>{unread > 0 && <span className="notif-unread-chip">{unread} new</span>}</div>
            {unread > 0 && <button className="text-link" onClick={() => actions.markAllRead()}><Checks size={14} /> Mark all read</button>}
          </div>
          {mine.length === 0 && (
            <div className="notif-empty">
              <span className="notif-empty-icon"><BellSlash size={20} /></span>
              <strong>You are all caught up</strong>
              <p>Agents notify {viewer.name.split(" ")[0]} here the moment a gate, revision or escalation needs attention.</p>
            </div>
          )}
          {mine.slice(0, 8).map((n) => {
            const campaign = n.campaignId ? state.campaigns.find((c) => c.id === n.campaignId) : undefined;
            return (
              <button key={n.id} className={`notif-row${n.read ? "" : " unread"}`} style={campaign ? toneVars(campaign.id, state.campaigns) : undefined}
                onClick={() => { if (n.campaignId) go({ page: "campaigns", campaignId: n.campaignId }); setOpen(false); }}>
                <span className="notif-mark">{campaign ? campaign.code : <Bell size={14} />}</span>
                <span className="notif-body">
                  <p>{n.text}</p>
                  <small title={fullStamp(n.ts)}>{campaign ? `${campaign.name} · ` : ""}{stampTime(n.ts, now)}</small>
                </span>
                {!n.read && <span className="notif-dot" aria-label="Unread" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotFound() {
  const { go } = useNav();
  return (
    <div className="screen-content not-found">
      <p className="meta-label">404</p>
      <h1>This page does not exist</h1>
      <p>The address may be old or mistyped. Everything in the studio is reachable from the sidebar.</p>
      <button className="primary-button" onClick={() => go("home")}>Back to home</button>
    </div>
  );
}

/* Mounts only once the first route chunk has resolved, flipping the Suspense
   fallback from the branded splash to the lightweight in-page loader. */
function BootMark({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady(); }, [onReady]);
  return null;
}

function RoleGate() {
  const { viewer } = useStore();
  const { go } = useNav();
  return (
    <div className="screen-content not-found">
      <p className="meta-label">Not part of your workspace</p>
      <h1>This area isn't shown to {viewer.role}s</h1>
      <p>The studio shows each role only the surfaces where they act — approvals you own, campaigns you work on. AiCoE manages access on the Users page.</p>
      <button className="primary-button" onClick={() => go("home")}>Back to home</button>
    </div>
  );
}

function Shell() {
  const { state, viewer, authed, logout, actions } = useStore();
  const { nav, go } = useNav();
  const { pathname } = useLocation();
  const routePending = useContext(NavTransitionContext)?.pending ?? false;
  const [booted, setBooted] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("shiftai.sidebar") === "collapsed"; } catch { return false; }
  });
  const [ctxOpen, setCtxOpen] = useState(() => {
    try { return localStorage.getItem("shiftai.ctxpanel") === "open"; } catch { return false; }
  });
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("shiftai.ctxpanel", ctxOpen ? "open" : "closed"); } catch { /* unavailable */ }
  }, [ctxOpen]);
  const profileMenuRef = useRef<HTMLDetailsElement>(null);
  useAutoCloseDetails(profileMenuRef);
  useEffect(() => {
    try { localStorage.setItem("shiftai.sidebar", collapsed ? "collapsed" : "open"); } catch { /* unavailable */ }
  }, [collapsed]);

  const openCount = openTasksFor(state, viewer.id).length;
  const activePage = nav.page;

  useEffect(() => {
    document.title = `${pageTitles[activePage]} · ShiftAI Marketing Studio`;
  }, [activePage]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (!authed) return <LoginScreen />;
  const visibleNav = navItems.filter((item) => canAccess(viewer.role, item.key));
  const pageAllowed = canAccess(viewer.role, activePage);

  return (
    <main className={`app-shell${collapsed ? " is-collapsed" : ""}${ctxOpen ? " panel-open" : ""}`}>
      {routePending && <span className="route-progress" aria-hidden="true" />}
      <LiveTaskSync />{/* headless: mirrors live gate tasks into the queue on every page */}
      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="brand" onClick={() => go("home")}><span className="brand-mark"><img src="/logo-icon.svg" alt="ShiftAI" /></span><span className="brand-text"><strong>ShiftAI</strong><small>Marketing Studio</small></span></button>
          <button className="collapse-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><SidebarSimple size={18} /></button>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {visibleNav.map((item) => {
            const NavIcon = item.icon;
            const badge = item.key === "approvals" && openCount > 0 ? String(openCount) : undefined;
            return (
              <button key={item.key} className={activePage === item.key ? "active" : ""} aria-current={activePage === item.key ? "page" : undefined} title={collapsed ? item.label : undefined}
                onMouseEnter={() => prefetch(item.key)} onFocus={() => prefetch(item.key)} onClick={() => go(item.key)}>
                <span className="nav-icon"><NavIcon size={18} /></span><span className="nav-text">{item.label}</span>{badge && <em>{badge}</em>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {canAccess(viewer.role, "rollout") && (
            <button className={`rollout-link${activePage === "rollout" ? " active" : ""}`} title={collapsed ? "Agent workflow" : undefined}
              onMouseEnter={() => prefetch("rollout")} onFocus={() => prefetch("rollout")} onClick={() => go("rollout")}><span className="nav-icon"><FlowArrow size={18} /></span><span className="nav-text">Agent workflow</span></button>
          )}
          <details className="menu profile-menu" ref={profileMenuRef}>
            <summary className="profile" title={collapsed ? viewer.name : undefined}>
              <Avatar initials={viewer.initials} />
              <span className="profile-text"><strong>{viewer.name}</strong><small>{viewer.id !== authed.id ? `viewing as · signed in: ${authed.name.split(" ")[0]}` : viewer.role}</small></span>
              <CaretDown size={14} />
            </summary>
            <div className="menu-list up" onClick={(e) => ((e.currentTarget.parentElement as HTMLDetailsElement).open = false)}>
              {isAdmin(authed.role) && (
                <>
                  <p className="menu-label">View workspace as (admin)</p>
                  {state.people.filter((p) => p.status === "Active").map((p) => (
                    <button key={p.id} onClick={() => actions.setViewAs(p.id)} disabled={p.id === viewer.id}>{p.name} · {p.role}{p.id === viewer.id ? " (current)" : ""}</button>
                  ))}
                  <div className="menu-sep" />
                  <button onClick={() => actions.reset()}><ArrowClockwise size={14} /> Reset demo data</button>
                  <div className="menu-sep" />
                </>
              )}
              <button onClick={() => logout()}><SignOut size={14} /> Sign out{authed ? ` (${authed.name.split(" ")[0]})` : ""}</button>
            </div>
          </details>
        </div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <AskBar />
          <div className="top-actions">
            <button className="help-button" aria-label="How this demo works" title="How this demo works" onClick={() => setHelpOpen(true)}><Question size={17} /></button>
            <NotificationsBell />
            <button className={`ctx-toggle${ctxOpen ? " active" : ""}`} aria-pressed={ctxOpen} aria-label={ctxOpen ? "Close context panel" : "Open context panel"} title="Context panel" onClick={() => setCtxOpen(!ctxOpen)}><SidebarSimple size={17} className="flip-x" /></button>
            <span className="role-chip" title={roleTypes.find((r) => r.name === viewer.role)?.gate}>{viewer.role}</span>
          </div>
        </header>
        <Suspense fallback={booted ? <PageLoader /> : <AppSplash />}>
          <BootMark onReady={() => setBooted(true)} />
          {!pageAllowed ? <RoleGate /> : (
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/campaigns" element={<CampaignsScreen />} />
            <Route path="/campaigns/:campaignId" element={<CampaignsScreen />} />
            <Route path="/agents" element={<AgentsScreen />} />
            <Route path="/approvals" element={<ApprovalsScreen />} />
            <Route path="/approvals/:taskId" element={<ApprovalsScreen />} />
            <Route path="/library" element={<LibraryScreen />} />
            <Route path="/insights" element={<InsightsScreen />} />
            <Route path="/activity" element={<ActivityScreen />} />
            <Route path="/users" element={<UsersScreen />} />
            <Route path="/intake" element={<IntakeScreen />} />
            <Route path="/workflow" element={<RolloutScreen />} />
            <Route path="/live" element={<LiveScreen />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          )}
        </Suspense>
      </section>
      {ctxOpen && <ContextPanel onClose={() => setCtxOpen(false)} />}
      <TraceDrawer />
      <Toast />
      {helpOpen && (
        <Modal title="How this demo works" onClose={() => setHelpOpen(false)}>
          <p><strong>One pipeline, real state.</strong> Every number is computed from the telemetry event log (STS v1.1) and every action you take advances the same shared state: submit a request, answer the agent's gap questions, resolve conflicts, approve, sign off.</p>
          <p><strong>Explainability.</strong> Click any activity line, journey-step trace, or KPI to see exactly where a number or decision came from: actor, model, tokens, cost, timing and the state transition with its reason.</p>
          <p><strong>Personas.</strong> You act as one person at a time. Use the profile menu to view the workspace as Marcus (brief approvals, sign-offs), Jen (content reviews), Tom (Grammar QA) or Sofia, and complete the pipeline end to end.</p>
          <p className="explain-note">State persists in this browser. "Reset demo data" in the profile menu returns everything to the starting point.</p>
        </Modal>
      )}
    </main>
  );
}

export default function App() {
  const [pending, startTransition] = useTransition();
  const transition = useMemo(() => ({ pending, start: (fn: () => void) => startTransition(fn) }), [pending]);
  return (
    <StoreProvider>
      <NavTransitionContext.Provider value={transition}>
        <Shell />
      </NavTransitionContext.Provider>
    </StoreProvider>
  );
}
