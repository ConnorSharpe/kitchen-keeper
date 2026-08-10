import { forwardRef, useEffect, useRef, useState } from 'react';

// TASK-056 Design C: consolidates Upload Image / Import URL / Find Online behind one disclosure
// trigger. No reusable menu/dropdown primitive exists in this codebase yet, so this is a small
// self-contained one — standard disclosure-menu keyboard model (Enter/Space opens via the native
// button, ArrowDown on open moves focus to the first item, Escape closes and refocuses the trigger,
// click-outside closes).
export default function AddRecipeMenu({
  onUpload,
  onImportUrl,
  onFindOnline,
  findOnlineLoading,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const firstItemRef = useRef(null);

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

  function handleTriggerKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      // Focus lands after the menu renders on the next tick.
      requestAnimationFrame(() => firstItemRef.current?.focus());
    }
  }

  function select(action) {
    setOpen(false);
    action();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="true"
        aria-expanded={open}
        className="btn-primary flex items-center gap-1.5"
      >
        + Add Recipe
        <span aria-hidden className="text-xs">▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Add recipe options"
          className="absolute right-0 mt-1 w-56 bg-surface border border-border rounded-md shadow-lg py-1 z-20"
        >
          <MenuItem
            ref={firstItemRef}
            label="📸 Upload Recipe Image"
            dataTour="upload-recipe-image"
            onSelect={() => select(onUpload)}
          />
          <MenuItem
            label="🔗 Import from URL"
            dataTour="import-recipe-url"
            onSelect={() => select(onImportUrl)}
          />
          <MenuItem
            label={findOnlineLoading ? 'Searching…' : '🔍 Find Recipes Online'}
            dataTour="find-recipes-online"
            disabled={findOnlineLoading}
            onSelect={() => select(onFindOnline)}
          />
        </div>
      )}
    </div>
  );
}

const MenuItem = forwardRef(function MenuItem(
  { label, onSelect, disabled, dataTour },
  ref
) {
  return (
    <button
      ref={ref}
      role="menuitem"
      disabled={disabled}
      data-tour={dataTour}
      onClick={onSelect}
      className="w-full text-left text-sm px-3 py-2 text-ink-muted hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {label}
    </button>
  );
});
