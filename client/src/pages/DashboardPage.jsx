import ExpiryStrip from '../components/dashboard/ExpiryStrip.jsx';
import EatThisNow from '../components/dashboard/EatThisNow.jsx';
import QuickAdd from '../components/dashboard/QuickAdd.jsx';

export default function DashboardPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">What's expiring soon and what you can make tonight</p>
      </div>

      {/* Zone 1: Items expiring within 7 days, sorted most urgent first */}
      <section aria-labelledby="expiry-heading">
        <h2 id="expiry-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Expiring Soon
        </h2>
        <ExpiryStrip />
      </section>

      {/* Zone 2: AI meal suggestions using expiring ingredients */}
      <section aria-labelledby="eat-heading">
        <h2 id="eat-heading" className="sr-only">Eat This Now</h2>
        <EatThisNow />
      </section>

      {/* Zone 3: Quick Add full-width */}
      <section aria-labelledby="quickadd-heading">
        <h2 id="quickadd-heading" className="sr-only">Quick Add</h2>
        <QuickAdd />
      </section>
    </div>
  );
}
