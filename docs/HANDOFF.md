# CampFinder — RecGov Geo-Search Handoff

**Date:** 2026-04-25  
**Phase:** 1 (data pipeline + scoring engine) — smoke test in progress  
**Stack:** Next.js 16.2.4 (App Router), TypeScript strict, Zod v4, Gemini 2.0 Flash

---

## What We Are Trying to Solve

The `POST /api/search` endpoint returns `{ results: [], overview: "No campsites found..." }` for the user's real home coordinates. The root cause is that **the Recreation.gov RIDB geo-radius search API returns zero campgrounds** when queried from those coordinates, even though real campgrounds exist within the search radius.

---

## Architecture Summary

The search pipeline is:

```
POST /api/search
  → searchCampsites()       ← RecGov RIDB /facilities geo-radius search
  → parallel per campsite:
      getDriveMinutes()      ← OSRM public routing
      getWeatherData()       ← Open-Meteo forecast
      getMosquitoData()      ← Campendium HTML scrape
  → getMoonPhase()           ← USNO moon phase API
  → scoreCampsite()          ← deterministic scoring engine
  → generateContent() ×5    ← Gemini 2.0 Flash summaries
  → return ranked results
```

`HOME_LAT` / `HOME_LNG` in `.env.local` is the user's home address — the origin point for the radius search and drive-time calculations. Coordinates come from env vars, not the request body.

---

## The Specific Problem: RIDB Geo-Search Behavior

### What the code does
`searchCampsites()` calls:
```
GET https://ridb.recreation.gov/api/v1/facilities
  ?limit=50
  &latitude={HOME_LAT}
  &longitude={HOME_LNG}
  &radius={radiusMiles}   ← derived from maxDriveMinutes
  &full=true
```

Results are filtered **client-side** by `FacilityTypeDescription === 'Campground'`.

### What we discovered during testing

| Query | Coordinates | Activity filter | Results |
|-------|------------|-----------------|---------|
| User's home | 45.57579, -122.67016 | none | 4 non-campground facilities |
| Default coords | 45.6387, -122.6615 | none | 6 facilities, **1 campground** (Sunset Falls) |
| User's home | 45.57579, -122.67016 | `activity=Camping` | 0 results |
| User's home | 45.57579, -122.67016 | `activity=9` (numeric ID) | 0 results |
| User's home | 45.57579, -122.67016 | `facilityTypeDescription=Campground` | 4 non-campground facilities (param **ignored** by API) |

**Key findings:**
1. The `activity` URL parameter (both string name and numeric ID) is **completely ignored** by the RIDB geo-radius search endpoint. Confirmed: passing `activity=9` (the canonical CAMPING activity ID) returns the same results as no filter.
2. The `facilityTypeDescription` URL parameter is also **ignored** by the geo-radius endpoint.
3. The RIDB geo-search returns different facility sets for coordinates that are only ~8 km apart. The user's home (45.57579, -122.67016) returns zero campgrounds; coordinates 8 km north (45.6387, -122.6615) return Sunset Falls Campground (FacilityID: 234765, ~26 miles away).
4. Sunset Falls Campground **does** have `ActivityID: 9` (CAMPING) and `FacilityTypeDescription: "Campground"` when looked up directly. It's in the RIDB database; it just doesn't appear in the geo-radius results from the user's coordinates.

### What we've already ruled out
- ~~Zod schema mismatch~~ — raw API response itself has 0 campground results before Zod parsing
- ~~`offset=0` parameter~~ — removed, no change
- ~~Missing `User-Agent` header~~ — added, no change
- ~~Turbopack cache~~ — confirmed by reading raw response in debug logs before any caching
- ~~ATTRIBUTES field~~ — RecGov never populates it; pet detection switched to keyword matching

---

## Current Code State

**`src/lib/apis/recgov.ts`** — working correctly given API limitations:
- No `activity` URL param (confirmed broken for geo-search)
- Client-side filter: `FacilityTypeDescription === 'Campground'`
- Keyword-based pet detection (ATTRIBUTES never populated)
- Temporary debug `console.log` statements still present (to be removed after fix confirmed)

**All other Phase 1 files** — `tsc --noEmit` and `npm run build` pass with zero errors.

---

## The Question for the Architect

**Is the RIDB geo-radius search reliable enough for this use case, or do we need a different data retrieval strategy?**

Specific options to evaluate:

### Option A — Accept RIDB limitations, increase radius
Multiply `radiusMiles` by 2–3× to cast a wider net and hope the geo-index returns more campgrounds. Simple, but doesn't fix the root geo-hash edge-effect issue.

### Option B — Two-step: search RecAreas first, then fetch facilities
```
GET /recareas?latitude=…&longitude=…&radius=…&activity=9
→ for each RecArea: GET /recareas/{id}/facilities?activity=9
```
RecAreas (national forests, parks) are larger polygons — less susceptible to geo-hash edge effects. More API calls but likely more reliable campground discovery.

### Option C — Use the RIDB bulk data download
Recreation.gov publishes weekly bulk data exports (~500MB CSV). Pre-index campgrounds into a local database (SQLite/PostGIS) for reliable geo-search. Eliminates API variability entirely, but adds infrastructure.

### Option D — Supplement with a second data source
Add an OpenStreetMap (Overpass API) query for `tourism=camp_site` nodes within the radius. Merge with RIDB results. OSM has denser coverage for informal/dispersed sites.

---

## Files of Interest

| File | Purpose |
|------|---------|
| `src/lib/apis/recgov.ts` | RecGov API client — the problem code |
| `src/lib/schemas/recgov.ts` | Zod schema for RIDB responses |
| `src/app/api/search/route.ts` | Main search endpoint |
| `src/app/api/campsites/route.ts` | Debug proxy for RecGov (uses HOME_LAT/HOME_LNG) |
| `.env.example` | Shows all required env vars |

---

## Reproduction Steps

```powershell
# 1. Start dev server
npm run dev

# 2. Search returns empty — user's home coords return 0 campgrounds from RIDB
$body = @{
  campingType = "car"; petFriendly = $false; nearWater = $false
  stargazing = $false; mosquitoTolerance = "medium"
  maxDriveMinutes = 120; startDate = "2026-05-10"; endDate = "2026-05-12"
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/search" -Method POST -Body $body -ContentType "application/json"

# 3. Direct RecGov probe confirms campground exists 26 miles from user's home
# but geo-search doesn't return it:
$key = (Get-Content .env.local | Where-Object { $_ -match '^RECGOV_API_KEY=' } | ForEach-Object { $_ -replace '^RECGOV_API_KEY=','' })
Invoke-RestMethod -Uri "https://ridb.recreation.gov/api/v1/facilities?limit=50&latitude=45.57579&longitude=-122.67016&radius=50&full=true" -Headers @{ apikey = $key } | ConvertTo-Json -Depth 2
# Returns: 4 non-campground facilities only

# 4. Shifting origin 8km north returns a campground:
Invoke-RestMethod -Uri "https://ridb.recreation.gov/api/v1/facilities?limit=50&latitude=45.6387&longitude=-122.6615&radius=50&full=true" -Headers @{ apikey = $key } | ConvertTo-Json -Depth 2
# Returns: 6 facilities including Sunset Falls Campground
```
