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
   - Marketing Lead ...... requests campaigns + owns mid-journey decisions:
                           intake, campaigns, approvals, library, insights,
                           agents, activity, workflow map
   - BU Campaign Lead .... approves briefs / signs off packages: same as
                           Marketing Lead minus intake (they don't request)
   - Content Writer ...... their work only: home, campaigns, their approvals
   - Grammar / Quality ... same as writers: home, campaigns, their approvals
   - Viewer .............. read-only: home, campaigns, package library */
const ROLE_PAGES: Record<Role, PageKey[]> = {
  "AiCoE Admin": [
    "home", "intake", "campaigns", "agents", "approvals", "library",
    "insights", "activity", "live", "rollout", "users",
  ],
  "Marketing Lead": [
    "home", "intake", "campaigns", "agents", "approvals", "library",
    "insights", "activity", "rollout",
  ],
  "BU Campaign Lead": [
    "home", "campaigns", "agents", "approvals", "library", "insights",
    "activity", "rollout",
  ],
  "Content Writer": ["home", "campaigns", "approvals"],
  "Grammar / Quality Reviewer": ["home", "campaigns", "approvals"],
  "Viewer": ["home", "campaigns", "library"],
};

export function canAccess(role: Role, page: PageKey): boolean {
  return ROLE_PAGES[role].includes(page);
}

export function pagesFor(role: Role): PageKey[] {
  return ROLE_PAGES[role];
}

export function isAdmin(role: Role): boolean {
  return role === "AiCoE Admin";
}
