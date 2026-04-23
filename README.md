# 🍳 Kitchen Keeper

AI-Powered Home Food Waste Management System

## Setup

1. **Clone the repo**
   ```bash
   git clone <your-repo-url>
   cd kitchen-keeper
   ```

2. **Fill in your environment variables**
   ```bash
   cp .env.example .env
   # Edit .env and add your real ANTHROPIC_API_KEY and a strong JWT_SECRET
   ```

3. **Install all dependencies** (installs root, server, and client in one step)
   ```bash
   npm install
   ```

4. **Start the dev servers**
   ```bash
   npm run dev
   ```
   - Express API: http://localhost:3001
   - React client: http://localhost:5173

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (from console.anthropic.com) |
| `JWT_SECRET` | A long random string for signing JWT tokens |
| `PORT` | Express server port (default: 3001) |
| `NODE_ENV` | `development` or `production` |
| `CLIENT_ORIGIN` | React dev server origin (default: http://localhost:5173) |

## Architecture

See `kitchen-keeper-spec-v4.docx` for the full technical specification.

- **Frontend**: React + Vite + Tailwind CSS (port 5173)
- **Backend**: Node.js + Express (port 3001)
- **Database**: SQLite via Drizzle ORM
- **AI**: Claude (Anthropic API)
