import ExpiryStrip from '../components/dashboard/ExpiryStrip.jsx';
import EatThisNow from '../components/dashboard/EatThisNow.jsx';
import QuickAdd from '../components/dashboard/QuickAdd.jsx';
import SuggestionBox from '../components/dashboard/SuggestionBox.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';

export default function DashboardPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="What's expiring soon and what you can make tonight"
      />

      {/* Zone 1: Items expiring within 7 days, sorted most urgent first */}
      <section aria-labelledby="expiry-heading">
        <h2
          id="expiry-heading"
          className="text-sm font-semibold text-ink-subtle uppercase tracking-wide mb-3"
        >
          Expiring Soon
        </h2>
        <ExpiryStrip />
      </section>

      {/* Zone 2: AI meal suggestions using expiring ingredients */}
      <section aria-labelledby="eat-heading">
        <h2 id="eat-heading" className="sr-only">
          Eat This Now
        </h2>
        <EatThisNow />
      </section>

      {/* Zone 3: Quick Add full-width */}
      <section aria-labelledby="quickadd-heading">
        <h2 id="quickadd-heading" className="sr-only">
          Quick Add
        </h2>
        <QuickAdd />
      </section>

      {/* Zone 4: private, owner-only suggestion box */}
      <section aria-labelledby="suggestion-heading">
        <h2 id="suggestion-heading" className="sr-only">
          Suggest an Improvement
        </h2>
        <SuggestionBox />
      </section>
    </div>
  );
}
