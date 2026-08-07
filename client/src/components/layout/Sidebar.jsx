import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePantryContext } from '../../context/PantryContext.jsx';

const navClass = ({ isActive }) => (isActive ? 'nav-link-active' : 'nav-link');

export default function Sidebar({ mobileOpen, setMobileOpen }) {
  const { user, logout } = useAuth();
  const { expiringItems } = usePantryContext();
  const expiringCount = expiringItems.length;

  const sidebarContent = (
    <>
      <div className="p-4 bg-primary flex items-center justify-between">
        <span className="text-lg font-bold text-on-primary">
          Kitchen Keeper
        </span>
        <button
          className="md:hidden text-on-primary/70 hover:text-on-primary text-2xl leading-none"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          ×
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <NavLink
          to="/"
          end
          className={navClass}
          onClick={() => setMobileOpen(false)}
          data-tour="nav-chat"
        >
          <span aria-hidden>💬</span>
          Chat
        </NavLink>

        <NavLink
          to="/dashboard"
          className={navClass}
          onClick={() => setMobileOpen(false)}
          data-tour="nav-dashboard"
        >
          <span aria-hidden>🏠</span>
          Dashboard
        </NavLink>

        <NavLink
          to="/pantry"
          className={navClass}
          onClick={() => setMobileOpen(false)}
          data-tour="nav-pantry"
        >
          <span aria-hidden>🥦</span>
          Pantry
          {expiringCount > 0 && (
            <span
              className="ml-auto text-xs bg-amber-500 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-tight"
              aria-label={`${expiringCount} items expiring soon`}
            >
              {expiringCount}
            </span>
          )}
        </NavLink>

        <NavLink
          to="/recipes"
          className={navClass}
          onClick={() => setMobileOpen(false)}
          data-tour="nav-recipes"
        >
          <span aria-hidden>📖</span>
          Recipes
        </NavLink>

        <NavLink
          to="/shopping"
          className={navClass}
          onClick={() => setMobileOpen(false)}
          data-tour="nav-shopping"
        >
          <span aria-hidden>🛒</span>
          Shopping
        </NavLink>

        <div className="my-2 border-t border-border" />

        <NavLink
          to="/household"
          onClick={() => setMobileOpen(false)}
          data-tour="nav-household"
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              isActive
                ? 'bg-page text-ink-muted'
                : 'text-ink-subtle hover:bg-page hover:text-ink-muted'
            }`
          }
        >
          <span aria-hidden>🏡</span>
          Household
        </NavLink>
      </nav>

      <div className="p-3 border-t border-border space-y-1">
        <p className="text-xs font-medium text-ink-muted truncate">
          {user?.name}
        </p>
        <p className="text-xs text-ink-subtle truncate">{user?.email}</p>
        <button
          onClick={logout}
          className="mt-1 text-xs text-ink-subtle hover:text-status-critical-text transition-colors"
        >
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Hamburger button — mobile only, shown when sidebar is closed.
          PageHeader.jsx's `pl-12` clears this button's ~36px width — keep in
          sync if this button's size or position ever changes. */}
      <button
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-surface border border-border shadow-sm text-ink-muted hover:text-ink"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        style={{ display: mobileOpen ? 'none' : undefined }}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* Backdrop — mobile only */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — always visible on md+, slide-in overlay on mobile */}
      <aside
        className={`
          flex-col bg-surface border-r border-border flex h-screen
          md:w-56 md:flex-shrink-0 md:sticky md:top-0
          fixed top-0 left-0 z-50 w-64 transition-transform duration-200
          md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
