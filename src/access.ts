/* Role-based access: which parts of the studio each role sees. The principle is
   focus, not secrecy — every role gets exactly the surfaces where THEY act, so a
   content writer isn't buried under fleet telemetry and cost dashboards.

   Auth is a lightweight shared-password gate for the testing phase (SSO replaces
   it in production — access is then provisioned via LevelShift Entra ID). */

import type { PageKey, Role } from "./types";

/* Default password for every workspace account, handed out by AiCoE.
   Deliberately not a secret: this is a demo/test gate, not production auth. */
export const DEFAULT_PASSWORD = "levelshift2@26";

/* What each role sees:
   - AiCoE Admin ......... everything, incl. Users (member management) and the
                           Live agents ops console (kill switch, raw STS stream)
   - BU Campaign Lead .... requests campaigns, approves briefs, owns mid-journey
                           content decisions and signs off packages: intake,
                           campaigns, approvals, library, insights, agents,
                           activity, workflow map. (Absorbed the former
                           Marketing Lead role; see normalizeRole.)
   - Content Writer ...... their work only: home, campaigns, their approvals
   - Grammar / Quality ... same as writers: home, campaigns, their approvals
   - Viewer .............. read-only: home, campaigns, package library
   Ask anything is on every list: it is read-only and answers only from the
   state the viewer already has, so it adds no reach that the role lacks. */
const ROLE_PAGES: Record<Role, PageKey[]> = {
  "AiCoE Admin": [
    "home", "intake", "campaigns", "agents", "approvals", "library",
    "insights", "activity", "live", "rollout", "users", "ask",
  ],
  "BU Campaign Lead": [
    "home", "intake", "campaigns", "agents", "approvals", "library",
    "insights", "activity", "rollout", "ask",
  ],
  "Content Writer": ["home", "campaigns", "approvals", "ask"],
  "Grammar / Quality Reviewer": ["home", "campaigns", "approvals", "ask"],
  "Viewer": ["home", "campaigns", "library", "ask"],
};

/* Roles that no longer exist, mapped to the role that absorbed them. Old users
   rows, cached localStorage state and historic agent cases may still carry these
   labels; everything that reads a role goes through normalizeRole. */
const LEGACY_ROLES: Record<string, Role> = {
  "Marketing Lead": "BU Campaign Lead",
};

export function normalizeRole(role: string): Role {
  return LEGACY_ROLES[role] ?? (role as Role);
}

export function canAccess(role: Role, page: PageKey): boolean {
  return (ROLE_PAGES[normalizeRole(role)] ?? []).includes(page);
}

export function pagesFor(role: Role): PageKey[] {
  return ROLE_PAGES[normalizeRole(role)] ?? [];
}

export function isAdmin(role: Role): boolean {
  return role === "AiCoE Admin";
}
