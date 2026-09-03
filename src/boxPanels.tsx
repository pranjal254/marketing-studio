/* Campaign-in-a-Box, embedded where the work actually lives:
   - LivePlanReview: the Marketing Lead's pack + plan confirmation gate (Approvals)
   - LiveBoxPackPanel: the real pack/calendar + downloads (campaign · Brief & plan)
   - LiveProductionPanel: asset confirmation, packaging, manifest (campaign ·
     Content production)
   All state lives on the bridge; every mutation re-syncs the studio mirror so the
   journey, assets and activity stream stay truthful. */

import { useCallback, useEffect, useState } from "react";
import { ArrowSquareOut, CheckCircle, Cube, DownloadSimple, WarningCircle } from "@phosphor-icons/react";
import { buildBoxSync, liveApi, type BoxDetail } from "./live";
import { useStore } from "./store";
import { Chip } from "./ui";
import type { Campaign, Task } from "./types";

function useBoxDetail(boxId: string | undefined) {
  const [detail, setDetail] = useState<BoxDetail | null>(null);
  const [offline, setOffline] = useState(false);
  const reload = useCallback(async (): Promise<BoxDetail | null> => {
    if (!boxId) return null;
    try {
      const d = await liveApi.boxDetail(boxId);
      setDetail(d);
      setOffline(false);
      return d;
    } catch {
      setOffline(true);
      return null;
    }
  }, [boxId]);
  useEffect(() => { void reload(); }, [reload]);
  return { detail, offline, reload };
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

/* ---------- Approvals: pack + plan confirmation gate ---------- */

export function LivePlanReview({ task }: { task: Task }) {
  const { actions, viewer, showToast } = useStore();
  const boxId = task.liveCaseId;
  const { detail, offline, reload } = useBoxDetail(boxId);
  const [busy, setBusy] = useState(false);
  const [delta, setDelta] = useState("");

  async function syncNow(d: BoxDetail) {
    try { actions.syncLiveBox(buildBoxSync(d, await liveApi.boxTelemetry())); } catch { /* mirror only */ }
  }

  async function confirm(kind: "pack" | "plan") {
    if (!boxId || busy) return;
    setBusy(true);
    try {
      await liveApi.boxConfirm(boxId, kind, viewer.email);
      const d = await reload();
      if (d) {
        await syncNow(d);
        if (d.summary.status !== "awaiting_confirmation") actions.completeLivePlanConfirm(task.id);
      }
    } catch (e) {
      showToast(`Live agent gate refused: ${e instanceof Error ? e.message : e}`);
    } finally { setBusy(false); }
  }

  async function applyDelta() {
    if (!boxId || busy || !delta.trim()) return;
    setBusy(true);
    try {
      await liveApi.boxConfirm(boxId, "pack", viewer.email, { value_proposition: delta.trim() });
      setDelta("");
      const d = await reload();
      if (d) await syncNow(d);
      showToast("Delta applied — new pack version, still awaiting your confirmation");
    } catch (e) {
      showToast(`Delta refused: ${e instanceof Error ? e.message : e}`);
    } finally { setBusy(false); }
  }

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
            <button className="primary-button" disabled={busy} onClick={() => void confirm("pack")}><CheckCircle size={15} /> Confirm pack</button>
          )}
          {!summary.confirmations.plan && (
            <button className="primary-button" disabled={busy} onClick={() => void confirm("plan")}><CheckCircle size={15} /> Confirm plan</button>
          )}
        </div>
        <div className="field">
          <label htmlFor="box-delta">Or modify the value proposition (delta → new pack version)</label>
          <textarea id="box-delta" rows={2} value={delta} onChange={(e) => setDelta(e.target.value)} />
        </div>
        <button className="secondary-button" disabled={busy || !delta.trim()} onClick={() => void applyDelta()}>Apply delta</button>
      </div>
    </div>
  );
}

/* ---------- Campaign · Brief & plan: the real pack + calendar ---------- */

export function LiveBoxPackPanel({ campaign }: { campaign: Campaign }) {
  const { detail, offline } = useBoxDetail(campaign.liveCampaignId);
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

/* ---------- Campaign · Content production: confirm, package, manifest ---------- */

export function LiveProductionPanel({ campaign }: { campaign: Campaign }) {
  const { actions, viewer, showToast } = useStore();
  const { detail, offline, reload } = useBoxDetail(campaign.liveCampaignId);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, done: string) {
    if (busy || !campaign.liveCampaignId) return;
    setBusy(true);
    try {
      await fn();
      const d = await reload();
      if (d) {
        try { actions.syncLiveBox(buildBoxSync(d, await liveApi.boxTelemetry())); } catch { /* mirror only */ }
      }
      showToast(done);
    } catch (e) {
      showToast(`Live agent refused: ${e instanceof Error ? e.message : e}`);
    } finally { setBusy(false); }
  }

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

  return (
    <section className="box-production-card">
      <div className="panel-heading">
        <div>
          <p className="meta-label">Production status · live agent</p>
          <h2>{confirmed} of {checklist.items.length} assets content-confirmed</h2>
        </div>
        <Chip tone={statusTone(summary.status)}>{summary.status.replace(/_/g, " ")}</Chip>
      </div>

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
                    <button className="secondary-button" disabled={busy}
                      onClick={() => void run(() => liveApi.boxConfirmAsset(boxId, item.asset_id, viewer.email), `${item.label} marked content-confirmed`)}>
                      <CheckCircle size={14} /> Mark content-confirmed
                    </button>
                  )}
                  {summary.status === "packaged_pending_compliance" && (
                    <button className="secondary-button" disabled={busy}
                      onClick={() => void run(() => liveApi.boxReopen(boxId, [item.asset_id], viewer.email), `${item.label} re-opened for rework`)}>
                      Re-open for rework
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {inProduction && (
        <p className="box-standin-note">
          "Mark content-confirmed" is the dev stand-in for Agents 3–4 (drafting and review) —
          in production that record comes only from the Content Collaboration agent.
        </p>
      )}

      {inProduction && (
        <div className="box-packaging">
          <div>
            <strong>Deterministic packaging module</strong>
            <small>No LLM — completeness diff, naming checks, sha256 snapshots. Blocks on any gap.</small>
          </div>
          <button className="primary-button" disabled={busy}
            onClick={() => void run(() => liveApi.boxPackage(boxId), "Packaging run finished")}>
            <Cube size={15} /> Run packaging
          </button>
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
