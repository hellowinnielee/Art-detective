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

You can verify environment readiness via `GET /api/health`.

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
