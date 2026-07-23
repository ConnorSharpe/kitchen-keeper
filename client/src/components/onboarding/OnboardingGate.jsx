import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/index.js';
import WelcomeStep from './WelcomeStep.jsx';
import StaplesChecklist from './StaplesChecklist.jsx';
import { runProductTour } from './productTour.js';

// setMobileNavOpen is threaded down from AppLayout — the mobile tour needs to
// force the slide-in sidebar open/closed across all twelve tour steps, so
// its open/closed state can no longer live only inside Sidebar.jsx.
export default function OnboardingGate({ setMobileNavOpen }) {
  const { onboarding, completeOnboarding } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false); // session-only
  const [step, setStep] = useState('welcome'); // 'welcome' | 'tour' | 'checklist'

  if (!onboarding || onboarding.complete || dismissed) return null;

  // Wraps completeOnboarding() so a PATCH failure can't become an unhandled
  // promise rejection. Documented, deliberate behavior on failure: swallow
  // it. The modal has already closed from the user's perspective, there's
  // nothing actionable to show them, and since the server-side row is still
  // `complete: false`, onboarding simply runs again next session — an
  // acceptable outcome for a first-run UI, not an error worth surfacing.
  async function handleFinish() {
    try {
      await completeOnboarding();
    } catch {
      /* see comment above — intentionally swallowed */
    }
  }

  // Real save — WelcomeStep awaits this and drives its own submitting/error
  // UI around it. OnboardingPreview (Household-page replay) supplies a NOOP
  // instead, so the same component works for both real onboarding and a
  // side-effect-free preview.
  async function saveHouseholdName(trimmedName) {
    await api.patch('/api/household', { name: trimmedName });
  }

  // Real save — StaplesChecklist awaits this the same way. OnboardingPreview
  // supplies a NOOP.
  async function addItems(items) {
    await api.post('/api/pantry/bulk', { items });
  }

  function startTour() {
    setStep('tour');
    runProductTour(
      () => {
        // Fires on driver.js's onDestroyed — however the tour ended, it's done.
        if (onboarding.flow === 'new_household') {
          setStep('checklist');
        } else {
          handleFinish();
        }
      },
      { setMobileNavOpen, navigate }
    );
  }

  if (step === 'welcome') {
    return (
      <WelcomeStep
        flow={onboarding.flow}
        onContinue={startTour}
        onDismiss={() => setDismissed(true)}
        onSaveHouseholdName={saveHouseholdName}
      />
    );
  }

  if (step === 'checklist') {
    return (
      <StaplesChecklist
        onComplete={handleFinish}
        onDismiss={() => setDismissed(true)}
        onAddItems={addItems}
      />
    );
  }

  return null; // 'tour' step: driver.js renders its own overlay outside React
}
