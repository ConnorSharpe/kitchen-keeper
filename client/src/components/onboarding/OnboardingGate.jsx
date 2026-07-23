import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import WelcomeStep from './WelcomeStep.jsx';
import StaplesChecklist from './StaplesChecklist.jsx';
import { runProductTour } from './productTour.js';

// setMobileNavOpen is threaded down from AppLayout — the mobile tour needs to
// force the slide-in sidebar open across all six nav steps, so its
// open/closed state can no longer live only inside Sidebar.jsx.
export default function OnboardingGate({ setMobileNavOpen }) {
  const { onboarding, completeOnboarding } = useAuth();
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
      { setMobileNavOpen }
    );
  }

  if (step === 'welcome') {
    return (
      <WelcomeStep
        flow={onboarding.flow}
        onContinue={startTour}
        onDismiss={() => setDismissed(true)}
      />
    );
  }

  if (step === 'checklist') {
    return (
      <StaplesChecklist onComplete={handleFinish} onDismiss={() => setDismissed(true)} />
    );
  }

  return null; // 'tour' step: driver.js renders its own overlay outside React
}
