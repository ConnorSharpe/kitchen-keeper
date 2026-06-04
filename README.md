# Kitchen Keeper

Kitchen Keeper is an AI-powered food waste management app for households. Add pantry items manually or by scanning a grocery receipt, see what's expiring, get AI meal suggestions tailored to what you have on hand, save and manage recipes, build shopping lists, and chat with an AI kitchen assistant — all from your phone or browser. Multiple household members share the same pantry and lists in real time.

## Live Demo

[https://kitchen-keeper-connorsharpes-projects.vercel.app](https://kitchen-keeper-connorsharpes-projects.vercel.app)

> Invite code required — unauthorized registrations are blocked to protect shared API resources. Contact Connor to request access.

## Tech Stack

| Layer          | Technology                                           |
|----------------|------------------------------------------------------|
| Frontend       | React 18 + Vite + Tailwind CSS                      |
| Backend        | Node.js + Express (Vercel Serverless Functions)     |
| Database       | Neon Postgres (Drizzle ORM)                         |
| AI             | Google Gemini 2.0 Flash                             |
| File Storage   | Vercel Blob                                         |
| Auth           | JWT stored in `httpOnly`, `sameSite=strict` cookies |

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

## Run Your Own Instance

1. Clone the repo
2. `cp .env.example .env` and fill in all values
3. Create a [Neon](https://neon.tech) Postgres database — copy the `DATABASE_URL`
4. Get a [Gemini API key](https://aistudio.google.com) from Google AI Studio (free tier available)
5. Deploy to [Vercel](https://vercel.com) — add all env vars from `.env.example`
   (The Neon and Vercel Blob marketplace integrations auto-provide their tokens)
6. Run the SQL files in `server/db/migrations/` against your Neon database using the Neon SQL Editor (drizzle-kit is incompatible with the Neon HTTP driver)
7. Visit the deployed URL and register (leave `INVITE_CODE` unset on your own instance)

## Environment Variables

| Variable                | Description                                               | Source                  |
|-------------------------|-----------------------------------------------------------|-------------------------|
| `DATABASE_URL`          | Neon Postgres connection string                           | Neon Vercel integration |
| `JWT_SECRET`            | Secret for signing auth cookies                           | Set manually            |
| `GEMINI_API_KEY`        | Google Gemini API key                                     | Google AI Studio        |
| `NODE_ENV`              | `production` on Vercel                                    | Set manually            |
| `CLIENT_ORIGIN`         | Frontend URL for CORS                                     | Set manually            |
| `INVITE_CODE`           | Registration gate secret. Omit or leave empty to disable  | Set manually            |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob access token                                  | Vercel Blob integration |
| `RESEND_API_KEY`        | Resend API key for household invite emails                | resend.com              |
| `RESEND_FROM_EMAIL`     | From address for invite emails (default: onboarding@resend.dev) | Set manually      |

## Local Development

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # Express on :3001, React on :5173
```
