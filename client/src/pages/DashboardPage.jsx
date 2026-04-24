import ExpiryStrip from '../components/dashboard/ExpiryStrip.jsx';
import EatThisNow from '../components/dashboard/EatThisNow.jsx';
import QuickAdd from '../components/dashboard/QuickAdd.jsx';
import WasteSaved from '../components/dashboard/WasteSaved.jsx';

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

      {/* Zone 3 & 4: Quick Add + Waste Saved side by side on wider screens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section aria-labelledby="quickadd-heading">
          <h2 id="quickadd-heading" className="sr-only">Quick Add</h2>
          <QuickAdd />
        </section>

        <section aria-labelledby="waste-heading">
          <h2 id="waste-heading" className="sr-only">Waste Saved</h2>
          <WasteSaved />
        </section>
      </div>
    </div>
  );
}
