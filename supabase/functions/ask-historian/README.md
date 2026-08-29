# Ask the Historian

A Supabase Edge Function that answers plain-language questions about the
league's history. The client (`src/pages/Hall.tsx` / `src/services/historian.ts`)
computes a compact summary of every season's champion, records, and
superlatives and sends it along with the question — this function just
forwards that to Claude and returns the answer. It never queries the
database itself, so there's nothing to keep in sync here.

## One-time setup

You'll need the [Supabase CLI](https://supabase.com/docs/guides/cli) installed
and logged in (`supabase login`), and an Anthropic API key from
[console.anthropic.com](https://console.anthropic.com/).

```bash
# From the repo root, link to this project (only needed once)
supabase link --project-ref wkdvibtyvnsinygkqxds

# Deploy the function
supabase functions deploy ask-historian

# Set the API key as a secret (never exposed to the browser)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

That's it — the "Ask the Historian" widget on `/hall` will start working
immediately, no client-side changes needed.

## Cost

Each question is a single Claude call with a short prompt (context is capped
at ~12,000 characters) and a 400-token response cap — this is a cheap,
low-volume feature, not something that needs rate limiting for a 10-team
league's traffic.

## Testing locally

```bash
supabase functions serve ask-historian --env-file .env.local
```

with `.env.local` containing `ANTHROPIC_API_KEY=sk-ant-...`, then:

```bash
curl -i --location --request POST 'http://localhost:54321/functions/v1/ask-historian' \
  --header 'Content-Type: application/json' \
  --data '{"question":"Who has won the most championships?","context":"Season 5: champion Erik."}'
```
