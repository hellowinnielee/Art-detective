# Art Detective

Art Detective is now a Next.js-only application (App Router).

## Environment

Copy `.env.example` to `.env.local` and fill in required values:

```bash
cp .env.example .env.local
```

Current runtime supports:

- `AUTH_SECRET` for token signing
- Supabase readiness helpers:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Dev snapshot placeholder mode (optional):
  - `SNAPSHOT_PLACEHOLDER_MODE=true` to enable placeholder caching in development
  - `SNAPSHOT_PLACEHOLDER_TARGET_URL=<listing-url>` to override the default target listing URL

You can verify environment readiness via `GET /api/health`.

### Dev snapshot placeholder mode

When `SNAPSHOT_PLACEHOLDER_MODE=true` (and `NODE_ENV !== "production"`), `POST /api/snapshot` behaves like this for the configured target listing URL:

- First request runs live snapshot generation and stores the response in local in-memory placeholder cache.
- Subsequent requests return that cached placeholder response without refetching the external listing page.

For any other URL (or with placeholder mode disabled), snapshot uses the normal live flow.

To reset placeholder cache and force a fresh live request on next call:

```bash
curl -X POST http://localhost:3001/api/snapshot/placeholder/reset \
  -H "Authorization: Bearer <access_token>"
```

Notes:
- Placeholder cache is in-memory per running server process.
- Going live only requires disabling `SNAPSHOT_PLACEHOLDER_MODE`.

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3001/` in your browser.

## Scripts

- `npm run dev` -> run Next.js in development mode
- `npm run build` -> create production build
- `npm run start` -> run production server
- `npm run lint` -> run ESLint

## Key API endpoints

- `POST /api/snapshot` -> build confidence snapshot from listing URL
- `POST /api/watchlist` -> save listing for rescans
- `GET /api/watchlist` -> list tracked items
- `POST /api/follow/:artistId` -> follow an artist
- `GET /api/following` -> list followed artists
- `POST /api/rescan` -> trigger watchlist rescan
- `GET /api/alerts` -> recent risk/price/availability alerts
