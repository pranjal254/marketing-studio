import { useState } from "react";
import { ArrowRight, Check, FileText, LockSimple, Timer } from "@phosphor-icons/react";
import { personById, useStore } from "../store";
import { relTime } from "../data";
import { useNav } from "../nav";
import { Avatar, CampaignStateChip, Chip, DocModal, MiniSource, Monogram } from "../ui";
import type { Asset } from "../types";

export default function LibraryScreen() {
  const { state, now, showToast } = useStore();
  const { go } = useNav();
  const packaged = state.campaigns.filter((c) => ["packaged_pending_compliance", "awaiting_signoff", "approved_locked"].includes(c.state));
  const [selectedId, setSelectedId] = useState(packaged.find((c) => c.state === "approved_locked")?.id ?? packaged[0]?.id ?? null);
  const [docAsset, setDocAsset] = useState<Asset | null>(null);
  const campaign = packaged.find((c) => c.id === selectedId) ?? packaged[0];

  if (!campaign) {
    return (
      <div className="screen-content library-screen">
        <section className="simple-page-header"><div><h1>Package library</h1><p>Approved, locked Campaign-in-a-Box packages land here.</p></div></section>
        <section className="empty-panel"><h3>No packages yet</h3><p>A package appears once a campaign clears compliance. Resolve the open decisions in Approvals to move one through.</p></section>
      </div>
    );
  }

  const assets = state.assets.filter((a) => a.campaignId === campaign.id);
  const chain = state.approvals.filter((a) => a.campaignId === campaign.id).sort((a, b) => a.at - b.at);
  const locked = campaign.state === "approved_locked";
  const confirmedAll = assets.length > 0 && assets.every((a) => a.state === "approved" || a.state === "content_confirmed");
  const health = [
    { ok: assets.length >= 9, label: `${assets.length} of 9 assets present` },
    { ok: confirmedAll, label: "Human confirmation on every asset" },
    { ok: true, label: "100% claim lineage" },
    { ok: campaign.step >= 7, label: "42 compliance rules passed" },
    { ok: locked, label: locked ? "Versions locked read-only" : "Awaiting final sign-off" },
  ];
  const score = Math.round((health.filter((x) => x.ok).length / health.length) * 100);

  return (
    <div className="screen-content library-screen">
      {packaged.length > 1 && (
        <div className="package-picker">
          {packaged.map((c) => (
            <button key={c.id} className={`package-pick${c.id === campaign.id ? " active" : ""}`} onClick={() => setSelectedId(c.id)}>
              <Monogram size="sm">{c.code}</Monogram> {c.name} <CampaignStateChip state={c.state} />
            </button>
          ))}
        </div>
      )}
      <section className={`package-hero${locked ? "" : " pending"}`}>
        <span className="lock-orb">{locked ? <LockSimple size={20} /> : <Timer size={20} />}</span>
        <div>
          <div className="title-line"><p className="meta-label">Campaign-in-a-Box package</p><CampaignStateChip state={campaign.state} /></div>
          <h1>{campaign.name}</h1>
          <p>{locked ? "Complete, governed campaign package ready for hand-off to Launch & Publishing." : "Package assembled; it locks the moment the BU Campaign Lead signs off."}</p>
          <div className="source-row"><MiniSource>Manifest v1.0</MiniSource><MiniSource>Rules pack v3.2</MiniSource><MiniSource>{locked ? "OneDrive locked" : "OneDrive workspace"}</MiniSource></div>
        </div>
        <div className="package-hero-actions">
          <button className="secondary-button" onClick={() => go({ page: "activity", campaignId: campaign.id })}>View audit trail</button>
          <button className="primary-button" onClick={() => { navigator.clipboard?.writeText(JSON.stringify({ campaign: campaign.name, state: campaign.state, assets: assets.map((a) => ({ name: a.name, version: a.version, hash: a.hash, state: a.state })) }, null, 2)); showToast("Manifest JSON copied to clipboard"); }}>Copy manifest JSON</button>
        </div>
      </section>
      <section className="manifest-layout">
        <div className="manifest-panel">
          <div className="panel-heading"><div><p className="meta-label">Package manifest</p><h2>{assets.length} content assets · click any row to read it</h2></div><span className="hash-label">SHA-256 verified</span></div>
          <div className="manifest-table">
            <div className="manifest-table-head"><span>Asset</span><span>Type</span><span>Version</span><span>State</span><span>Content hash</span></div>
            {assets.map((a) => (
              <div key={a.id} className="manifest-row" role="button" tabIndex={0} title={`Read ${a.name}`} onClick={() => setDocAsset(a)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDocAsset(a); } }}>
                <span><span className="file-icon"><FileText size={13} /></span><strong>{a.name}</strong></span>
                <span>{a.assetType}</span>
                <span>{a.version}</span>
                <span><Chip tone={a.state === "approved" ? "green" : a.state === "content_confirmed" ? "blue" : "amber"}>{a.state === "approved" ? "Approved" : a.state === "content_confirmed" ? "Confirmed" : "In review"}</Chip></span>
                <code>{a.hash}</code>
              </div>
            ))}
          </div>
        </div>
        <aside className="package-side">
          <section>
            <p className="meta-label">Package health</p>
            <div className="health-score"><strong>{score}</strong><span>/ 100<br />{locked ? "locked and complete" : "pending sign-off"}</span></div>
            <div className="health-list">{health.map((x) => <span key={x.label}>{x.ok ? <Check size={13} weight="bold" /> : <Timer size={13} />} {x.label}</span>)}</div>
          </section>
          <section>
            <p className="meta-label">Approval chain</p>
            <div className="vertical-chain">
              {chain.map((a) => {
                const person = personById(state, a.byId);
                return (
                  <div key={a.id}>
                    <Avatar initials={person?.initials ?? "?"} />
                    <span><strong>{person?.name}</strong><small>{a.action}<br />{relTime(a.at, now)} · <code>{a.hash}</code></small></span>
                    <Chip tone="green">Recorded</Chip>
                  </div>
                );
              })}
              {chain.length === 0 && <p className="chain-empty">Approvals appear here as they are recorded.</p>}
            </div>
          </section>
          <section className="handoff-box">
            <span className="handoff-icon"><ArrowRight size={15} /></span>
            <div><strong>Next: Launch &amp; Publishing</strong><p>Phase 2 receives the locked package reference. Nothing has been published by these agents.</p></div>
          </section>
        </aside>
      </section>
      {docAsset && <DocModal asset={docAsset} onClose={() => setDocAsset(null)} />}
    </div>
  );
}
