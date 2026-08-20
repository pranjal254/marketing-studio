import { createContext, useContext } from "react";
import type { PageKey } from "./types";

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

export const NavContext = createContext<NavApi | null>(null);

export function useNav(): NavApi {
  const api = useContext(NavContext);
  if (!api) throw new Error("useNav outside provider");
  return api;
}
