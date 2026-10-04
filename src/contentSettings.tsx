/* Content settings: how many of each asset this campaign needs, and how long
   each one should be.

   Marketing asked for this because campaign shape varies: one needs four
   LinkedIn posts and a short one-pager, the next needs one post and a long FAQ.
   The Content Writer sets it after the flagship is confirmed and before the
   fan-out runs, which is exactly the window where the numbers still matter.

   The bridge sends the bounds down with the values, so the inputs here are
   constrained by the same limits the agent enforces rather than by a number
   duplicated in this file. If the writer still asks for something out of range,
   the agent clamps it and says so, and those notes render under the table. */

import { useCallback, useEffect, useState } from "react";
import { ArrowCounterClockwise, Check, Sliders, WarningCircle } from "@phosphor-icons/react";
import {
  liveApi,
  type ContentSettingRequest,
  type ContentSettingsView,
} from "./live";
import { BusyButton, Chip } from "./ui";

type Draft = Record<string, { variants: number; min_words: number; max_words: number }>;

function toDraft(view: ContentSettingsView): Draft {
  return Object.fromEntries(
    view.settings.items.map((i) => [
      i.asset_id,
      { variants: i.variants, min_words: i.min_words, max_words: i.max_words },
    ]),
  );
}

/* Only what actually changed goes to the bridge: the PUT is a patch, so a
   narrow request keeps the audit record meaningful ("they changed the emails")
   instead of restating every asset on every save. */
function changedItems(view: ContentSettingsView, draft: Draft): ContentSettingRequest[] {
  return view.settings.items
    .filter((i) => {
      const d = draft[i.asset_id];
      return (
        d &&
        (d.variants !== i.variants ||
          d.min_words !== i.min_words ||
          d.max_words !== i.max_words)
      );
    })
    .map((i) => ({ asset_id: i.asset_id, ...draft[i.asset_id] }));
}

function NumberCell({
  value, min, max, disabled, onChange, label,
}: {
  value: number; min: number; max: number; disabled: boolean;
  onChange: (next: number) => void; label: string;
}) {
  return (
    <input
      className="cs-num"
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={Number.isFinite(value) ? value : min}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => {
        const next = Number.parseInt(e.target.value, 10);
        onChange(Number.isNaN(next) ? min : next);
      }}
    />
  );
}

export function ContentSettingsPanel({
  boxId,
  actorId,
  canEdit,
  locked,
  onSaved,
}: {
  boxId: string;
  actorId: string;
  /* Content Writers own this gate; everyone else reads it. */
  canEdit: boolean;
  /* True once the fan-out has run: the numbers no longer change anything, so
     the panel goes read-only rather than offering a button that does nothing. */
  locked: boolean;
  onSaved?: () => void;
}) {
  const [view, setView] = useState<ContentSettingsView | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await liveApi.boxContentSettings(boxId);
      setView(next);
      setDraft(toDraft(next));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [boxId]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <section className="cs-panel">
        <p className="live-note"><WarningCircle size={13} /> Content settings unavailable: {error}</p>
      </section>
    );
  }
  if (!view) {
    return (
      <section className="cs-panel">
        <p className="live-note">Loading content settings…</p>
      </section>
    );
  }

  const { limits } = view;
  const pending = changedItems(view, draft);
  const editable = canEdit && !locked;

  async function save() {
    if (!view || pending.length === 0) return;
    setSaving(true);
    try {
      const next = await liveApi.boxSaveContentSettings(
        boxId, pending, actorId, "content-writer",
      );
      setView(next);
      setDraft(toDraft(next));
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="cs-panel">
      <button className="cs-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Sliders size={14} />
        <span>
          <strong>Content settings</strong>
          <small>
            {view.saved
              ? `Set by ${view.settings.set_by ?? "a writer"} · version ${view.settings.version}`
              : "Using the plan volumes and the standard word ranges"}
          </small>
        </span>
        {locked && <Chip tone="neutral">Applied</Chip>}
        {!locked && pending.length > 0 && <Chip tone="amber">{pending.length} unsaved</Chip>}
        <em>{open ? "Hide" : "Adjust"}</em>
      </button>

      {open && (
        <>
          <p className="cs-intro">
            How many of each asset the agent writes, and how long each one runs.
            Up to {limits.max_variants_per_asset} per asset, {limits.word_floor} to{" "}
            {limits.word_ceiling.toLocaleString()} words.
            {locked
              ? " The fan-out has already run, so these are the numbers it used."
              : " These apply when the derivatives are generated."}
          </p>

          <table className="cs-table">
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">How many</th>
                <th scope="col">Min words</th>
                <th scope="col">Max words</th>
              </tr>
            </thead>
            <tbody>
              {view.settings.items.map((item) => {
                const row = draft[item.asset_id] ?? item;
                // Merge onto the latest draft inside the updater, not onto the
                // row captured by this render: three inputs share this closure
                // and a fast edit across two of them would otherwise drop one.
                const set = (patch: Partial<typeof row>) =>
                  setDraft((d) => ({
                    ...d,
                    [item.asset_id]: { ...(d[item.asset_id] ?? row), ...patch },
                  }));
                return (
                  <tr key={item.asset_id}>
                    <th scope="row">
                      {item.label || item.asset_id}
                      <small>{item.asset_type.replace(/_/g, " ")}</small>
                    </th>
                    <td>
                      <NumberCell
                        label={`${item.label} count`} value={row.variants}
                        min={1} max={limits.max_variants_per_asset} disabled={!editable}
                        onChange={(variants) => set({ variants })}
                      />
                    </td>
                    <td>
                      <NumberCell
                        label={`${item.label} minimum words`} value={row.min_words}
                        min={limits.word_floor} max={limits.word_ceiling} disabled={!editable}
                        onChange={(min_words) => set({ min_words })}
                      />
                    </td>
                    <td>
                      <NumberCell
                        label={`${item.label} maximum words`} value={row.max_words}
                        min={limits.word_floor} max={limits.word_ceiling} disabled={!editable}
                        onChange={(max_words) => set({ max_words })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {view.settings.adjustments.length > 0 && (
            <ul className="cs-adjustments">
              {view.settings.adjustments.map((note) => (
                <li key={note}><WarningCircle size={12} /> {note}</li>
              ))}
            </ul>
          )}

          {editable && (
            <div className="cs-actions">
              <BusyButton
                kind="primary" busy={saving} busyLabel="Saving…"
                disabled={pending.length === 0} onClick={() => void save()}
              >
                <Check size={14} /> Save settings
              </BusyButton>
              {pending.length > 0 && (
                <button
                  className="secondary-button" type="button"
                  onClick={() => setDraft(toDraft(view))}
                >
                  <ArrowCounterClockwise size={13} /> Discard changes
                </button>
              )}
              <small className="cs-hint">
                Each save is a new version, stamped with who made it.
              </small>
            </div>
          )}
          {!canEdit && (
            <p className="cs-hint">Content Writers set these. You are seeing them read-only.</p>
          )}
        </>
      )}
    </section>
  );
}
