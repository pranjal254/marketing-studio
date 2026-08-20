import { useState, type FormEvent } from "react";
import { PaperPlaneTilt } from "@phosphor-icons/react";
import { useStore, type IntakeForm } from "../store";
import { useNav } from "../nav";
import { EventLine, MiniSource, Monogram } from "../ui";

const channelOptions = ["LinkedIn", "Email nurture", "Sales enablement", "Web / service page", "Community", "Event"];

export default function IntakeScreen() {
  const { state, viewer, actions } = useStore();
  const { go } = useNav();
  const [form, setForm] = useState({ objective: "", topic: "", bu: "", vertical: "", segment: "", owner: "", start: "", end: "", budget: false });
  const [channels, setChannels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm({ ...form, [key]: value });
  }

  function toggleChannel(channel: string) {
    setChannels(channels.includes(channel) ? channels.filter((c) => c !== channel) : [...channels, channel]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.objective.trim() || !form.topic.trim() || !form.bu || !form.vertical || !form.segment) { setError("Fill in objective, offer or topic, business unit, vertical and target segment."); return; }
    if (channels.length === 0) { setError("Pick at least one intended channel."); return; }
    if (!form.start) { setError("Set the campaign window start date."); return; }
    setError("");
    const payload: IntakeForm = { ...form, owner: form.owner || viewer.name, channels };
    setSubmittedId(actions.submitRequest(payload));
  }

  if (submittedId) {
    const events = state.events.filter((e) => e.campaignId === submittedId).sort((a, b) => a.ts - b.ts);
    const routed = events.some((e) => e.activity === "route_brief_approval");
    return (
      <div className="screen-content intake-screen">
        <section className="simple-page-header"><div><h1>Request submitted</h1><p>Live telemetry from the Campaign Identification Agent. Click any line for the full trace.</p></div></section>
        <section className="intake-result">
          <div className="activity-feed embedded">
            {events.map((e) => <EventLine event={e} key={e.id} />)}
            {!routed && <p className="pending-line">Agent working…</p>}
          </div>
          {routed && (
            <div className="intake-routed">
              <Monogram>CI</Monogram>
              <div>
                <strong>Brief routed for approval</strong>
                <p>Marcus Webb (BU Campaign Lead) received the approval task, SLA 2 business days. Use the profile menu to view the workspace as Marcus and approve it, and the pipeline will keep moving.</p>
                <div className="source-row"><MiniSource>Brief draft v1.0</MiniSource><MiniSource>Campaign calendar</MiniSource></div>
              </div>
            </div>
          )}
          {routed && (
            <div className="intake-result-actions">
              <button className="primary-button" onClick={() => go({ page: "campaigns", campaignId: submittedId })}>View campaign</button>
              <button className="secondary-button" onClick={() => go("home")}>Back to home</button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="screen-content intake-screen">
      <section className="simple-page-header"><div><h1>New campaign request</h1><p>The on-demand intake path. Most requests arrive from Microsoft Forms or the quarterly plan; this form feeds the same agent.</p></div></section>
      <div className="intake-layout">
        <form className="intake-card" onSubmit={submit} noValidate>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="in-objective">Campaign objective</label><input id="in-objective" value={form.objective} onChange={(e) => set("objective", e.target.value)} placeholder="e.g. Build cloud migration intent in FinServ" /></div>
            <div className="field field-full"><label htmlFor="in-topic">Offer or topic</label><input id="in-topic" value={form.topic} onChange={(e) => set("topic", e.target.value)} placeholder="e.g. BC cloud readiness assessment" /></div>
            <div className="field"><label htmlFor="in-bu">Business unit</label><select id="in-bu" value={form.bu} onChange={(e) => set("bu", e.target.value)}><option value="">Select…</option><option>Business Central</option><option>Finance &amp; Operations</option><option>Cross-BU</option></select></div>
            <div className="field"><label htmlFor="in-vertical">Vertical</label><select id="in-vertical" value={form.vertical} onChange={(e) => set("vertical", e.target.value)}><option value="">Select…</option><option>Financial Services</option><option>Manufacturing</option><option>Technology</option></select></div>
            <div className="field"><label htmlFor="in-segment">Target segment</label><select id="in-segment" value={form.segment} onChange={(e) => set("segment", e.target.value)}><option value="">Select…</option><option>Type 3</option><option>Type 4</option><option>Standard</option></select></div>
            <div className="field"><label htmlFor="in-owner">Owner</label><input id="in-owner" value={form.owner || viewer.name} onChange={(e) => set("owner", e.target.value)} /></div>
            <div className="field"><label htmlFor="in-start">Window start</label><input id="in-start" type="date" value={form.start} onChange={(e) => set("start", e.target.value)} /></div>
            <div className="field"><label htmlFor="in-end">Window end</label><input id="in-end" type="date" value={form.end} onChange={(e) => set("end", e.target.value)} /></div>
            <fieldset className="field field-full channel-set"><legend>Intended channels</legend><div className="channel-grid">{channelOptions.map((channel) => <label key={channel} className="checkbox"><input type="checkbox" checked={channels.includes(channel)} onChange={() => toggleChannel(channel)} />{channel}</label>)}</div></fieldset>
            <label className="checkbox field-full"><input type="checkbox" checked={form.budget} onChange={(e) => set("budget", e.target.checked)} />Budget is approved for this campaign</label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="intake-actions"><button type="submit" className="primary-button"><PaperPlaneTilt size={15} /> Submit request</button><button type="button" className="secondary-button" onClick={() => go("home")}>Cancel</button></div>
        </form>
        <aside className="intake-side">
          <h2>What happens next</h2>
          <div className="next-steps">
            <p>The Campaign Identification Agent validates completeness, checks duplicates against the campaign calendar and classifies the campaign.</p>
            <p>Missing information becomes a gap request back to you. The agent never infers a value.</p>
            <p>The agent drafts and flags only. Your BU Campaign Lead approves the brief before any planning starts.</p>
          </div>
          <div className="source-row"><MiniSource>Quarterly plan Q3</MiniSource><MiniSource>Campaign calendar</MiniSource><MiniSource>Brief template v1.2</MiniSource></div>
        </aside>
      </div>
    </div>
  );
}
