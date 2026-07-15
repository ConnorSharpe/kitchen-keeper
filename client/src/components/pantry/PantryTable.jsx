import { getExpiryStatus, getExpiryRowClass, getExpiryBadgeClass, getExpiryLabel, getRipeningState, getRipeningDays } from '../../utils/expiry.js';
import { STORAGE_LOCATION_LABELS } from '../../utils/pantryDefaults.js';

const STORAGE_LOCATION_ICONS = { pantry: '🥫', refrigerator: '🧊', freezer: '❄' };

function StorageBadge({ storageLocation }) {
  if (!storageLocation) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-600">
      <span aria-hidden="true">{STORAGE_LOCATION_ICONS[storageLocation]}</span>
      {STORAGE_LOCATION_LABELS[storageLocation] ?? storageLocation}
    </span>
  );
}

function ExpiryBadge({ expiryDate, status }) {
  if (!expiryDate) return <span className="text-gray-400 text-xs">—</span>;

  const cls = getExpiryBadgeClass(status);
  const label = getExpiryLabel(expiryDate);

  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function PantryTable({ items, onEdit, onMarkUsed, onToggleFreeze, onSplit, onDelete }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-4xl mb-3">🧺</p>
        <p className="text-sm">Your pantry is empty. Add items manually or scan a grocery receipt.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {['Name', 'Category', 'Qty', 'Unit', 'Storage', 'Expires', 'Status', ''].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {items.map((item) => {
            const ripeState    = getRipeningState(item);
            const expiryStatus = getExpiryStatus(item.expiryDate);
            const rowStatus = ripeState === 'frozen'   ? 'ok'
                            : ripeState === 'ripening' ? 'ripening'
                            : expiryStatus;
            const rowCls = ripeState === 'frozen' ? '' : getExpiryRowClass(rowStatus);
            const isFrozen = item.storageLocation === 'freezer';
            const badgeStatus = isFrozen ? 'ok' : expiryStatus;
            return (
              <tr key={item.id} className={`${rowCls} transition-colors`}>
                <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                  {item.name}
                  {isFrozen && (
                    <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">
                      ❄ Frozen
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.category}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.quantity}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.unit}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <StorageBadge storageLocation={item.storageLocation} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <ExpiryBadge expiryDate={item.expiryDate} status={badgeStatus} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <StatusLabel ripeState={ripeState} expiryStatus={expiryStatus} readyDate={item.readyDate} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <ActionButton onClick={() => onEdit(item)} title="Edit" label="Edit" />
                    <ActionButton
                      onClick={() => onMarkUsed(item.id)}
                      title="Mark as used (I cooked this)"
                      label="✓ Used"
                      success
                    />
                    <ActionButton
                      onClick={() => onToggleFreeze(item.id)}
                      title={isFrozen ? 'Unfreeze' : 'Freeze'}
                      label={isFrozen ? '🌡 Thaw' : '❄ Freeze'}
                    />
                    <ActionButton
                      onClick={() => onSplit(item)}
                      title="Split quantity across storage locations"
                      label="Split"
                    />
                    <ActionButton
                      onClick={() => onDelete(item.id)}
                      title="Delete (I threw this away)"
                      label="Delete"
                      danger
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusLabel({ ripeState, expiryStatus, readyDate }) {
  if (ripeState === 'frozen') {
    return <span className="text-blue-600 text-xs">Frozen</span>;
  }
  if (ripeState === 'ripening') {
    const days = getRipeningDays(readyDate);
    const label = days === 1 ? 'Ready tomorrow' : `Ready in ${days}d`;
    return <span className="text-purple-600 text-xs font-medium">{label}</span>;
  }
  const map = {
    ok:       { cls: 'text-green-600', text: 'Good' },
    warning:  { cls: 'text-amber-600', text: 'Expiring soon' },
    critical: { cls: 'text-red-600',   text: 'Critical' },
    expired:  { cls: 'text-red-700',   text: 'Expired' },
    none:     { cls: 'text-gray-400',  text: 'No date' },
  };
  const { cls, text } = map[expiryStatus] ?? map.none;
  return <span className={`text-xs font-medium ${cls}`}>{text}</span>;
}

function ActionButton({ onClick, label, title, danger = false, success = false }) {
  const cls = danger
    ? 'text-red-500 hover:bg-red-50 hover:text-red-700'
    : success
    ? 'text-green-600 hover:bg-green-50 hover:text-green-800'
    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700';
  return (
    <button
      onClick={onClick}
      title={title}
      className={`text-xs px-2 py-1 rounded transition-colors ${cls}`}
    >
      {label}
    </button>
  );
}
