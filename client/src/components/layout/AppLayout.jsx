import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import { PantryProvider } from '../../context/PantryContext.jsx';

export default function AppLayout() {
  return (
    <PantryProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </PantryProvider>
  );
}
