import { Suspense, lazy, useContext, useEffect, useMemo, useRef, useState, useTransition, type ComponentType } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import {
  ArrowClockwise, Bell, BellSlash, CaretDown, ChartLineUp, Checks, FlowArrow, House, ListChecks,
  MagnifyingGlass, Package, Question, Robot, SealCheck, SidebarSimple, SquaresFour,
  UsersThree, type Icon,
} from "@phosphor-icons/react";
import type { PageKey } from "./types";
import { fullStamp, roleTypes, stampTime, toneVars } from "./data";
import { StoreProvider, openTasksFor, useStore } from "./store";
import { NavTransitionContext, useNav } from "./nav";
import { Avatar, MicButton, Modal, Toast, TraceDrawer, useAutoCloseDetails } from "./ui";
import { AppSplash, PageLoader } from "./loaders";

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
  { key: "users", label: "Users", icon: UsersThree },
];

const pageTitles: Record<PageKey, string> = {
  home: "Home", campaigns: "Campaigns", agents: "Agents", approvals: "Approvals",
  library: "Package library", insights: "Insights", activity: "Activity",
  users: "Users & roles", intake: "New campaign request", rollout: "Agent workflow",
};

function AskBar() {
  const { state, viewer } = useStore();
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
    const campaigns = state.campaigns.filter((c) => q && c.name.toLowerCase().includes(q));
    const tasks = openTasksFor(state, viewer.id).filter((t) => !q || t.title.toLowerCase().includes(q) || q.includes("task") || q.includes("approv"));
    return { campaigns, tasks };
  }, [query, state, viewer.id]);

  return (
    <div className="ask-wrap">
      <div className={`ask-bar as-input${open ? " open" : ""}`}>
        <MagnifyingGlass size={16} />
        <input ref={inputRef} value={query} placeholder="Search campaigns and your tasks…" aria-label="Search campaigns and tasks"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        <MicButton onText={(t) => { setQuery(t); setOpen(true); inputRef.current?.focus(); }} />
        <kbd>⌘K</kbd>
      </div>
      {open && (
        <div className="ask-popover">
          {results.campaigns.length > 0 && <p className="meta-label">Campaigns</p>}
          {results.campaigns.map((c) => (
            <button className="ask-result" key={c.id} onMouseDown={() => { go({ page: "campaigns", campaignId: c.id }); setOpen(false); setQuery(""); }}>
              <strong>{c.name}</strong><small>Step {c.step} of 9 · {c.state.replace(/_/g, " ")}</small>
            </button>
          ))}
          <p className="meta-label">{query.trim() ? "Your matching tasks" : "Your open tasks"}</p>
          {results.tasks.length === 0 && <p className="ask-empty">Nothing open for {viewer.name.split(" ")[0]}.</p>}
          {results.tasks.slice(0, 4).map((t) => (
            <button className="ask-result" key={t.id} onMouseDown={() => { go({ page: "approvals", taskId: t.id }); setOpen(false); setQuery(""); }}>
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

function Shell() {
  const { state, viewer, actions } = useStore();
  const { nav, go } = useNav();
  const { pathname } = useLocation();
  const routePending = useContext(NavTransitionContext)?.pending ?? false;
  const [booted, setBooted] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("shiftai.sidebar") === "collapsed"; } catch { return false; }
  });
  const [helpOpen, setHelpOpen] = useState(false);
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

  return (
    <main className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
      {routePending && <span className="route-progress" aria-hidden="true" />}
      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="brand" onClick={() => go("home")}><span className="brand-mark"><img src="/logo-icon.svg" alt="ShiftAI" /></span><span className="brand-text"><strong>ShiftAI</strong><small>Marketing Studio</small></span></button>
          <button className="collapse-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><SidebarSimple size={18} /></button>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => {
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
          <button className={`rollout-link${activePage === "rollout" ? " active" : ""}`} title={collapsed ? "Agent workflow" : undefined}
            onMouseEnter={() => prefetch("rollout")} onFocus={() => prefetch("rollout")} onClick={() => go("rollout")}><span className="nav-icon"><FlowArrow size={18} /></span><span className="nav-text">Agent workflow</span></button>
          <details className="menu profile-menu" ref={profileMenuRef}>
            <summary className="profile" title={collapsed ? viewer.name : undefined}>
              <Avatar initials={viewer.initials} />
              <span className="profile-text"><strong>{viewer.name}</strong><small>{viewer.role}</small></span>
              <CaretDown size={14} />
            </summary>
            <div className="menu-list up" onClick={(e) => ((e.currentTarget.parentElement as HTMLDetailsElement).open = false)}>
              <p className="menu-label">View workspace as</p>
              {state.people.filter((p) => p.status === "Active").map((p) => (
                <button key={p.id} onClick={() => actions.setViewAs(p.id)} disabled={p.id === viewer.id}>{p.name} · {p.role}{p.id === viewer.id ? " (current)" : ""}</button>
              ))}
              <div className="menu-sep" />
              <button onClick={() => actions.reset()}><ArrowClockwise size={14} /> Reset demo data</button>
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
            <span className="role-chip" title={roleTypes.find((r) => r.name === viewer.role)?.gate}>{viewer.role}</span>
          </div>
        </header>
        <Suspense fallback={booted ? <PageLoader /> : <AppSplash />}>
          <BootMark onReady={() => setBooted(true)} />
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </section>
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
