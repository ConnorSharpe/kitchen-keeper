import { useEffect, useRef, useState } from 'react';
import {
  getExpiryStatus,
  getExpiryRowClass,
  getExpiryBadgeClass,
  getExpiryLabel,
  getRipeningState,
  getRipeningDays,
} from '../../utils/expiry.js';
import { STORAGE_LOCATION_LABELS } from '../../utils/pantryDefaults.js';

const STORAGE_LOCATION_ICONS = {
  pantry: '🥫',
  refrigerator: '🧊',
  freezer: '❄',
};

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
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

// Derives the row/card status the table and card views both need from an item.
function deriveStatus(item) {
  const ripeState = getRipeningState(item);
  const expiryStatus = getExpiryStatus(item.expiryDate);
  const rowStatus =
    ripeState === 'frozen'
      ? 'ok'
      : ripeState === 'ripening'
        ? 'ripening'
        : expiryStatus;
  const isFrozen = item.storageLocation === 'freezer';
  const badgeStatus = isFrozen ? 'ok' : expiryStatus;
  return { ripeState, expiryStatus, rowStatus, isFrozen, badgeStatus };
}

export default function PantryTable({
  items,
  onEdit,
  onMarkUsed,
  onToggleFreeze,
  onSplit,
  onDelete,
}) {
  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-4xl mb-3">🧺</p>
        <p className="text-sm">
          Your pantry is empty. Add items manually or scan a grocery receipt.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop/tablet: dense table (md and up) */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {[
                'Name',
                'Category',
                'Qty',
                'Unit',
                'Storage',
                'Expires',
                'Status',
                '',
              ].map((h) => (
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
              const { ripeState, expiryStatus, rowStatus, isFrozen, badgeStatus } =
                deriveStatus(item);
              const rowCls =
                ripeState === 'frozen' ? '' : getExpiryRowClass(rowStatus);
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
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {item.category}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {item.quantity}
                    {item.servingsPerPurchaseUnit != null && (
                      <span className="block text-xs text-gray-400">
                        {item.servingsPerPurchaseUnit} servings/{item.unit}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {item.unit}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StorageBadge storageLocation={item.storageLocation} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ExpiryBadge
                      expiryDate={item.expiryDate}
                      status={badgeStatus}
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusLabel
                      ripeState={ripeState}
                      expiryStatus={expiryStatus}
                      readyDate={item.readyDate}
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <ActionButton
                        onClick={() => onEdit(item)}
                        title="Edit"
                        label="Edit"
                      />
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

      {/* Mobile: stacked cards (below md) — TASK-056 Design B */}
      <div className="md:hidden space-y-3">
        {items.map((item) => (
          <PantryCard
            key={item.id}
            item={item}
            onEdit={onEdit}
            onMarkUsed={onMarkUsed}
            onToggleFreeze={onToggleFreeze}
            onSplit={onSplit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </>
  );
}

function PantryCard({ item, onEdit, onMarkUsed, onToggleFreeze, onSplit, onDelete }) {
  const { ripeState, expiryStatus, isFrozen, badgeStatus } = deriveStatus(item);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3
          className="text-sm font-medium text-gray-900 truncate"
          title={item.name}
        >
          {item.name}
          {isFrozen && (
            <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium align-middle">
              ❄ Frozen
            </span>
          )}
        </h3>
        <ExpiryBadge expiryDate={item.expiryDate} status={badgeStatus} />
      </div>

      <div className="mb-2">
        <StatusLabel
          ripeState={ripeState}
          expiryStatus={expiryStatus}
          readyDate={item.readyDate}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mb-3">
        <span>{item.category}</span>
        <span>
          {item.quantity} {item.unit}
        </span>
        <StorageBadge storageLocation={item.storageLocation} />
      </div>

      <div className="flex items-center gap-2">
        <CardActionButton onClick={() => onEdit(item)} label="Edit" />
        <CardActionButton
          onClick={() => onMarkUsed(item.id)}
          label="✓ Used"
          success
        />
        <CardActionButton
          onClick={() => onToggleFreeze(item.id)}
          label={isFrozen ? '🌡 Thaw' : '❄ Freeze'}
        />
        <ItemOverflowMenu
          onSplit={() => onSplit(item)}
          onDelete={() => onDelete(item.id)}
        />
      </div>
    </div>
  );
}

// Split/Delete — least-frequent (and most consequential, for Delete) pantry-row actions — live
// behind this overflow control on mobile so Edit/Used/Freeze stay at a real touch-target size.
function ItemOverflowMenu({ onSplit, onDelete }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (
        !menuRef.current?.contains(e.target) &&
        !triggerRef.current?.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative ml-auto">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More item actions"
          className="absolute right-0 bottom-full mb-1 w-36 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-20"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSplit();
            }}
            className="w-full text-left text-sm px-3 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Split
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full text-left text-sm px-3 py-2 text-red-500 hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function CardActionButton({ onClick, label, success = false }) {
  const cls = success
    ? 'text-green-600 hover:bg-green-50'
    : 'text-gray-600 hover:bg-gray-100';
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center min-h-[44px] px-2.5 text-xs font-medium rounded-md transition-colors ${cls}`}
    >
      {label}
    </button>
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
    ok: { cls: 'text-green-600', text: 'Good' },
    warning: { cls: 'text-amber-600', text: 'Expiring soon' },
    critical: { cls: 'text-red-600', text: 'Critical' },
    expired: { cls: 'text-red-700', text: 'Expired' },
    none: { cls: 'text-gray-400', text: 'No date' },
  };
  const { cls, text } = map[expiryStatus] ?? map.none;
  return <span className={`text-xs font-medium ${cls}`}>{text}</span>;
}

function ActionButton({
  onClick,
  label,
  title,
  danger = false,
  success = false,
}) {
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
