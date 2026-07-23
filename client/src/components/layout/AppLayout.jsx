import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import OnboardingGate from '../onboarding/OnboardingGate.jsx';
import { PantryProvider } from '../../context/PantryContext.jsx';

export default function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <PantryProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <OnboardingGate setMobileNavOpen={setMobileNavOpen} />
    </PantryProvider>
  );
}
