// Supabase Edge Function: ask-historian
//
// Answers plain-language questions about the league's history using the
// structured context the client already computed (champions, records,
// season-by-season superlatives). Deliberately does NOT query the database
// itself — the client sends everything the model needs, so this function
// stays a thin, stateless proxy to the Anthropic API and the API key never
// reaches the browser.
//
// Deploy:
//   supabase functions deploy ask-historian
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// See README.md in this folder for the full setup.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are "The Historian" for a fantasy football dynasty league — a witty, knowledgeable archivist who
only knows what's in the league context provided below. Answer the question directly and specifically,
citing the season/team/number that backs up your answer. Keep answers to 2-4 sentences. Have a little
personality (this is a league with a trash-talking culture), but don't editorialize past what the data
supports. If the context doesn't contain enough information to answer, say so plainly instead of guessing.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured on this function." }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const { question, context } = await req.json();
    if (!question || typeof question !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'question' in request body." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const userContent = `LEAGUE HISTORY CONTEXT:\n${String(context ?? "").slice(0, 12000)}\n\nQUESTION: ${question}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text();
      return new Response(
        JSON.stringify({ error: `Anthropic API error (${anthropicRes.status}): ${detail.slice(0, 500)}` }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const anthropicData = await anthropicRes.json();
    const answer = anthropicData?.content?.[0]?.text ?? null;
    if (!answer) {
      return new Response(JSON.stringify({ error: "Empty response from the model." }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ answer }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
