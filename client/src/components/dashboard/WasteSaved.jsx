import { usePantryContext } from '../../context/PantryContext.jsx';

export default function WasteSaved() {
  const { wasteSaved, loading } = usePantryContext();

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 flex items-center gap-4">
      <span className="text-3xl" aria-hidden>♻️</span>
      <div>
        <p className="text-2xl font-bold text-green-600">{loading ? '—' : wasteSaved}</p>
        <p className="text-sm text-gray-500">
          item{wasteSaved !== 1 ? 's' : ''} saved from waste this week
        </p>
      </div>
    </div>
  );
}
