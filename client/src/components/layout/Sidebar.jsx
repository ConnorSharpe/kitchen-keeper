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

  return (
    <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0">
      <div className="p-4 border-b border-gray-200">
        <span className="text-lg font-bold text-orange-600">Kitchen Keeper</span>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {/* Dashboard is the primary surface — use `end` so it only matches exactly `/` */}
        <NavLink to="/" end className={navClass}>
          <span aria-hidden>🏠</span>
          Dashboard
        </NavLink>

        <NavLink to="/pantry" className={navClass}>
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
      </nav>

      <div className="p-3 border-t border-gray-200 space-y-1">
        <p className="text-xs font-medium text-gray-700 truncate">{user?.name}</p>
        <p className="text-xs text-gray-400 truncate">{user?.email}</p>
        <button
          onClick={logout}
          className="mt-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
