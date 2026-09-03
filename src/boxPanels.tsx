/* Campaign-in-a-Box, embedded where the work actually lives:
   - LivePlanReview: the Marketing Lead's pack + plan confirmation gate (Approvals)
   - LiveBoxPackPanel: the real pack/calendar + downloads (campaign · Brief & plan)
   - LiveProductionPanel: asset confirmation, packaging, manifest (campaign ·
     Content production)
   All state lives on the bridge; every mutation re-syncs the studio mirror so the
   journey, assets and activity stream stay truthful. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CheckCircle, Cube, DownloadSimple, WarningCircle } from "@phosphor-icons/react";
import {
  buildBoxSync, liveApi, LiveApiError,
  type BoxDetail, type RepurposeDetail, type RepurposeDraft,
} from "./live";
import { useStore } from "./store";
import { BusyButton, Chip } from "./ui";
import type { Campaign, Task } from "./types";

function useBoxDetail(boxId: string | undefined) {
  const [detail, setDetail] = useState<BoxDetail | null>(null);
  const [offline, setOffline] = useState(false);
  const [gone, setGone] = useState(false);
  const reload = useCallback(async (): Promise<BoxDetail | null> => {
    if (!boxId) return null;
    try {
      const d = await liveApi.boxDetail(boxId);
      setDetail(d);
      setOffline(false);
      setGone(false);
      return d;
    } catch (e) {
      if (e instanceof LiveApiError && e.status === 404) setGone(true);
      else setOffline(true);
      return null;
    }
  }, [boxId]);
  useEffect(() => { void reload(); }, [reload]);
  return { detail, offline, gone, reload };
}

function statusTone(status: string): "neutral" | "green" | "amber" | "blue" | "red" {
  switch (status) {
    case "packaged_pending_compliance": return "green";
    case "in_production": return "blue";
    case "awaiting_confirmation": case "packaging_blocked": return "amber";
    case "failed": return "red";
    default: return "neutral";
  }
}

function decisionTone(decision: string): "green" | "blue" | "neutral" {
  if (decision === "reuse") return "green";
  if (decision === "adapt") return "blue";
  return "neutral";
}

function OfflineNote() {
  return (
    <p className="live-note">
      <WarningCircle size={13} /> Agent bridge offline — the live plan cannot be
      loaded right now. Start the bridge and reload.
    </p>
  );
}

function GoneNote() {
  return (
    <p className="live-note">
      <WarningCircle size={13} /> This campaign&apos;s live state no longer exists on
      the agent bridge — the bridge restarted since it was created. The journey
      recorded here is preserved; create a new campaign to run the live flow again.
    </p>
  );
}

/* ---------- Approvals: pack + plan confirmation gate ---------- */

export function LivePlanReview({ task }: { task: Task }) {
  const { actions, viewer, showToast } = useStore();
  const boxId = task.liveCaseId;
  const { detail, offline, gone, reload } = useBoxDetail(boxId);
  const [busyAction, setBusyAction] = useState<null | "pack" | "plan" | "delta">(null);
  const [delta, setDelta] = useState("");

  async function syncNow(d: BoxDetail) {
    try { actions.syncLiveBox(buildBoxSync(d, await liveApi.boxTelemetry())); } catch { /* mirror only */ }
  }

  async function confirm(kind: "pack" | "plan") {
    if (!boxId || busyAction) return;
    setBusyAction(kind);
    try {
      await liveApi.boxConfirm(boxId, kind, viewer.email);
      const d = await reload();
      if (d) {
        await syncNow(d);
        if (d.summary.status !== "awaiting_confirmation") {
          actions.completeLivePlanConfirm(task.id);
          // Outline approval is the REAL trigger for Agent 3: the flagship draft
          // starts now (fire-and-forget; the Content production tab tracks it).
          void liveApi.boxFlagship(boxId, viewer.email).catch(() => undefined);
          showToast("Plan confirmed — the Content Repurposing agent is drafting the flagship");
        }
      }
    } catch (e) {
      showToast(`Live agent gate refused: ${e instanceof Error ? e.message : e}`);
    } finally { setBusyAction(null); }
  }

  async function applyDelta() {
    if (!boxId || busyAction || !delta.trim()) return;
    setBusyAction("delta");
    try {
      await liveApi.boxConfirm(boxId, "pack", viewer.email, { value_proposition: delta.trim() });
      setDelta("");
      const d = await reload();
      if (d) await syncNow(d);
      showToast("Delta applied — new pack version, still awaiting your confirmation");
    } catch (e) {
      showToast(`Delta refused: ${e instanceof Error ? e.message : e}`);
    } finally { setBusyAction(null); }
  }

  if (gone) return <GoneNote />;
  if (offline) return <OfflineNote />;
  if (!detail) return <p className="live-empty">Loading the live pack and plan…</p>;
  const { summary, pack, plan } = detail;
  const packDoc = liveApi.boxDocUrl(summary.folder, detail.case.pack_doc_ref);
  const tracker = liveApi.boxDocUrl(summary.folder, detail.case.tracker_ref);

  return (
    <div className="live-detail">
      {summary.escalations.length > 0 && (
        <p className="live-note"><WarningCircle size={13} /> Escalated to you: {summary.escalations.join(", ")} — the pass completed with explicit gaps/trade-offs, never silent filler.</p>
      )}
      {pack && (
        <div className="live-brief">
          <p className="meta-label">
            Audience & offer pack v{pack.version} · intel {pack.intel_mode.replace(/_/g, " ")}
            {pack.unverified_share > 0 ? ` · ${Math.round(pack.unverified_share * 100)}% unverified claims excluded` : ""}
          </p>
          <p className="live-note"><strong>Value proposition:</strong> {pack.value_proposition || "—"}</p>
          <div className="live-brief-table">
            {pack.personas.map((p) => (
              <div key={p.persona_id}><span>persona</span><strong>{p.title}</strong><small>{p.role_pains} · {p.rationale}</small></div>
            ))}
            {pack.proof_points.map((pp, i) => (
              <div key={i}><span>proof</span><strong>{pp.claim}</strong><small>source: {pp.source_ref}</small></div>
            ))}
            {Object.entries(pack.channel_emphasis).map(([ch, why]) => (
              <div key={ch}><span>channel</span><strong>{ch}</strong><small>{why}</small></div>
            ))}
          </div>
          {pack.gaps.length > 0 && (
            <p className="live-note"><WarningCircle size={13} /> Gaps (explicit, never filled): {pack.gaps.join(" · ")}</p>
          )}
          {(packDoc || tracker) && (
            <p className="live-note">
              <DownloadSimple size={14} />{" "}
              {packDoc && <a className="text-link" href={packDoc} target="_blank" rel="noreferrer">Pack (.docx) <ArrowSquareOut size={12} /></a>}
              {packDoc && tracker && " · "}
              {tracker && <a className="text-link" href={tracker} target="_blank" rel="noreferrer">Status tracker (.csv) <ArrowSquareOut size={12} /></a>}
            </p>
          )}
        </div>
      )}
      {plan && (
        <div className="live-brief">
          <p className="meta-label">
            Back-planned calendar v{plan.version} · {plan.window_start} → {plan.window_end} ·{" "}
            {plan.feasible ? "feasible" : "INFEASIBLE — trade-offs below"} · {plan.capacity_note}
          </p>
          {plan.infeasibility && (
            <p className="live-note">
              <WarningCircle size={13} /> {plan.infeasibility.reasons.join(" · ")}<br />
              Trade-offs: {plan.infeasibility.trade_offs.join(" · ")}
            </p>
          )}
        </div>
      )}
      <div className="live-gate">
        <p className="meta-label">
          Pack {summary.confirmations.pack ? "confirmed ✓" : "pending"} · plan{" "}
          {summary.confirmations.plan ? "confirmed ✓" : "pending"} — proposals take effect only
          after your explicit confirmation, recorded by the agent with your identity
        </p>
        <div className="live-gate-actions">
          {!summary.confirmations.pack && (
            <BusyButton busy={busyAction === "pack"} busyLabel="Recording confirmation…"
              disabled={busyAction !== null} onClick={() => void confirm("pack")}>
              <CheckCircle size={15} /> Confirm pack
            </BusyButton>
          )}
          {!summary.confirmations.plan && (
            <BusyButton busy={busyAction === "plan"} busyLabel="Recording confirmation…"
              disabled={busyAction !== null} onClick={() => void confirm("plan")}>
              <CheckCircle size={15} /> Confirm plan
            </BusyButton>
          )}
        </div>
        <div className="field">
          <label htmlFor="box-delta">Or modify the value proposition (delta → new pack version)</label>
          <textarea id="box-delta" rows={2} value={delta} onChange={(e) => setDelta(e.target.value)} />
        </div>
        <BusyButton kind="secondary" busy={busyAction === "delta"} busyLabel="Applying delta…"
          disabled={busyAction !== null || !delta.trim()} onClick={() => void applyDelta()}>
          Apply delta
        </BusyButton>
      </div>
    </div>
  );
}

/* ---------- Campaign · Brief & plan: the real pack + calendar ---------- */

export function LiveBoxPackPanel({ campaign }: { campaign: Campaign }) {
  const { detail, offline, gone } = useBoxDetail(campaign.liveCampaignId);
  if (gone) return <GoneNote />;
  if (offline) return <OfflineNote />;
  if (!detail?.pack) return null;
  const { summary, pack, plan } = detail;
  const packDoc = liveApi.boxDocUrl(summary.folder, detail.case.pack_doc_ref);
  const tracker = liveApi.boxDocUrl(summary.folder, detail.case.tracker_ref);
  return (
    <div className="live-brief">
      <p className="meta-label">
        Campaign-in-a-Box (live agent) · pack v{pack.version}{" "}
        <Chip tone={statusTone(summary.status)}>{summary.status.replace(/_/g, " ")}</Chip>
      </p>
      <p className="live-note"><strong>Value proposition:</strong> {pack.value_proposition || "—"}</p>
      {plan && (
        <p className="live-note">
          Calendar: {plan.window_start} → {plan.window_end} · {plan.feasible ? "feasible" : "infeasible — see trade-offs in Approvals"} · {plan.capacity_note}
        </p>
      )}
      {(packDoc || tracker) && (
        <p className="live-note">
          <DownloadSimple size={14} />{" "}
          {packDoc && <a className="text-link" href={packDoc} target="_blank" rel="noreferrer">Audience & offer pack (.docx) <ArrowSquareOut size={12} /></a>}
          {packDoc && tracker && " · "}
          {tracker && <a className="text-link" href={tracker} target="_blank" rel="noreferrer">Status tracker (.csv) <ArrowSquareOut size={12} /></a>}
        </p>
      )}
    </div>
  );
}

/* ---------- Campaign · Content production: Agent 3 drafts + confirm, package ---------- */

function rpTone(status: string): "neutral" | "green" | "amber" | "blue" | "red" {
  switch (status) {
    case "derivatives_staged": return "green";
    case "flagship_confirmed": return "blue";
    case "flagship_staged": return "amber";
    case "escalated": case "failed": return "red";
    default: return "neutral";
  }
}

function latestByAsset(drafts: RepurposeDraft[]): RepurposeDraft[] {
  const latest = new Map<string, RepurposeDraft>();
  for (const d of drafts) {
    const current = latest.get(d.asset_id);
    if (!current || d.version > current.version) latest.set(d.asset_id, d);
  }
  return [...latest.values()];
}

export function LiveProductionPanel({ campaign }: { campaign: Campaign }) {
  const { actions, viewer, showToast } = useStore();
  const { detail, offline, gone, reload } = useBoxDetail(campaign.liveCampaignId);
  /* Which action is in flight (e.g. "confirm:linkedin_posts", "package",
     "flagship", "rework:faq_service_page") — the clicked button shows a spinner,
     every other action button is disabled until the bridge call returns. */
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  const [rp, setRp] = useState<RepurposeDetail | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [fanoutRunning, setFanoutRunning] = useState(false);
  const [reworkFor, setReworkFor] = useState<string | null>(null);
  const [reworkText, setReworkText] = useState("");
  const rpBusy = useRef(false);

  const reloadRp = useCallback(async (): Promise<RepurposeDetail | null> => {
    if (!campaign.liveCampaignId || rpBusy.current) return null;
    rpBusy.current = true;
    try {
      const d = await liveApi.boxDrafts(campaign.liveCampaignId);
      setRp(d);
      return d;
    } catch {
      return null;
    } finally { rpBusy.current = false; }
  }, [campaign.liveCampaignId]);

  useEffect(() => {
    void reloadRp();
    const timer = window.setInterval(() => void reloadRp(), 12000);
    return () => window.clearInterval(timer);
  }, [reloadRp]);

  async function run(action: string, fn: () => Promise<unknown>, done: string) {
    if (busy || !campaign.liveCampaignId) return;
    setBusyAction(action);
    try {
      await fn();
      const d = await reload();
      if (d) {
        try { actions.syncLiveBox(buildBoxSync(d, await liveApi.boxTelemetry())); } catch { /* mirror only */ }
      }
      showToast(done);
    } catch (e) {
      showToast(`Live agent refused: ${e instanceof Error ? e.message : e}`);
    } finally { setBusyAction(null); }
  }

  if (gone) return <section className="box-production-card"><GoneNote /></section>;
  if (offline) return <section className="box-production-card"><OfflineNote /></section>;
  if (!detail?.checklist) {
    return (
      <section className="box-production-card">
        <p className="live-empty">The asset checklist arrives once the plan is confirmed.</p>
      </section>
    );
  }
  const { summary, checklist, manifest, completeness_report: report } = detail;
  const boxId = campaign.liveCampaignId as string;
  const inProduction = summary.status === "in_production" || summary.status === "packaging_blocked";
  const confirmed = checklist.items.filter(
    (i) => i.status === "content_confirmed" || i.status === "packaged",
  ).length;

  const rpStatus = rp?.status ?? null;
  const rpDrafts = latestByAsset(rp?.drafts ?? []);
  const flagship = rpDrafts.find((d) => d.kind === "flagship") ?? null;
  const derivatives = rpDrafts.filter((d) => d.kind === "derivative");

  function startFlagship() {
    if (drafting) return;
    setDrafting(true);
    showToast("Flagship drafting started — the agent writes from the approved outline (1–3 min)");
    liveApi.boxFlagship(boxId, viewer.email)
      .catch((e) => showToast(`Flagship draft: ${e instanceof Error ? e.message : e}`))
      .finally(() => { setDrafting(false); void reloadRp(); });
  }

  async function confirmFlagship() {
    if (busy || !flagship) return;
    setBusyAction("flagship");
    try {
      await liveApi.boxFlagshipConfirm(boxId, viewer.email, viewer.role);
      showToast("Flagship content-confirmed — derivative fan-out running");
      setFanoutRunning(true);
      void (async () => {
        try {
          await liveApi.boxFanout(boxId);
        } catch (e) {
          showToast(`Fan-out: ${e instanceof Error ? e.message : e}`);
        } finally {
          setFanoutRunning(false);
          await reloadRp();
          const d = await reload();
          if (d) {
            try { actions.syncLiveBox(buildBoxSync(d, await liveApi.boxTelemetry())); } catch { /* mirror only */ }
          }
        }
      })();
      await reloadRp();
      const d = await reload();
      if (d) {
        try { actions.syncLiveBox(buildBoxSync(d, await liveApi.boxTelemetry())); } catch { /* mirror only */ }
      }
    } catch (e) {
      showToast(`Live agent gate refused: ${e instanceof Error ? e.message : e}`);
    } finally { setBusyAction(null); }
  }

  async function submitRework(assetId: string) {
    if (busy || !reworkText.trim()) return;
    setBusyAction(`rework:${assetId}`);
    try {
      await liveApi.boxRework(boxId, assetId, reworkText.trim(), viewer.email);
      setReworkFor(null); setReworkText("");
      await reloadRp();
      showToast("Rework applied — only this asset was regenerated, as a new version");
    } catch (e) {
      showToast(`Rework refused: ${e instanceof Error ? e.message : e}`);
    } finally { setBusyAction(null); }
  }

  function draftCard(draft: RepurposeDraft) {
    const doc = liveApi.boxDraftUrl(draft.file_rel);
    const withheld = draft.status === "withheld";
    const classes = ["box-asset"];
    if (draft.kind === "flagship") classes.push("flagship");
    if (withheld) classes.push("withheld");
    return (
      <article className={classes.join(" ")} key={draft.asset_id}>
        <div className="box-asset-head">
          <Chip tone={withheld ? "amber" : "green"}>{withheld ? "withheld" : `v${draft.version}`}</Chip>
          <strong>{draft.title}</strong>
          <Chip tone="neutral">{draft.asset_type.replace(/_/g, " ")}</Chip>
        </div>
        <p>
          {draft.sections.length} section{draft.sections.length === 1 ? "" : "s"}
          {draft.kind === "flagship"
            ? ` · ${draft.claim_markers.length} sourced claim marker${draft.claim_markers.length === 1 ? "" : "s"}`
            : draft.claim_lineage.length > 0
              ? ` · lineage: ${draft.claim_lineage.join(", ")}`
              : ""}
          {" · self-check "}
          {draft.self_check.passed ? `passed (attempt ${draft.self_check.attempts})` : "failed — not staged"}
        </p>
        {draft.gap_notes.length > 0 && (
          <>
            <p className="live-note">
              <WarningCircle size={13} /> {draft.gap_notes.length} gap note
              {draft.gap_notes.length === 1 ? "" : "s"} — evidence the agent needed but refused
              to invent:
            </p>
            <ul className="box-gapnotes">
              {draft.gap_notes.map((g) => (
                <li key={g.gap_id}><strong>{g.section}:</strong> {g.needed}</li>
              ))}
            </ul>
          </>
        )}
        <div className="box-asset-foot">
          {doc && (
            <a className="text-link" href={doc} target="_blank" rel="noreferrer">
              <DownloadSimple size={13} /> Draft (.docx) <ArrowSquareOut size={11} />
            </a>
          )}
          {!withheld && (
            <button className="secondary-button" disabled={busy}
              onClick={() => { setReworkFor(reworkFor === draft.asset_id ? null : draft.asset_id); setReworkText(""); }}>
              Request rework
            </button>
          )}
          {draft.kind === "flagship" && rpStatus === "flagship_staged" && !withheld && (
            <BusyButton busy={busyAction === "flagship"} busyLabel="Recording confirmation…"
              disabled={busy} onClick={() => void confirmFlagship()}>
              <CheckCircle size={14} /> Confirm flagship content
            </BusyButton>
          )}
        </div>
        {reworkFor === draft.asset_id && (
          <div className="box-rework">
            <textarea value={reworkText} rows={2} disabled={busyAction === `rework:${draft.asset_id}`}
              placeholder="Consolidated revision instruction (only this asset is regenerated)"
              onChange={(e) => setReworkText(e.target.value)} />
            <BusyButton kind="secondary" busy={busyAction === `rework:${draft.asset_id}`}
              busyLabel="Agent regenerating…"
              disabled={busy || !reworkText.trim()}
              onClick={() => void submitRework(draft.asset_id)}>
              Send to agent
            </BusyButton>
          </div>
        )}
      </article>
    );
  }

  return (
    <section className="box-production-card">
      <div className="panel-heading">
        <div>
          <p className="meta-label">Production status · live agent</p>
          <h2>{confirmed} of {checklist.items.length} assets content-confirmed</h2>
        </div>
        <Chip tone={statusTone(summary.status)}>{summary.status.replace(/_/g, " ")}</Chip>
      </div>

      {(inProduction || summary.status === "packaged_pending_compliance") && (
        <div className="box-repurpose">
          <div className="panel-heading">
            <div>
              <p className="meta-label">
                Content drafting · live Content Repurposing agent
                {rp?.model ? ` · target ${rp.model}` : ""}
              </p>
              <h2>
                {rpStatus === null && (drafting ? "Flagship drafting in progress…" : "Flagship draft pending")}
                {rpStatus === "flagship_staged" && "Flagship staged — awaiting the writer's content confirmation"}
                {rpStatus === "flagship_confirmed" && (fanoutRunning ? "Fan-out running — channel derivatives generating…" : "Flagship confirmed — fan-out unlocked")}
                {rpStatus === "derivatives_staged" && "Drafts staged for review"}
                {(rpStatus === "escalated" || rpStatus === "failed") && "Escalated — gaps need a human"}
              </h2>
            </div>
            {rpStatus && <Chip tone={rpTone(rpStatus)}>{rpStatus.replace(/_/g, " ")}</Chip>}
          </div>
          {rpStatus === null && !drafting && (
            <p className="live-note">
              Flagship drafting starts automatically when the plan is confirmed. If this
              campaign was confirmed before the agent existed (or the trigger was lost),
              start it here:{" "}
              <BusyButton kind="secondary" busy={drafting} busyLabel="Drafting flagship…"
                onClick={startFlagship}>
                Draft flagship now
              </BusyButton>
            </p>
          )}
          {(drafting || fanoutRunning) && (
            <p className="live-note">The agent is generating — this panel refreshes automatically.</p>
          )}
          {(() => {
            // Gap notes for assets without their own card below (a card lists its
            // own notes — never show the same text twice).
            const carded = new Set(rpDrafts.map((d) => d.asset_id));
            const orphans = (rp?.gap_notes ?? []).filter((g) => !carded.has(g.asset_id));
            if (orphans.length === 0 || rpStatus === null) return null;
            return (
              <>
                <p className="live-note">
                  <WarningCircle size={13} /> Gap notes (never filled with plausible content):
                </p>
                <ul className="box-gapnotes">
                  {orphans.map((g) => (
                    <li key={g.gap_id}><strong>{g.section}:</strong> {g.needed}</li>
                  ))}
                </ul>
              </>
            );
          })()}
          {(flagship || derivatives.length > 0) && (
            <div className="box-assets">
              {flagship && draftCard(flagship)}
              {derivatives.map(draftCard)}
            </div>
          )}
          {rp?.inventory && (
            <p className="box-standin-note">
              Claim inventory v{rp.inventory.flagship_version} ({rp.inventory.method.replace(/_/g, " ")}):{" "}
              {rp.inventory.items.length} verified claim{rp.inventory.items.length === 1 ? "" : "s"} — the only
              source every derivative may draw from; lineage is recorded per draft.
            </p>
          )}
        </div>
      )}

      <div className="box-assets">
        {checklist.items.map((item) => {
          const done = item.status === "content_confirmed" || item.status === "packaged";
          return (
            <article className="box-asset" key={item.asset_id}>
              <div className="box-asset-head">
                <Chip tone={decisionTone(item.decision)}>{item.decision}</Chip>
                <strong>{item.label}</strong>
                <Chip tone={done ? "green" : "neutral"}>{item.status.replace(/_/g, " ")}</Chip>
              </div>
              <p>{item.decision_rationale}</p>
              {(inProduction && item.status === "in_production") || summary.status === "packaged_pending_compliance" ? (
                <div className="box-asset-foot">
                  {inProduction && item.status === "in_production" && (
                    <BusyButton kind="secondary" busy={busyAction === `confirm:${item.asset_id}`}
                      busyLabel="Registering…" disabled={busy}
                      onClick={() => void run(`confirm:${item.asset_id}`, () => liveApi.boxConfirmAsset(boxId, item.asset_id, viewer.email), `${item.label} marked content-confirmed`)}>
                      <CheckCircle size={14} /> Mark content-confirmed
                    </BusyButton>
                  )}
                  {summary.status === "packaged_pending_compliance" && (
                    <BusyButton kind="secondary" busy={busyAction === `reopen:${item.asset_id}`}
                      busyLabel="Re-opening…" disabled={busy}
                      onClick={() => void run(`reopen:${item.asset_id}`, () => liveApi.boxReopen(boxId, [item.asset_id], viewer.email), `${item.label} re-opened for rework`)}>
                      Re-open for rework
                    </BusyButton>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {inProduction && (
        <p className="box-standin-note">
          "Mark content-confirmed" is the dev stand-in for Agent 4's review cycle — it
          registers the REAL draft the Content Repurposing agent staged (with its claim
          lineage); the synthetic placeholder is used only for reuse assets Agent 3
          doesn't draft. In production this record comes from the Content Collaboration agent.
        </p>
      )}

      {inProduction && (
        <div className="box-packaging">
          <div>
            <strong>Deterministic packaging module</strong>
            <small>No LLM — completeness diff, naming checks, sha256 snapshots. Blocks on any gap.</small>
          </div>
          <BusyButton busy={busyAction === "package"} busyLabel="Packaging — hashing snapshots…"
            disabled={busy}
            onClick={() => void run("package", () => liveApi.boxPackage(boxId), "Packaging run finished")}>
            <Cube size={15} /> Run packaging
          </BusyButton>
        </div>
      )}
      {report && summary.status === "packaging_blocked" && (
        <p className="live-note">
          <WarningCircle size={13} /> Blocked:
          {report.diff.missing.length > 0 && ` missing ${report.diff.missing.join(", ")}.`}
          {report.diff.extra.length > 0 && ` extra ${report.diff.extra.join(", ")}.`}
          {report.missing_confirmations.length > 0 && ` no confirmation record for ${report.missing_confirmations.join(", ")}.`}
          {" "}The diff is never padded or trimmed to fit.
        </p>
      )}

      {manifest && (
        <div className="box-manifest">
          <p className="meta-label">
            Package manifest v{manifest.version} · {manifest.status.replace(/_/g, " ")} — Agent 5's input (Quality Gate)
          </p>
          <div className="box-assets">
            {manifest.assets.map((a) => (
              <article className="box-asset slim" key={a.asset_id}>
                <div className="box-asset-head">
                  <Chip tone="green">v{a.version}</Chip>
                  <strong>
                    <a className="text-link" href={liveApi.boxSnapshotUrl(summary.folder, a.canonical_name) ?? "#"} target="_blank" rel="noreferrer">
                      {a.canonical_name}
                    </a>
                  </strong>
                </div>
                <p>sha256 {a.sha256.slice(0, 16)}… · post-packaging edits are detectable</p>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
