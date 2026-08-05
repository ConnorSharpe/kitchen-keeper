import { Link } from 'react-router-dom';

const FEATURES = [
  { icon: '🥦', title: 'Track your pantry', text: 'Add items manually or snap a photo of a grocery receipt.' },
  { icon: '⏰', title: 'See what\'s expiring', text: 'Color-coded urgency so nothing gets forgotten in the back of the fridge.' },
  { icon: '💬', title: 'Get AI meal ideas', text: 'Suggestions generated from what\'s about to expire, or chat freely with the AI assistant.' },
  { icon: '📖', title: 'Save your recipes', text: 'Keep a collection built from suggestions or your own search.' },
  { icon: '🛒', title: 'Build shopping lists', text: 'From pantry gaps or straight from a recipe\'s ingredients.' },
  { icon: '🏠', title: 'Share with your household', text: 'Everyone sees the same pantry, recipes, and lists in real time.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="px-6 py-4">
        <span className="text-lg font-bold text-orange-600">Kitchen Keeper</span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 max-w-2xl">
          Stop throwing away food you forgot you had.
        </h1>
        <p className="mt-4 text-gray-500 max-w-xl">
          Kitchen Keeper is an AI-powered food waste management app for households. Track your pantry, see
          what&apos;s expiring, get AI meal suggestions tailored to what you have on hand, and share it all
          with your family — from your phone or browser.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Link
            to="/sign-up"
            className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors"
          >
            Create account
          </Link>
          <Link
            to="/sign-in"
            className="px-6 py-2.5 border border-gray-300 hover:bg-gray-100 text-gray-700 font-medium rounded-lg transition-colors"
          >
            Log in
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 max-w-4xl text-left">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="text-2xl mb-2" aria-hidden>{f.icon}</div>
              <h2 className="font-semibold text-gray-900 mb-1">{f.title}</h2>
              <p className="text-sm text-gray-500">{f.text}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
