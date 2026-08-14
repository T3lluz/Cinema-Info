import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * OMDb lookup for Cinema Info.
 *
 * The PWA is static on GitHub Pages, so the OMDb key stays here (function
 * secret `OMDB_API_KEY`, same name as the Actions secret used by the
 * nightly snapshot) and the browser only sees search hits and title
 * details. Same CORS / anon-key pattern as `dx-web-login`.
 */

const OMDB = "https://www.omdbapi.com/";
const TIMEOUT_MS = 8000;
const MAX_Q = 100;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function omdbKey() {
  // Prefer the project secret (same name as the GitHub Actions secret).
  // A public tutorial key is the last resort so search still works
  // before that secret is pasted into Supabase.
  return String(Deno.env.get("OMDB_API_KEY") || "").trim() || "trilogy";
}

function na(value: unknown) {
  const s = String(value ?? "").trim();
  if (!s || s === "N/A") return "";
  return s;
}

function posterUrl(value: unknown) {
  const url = na(value);
  if (!url || !/^https?:\/\//i.test(url)) return "";
  return url;
}

async function omdbGet(params: Record<string, string>) {
  const key = omdbKey();
  if (!key) {
    const err = new Error("OMDB_API_KEY is not set");
    (err as Error & { code?: string }).code = "config";
    throw err;
  }
  const qs = new URLSearchParams({ apikey: key, ...params });
  const res = await fetch(`${OMDB}?${qs}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const err = new Error(`OMDb ${res.status}`);
    (err as Error & { code?: string }).code = "upstream";
    throw err;
  }
  return await res.json();
}

function packSearchHit(row: Record<string, unknown>) {
  const imdbID = na(row.imdbID);
  if (!imdbID) return null;
  return {
    imdbID,
    title: na(row.Title) || imdbID,
    year: na(row.Year),
    type: na(row.Type) || "movie",
    poster: posterUrl(row.Poster),
  };
}

function packTitle(data: Record<string, unknown>) {
  const imdbID = na(data.imdbID);
  if (!imdbID) return null;
  const ratings = Array.isArray(data.Ratings)
    ? data.Ratings.map((r) => {
        const row = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
        const source = na(row.Source);
        const value = na(row.Value);
        return source && value ? { source, value } : null;
      }).filter(Boolean)
    : [];
  return {
    imdbID,
    title: na(data.Title) || imdbID,
    year: na(data.Year),
    rated: na(data.Rated),
    released: na(data.Released),
    runtime: na(data.Runtime),
    genre: na(data.Genre),
    director: na(data.Director),
    writer: na(data.Writer),
    actors: na(data.Actors),
    plot: na(data.Plot),
    language: na(data.Language),
    country: na(data.Country),
    awards: na(data.Awards),
    poster: posterUrl(data.Poster),
    ratings,
    imdbRating: na(data.imdbRating),
    imdbVotes: na(data.imdbVotes),
    metascore: na(data.Metascore),
    boxOffice: na(data.BoxOffice),
    type: na(data.Type) || "movie",
    dvd: na(data.DVD),
    production: na(data.Production),
    website: na(data.Website),
    imdbUrl: `https://www.imdb.com/title/${encodeURIComponent(imdbID)}/`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action = String(body.action || "").trim();

  try {
    if (action === "search") {
      const q = String(body.q || "").trim().slice(0, MAX_Q);
      if (q.length < 2) return json({ ok: true, results: [] });
      const data = await omdbGet({ s: q, type: "movie" });
      if (data?.Response === "False") {
        return json({ ok: true, results: [] });
      }
      const rows = Array.isArray(data?.Search) ? data.Search : [];
      const results = rows.map(packSearchHit).filter(Boolean).slice(0, 10);
      return json({ ok: true, results });
    }

    if (action === "title") {
      const id = String(body.id || "").trim();
      if (!/^tt\d{5,}$/i.test(id)) {
        return json({ error: "Invalid IMDb id" }, 400);
      }
      const data = await omdbGet({ i: id, plot: "full" });
      if (data?.Response === "False") {
        return json({ error: data?.Error || "Not found", code: "not_found" }, 404);
      }
      const movie = packTitle(data);
      if (!movie) return json({ error: "Not found", code: "not_found" }, 404);
      return json({ ok: true, movie });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    const code = (err as { code?: string })?.code || "upstream";
    const status = code === "config" ? 503 : 502;
    return json(
      { error: err instanceof Error ? err.message : "OMDb lookup failed", code },
      status
    );
  }
});
