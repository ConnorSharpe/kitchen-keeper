# TASK-005 — Barcode Scanner + Open Food Facts

Version: DRAFT-3 — IMPLEMENTATION-READY
Status: Approved by architect (2 review rounds). Ready to implement.

## Review History

| Round | Verdict | Key changes |
|-------|---------|-------------|
| DRAFT-1 | Not approved | Initial design — 5 must-fixes, 3 should-fixes, 3 minor |
| DRAFT-2 | Approved with minor notes | Must-fixes applied: AddItemModal added to scope, modal state contract documented, onError wired, double-stop guard, category enum sourced; should-fixes applied: format restriction, AbortController signature, name fallback; minor fixes: dead state removed, OFF abbreviation corrected, dynamic import sharpened |
| DRAFT-3 | Approved | Minor #1: AbortController owned and wired in PantryPage (was dead code); Minor #2: category default asymmetry documented as intentional design decision; Minor #3: Suspense fallback=null noted as deliberate trade-off |

---

# Goal

Enable zero-friction pantry onboarding via barcode scan. User taps "Scan barcode"
on the Pantry page, points their phone camera at a grocery item, and the
Add Item modal opens pre-filled with the product name and best-fit category from
the Open Food Facts API. The user reviews, optionally edits, and confirms.

No backend changes. No API key. Pure client feature.

---

# Allowed Files

- `client/src/pages/PantryPage.jsx` — add button + scanner state
- `client/src/components/pantry/BarcodeScanner.jsx` — NEW: camera overlay + scan loop
- `client/src/utils/openFoodFacts.js` — NEW: OFF fetch + category mapping
- `client/src/components/pantry/AddItemModal.jsx` — add `prefill` prop (additive, backward-compatible)

---

# Forbidden Files

- All `server/*` files — no backend changes permitted
- `client/src/components/pantry/PantryTable.jsx` — unrelated
- `client/src/components/pantry/ReceiptUpload.jsx` — unrelated (different flow)
- All other client pages and components

---

# Constraints

1. **Pure client change.** No server routes, no backend proxy, no schema migration.

2. **Direct browser fetch to Open Food Facts (OFF).** OFF is a public CORS-enabled API.
   No backend proxy needed.
   Endpoint: `https://world.openfoodfacts.org/api/v2/product/{barcode}.json`

3. **No API key required.** OFF is a community project; unauthenticated read access is free.

4. **Barcode formats: EAN-13 and UPC-A only.** These are the standard grocery formats
   indexed by OFF. QR codes and other formats are explicitly disabled via `formatsToSupport`.

5. **Library: `html5-qrcode`.** Use `Html5Qrcode` class with `Html5QrcodeSupportedFormats`
   enum to restrict to EAN-13 and UPC-A. Do not use native `BarcodeDetector` API —
   Safari support is insufficient. If `html5-qrcode` proves incompatible with the build,
   `quagga2` is the approved fallback (requires re-specifying format config).

6. **AddItemModal: additive `prefill` prop only.** The only change to `AddItemModal` is
   accepting an optional `prefill` prop. No changes to submit logic, validation, layout,
   or `isEdit` semantics. The prop is ignored when `item` is present (edit mode).

7. **Graceful degradation for all failure modes.** Three failure paths:
   - No camera permission → `onError` fires → toast error, scanner closes, no modal
   - Product not found in OFF (status ≠ 1) → toast warning, AddItemModal opens empty
   - Network error / fetch aborted → toast error, AddItemModal opens empty

8. **Do not refactor ReceiptUpload or existing flows.** "Scan receipt" is a separate feature.
   Do not consolidate, rename, or unify with the barcode flow.

9. **HTTPS required for camera API on mobile.** Dev server runs over HTTP.
   Mobile testing requires a production deploy or HTTPS tunnel (e.g. ngrok).
   This is a known environment constraint, not a code issue.

---

# Existing Modal State Contract (PantryPage)

The current `modalItem` state in `PantryPage` uses these sentinel values:

```
undefined  → AddItemModal closed
null       → AddItemModal open in ADD mode (empty form)
<object>   → AddItemModal open in EDIT mode (item = that object)
```

`AddItemModal` uses `isEdit = Boolean(item)` — `null` and `undefined` both produce
`false`, so passing `null` as `item` correctly opens add mode.

The barcode flow reuses this contract:
- `setModalItem(null)` → opens AddItemModal in add mode
- `barcodePrefill` state carries the pre-fill data separately
- `prefill` prop is passed only when `modalItem === null`

---

# Dependency Chain

Editing:
- `client/src/pages/PantryPage.jsx`
- `client/src/components/pantry/AddItemModal.jsx`

Creating:
- `client/src/components/pantry/BarcodeScanner.jsx`
- `client/src/utils/openFoodFacts.js`

Irrelevant:
- All `server/*`
- `client/src/components/pantry/ReceiptUpload.jsx`
- `client/src/components/pantry/PantryTable.jsx`
- All other client pages

---

# Implementation Plan

## 1. `client/src/utils/openFoodFacts.js` — NEW

### 1a. Fetch product by barcode (with AbortController)

```js
const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';

export async function fetchProductByBarcode(barcode, { signal } = {}) {
  const res = await fetch(`${OFF_BASE}/${barcode}.json`, { signal });
  if (!res.ok) throw new Error('Network error');
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null; // product not found
  return mapProduct(data.product);
}
```

Returns `null` for unknown barcodes. Throws on network error or abort.
Callers should catch `AbortError` separately from other errors (see PantryPage section).

### 1b. Map OFF product → AddItemModal pre-fill shape

```js
function mapProduct(product) {
  return {
    name: product.product_name_en || product.product_name || product.generic_name || '',
    category: mapCategory(product.categories_tags ?? []),
  };
}
```

Name fallback chain (in priority order):
1. `product_name_en` — English-specific name (preferred)
2. `product_name` — any-language name
3. `generic_name` — product type descriptor (e.g. "Baked beans in tomato sauce")
4. `''` — user must type the name manually

### 1c. Category mapping

The source of truth for valid category values is `CATEGORIES` in `AddItemModal.jsx`:

```js
// AddItemModal.jsx lines 3-6 — DO NOT introduce values not in this list
const CATEGORIES = [
  'Produce', 'Dairy', 'Meat', 'Seafood', 'Bakery',
  'Frozen', 'Pantry', 'Beverages', 'Condiments', 'Other',
];
```

OFF returns `categories_tags` as an array of strings like `["en:beverages", "en:waters"]`.
Match against the exact CATEGORIES values using substring keywords. First match wins.

```js
const CATEGORY_RULES = [
  { keywords: ['dairy', 'milk', 'cheese', 'yogurt', 'cream'],          category: 'Dairy' },
  { keywords: ['produce', 'vegetable', 'fruit', 'fresh'],              category: 'Produce' },
  { keywords: ['seafood', 'fish', 'shellfish', 'shrimp', 'prawn'],     category: 'Seafood' },
  { keywords: ['meat', 'poultry', 'chicken', 'beef', 'pork', 'lamb'],  category: 'Meat' },
  { keywords: ['bakery', 'bread', 'pastry', 'biscuit', 'cake'],        category: 'Bakery' },
  { keywords: ['frozen'],                                               category: 'Frozen' },
  { keywords: ['beverage', 'drink', 'juice', 'water', 'soda', 'tea', 'coffee'], category: 'Beverages' },
  { keywords: ['condiment', 'sauce', 'dressing', 'vinegar', 'oil'],    category: 'Condiments' },
];

function mapCategory(tags) {
  const tagStr = tags.join(' ').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => tagStr.includes(k))) return rule.category;
  }
  return 'Pantry'; // default: most packaged grocery items belong here, not "Other"
}
```

All returned values are members of the `CATEGORIES` enum. `'Other'` is intentionally
excluded from the default — `'Pantry'` is the correct fallback for packaged grocery items.

**Intentional category default asymmetry:**
Two "no category" paths exist and produce different defaults — this is by design:

| Path | Default category | Reasoning |
|------|-----------------|-----------|
| Unknown barcode (OFF returns null) | `"Other"` | No product signal at all; "Other" is honest |
| Known product, no tag match | `"Pantry"` | Product exists and is a packaged grocery item; "Pantry" is a better guess than "Other" |

The unknown-barcode path hits `setBarcodePrefill(null)`, which causes `buildInitialState`
to fall through to `prefill?.category ?? 'Other'`. The known-product path hits
`mapCategory()`, which returns `'Pantry'` when no rule matches. Both are correct for
their respective contexts.

---

## 2. `client/src/components/pantry/BarcodeScanner.jsx` — NEW

### 2a. Component contract

```jsx
// Props:
// onDetected(barcode: string) — called exactly once when a valid barcode is scanned
// onClose()                   — called when the user taps Cancel
// onError(err: Error)         — called when camera permission is denied or device fails
export default function BarcodeScanner({ onDetected, onClose, onError }) { ... }
```

`onDetected` fires at most once per session. `onError` fires instead of `onDetected`
when camera access fails. The parent is responsible for toasts and UI state changes
in response to these callbacks.

### 2b. Scanner lifecycle with stop-guard

```jsx
import { useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.UPC_A,
];

export default function BarcodeScanner({ onDetected, onClose, onError }) {
  const scannerRef = useRef(null);
  const stoppedRef = useRef(false); // prevents double stop()

  const stopScanner = async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    await scannerRef.current?.stop().catch(() => {});
  };

  useEffect(() => {
    const scanner = new Html5Qrcode('barcode-scanner-region');
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 280, height: 140 }, // 2:1 ratio suits EAN-13/UPC-A linear barcodes
          formatsToSupport: SUPPORTED_FORMATS,
        },
        (decodedText) => {
          // Guard: stop() already called (should not happen, but defensive)
          if (stoppedRef.current) return;
          stopScanner().then(() => onDetected(decodedText));
        },
        () => {}, // per-frame scan failure — silent, expected on every non-barcode frame
      )
      .catch((err) => {
        // Camera permission denied or device not available
        stoppedRef.current = true; // scanner never started — nothing to stop
        onError(err);
      });

    return () => {
      stopScanner(); // cleanup on unmount; stoppedRef guards against double-stop
    };
  }, [onDetected, onClose, onError]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80">
      <div className="relative w-full max-w-sm">
        <div id="barcode-scanner-region" className="w-full rounded-lg overflow-hidden" />
        <p className="text-white text-sm text-center mt-4 opacity-75">
          Point at a barcode to scan
        </p>
      </div>
      <button
        onClick={() => { stopScanner(); onClose(); }}
        className="mt-6 px-5 py-2 bg-white text-gray-900 text-sm font-medium rounded-md"
      >
        Cancel
      </button>
    </div>
  );
}
```

`stoppedRef` makes `stopScanner()` idempotent. All three exit paths (detection, Cancel,
unmount) route through it — only the first call to `stop()` reaches `html5-qrcode`.

> **Bundle size note:** `html5-qrcode` adds ~200KB gzipped. If this becomes a concern,
> wrap `BarcodeScanner` in `React.lazy()` at its import site in `PantryPage.jsx`.
> The lazy boundary is the component itself — no architectural change needed.

---

## 3. `client/src/components/pantry/AddItemModal.jsx` — Modify (additive only)

### 3a. Add `prefill` prop

`prefill` seeds the form when opening in add mode with pre-filled data (barcode flow).
It is ignored when `item` is present (edit mode). No other behavior changes.

```js
// Before:
function buildInitialState(item) {
  if (!item) {
    return { name: '', category: 'Other', quantity: '1', unit: 'item', purchaseDate: '', expiryDate: '', notes: '' };
  }
  ...
}

export default function AddItemModal({ item, onClose, onSave }) {
  const [form, setForm] = useState(() => buildInitialState(item));
  const isEdit = Boolean(item);
  ...
}
```

```js
// After:
function buildInitialState(item, prefill) {
  if (!item) {
    return {
      name:         prefill?.name     ?? '',
      category:     prefill?.category ?? 'Other',
      quantity:     '1',
      unit:         'item',
      purchaseDate: '',
      expiryDate:   '',
      notes:        '',
    };
  }
  // edit mode — prefill is ignored
  return {
    name:         item.name,
    category:     item.category,
    quantity:     String(item.quantity),
    unit:         item.unit,
    purchaseDate: fromISO(item.purchaseDate),
    expiryDate:   fromISO(item.expiryDate),
    notes:        item.notes ?? '',
  };
}

export default function AddItemModal({ item, prefill, onClose, onSave }) {
  const [form, setForm] = useState(() => buildInitialState(item, prefill));
  const isEdit = Boolean(item); // prefill does NOT affect isEdit
  ...
}
```

`prefill` shape: `{ name: string, category: string }`. Only `name` and `category` are
read from it — all other fields remain at their defaults.

---

## 4. `client/src/pages/PantryPage.jsx` — Modify

### 4a. Imports

```js
import { lazy, Suspense, useRef } from 'react';
import { fetchProductByBarcode } from '../utils/openFoodFacts.js';

// Lazy-load BarcodeScanner to defer its ~200KB bundle until first use
const BarcodeScanner = lazy(() => import('../components/pantry/BarcodeScanner.jsx'));
```

### 4b. State and ref additions

```js
const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
const [barcodePrefill, setBarcodePrefill] = useState(null); // { name, category } | null
const fetchAbortRef = useRef(null); // AbortController for in-flight OFF fetch
```

No `scannerError` state — errors are handled imperatively via toast.

### 4c. Scanner callbacks

`handleBarcodeDetected` creates an `AbortController` before the OFF fetch and stores it
in `fetchAbortRef`. If the component unmounts or the user navigates away mid-fetch, the
cleanup returned from `useEffect` aborts it. `AbortError` is caught silently — no toast,
no modal, since the user has already left the page.

```js
// In the component body, register cleanup for any in-flight fetch:
useEffect(() => {
  return () => fetchAbortRef.current?.abort();
}, []);

const handleBarcodeDetected = async (barcode) => {
  setShowBarcodeScanner(false);

  const controller = new AbortController();
  fetchAbortRef.current = controller;

  try {
    const product = await fetchProductByBarcode(barcode, { signal: controller.signal });
    if (!product) {
      toast('Product not found — enter details manually', { icon: '⚠️' });
      setBarcodePrefill(null);
    } else {
      setBarcodePrefill({ name: product.name, category: product.category });
    }
    setModalItem(null); // open AddItemModal in add mode (existing state contract)
  } catch (err) {
    if (err.name === 'AbortError') return; // user navigated away — silent, no modal
    toast.error('Could not look up product — enter details manually');
    setBarcodePrefill(null);
    setModalItem(null);
  } finally {
    fetchAbortRef.current = null;
  }
};

const handleScannerError = () => {
  setShowBarcodeScanner(false);
  toast.error('Camera access denied — check browser permissions');
  // Do not open AddItemModal — user did not intend to add manually
};
```

### 4d. Add "Scan barcode" button

In the header button group, alongside existing buttons:

```jsx
<button
  onClick={() => setShowBarcodeScanner(true)}
  className="px-4 py-2 bg-white text-orange-600 text-sm font-medium rounded-md border border-orange-300 hover:bg-orange-50 transition-colors shadow-sm"
>
  Scan barcode
</button>
```

### 4e. Update AddItemModal render

```jsx
{modalItem !== undefined && (
  <AddItemModal
    item={modalItem || undefined}
    prefill={modalItem === null ? barcodePrefill : undefined}
    onClose={() => { setModalItem(undefined); setBarcodePrefill(null); }}
    onSave={handleSave}
  />
)}
```

Clearing `barcodePrefill` on close ensures the next "+ Add item" tap does not inherit
a stale pre-fill.

### 4f. Render BarcodeScanner

```jsx
{showBarcodeScanner && (
  <Suspense fallback={null}>
    <BarcodeScanner
      onDetected={handleBarcodeDetected}
      onClose={() => setShowBarcodeScanner(false)}
      onError={handleScannerError}
    />
  </Suspense>
)}
```

---

# Data Flow (end-to-end)

```
User clicks "Scan barcode"
  │
  ▼
BarcodeScanner mounts (lazy-loaded) → rear camera opens
  │
  ▼
User points at EAN-13/UPC-A barcode
html5-qrcode fires success callback ("5000112637922")
  │
  ▼
stopScanner() → stoppedRef = true → scanner.stop()
onDetected("5000112637922") → PantryPage.handleBarcodeDetected
  │
  ▼
setShowBarcodeScanner(false) → BarcodeScanner unmounts
  (useEffect cleanup calls stopScanner() → stoppedRef already true → no-op)
  │
  ▼
fetchProductByBarcode("5000112637922")
  GET https://world.openfoodfacts.org/api/v2/product/5000112637922.json
  → { status: 1, product: { product_name_en: "Heinz Baked Beans",
                             categories_tags: ["en:canned-foods", "en:pantry"] } }
  │
  ▼
mapProduct → { name: "Heinz Baked Beans", category: "Pantry" }
  │
  ▼
setBarcodePrefill({ name: "Heinz Baked Beans", category: "Pantry" })
setModalItem(null)  →  AddItemModal opens in ADD mode
  name = "Heinz Baked Beans", category = "Pantry"
  quantity = "1", unit = "item", all dates blank
  │
  ▼
User adjusts fields → clicks "Add item"
handleSave(body) → addItem(body) → POST /api/pantry → DB insert
toast.success("Item added")
setBarcodePrefill(null) cleared on modal close
```

---

# Acceptance Criteria

1. **Happy path — known product:**
   Scan EAN-13 barcode → scanner closes → AddItemModal opens in add mode
   (title "Add item", button "Add item") → name pre-filled → category pre-filled →
   user can edit all fields → submit creates DB row.

2. **Category mapping uses exact CATEGORIES enum values:**
   A product with `categories_tags` containing `"en:beverages"` → category = `"Beverages"`.
   All mapped values are members of `['Produce','Dairy','Meat','Seafood','Bakery','Frozen','Pantry','Beverages','Condiments','Other']`.

3. **Default category is "Pantry" not "Other":**
   If no OFF tag matches any rule, `mapCategory` returns `"Pantry"`.

4. **Unknown barcode (OFF returns status ≠ 1):**
   Toast: "Product not found — enter details manually" →
   AddItemModal opens in add mode with all fields at default (name blank, category `"Other"`).

5. **Known product, no OFF category tag match:**
   AddItemModal opens with name pre-filled, category = `"Pantry"` (not `"Other"`).
   See intentional asymmetry note in category mapping section.

6. **Network error during OFF fetch:**
   Toast: "Could not look up product — enter details manually" →
   AddItemModal opens with empty form. No crash.

7. **AbortError during OFF fetch (user navigated away):**
   No toast. No modal opened. Silent. `fetchAbortRef.current?.abort()` is called by
   the `useEffect` cleanup; `AbortError` is caught and swallowed in `handleBarcodeDetected`.

8. **Camera permission denied:**
   `html5-qrcode` throws during `.start()` → `onError` fires →
   `handleScannerError` in PantryPage shows toast: "Camera access denied — check browser permissions" →
   scanner closes, AddItemModal does NOT open.

9. **Scanner fires exactly once per session:**
   `stoppedRef` guard ensures `onDetected` is called at most once even if the barcode
   stays in frame after first detection.

10. **No double stop() error:**
    All three exit paths (detection, Cancel button, unmount) route through `stopScanner()`.
    Only the first call reaches `html5-qrcode`; subsequent calls are no-ops.

11. **Format restriction enforced:**
    Only EAN-13 and UPC-A barcodes trigger detection. QR codes and other formats
    are not recognized (configured via `formatsToSupport`).

12. **AbortController is created and passed on every scan:**
    `fetchProductByBarcode(barcode, { signal: controller.signal })` — the `signal`
    parameter is always present. `fetchAbortRef` holds the active controller until
    the fetch resolves or is aborted; it is nulled in `finally`.

13. **Existing flows unaffected:**
    - "+ Add item" → AddItemModal opens with all-default form. `barcodePrefill` is `null`.
    - "Scan receipt" → ReceiptUpload opens unchanged.
    - Edit flow (row action) → AddItemModal opens in edit mode with item data. `prefill` is `undefined`.

14. **No backend calls introduced:**
    Network tab shows only the OFF fetch (`world.openfoodfacts.org`).
    No new requests to the app's own API routes.

15. **Name fallback chain:**
    `product_name_en` → `product_name` → `generic_name` → `''`
    Empty name is valid — user must type it.

16. **Bundle deferred until first use:**
    `html5-qrcode` is not included in the initial bundle. It loads only when
    `BarcodeScanner` is first rendered (`React.lazy`). `Suspense fallback={null}` is
    intentional — the scanner overlay itself serves as the loading indicator once mounted.
    A spinner inside the overlay is a nice-to-have deferred to a later pass.

---

# Verification Steps

```
1.  npm install html5-qrcode — confirm installs without conflict
2.  npm run dev — confirm no build errors, no new console warnings at startup
3.  Open PantryPage — confirm "Scan barcode" button is visible
4.  Open DevTools Network tab. Click "Scan barcode" — confirm html5-qrcode chunk loads lazily
5.  Camera overlay appears — confirm rear-facing camera activates
6.  Scan EAN-13 barcode (cereal box, tin of beans, etc.)
    → scanner closes
    → OFF fetch visible in Network tab (world.openfoodfacts.org)
    → AddItemModal opens: title "Add item", button "Add item"
    → name and category pre-filled
7.  Click "+ Add item" — confirm modal opens with blank name, category "Other" (no prefill)
8.  Click "Scan receipt" — confirm ReceiptUpload opens (unaffected)
9.  Edit an existing pantry item — confirm modal opens in edit mode (unaffected)
10. Test camera denied: revoke camera permission in browser settings
    → click "Scan barcode" → toast "Camera access denied…" appears → no modal opens
11. Test unknown barcode: find a barcode OFF doesn't know (store-brand item)
    → toast "Product not found…" → AddItemModal opens with blank name, category "Other"
11a. Test known product / no category match (find a niche product with sparse OFF tags)
    → AddItemModal opens with name filled, category "Pantry" (not "Other")
12. Network tab audit: confirm no new calls to localhost:3001 during barcode flow
12a. Abort test: scan a barcode, immediately navigate away before OFF fetch resolves
    → no console error, no toast, no modal opened
13. Mobile test (requires HTTPS deploy or ngrok):
    → scan barcode on an actual phone → verify rear camera activates and scan succeeds
```

---

# Known Risks / Open Questions

1. **HTTPS required for camera on mobile.** `getUserMedia` requires a secure context
   on iOS and Android. Dev server uses HTTP — mobile testing requires a Vercel preview
   deploy or ngrok tunnel.

2. **OFF product coverage.** OFF indexes millions of products but store-brand and regional
   items often return no result. Graceful degradation (empty modal) handles this.

3. **OFF category tag quality.** Some products have sparse or incorrect `categories_tags`.
   Mapping is best-effort — the user is expected to verify before submitting.

4. **`html5-qrcode` bundle size.** Mitigated by `React.lazy` — loaded on first use only.

5. **OFF rate limits.** OFF does not publish hard limits for anonymous reads.
   One fetch per scan session is well within any reasonable threshold.

6. **`html5-qrcode` maintained status.** As of 2026 the library is widely used but not
   actively maintained at high velocity. If build incompatibilities arise, `quagga2`
   is the approved fallback (requires re-specifying `formatsToSupport` API).

---

# Out of Scope (Deferred)

- Scanning from camera roll / photo picker
- Shopping list barcode scan
- Caching OFF responses
- Bulk barcode entry
- OFF data beyond name + category (brand, weight, nutrition)
- Backend proxy for OFF (not needed; CORS is open)
- `remove_pantry_item` or other chat tool extensions
