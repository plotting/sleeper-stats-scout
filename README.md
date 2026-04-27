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
