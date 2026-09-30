# Kitchen Keeper

Kitchen Keeper is an AI-powered food waste management app for households. Add pantry items manually or by scanning a grocery receipt, see what's expiring, get AI meal suggestions tailored to what you have on hand, save and manage recipes, build shopping lists, and chat with an AI kitchen assistant — all from your phone or browser. Multiple household members share the same pantry and lists in real time.

## Live Demo

[https://kitchenkeeper.vercel.app](https://kitchenkeeper.vercel.app)

> Sign-up is currently unrestricted — create an account via the link above.

## Tech Stack

| Layer          | Technology                                           |
|----------------|------------------------------------------------------|
| Frontend       | React 18 + Vite + Tailwind CSS                      |
| Backend        | Node.js + Express (Vercel Serverless Functions)     |
| Database       | Neon Postgres (Drizzle ORM)                         |
| AI             | Google Gemini 2.0 Flash                             |
| File Storage   | Vercel Blob                                         |
| Auth           | Authentication provided by Clerk                    |

## Features

- **Household sharing** — invite family members by email; everyone shares the same pantry, recipes, and lists
- **Receipt scanning** — photograph a grocery receipt; Gemini vision extracts items and adds them to your pantry
- **Expiry tracking** — color-coded urgency so you always know what needs to be used first
- **Eat This Now** — AI meal suggestions generated from your most-expiring ingredients
- **Recipe management** — save recipes from suggestions, search the web, and manage your collection
- **Shopping list builder** — build and manage lists from pantry gaps or recipe ingredients
- **AI chat assistant** — "Explore" tab for freeform kitchen questions
- **Freeze toggle** — mark items as frozen with AI-generated storage tips
- **Waste-saved counter** — tracks estimated food waste prevented over time

## Agent retrieval

The chat assistant can search a household's saved recipes (full text, including ingredients and steps) and
past meal logs through a `search_recipes_and_meals` tool. Before this, the agent saw recipes only as name and
tags, capped at 150, and never saw meal history. So "which of my recipes use chickpeas?" had no answer.

How it works:

- **pgvector in the existing Neon Postgres**, in one derived, household-scoped `search_documents` table that
  can be rebuilt at any time. Source tables stay authoritative.
- **Hybrid search:** Postgres full-text search and vector similarity (OpenAI `text-embedding-3-small`), fused
  with Reciprocal Rank Fusion. If the query embedding fails, search falls back to lexical only. If search
  fails entirely, chat carries on without the tool.
- **Lazy indexing:** each search reconciles the household's index first, embedding at most 25 documents, so
  there are no hooks on the recipe or meal-log write paths.
- **Tenancy:** every candidate query, join, and index write is scoped to the caller's household. This is
  tested against a real database with two households holding identical content.

Design decisions: [0001 pgvector](docs/adr/0001-pgvector-in-postgres.md) ·
[0002 hybrid + RRF](docs/adr/0002-hybrid-retrieval-rrf.md) ·
[0003 exact scan](docs/adr/0003-exact-scan-no-ann-index.md) ·
[0004 lazy indexing](docs/adr/0004-lazy-indexing-bounded-budget.md) ·
[0005 identity and tenancy](docs/adr/0005-retrieval-index-identity-and-tenancy.md)

**Data flow.** Recipe and meal-log content is sent to OpenAI's embeddings endpoint, re-sent when it changes,
along with every search query. OpenAI already powers the app's AI features, but this is a new flow: manually
entered recipes and meal history were never sent before. See ADR-0001.

### Eval results

Measured 2026-09-30 on a synthetic household of 507 documents (207 recipes, 300 meal logs), commit `4c4df4d`.
Full method, distributions, and caveats: [docs/eval/TASK-069-results.md](docs/eval/TASK-069-results.md).

**Retrieval** (40 golden queries, all modes against one frozen index):

| category (n) | lexical R@5 | vector R@5 | hybrid R@5 |
|---|---|---|---|
| ingredient hidden (8) | 0.625 | 0.500 | 0.625 |
| paraphrase (8) | 0.375 | 1.000 | 1.000 |
| exact rare term (7) | 1.000 | 0.857 | 1.000 |
| temporal meal log (9) | 0.889 | 1.000 | 1.000 |
| **all positives (32)** | **0.719** | **0.844** | **0.906** |
| MRR@10, all positives | 0.719 | 0.792 | 0.906 |
| negatives returning any result (8) | 0.000 | 1.000 | 1.000 |

There is no relevance floor yet, so any mode with a vector leg returns its nearest neighbours even for queries
with no right answer. The eval found that negative and positive distance distributions overlap, so no
threshold was chosen.

**Agent** (15 golden + 5 control queries, 3 runs per arm, `gpt-4o-mini`):

| metric | without tool | with tool |
|---|---|---|
| Tool-use correctness (called for golden, not for controls) | 0.25 | **1.00** |
| Retrieval correctness (tool results include an expected recipe) | n/a | **1.00** |
| Heuristic answer-match (reply names the expected recipe) | 0.11 | 0.98 |
| Chat latency p50 / p95 | 2.2 s / 6.9 s | 5.1 s / 7.6 s |

Answer-match is a string heuristic, not a semantic grader. Tool-use and retrieval correctness are the rigorous
metrics.

**Latency** (local machine → Neon → OpenAI): hybrid search p50 468 ms / p95 857 ms, mostly the query embedding
call. Lexical alone takes 35 / 53 ms. A cold search that also embeds 25 pending documents takes p50 1.5 s /
p95 2.9 s.

> **This is a quality benchmark, not a capacity benchmark.** It measures retrieval quality and small-corpus
> latency on about 500 documents. It does not validate exact-scan behaviour at larger household sizes. Whether
> to add an ANN index is decided from production search telemetry (ADR-0003), not from this fixture.

## Run Your Own Instance

1. Clone the repo
2. `cp .env.example .env` and fill in all values
3. Create a [Neon](https://neon.tech) Postgres database — copy the `DATABASE_URL`
4. Get a [Gemini API key](https://aistudio.google.com) from Google AI Studio (free tier available)
5. Deploy to [Vercel](https://vercel.com) — add all env vars from `.env.example`
   (The Neon and Vercel Blob marketplace integrations auto-provide their tokens)
6. Run the SQL files in `server/db/migrations/` against your Neon database using the Neon SQL Editor (drizzle-kit is incompatible with the Neon HTTP driver)
7. Visit the deployed URL and register

## Environment Variables

| Variable                | Description                                               | Source                  |
|-------------------------|-----------------------------------------------------------|-------------------------|
| `DATABASE_URL`          | Neon Postgres connection string                           | Neon Vercel integration |
| `GEMINI_API_KEY`        | Google Gemini API key                                     | Google AI Studio        |
| `NODE_ENV`              | `production` on Vercel                                    | Set manually            |
| `CLIENT_ORIGIN`         | Frontend URL for CORS                                     | Set manually            |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob access token                                  | Vercel Blob integration |
| `RESEND_API_KEY`        | Resend API key for household invite emails                | resend.com              |
| `RESEND_FROM_EMAIL`     | From address for invite emails (default: onboarding@resend.dev) | Set manually      |

## Local Development

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # Express on :3001, React on :5173
```
