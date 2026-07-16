import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePantryContext } from '../../context/PantryContext.jsx';

const navClass = ({ isActive }) =>
  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-orange-100 text-orange-700'
      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
  }`;

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { expiringItems } = usePantryContext();
  const expiringCount = expiringItems.length;
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <span className="text-lg font-bold text-orange-600">
          Kitchen Keeper
        </span>
        <button
          className="md:hidden text-gray-400 hover:text-gray-600 text-2xl leading-none"
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
        >
          <span aria-hidden>💬</span>
          Chat
        </NavLink>

        <NavLink
          to="/dashboard"
          className={navClass}
          onClick={() => setMobileOpen(false)}
        >
          <span aria-hidden>🏠</span>
          Dashboard
        </NavLink>

        <NavLink
          to="/pantry"
          className={navClass}
          onClick={() => setMobileOpen(false)}
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
        >
          <span aria-hidden>📖</span>
          Recipes
        </NavLink>

        <NavLink
          to="/shopping"
          className={navClass}
          onClick={() => setMobileOpen(false)}
        >
          <span aria-hidden>🛒</span>
          Shopping
        </NavLink>

        <div className="my-2 border-t border-gray-100" />

        <NavLink
          to="/household"
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              isActive
                ? 'bg-gray-100 text-gray-700'
                : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
            }`
          }
        >
          <span aria-hidden>🏡</span>
          Household
        </NavLink>
      </nav>

      <div className="p-3 border-t border-gray-200 space-y-1">
        <p className="text-xs font-medium text-gray-700 truncate">
          {user?.name}
        </p>
        <p className="text-xs text-gray-400 truncate">{user?.email}</p>
        <button
          onClick={logout}
          className="mt-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Hamburger button — mobile only, shown when sidebar is closed */}
      <button
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-white border border-gray-200 shadow-sm text-gray-600 hover:text-gray-900"
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
          flex-col bg-white border-r border-gray-200 flex h-screen
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
