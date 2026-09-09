/* Agent 5 (Quality Gate & Approval), embedded where approvers work:
   - the compliance verdicts per asset (rule, location, verbatim quote, remediation)
   - the sequenced human review queue (Grammar QA → BU Lead package sign-off)
   - the approval chain (identity + hash per decision) and the read-only locks
   All state lives on the bridge; the gate flags and blocks — every approval here
   is an identity-stamped human action. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight, ArrowSquareOut, CheckCircle, LockSimple, SealCheck, ShieldCheck,
  WarningCircle, XCircle,
} from "@phosphor-icons/react";
import {
  buildBoxSync, liveApi, LiveApiError,
  type BoxDetail, type GateDetail, type GateFinding, type GateReport, type GateTask,
} from "./live";
import { useStore } from "./store";
import { BusyButton, Chip } from "./ui";
import type { Campaign, Task } from "./types";

/* Plain-language "what happens next" for whoever is looking at the gate, keyed on
   where the package is in the flow. The gate is a loop, not a verdict, so every
   state points at the concrete next action and who owns it. */
type FailedAsset = { assetId: string; name: string; blocking: number; advisory: number };

function GateNextSteps({
  status,
  failedAssets,
  openAssetReviews,
  hasPackageTask,
  canProduce,
  onFixAsset,
  onReRun,
  onGoToProduction,
}: {
  status: string;
  failedAssets: FailedAsset[];
  openAssetReviews: number;
  hasPackageTask: boolean;
  canProduce: boolean;
  onFixAsset: (assetId: string) => void;
  onReRun: () => void;
  onGoToProduction: () => void;
}) {
  if (status === "gate_failed") {
    const totalBlocking = failedAssets.reduce((n, a) => n + a.blocking, 0);
    return (
      <div className="gate-next tone-red">
        <strong>This package can&apos;t pass yet — here&apos;s exactly what to fix</strong>
        <p>
          {totalBlocking} blocking issue{totalBlocking === 1 ? "" : "s"} across{" "}
          {failedAssets.length} asset{failedAssets.length === 1 ? "" : "s"} must be
          resolved before the gate can pass. Advisory notes are suggestions and don&apos;t
          block. The exact findings are already waiting as review comments on each draft.
        </p>
        {canProduce ? (
          <ol className="gate-steps">
            <li>Open each asset below and fix its blocking findings. The quickest way is the
              <strong> Rework using this feedback</strong> button on the draft, which pre-fills the
              agent with the findings so you can edit and regenerate.</li>
            <li>Re-confirm the reworked assets, then <strong>Run packaging</strong> again in Content production.</li>
            <li>Come back here and <strong>Re-run the quality gate</strong>.</li>
          </ol>
        ) : (
          <p className="gate-role-note">
            The assets are back with the content writers to fix. You&apos;ll be notified when
            they&apos;ve reworked and re-packaged, and the gate can be re-run.
          </p>
        )}
        <div className="gate-fix-list">
          {failedAssets.map((a) => (
            <button key={a.assetId} type="button" className="gate-fix-item"
              onClick={() => onFixAsset(a.assetId)}>
              <span className="gate-fix-name">{a.name}</span>
              <span className="gate-fix-count">
                {a.blocking} to fix{a.advisory > 0 ? ` · ${a.advisory} optional` : ""}
              </span>
              <ArrowRight size={14} weight="bold" />
            </button>
          ))}
        </div>
        {canProduce && (
          <div className="gate-next-actions">
            <button type="button" className="secondary-button" onClick={onGoToProduction}>
              Go to content production
            </button>
            <button type="button" className="text-link" onClick={onReRun}>
              I&apos;ve already reworked and re-packaged — re-run the gate
            </button>
          </div>
        )}
      </div>
    );
  }
  if (status === "in_review") {
    return (
      <div className="gate-next tone-blue">
        <strong>What happens next</strong>
        <p>
          Every asset passed the automated gate. Now the human review runs in order:
          approve each asset&apos;s language QA below, then the BU Campaign Lead signs off
          the whole package. Disagree with a machine finding? Return it with a note and
          flag it as a dispute; it is logged for calibration.
        </p>
      </div>
    );
  }
  if (status === "returned") {
    return (
      <div className="gate-next tone-amber">
        <strong>A reviewer sent assets back for changes</strong>
        <p>
          The returned assets are back with the content writers. Once they&apos;ve reworked
          and re-packaged, re-run the quality gate.
        </p>
        {canProduce && (
          <button type="button" className="secondary-button" onClick={onGoToProduction}>
            Go to content production
          </button>
        )}
      </div>
    );
  }
  if (status === "approved_locked") {
    return (
      <div className="gate-next tone-green">
        <strong>Approved and locked</strong>
        <p>
          Every gate and human approval is recorded (identity, role and hash per
          decision). The approved versions are locked read-only, ready for Phase 2
          launch. Nothing is published from here.
        </p>
      </div>
    );
  }
  if (openAssetReviews > 0 || hasPackageTask) {
    return (
      <div className="gate-next tone-blue">
        <strong>What happens next</strong>
        <p>Work through the human review queue below in order.</p>
      </div>
    );
  }
  return null;
}

function gateStatusTone(status: string): "neutral" | "green" | "amber" | "blue" | "red" {
  switch (status) {
    case "approved_locked": return "green";
    case "in_review": return "blue";
    case "returned": return "amber";
    case "gate_failed": case "invalidated": return "red";
    default: return "neutral";
  }
}

const GATE_STATUS_LABEL: Record<string, string> = {
  gate_failed: "Gate failed — returned to rework",
  in_review: "Gate passed — human review running",
  returned: "Returned by a reviewer",
  approved_locked: "Approved & locked",
  invalidated: "Invalidated — post-lock modification",
};

const STEP_LABEL: Record<string, string> = {
  grammar_qa: "Grammar / Quality review",
  grammar_qa_light: "Grammar pass (internal asset)",
  bu_lead_signoff: "BU Campaign Lead — package sign-off",
};

/* Human gates are role-gated: the bridge records whoever decides, but the studio
   only offers the decision to the right role (AiCoE Admin may override in dev). */
const ROLE_FOR_STEP: Record<string, string> = {
  grammar_qa: "Grammar / Quality Reviewer",
  grammar_qa_light: "Grammar / Quality Reviewer",
  bu_lead_signoff: "BU Campaign Lead",
};

function canDecide(viewerRole: string, step: string): boolean {
  const required = ROLE_FOR_STEP[step];
  return !required || viewerRole === required || viewerRole === "AiCoE Admin";
}

function FindingRow({ finding }: { finding: GateFinding }) {
  return (
    <div className={`gate-finding ${finding.severity}`}>
      <div className="gate-finding-head">
        <Chip tone={finding.severity === "blocking" ? "red" : "amber"}>
          {finding.severity}
        </Chip>
        <code>{finding.rule_id}</code>
        <span className="gate-finding-src">{finding.source}</span>
        {finding.location && <span className="gate-finding-loc">{finding.location}</span>}
        {!finding.quote_verified && finding.quote && (
          <Chip tone="amber">quote unverified</Chip>
        )}
      </div>
      {finding.quote && <blockquote className="gate-quote">“{finding.quote}”</blockquote>}
      {(finding.remediation || finding.reasoning) && (
        <p className="gate-remedy">{finding.remediation || finding.reasoning}</p>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: GateReport }) {
  const blocking = report.findings.filter((f) => f.severity === "blocking");
  const advisory = report.findings.filter((f) => f.severity === "advisory");
  return (
    <details className="gate-report" open={report.verdict === "fail"}>
      <summary>
        <Chip tone={report.verdict === "pass" ? "green" : "red"}>
          {report.verdict === "pass" ? "pass" : "fail"}
        </Chip>
        <strong>{report.asset_id.replace(/_/g, " ")}</strong>
        <span className="gate-report-meta">
          v{report.version} · {blocking.length} blocking · {advisory.length} advisory
          {!report.checks_complete && " · checks incomplete"}
        </span>
      </summary>
      {!report.checks_complete && (
        <p className="live-note">
          <WarningCircle size={13} /> Fail-closed: {report.incomplete_reason}
        </p>
      )}
      {report.findings.length === 0 && report.checks_complete && (
        <p className="gate-clean"><CheckCircle size={14} /> No findings — every rule passed.</p>
      )}
      {report.findings.map((f, i) => <FindingRow key={`${f.rule_id}-${i}`} finding={f} />)}
      <p className="gate-report-foot">
        Rules pack {report.rules_pack_id} v{report.rules_pack_version} ·
        deterministic {report.deterministic_ms}ms · contextual {report.contextual_ms}ms ·
        sha {report.sha256.slice(0, 12)}…
      </p>
    </details>
  );
}

export function LiveGatePanel({
  campaign,
  context = "campaign",
}: {
  campaign: Campaign;
  /* "campaign": full panel on the campaign's Content production tab (shows
     empty/gone states so the stage is always visible in its home).
     "approvals": the reviewer surface — renders ONLY when there is live gate
     work to see (a manifest or a gate state), and never for campaigns the
     bridge no longer knows. */
  context?: "campaign" | "approvals";
}) {
  const { state: appState, actions, viewer, showToast } = useStore();
  const nameFor = (email: string) =>
    appState.people.find((p) => p.email === email)?.name ?? email;
  const boxId = campaign.liveCampaignId;
  const [box, setBox] = useState<BoxDetail | null>(null);
  const [gate, setGate] = useState<GateDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  const [returnFor, setReturnFor] = useState<string | null>(null);
  const [returnNotes, setReturnNotes] = useState("");
  const [disputed, setDisputed] = useState<Set<string>>(new Set());
  const [returnAssets, setReturnAssets] = useState<Set<string>>(new Set());
  const loading = useRef(false);

  const reload = useCallback(async () => {
    if (!boxId || loading.current) return;
    loading.current = true;
    try {
      const [detail, gateDetail] = await Promise.all([
        liveApi.boxDetail(boxId), liveApi.boxGate(boxId),
      ]);
      setBox(detail);
      setGate(gateDetail);
      setOffline(false);
      setGone(false);
    } catch (e) {
      if (e instanceof LiveApiError && e.status === 404) setGone(true);
      else setOffline(true);
    } finally { loading.current = false; }
  }, [boxId]);

  useEffect(() => {
    if (!boxId || gone) return;
    void reload();
    const timer = window.setInterval(() => void reload(), 12000);
    return () => window.clearInterval(timer);
  }, [boxId, gone, reload]);

  if (!boxId) return null;
  // Approvals is a work queue, not a status page: no dead campaigns (bridge
  // restarted), no not-yet-packaged campaigns — only real gate work.
  if (context === "approvals" && (gone || (!gate?.state && !box?.manifest))) return null;

  async function run(action: string, fn: () => Promise<unknown>, done: string) {
    if (busy || !boxId) return;
    setBusyAction(action);
    try {
      await fn();
      await reload();
      try {
        const d = await liveApi.boxDetail(boxId);
        actions.syncLiveBox(buildBoxSync(d, await liveApi.boxTelemetry()));
      } catch { /* mirror only */ }
      showToast(done);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "The gate call failed");
    } finally { setBusyAction(null); }
  }

  function submitDecision(task: GateTask, decision: "approved" | "returned") {
    const notes = decision === "returned" ? returnNotes.trim() : "";
    const assets = task.scope === "package" ? [...returnAssets] : [];
    void run(
      `decide:${task.task_id}:${decision}`,
      () => liveApi.boxGateDecision(
        boxId as string, task.task_id, decision, viewer.email, viewer.role,
        notes, [...disputed], assets,
      ),
      decision === "approved"
        ? (task.scope === "package" ? "Package signed off — versions locked" : "Review approved")
        : "Returned with notes — packaging re-opened",
    ).then(() => {
      setReturnFor(null); setReturnNotes(""); setDisputed(new Set()); setReturnAssets(new Set());
    });
  }

  const state = gate?.state ?? null;
  const manifest = box?.manifest ?? null;
  const reports = gate?.reports ?? [];
  const tasks = gate?.tasks ?? [];
  const openTasks = tasks.filter((t) => t.status === "open");
  const packageTask = openTasks.find((t) => t.scope === "package");
  const assetTasksOpen = openTasks.filter((t) => t.scope === "asset");
  const approvals = gate?.approvals ?? [];
  const locked = state?.status === "approved_locked";
  const folder = box?.case?.folder ?? box?.summary?.folder ?? null;

  const blockingByAsset = (assetId: string): string[] =>
    (reports.find((r) => r.asset_id === assetId)?.findings ?? [])
      .filter((f) => f.severity === "blocking" || f.severity === "advisory")
      .map((f) => f.rule_id);

  // Content production is on the same tab, so the "fix this" jumps are in-page
  // scrolls (with a brief flash), not navigation — the old button routed to the
  // URL we were already on and did nothing.
  const canProduce = viewer.role === "Content Writer" || viewer.role === "AiCoE Admin";
  const failedAssets: FailedAsset[] = reports
    .filter((r) => r.verdict === "fail")
    .map((r) => ({
      assetId: r.asset_id,
      name: r.asset_id.replace(/_/g, " "),
      blocking: r.findings.filter((f) => f.severity === "blocking").length,
      advisory: r.findings.filter((f) => f.severity === "advisory").length,
    }));

  const flashIntoView = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("asset-flash");
    window.setTimeout(() => el.classList.remove("asset-flash"), 1600);
  };

  return (
    <section className="panel gate-panel">
      <header className="gate-head">
        <h3>
          <ShieldCheck size={18} /> Quality gate &amp; approval
          {context === "approvals" && <span className="gate-head-campaign">· {campaign.name}</span>}
        </h3>
        {state
          ? <Chip tone={gateStatusTone(state.status)}>{GATE_STATUS_LABEL[state.status] ?? state.status}</Chip>
          : <Chip tone="neutral">not gated yet</Chip>}
        {state && <span className="gate-report-meta">manifest v{state.manifest_version}</span>}
        <span className="gate-head-actions">
          <BusyButton
            busy={busyAction === "run"} busyLabel="Gating package…"
            disabled={busy || !manifest || locked}
            onClick={() => void run("run", () => liveApi.boxGateRun(boxId), "Quality gate complete")}
          >
            {state ? "Re-run quality gate" : "Run quality gate"}
          </BusyButton>
          {state && !locked && (
            <BusyButton
              kind="secondary" busy={busyAction === "sweep"} busyLabel="Sweeping…"
              disabled={busy}
              onClick={() => void run("sweep", () => liveApi.boxGateSweep(boxId), "SLA sweep complete")}
            >
              SLA sweep
            </BusyButton>
          )}
          {locked && (
            <BusyButton
              kind="secondary" busy={busyAction === "verify"} busyLabel="Verifying…"
              disabled={busy}
              onClick={() => void run("verify", () => liveApi.boxGateVerifyLocks(boxId), "Lock integrity verified")}
            >
              Verify locks
            </BusyButton>
          )}
        </span>
      </header>

      {gone && (
        <p className="live-note">
          <WarningCircle size={13} /> This campaign&apos;s live state no longer exists on the
          agent bridge — the bridge restarted since it was created.
        </p>
      )}
      {offline && !gone && (
        <p className="live-note"><WarningCircle size={13} /> Agent bridge offline.</p>
      )}
      {!gone && !manifest && (
        <p className="gate-empty">
          The gate runs on the package manifest — confirm every asset and run
          packaging in Content production first.
        </p>
      )}

      {state && (
        <GateNextSteps
          status={state.status}
          failedAssets={failedAssets}
          openAssetReviews={assetTasksOpen.length}
          hasPackageTask={Boolean(packageTask)}
          canProduce={canProduce}
          onFixAsset={(assetId) => flashIntoView(`asset-card-${assetId}`)}
          onReRun={() => void run("run", () => liveApi.boxGateRun(boxId), "Quality gate complete")}
          onGoToProduction={() => flashIntoView("content-production")}
        />
      )}

      {reports.length > 0 && (
        <div className="gate-section">
          <h4>Compliance reports <span className="gate-report-meta">— the gate flags and blocks; it never edits</span></h4>
          {reports.map((r) => <ReportCard key={r.asset_id} report={r} />)}
        </div>
      )}

      {(assetTasksOpen.length > 0 || packageTask) && !locked && (
        <div className="gate-section">
          <h4>Human review queue <span className="gate-report-meta">— sequence is structural: assets first, then the package sign-off</span></h4>
          {[...assetTasksOpen, ...(packageTask ? [packageTask] : [])].map((task) => {
            const isReturn = returnFor === task.task_id;
            const gatedByAssets = task.scope === "package" && assetTasksOpen.length > 0;
            const roleOk = canDecide(viewer.role, task.step);
            return (
              <div key={task.task_id} className="gate-task">
                <div className="gate-task-head">
                  {task.scope === "package" ? <SealCheck size={16} /> : <CheckCircle size={16} />}
                  <strong>{STEP_LABEL[task.step] ?? task.step}</strong>
                  {task.asset_id && <Chip tone="neutral">{task.asset_id.replace(/_/g, " ")}</Chip>}
                  <span className="gate-report-meta">
                    {task.role} · due {task.due}
                    {task.reminders_sent > 0 && ` · ${task.reminders_sent} reminder(s)`}
                    {task.escalated && " · escalated"}
                  </span>
                </div>
                {gatedByAssets && (
                  <p className="gate-report-meta">
                    Locked until every asset review above is approved ({assetTasksOpen.length} open).
                  </p>
                )}
                {!roleOk && (
                  <p className="gate-report-meta">
                    Waiting on a {ROLE_FOR_STEP[task.step] ?? task.role} — you are acting
                    as {viewer.name}, {viewer.role}. This task is in their Approvals queue.
                  </p>
                )}
                {isReturn && (
                  <div className="gate-return">
                    <textarea
                      value={returnNotes}
                      onChange={(e) => setReturnNotes(e.target.value)}
                      placeholder="Return notes — travel verbatim to the rework cycle"
                      rows={2}
                    />
                    {task.scope === "asset" && blockingByAsset(task.asset_id).length > 0 && (
                      <div className="gate-disputes">
                        <span>Dispute a gate finding (logs a false-positive calibration example):</span>
                        {blockingByAsset(task.asset_id).map((rule) => (
                          <label key={rule}>
                            <input
                              type="checkbox"
                              checked={disputed.has(rule)}
                              onChange={(e) => {
                                const next = new Set(disputed);
                                if (e.target.checked) next.add(rule); else next.delete(rule);
                                setDisputed(next);
                              }}
                            />
                            <code>{rule}</code>
                          </label>
                        ))}
                      </div>
                    )}
                    {task.scope === "package" && (
                      <div className="gate-disputes">
                        <span>Assets to re-open:</span>
                        {(box?.checklist?.items ?? []).map((item) => (
                          <label key={item.asset_id}>
                            <input
                              type="checkbox"
                              checked={returnAssets.has(item.asset_id)}
                              onChange={(e) => {
                                const next = new Set(returnAssets);
                                if (e.target.checked) next.add(item.asset_id); else next.delete(item.asset_id);
                                setReturnAssets(next);
                              }}
                            />
                            <code>{item.asset_id}</code>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="gate-task-actions">
                  <BusyButton
                    busy={busyAction === `decide:${task.task_id}:approved`}
                    busyLabel={task.scope === "package" ? "Signing off & locking…" : "Approving…"}
                    disabled={busy || gatedByAssets || isReturn || !roleOk}
                    onClick={() => submitDecision(task, "approved")}
                  >
                    {task.scope === "package" ? "Sign off package" : "Approve"}
                  </BusyButton>
                  {isReturn ? (
                    <>
                      <BusyButton
                        kind="secondary"
                        busy={busyAction === `decide:${task.task_id}:returned`}
                        busyLabel="Returning…"
                        disabled={
                          busy || !returnNotes.trim()
                          || (task.scope === "package" && returnAssets.size === 0)
                        }
                        onClick={() => submitDecision(task, "returned")}
                      >
                        Send return
                      </BusyButton>
                      <button
                        type="button" className="secondary-button" disabled={busy}
                        onClick={() => { setReturnFor(null); setReturnNotes(""); setDisputed(new Set()); setReturnAssets(new Set()); }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button" className="secondary-button" disabled={busy || gatedByAssets || !roleOk}
                      onClick={() => { setReturnFor(task.task_id); setDisputed(new Set()); setReturnAssets(new Set()); }}
                    >
                      Return with notes
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {approvals.length > 0 && (
        <div className="gate-section">
          <h4>Approval chain <span className="gate-report-meta">— identity, timestamp, version and hash per decision</span></h4>
          <div className="gate-chain">
            {approvals.map((a) => (
              <div key={a.approval_id} className="gate-chain-row">
                <Chip tone={a.decision === "approved" ? "green" : "amber"}>{a.decision}</Chip>
                <strong>{STEP_LABEL[a.step] ?? a.step}</strong>
                {a.asset_id && <span>{a.asset_id.replace(/_/g, " ")}</span>}
                <span className="gate-report-meta">
                  {nameFor(a.actor_id)} ({a.actor_role}) · {new Date(a.at).toLocaleString()} ·
                  v{a.asset_version} · {a.sha256.slice(0, 10)}…
                </span>
                {a.notes && <em>“{a.notes}”</em>}
              </div>
            ))}
          </div>
        </div>
      )}

      {locked && state && (
        <div className="gate-section">
          <h4><LockSimple size={15} /> Locked package <span className="gate-report-meta">— Phase 1 terminal output, hand-off to Launch &amp; Publishing</span></h4>
          <div className="gate-chain">
            {state.locks.map((lock) => {
              const url = liveApi.boxDocUrl(folder ? `${folder}/final` : null, lock.final_ref);
              return (
                <div key={lock.asset_id} className="gate-chain-row">
                  <LockSimple size={14} />
                  <strong>{lock.asset_id.replace(/_/g, " ")}</strong>
                  <span className="gate-report-meta">{lock.sha256.slice(0, 12)}… · read-only</span>
                  {url && (
                    <a className="text-link" href={url} target="_blank" rel="noreferrer">
                      Open <ArrowSquareOut size={12} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(gate?.calibration.length ?? 0) > 0 && (
        <div className="gate-section">
          <h4>Calibration log <span className="gate-report-meta">— labeled examples for rules-pack tuning</span></h4>
          <div className="gate-chain">
            {gate?.calibration.map((c) => (
              <div key={c.event_id} className="gate-chain-row">
                <Chip tone={c.kind === "false_negative" ? "red" : "amber"}>{c.kind.replace("_", " ")}</Chip>
                <code>{c.rule_id}</code>
                <span>{c.asset_id.replace(/_/g, " ")}</span>
                <span className="gate-report-meta">{c.reviewer_id} · {c.notes}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- global live-task sync (headless, mounted once in the app shell) ----------
   Keeps the studio queue truthful everywhere, on every page:
   - live gate review tasks are mirrored INTO the Approvals queue (role-gated,
     shared claim-on-action) and closed when decided on the bridge;
   - a flagship_confirm task whose flagship was already confirmed on the bridge
     (via the campaign panel) closes itself, so the badge count never lies. */
export function LiveTaskSync() {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const gone = useRef<Set<string>>(new Set());

  useEffect(() => {
    let stopped = false;
    async function sweep() {
      const { state, actions } = storeRef.current;
      const seen = new Set<string>();
      for (const campaign of state.campaigns) {
        const boxId = campaign.liveCampaignId;
        if (!boxId || seen.has(boxId) || gone.current.has(boxId)) continue;
        seen.add(boxId);
        try {
          const [rp, gateDetail] = await Promise.all([
            liveApi.boxDrafts(boxId).catch(() => null),
            liveApi.boxGate(boxId),
          ]);
          if (stopped) return;
          const confirmed =
            rp?.status === "flagship_confirmed" || rp?.status === "derivatives_staged";
          if (confirmed) {
            storeRef.current.state.tasks
              .filter((t) => t.campaignId === campaign.id
                && t.kind === "flagship_confirm" && t.status === "open")
              .forEach((t) => actions.clearFlagshipTask(t.id));
          }
          if (gateDetail.tasks.length > 0) {
            actions.syncGateTasks(campaign.id, gateDetail.tasks.map((t) => ({
              task_id: t.task_id, scope: t.scope, asset_id: t.asset_id,
              step: t.step, status: t.status, due: t.due, decided_by: t.decided_by,
            })));
          }
        } catch (e) {
          if (e instanceof LiveApiError && e.status === 404) gone.current.add(boxId);
          // offline: try again on the next sweep
        }
      }
    }
    void sweep();
    const timer = window.setInterval(() => void sweep(), 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);

  return null;
}

/* ---------- queue detail for a mirrored gate task ----------
   Rendered inside Approvals when the selected task is a live gate review: the
   asset's compliance report (or the package summary), then approve / return —
   recorded on the bridge with the reviewer's identity and role. */
export function GateTaskDetail({ task }: { task: Task }) {
  const { state: appState, actions, viewer, showToast } = useStore();
  const boxId = task.liveCaseId;
  const gateTaskId = task.id.startsWith("gt_") ? task.id.slice(3) : task.id;
  const [gate, setGate] = useState<GateDetail | null>(null);
  const [box, setBox] = useState<BoxDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [notes, setNotes] = useState("");
  const [disputed, setDisputed] = useState<Set<string>>(new Set());
  const [returnAssets, setReturnAssets] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!boxId) return;
    try {
      const [g, b] = await Promise.all([liveApi.boxGate(boxId), liveApi.boxDetail(boxId)]);
      setGate(g);
      setBox(b);
    } catch { /* offline/gone — the queue mirror will close via sync */ }
  }, [boxId]);

  useEffect(() => { void reload(); }, [reload]);

  if (!boxId) return <p className="live-empty">This task is not backed by a live campaign.</p>;
  const liveTask = gate?.tasks.find((t) => t.task_id === gateTaskId) ?? null;
  if (!gate || !liveTask) return <p className="live-empty">Loading the live gate task…</p>;

  const isPackage = liveTask.scope === "package";
  const report = isPackage ? null : gate.reports.find((r) => r.asset_id === liveTask.asset_id);
  const openAssetTasks = gate.tasks.filter((t) => t.scope === "asset" && t.status === "open");
  const gatedByAssets = isPackage && openAssetTasks.length > 0;
  const roleOk = canDecide(viewer.role, liveTask.step);
  const decided = liveTask.status !== "open";

  async function decide(decision: "approved" | "returned") {
    if (busy || !boxId) return;
    setBusy(true);
    try {
      await liveApi.boxGateDecision(
        boxId, gateTaskId, decision, viewer.email, viewer.role,
        decision === "returned" ? notes.trim() : "",
        [...disputed], isPackage ? [...returnAssets] : [],
      );
      const g = await liveApi.boxGate(boxId);
      setGate(g);
      actions.syncGateTasks(task.campaignId, g.tasks.map((t) => ({
        task_id: t.task_id, scope: t.scope, asset_id: t.asset_id,
        step: t.step, status: t.status, due: t.due, decided_by: t.decided_by,
      })));
      showToast(decision === "approved"
        ? (isPackage ? "Package signed off — versions locked read-only" : "Language QA approved")
        : "Returned with notes — packaging re-opened");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "The gate call failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="gap-body">
      {report && <ReportCard report={report} />}
      {isPackage && (
        <div className="gate-section">
          <p className="meta-label">Package summary — manifest v{gate.state?.manifest_version}</p>
          <div className="gate-chain">
            {gate.reports.map((r) => (
              <div key={r.asset_id} className="gate-chain-row">
                <Chip tone={r.verdict === "pass" ? "green" : "red"}>{r.verdict}</Chip>
                <strong>{r.asset_id.replace(/_/g, " ")}</strong>
                <span className="gate-report-meta">
                  v{r.version} · {r.findings.filter((f) => f.severity === "blocking").length} blocking
                </span>
              </div>
            ))}
            {gate.approvals.map((a) => (
              <div key={a.approval_id} className="gate-chain-row">
                <CheckCircle size={13} />
                <span>{STEP_LABEL[a.step] ?? a.step}{a.asset_id ? ` · ${a.asset_id.replace(/_/g, " ")}` : ""}</span>
                <span className="gate-report-meta">
                  {appState.people.find((p) => p.email === a.actor_id)?.name ?? a.actor_id} · {a.decision}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="agent-recommendation">
        <span className="monogram sm">QG</span>
        <div>
          <p className="meta-label">Why this is in front of you</p>
          <p className="gate-why">
            {isPackage
              ? "Every asset passed the automated gate and its language QA. Signing off records your identity, role and hash per asset, locks the approved versions read-only, and releases the package reference — the terminal output of Phase 1."
              : "This asset passed the automated quality gate; you are the final language gate on it. Your decision is recorded on the bridge with your identity and role. Returning re-opens packaging with your notes, verbatim."}
          </p>
        </div>
      </div>
      {gatedByAssets && (
        <p className="live-note">
          <WarningCircle size={13} /> Locked until every asset review is approved
          ({openAssetTasks.length} open) — sequence is structural.
        </p>
      )}
      {!roleOk && !decided && (
        <p className="live-note">
          <WarningCircle size={13} /> This gate belongs to a {ROLE_FOR_STEP[liveTask.step]}.
          Switch person via the profile menu.
        </p>
      )}
      {returning && (
        <div className="gate-return">
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Return notes — travel verbatim to the rework cycle"
          />
          {!isPackage && (report?.findings ?? []).length > 0 && (
            <div className="gate-disputes">
              <span>Dispute a gate finding (logged as a false-positive calibration example):</span>
              {(report?.findings ?? []).map((f) => (
                <label key={f.rule_id}>
                  <input
                    type="checkbox" checked={disputed.has(f.rule_id)}
                    onChange={(e) => {
                      const next = new Set(disputed);
                      if (e.target.checked) next.add(f.rule_id); else next.delete(f.rule_id);
                      setDisputed(next);
                    }}
                  />
                  <code>{f.rule_id}</code>
                </label>
              ))}
            </div>
          )}
          {isPackage && (
            <div className="gate-disputes">
              <span>Assets to re-open:</span>
              {(box?.checklist?.items ?? []).map((item) => (
                <label key={item.asset_id}>
                  <input
                    type="checkbox" checked={returnAssets.has(item.asset_id)}
                    onChange={(e) => {
                      const next = new Set(returnAssets);
                      if (e.target.checked) next.add(item.asset_id); else next.delete(item.asset_id);
                      setReturnAssets(next);
                    }}
                  />
                  <code>{item.asset_id}</code>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="decision-footer">
        <div><small>Recorded with identity, role and timestamp by the live agent · due {liveTask.due}</small></div>
        {decided ? (
          <Chip tone="green">Already {liveTask.status}</Chip>
        ) : (
          <span className="gate-task-actions">
            <BusyButton
              busy={busy && !returning} busyLabel={isPackage ? "Signing off & locking…" : "Approving…"}
              disabled={busy || gatedByAssets || !roleOk || returning}
              onClick={() => void decide("approved")}
            >
              <SealCheck size={14} /> {isPackage ? "Sign off & lock package" : "Approve language QA"}
            </BusyButton>
            {returning ? (
              <>
                <BusyButton
                  kind="secondary" busy={busy} busyLabel="Returning…"
                  disabled={busy || !notes.trim() || (isPackage && returnAssets.size === 0)}
                  onClick={() => void decide("returned")}
                >
                  Send return
                </BusyButton>
                <button
                  type="button" className="secondary-button" disabled={busy}
                  onClick={() => { setReturning(false); setNotes(""); setDisputed(new Set()); setReturnAssets(new Set()); }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button" className="secondary-button" disabled={busy || gatedByAssets || !roleOk}
                onClick={() => setReturning(true)}
              >
                Return with notes
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
