/* In-app preview for the generated MS Word documents (brief, audience & offer
   pack, flagship, derivative drafts, trackers). Fetches the .docx from the
   bridge, converts it to HTML in the browser with mammoth, and renders it in a
   sleek, responsive modal. Download stays available; preview never replaces it. */

import { useEffect, useState } from "react";
import { DownloadSimple, FileText, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "./ui";
import { authHeaders } from "./live";

export type PreviewTarget = { title: string; url: string };

export function DocPreviewModal({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(target.url, { headers: authHeaders() });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const buf = await res.arrayBuffer();
        // Browser build only — the node build pulls in fs and breaks the bundle.
        const mammoth = await import("mammoth/mammoth.browser.js");
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) setHtml(result.value || "<p>(empty document)</p>");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [target.url]);

  return (
    <Modal title={target.title} onClose={onClose} wide>
      <div className="doc-preview-toolbar">
        <span className="doc-preview-kind"><FileText size={13} /> Word document preview</span>
        <a className="secondary-button" href={target.url} target="_blank" rel="noreferrer">
          <DownloadSimple size={14} /> Download .docx
        </a>
      </div>
      <div className="doc-preview-surface">
        {error ? (
          <p className="doc-preview-state">
            <WarningCircle size={15} /> Could not render a preview ({error}). Use Download to open it.
          </p>
        ) : html === null ? (
          <p className="doc-preview-state">Rendering the document…</p>
        ) : (
          <article className="doc-preview-paper" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </Modal>
  );
}

/* Small inline control that pairs with a download link: "Preview" opens the
   modal for `url`. Renders nothing when there is no document yet. */
export function PreviewLink({
  url,
  title,
  onOpen,
}: {
  url: string | null | undefined;
  title: string;
  onOpen: (t: PreviewTarget) => void;
}) {
  if (!url) return null;
  return (
    <button type="button" className="text-link doc-preview-open" onClick={() => onOpen({ title, url })}>
      <FileText size={13} /> Preview
    </button>
  );
}
