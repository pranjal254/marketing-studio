import { createContext, useCallback, useContext, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { PageKey } from "./types";

/* Route transitions run inside a shared React transition: the previous screen
   stays interactive while the next chunk loads, and the shell shows a slim
   progress bar driven by `pending`. */
export const NavTransitionContext = createContext<{ pending: boolean; start: (fn: () => void) => void } | null>(null);

/* Route-backed navigation. Screens keep the same useNav() API they always had;
   under the hood every target is a real URL, so deep links, back/forward and
   per-route code splitting all work. */

export type NavTarget = {
  page: PageKey;
  campaignId?: string;
  taskId?: string;
  agentFilter?: string;
};

export type NavApi = {
  nav: NavTarget;
  go: (target: PageKey | NavTarget) => void;
};

const pagePaths: Record<PageKey, string> = {
  home: "/",
  campaigns: "/campaigns",
  agents: "/agents",
  approvals: "/approvals",
  library: "/library",
  insights: "/insights",
  activity: "/activity",
  users: "/users",
  intake: "/intake",
  rollout: "/workflow",
  live: "/live",
};

export function pathFor(target: PageKey | NavTarget): string {
  const t = typeof target === "string" ? { page: target } : target;
  switch (t.page) {
    case "campaigns": return t.campaignId ? `/campaigns/${t.campaignId}` : "/campaigns";
    case "approvals": return t.taskId ? `/approvals/${t.taskId}` : "/approvals";
    case "activity": {
      const q = new URLSearchParams();
      if (t.agentFilter) q.set("agent", t.agentFilter);
      if (t.campaignId) q.set("campaign", t.campaignId);
      const s = q.toString();
      return s ? `/activity?${s}` : "/activity";
    }
    case "rollout": return t.campaignId ? `/workflow?campaign=${t.campaignId}` : "/workflow";
    default: return pagePaths[t.page];
  }
}

export function parseNav(pathname: string, search: string): NavTarget {
  const [head, second] = pathname.split("/").filter(Boolean);
  const q = new URLSearchParams(search);
  switch (head) {
    case undefined: return { page: "home" };
    case "campaigns": return { page: "campaigns", campaignId: second };
    case "approvals": return { page: "approvals", taskId: second };
    case "activity": return { page: "activity", agentFilter: q.get("agent") ?? undefined, campaignId: q.get("campaign") ?? undefined };
    case "workflow": return { page: "rollout", campaignId: q.get("campaign") ?? undefined };
    case "agents": return { page: "agents" };
    case "library": return { page: "library" };
    case "insights": return { page: "insights" };
    case "users": return { page: "users" };
    case "intake": return { page: "intake" };
    case "live": return { page: "live" };
    default: return { page: "home" };
  }
}

export function useNav(): NavApi {
  const location = useLocation();
  const navigate = useNavigate();
  const transition = useContext(NavTransitionContext);
  const nav = useMemo(() => parseNav(location.pathname, location.search), [location.pathname, location.search]);
  const go = useCallback((target: PageKey | NavTarget) => {
    const run = () => navigate(pathFor(target));
    if (transition) transition.start(run); else run();
  }, [navigate, transition]);
  return { nav, go };
}
