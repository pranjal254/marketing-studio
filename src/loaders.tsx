/* Loading states, one family: the arc spinner is the base unit, PageLoader wraps it
   for route transitions, AppSplash is the branded first-paint screen, InlineDots is
   the quiet "agent is working" indicator for inline rows. All motion is transform or
   opacity only and collapses under prefers-reduced-motion via the global override. */

export function Spinner({ size = 22 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

/* Route-level fallback. The 150ms reveal delay means fast chunk loads never flash it. */
export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <Spinner size={26} />
      <p>{label}…</p>
    </div>
  );
}

/* First-load splash: brand mark with a soft radar pulse, then never seen again. */
export function AppSplash() {
  return (
    <div className="app-splash" role="status" aria-label="Loading Marketing Studio">
      <div className="splash-mark">
        <span className="splash-ring" aria-hidden="true" />
        <span className="splash-ring r2" aria-hidden="true" />
        <img src="/logo-icon.svg" alt="" width={52} height={52} />
      </div>
      <strong>ShiftAI</strong>
      <small>Marketing Studio</small>
      <span className="splash-bar" aria-hidden="true"><i /></span>
    </div>
  );
}

/* Three quiet dots for inline "agent working" rows. */
export function InlineDots() {
  return (
    <span className="inline-dots" aria-hidden="true"><i /><i /><i /></span>
  );
}
