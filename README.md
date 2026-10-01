# Matzie's Dynasty League

A dynasty fantasy football league dashboard tracking 13+ seasons of standings, stats, playoffs, trades, and draft history. Integrated with the Sleeper API for automatic data sync into Supabase.

## Tech Stack

- **React 18** + **TypeScript** — frontend framework
- **Vite** — build tool
- **Tailwind CSS** + **shadcn/ui** — styling and components
- **TanStack React Query** — data fetching and caching
- **Supabase** — PostgreSQL database backend
- **Sleeper API** — fantasy league data source
- **Recharts** — data visualization

## Getting Started

```sh
npm install
npm run dev
```

The app runs on `http://localhost:8080`.

## Environment

Create a `.env` file with your Supabase credentials:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

## Sleeper Sync

Navigate to `/admin` in the app to sync data from the Sleeper API. The sync page lets you:

- Map Sleeper users to league teams
- Sync scores and schedules for any season
- Sync draft picks
- Sync trades

## Deploying

Build for production:

```sh
npm run build
```

The `dist/` folder can be deployed to any static host (Netlify, Vercel, Cloudflare Pages, etc.).

## Securing writes

The Supabase anon key is public (it ships in the browser bundle), so database
writes are locked to a signed-in admin by row-level security. Reads stay public.

1. Run `supabase/migrations/20260930000012_admin_auth.sql` (adds the admin
   allow-list and admin write policies; nothing is removed yet).
2. Run `supabase/admin_user_setup.sql`: it creates the admin login and prints a
   generated 16-character password. In Supabase → Authentication → Providers →
   Email, turn off "Allow new users to sign up".
3. Deploy, sign in at `/admin`, and confirm sync works.
4. Run `supabase/migrations/20260930000013_lock_writes.sql` (removes public write
   access; the file ends with an undo block).
5. Add the GitHub Actions secret `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project
   Settings → API → service_role) so the scheduled sync can keep writing.

## Trade market (admin only)

`scripts/crawl-trades.ts` (run by `.github/workflows/crawl-trades.yml`) collects completed
trades from public Sleeper dynasty leagues with settings similar to this one into
`market_trades` (migration `20260930000017_trade_market.sql`), snowballing out from this
league's managers. The tables are readable only by the signed-in admin; browse them at
`/trade-market` (linked from `/admin`, not from the site navigation). The crawler needs the
`SUPABASE_SERVICE_ROLE_KEY` GitHub secret and stops at `TARGET_TRADES` (default 50,000).
