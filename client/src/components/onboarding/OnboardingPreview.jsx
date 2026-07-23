import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WelcomeStep from './WelcomeStep.jsx';
import StaplesChecklist from './StaplesChecklist.jsx';
import { runProductTour } from './productTour.js';

// Not a plain synchronous `() => {}` — WelcomeStep/StaplesChecklist `await`
// these, driving real submitting/disabled/error UI around them, so the
// no-op path must have identical calling semantics to the real one.
const NOOP = async () => {};

// Side-effect-free replay of the onboarding tour from the Household page.
// Never touches user_onboarding, never renames the household for real, and
// never inserts real pantry items — purely for previewing both flows.
// Reuses the exact same runProductTour() as OnboardingGate; the only
// difference is which flow drives it and which callbacks the child steps
// are given, never a second tour implementation.
export default function OnboardingPreview({ flow, onClose, setMobileNavOpen }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('welcome');

  function startTour() {
    setStep('tour');
    runProductTour(
      () => (flow === 'new_household' ? setStep('checklist') : onClose()),
      { setMobileNavOpen, navigate }
    );
  }

  if (step === 'welcome') {
    return (
      <WelcomeStep
        flow={flow}
        onContinue={startTour}
        onDismiss={onClose}
        onSaveHouseholdName={NOOP}
        allowNaming={false}
      />
    );
  }
  if (step === 'checklist') {
    return (
      <StaplesChecklist onComplete={onClose} onDismiss={onClose} onAddItems={NOOP} />
    );
  }
  return null;
}
