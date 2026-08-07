// pl-12 clears Sidebar.jsx's mobile hamburger (top-3 left-3, ~36px wide) —
// keep in sync with that button if either one moves.
export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex items-center justify-between flex-wrap gap-3 pl-12 md:pl-0 ${className}`}>
      <div>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-ink-subtle mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
