import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import OnboardingGate from '../onboarding/OnboardingGate.jsx';
import OnboardingPreview from '../onboarding/OnboardingPreview.jsx';
import { PantryProvider } from '../../context/PantryContext.jsx';

export default function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Mounted here (not inside HouseholdPage) for the same reason OnboardingGate
  // is: the tour it drives navigates across routes, which would unmount a
  // page-rooted component mid-tour and orphan its onFinished callback.
  const [previewFlow, setPreviewFlow] = useState(null); // 'new_household' | 'joined' | null

  return (
    <PantryProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} />
        <main className="flex-1 overflow-auto">
          <Outlet context={{ setMobileNavOpen, setPreviewFlow }} />
        </main>
      </div>
      <OnboardingGate setMobileNavOpen={setMobileNavOpen} />
      {previewFlow && (
        <OnboardingPreview
          flow={previewFlow}
          onClose={() => setPreviewFlow(null)}
          setMobileNavOpen={setMobileNavOpen}
        />
      )}
    </PantryProvider>
  );
}
