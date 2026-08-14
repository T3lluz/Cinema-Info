import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Movie lookup for Cinema Info.
 *
 * The PWA is static on GitHub Pages, so keys and upstream calls stay
 * here. OMDb covers search + plot/ratings; IMDb's public GraphQL fills
 * in cast headshots and the coming-soon feed. Same CORS / anon-key
 * pattern as `dx-web-login`.
 */

const OMDB = "https://www.omdbapi.com/";
const IMDB_GQL = "https://caching.graphql.imdb.com/";
const TIMEOUT_MS = 8000;
const MAX_Q = 100;
const POPULAR_LIMIT = 36;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IMDB_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "x-imdb-client-name": "imdb-web-app",
  "User-Agent":
    "Mozilla/5.0 (compatible; CinemaInfo/1.0; +https://github.com/T3lluz/Cinema-Info)",
};

const TITLE_QUERY = `query Title($id: ID!) {
  title(id: $id) {
    id
    titleText { text }
    originalTitleText { text }
    releaseYear { year }
    releaseDate { day month year }
    runtime { seconds }
    certificate { rating }
    ratingsSummary { aggregateRating voteCount }
    metacritic { metascore { score } }
    primaryImage { url }
    plot { plotText { plainText } }
    genres { genres { text } }
    spokenLanguages { spokenLanguages { text } }
    countriesOfOrigin { countries { text } }
    principalCredits {
      category { text }
      credits {
        name { id nameText { text } primaryImage { url } }
        ... on Cast { characters { name } }
      }
    }
    credits(first: 16, filter: { categories: ["cast"] }) {
      edges {
        node {
          name { id nameText { text } primaryImage { url } }
          ... on Cast { characters { name } }
        }
      }
    }
  }
}`;

const POPULAR_QUERY = `query Popular($n: Int!) {
  popularTitles(limit: $n) {
    titles {
      id
      titleText { text }
      titleType { id text }
      releaseYear { year }
      releaseDate { day month year }
      ratingsSummary { aggregateRating voteCount }
      primaryImage { url }
      plot { plotText { plainText } }
      runtime { seconds }
      certificate { rating }
      genres { genres { text } }
    }
  }
}`;

const COMING_SOON_QUERY = `query ComingSoon($n: Int!, $d: Date!) {
  comingSoon(first: $n, comingSoonType: MOVIE, releasingOnOrAfter: $d) {
    edges {
      node {
        id
        titleText { text }
        titleType { id text }
        releaseYear { year }
        releaseDate { day month year }
        ratingsSummary { aggregateRating voteCount }
        primaryImage { url }
        plot { plotText { plainText } }
        runtime { seconds }
        certificate { rating }
        genres { genres { text } }
      }
    }
  }
}`;

function todayOslo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function upcomingDateKey(value: unknown) {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isUpcomingRelease(value: unknown, today: string) {
  const key = upcomingDateKey(value);
  return Boolean(key && key >= today);
}

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

function rewriteImdbImage(url: unknown, suffix: string) {
  const raw = posterUrl(url);
  if (!raw) return "";
  if (!/m\.media-amazon\.com/i.test(raw)) return raw;
  return raw.replace(/\._V1_.*$/i, `._V1_${suffix}`);
}

function faceUrl(url: unknown) {
  return rewriteImdbImage(url, "UX240_CR0,0,240,240_.jpg");
}

function posterFromImdb(url: unknown) {
  return rewriteImdbImage(url, "SX300.jpg") || posterUrl(url);
}

function imdbDate(rd: Record<string, unknown> | null | undefined) {
  if (!rd || rd.year == null) return "";
  const y = Number(rd.year);
  if (!Number.isFinite(y)) return "";
  const m = Number(rd.month);
  const d = Number(rd.day);
  if (Number.isFinite(m) && Number.isFinite(d)) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (Number.isFinite(m)) return `${y}-${String(m).padStart(2, "0")}`;
  return String(y);
}

function runtimeLabel(seconds: unknown) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${Math.round(n / 60)} min`;
}

function texts(list: unknown, key: string) {
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => {
      const rec = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return na(rec[key]);
    })
    .filter(Boolean);
}

function packPerson(raw: unknown) {
  const node = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nameObj = node.name && typeof node.name === "object"
    ? (node.name as Record<string, unknown>)
    : {};
  const nameText = nameObj.nameText && typeof nameObj.nameText === "object"
    ? (nameObj.nameText as Record<string, unknown>)
    : {};
  const image = nameObj.primaryImage && typeof nameObj.primaryImage === "object"
    ? (nameObj.primaryImage as Record<string, unknown>)
    : {};
  const name = na(nameText.text);
  if (!name) return null;
  const characters = Array.isArray(node.characters) ? node.characters : [];
  const character = characters
    .map((c) => {
      const rec = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
      return na(rec.name);
    })
    .filter(Boolean)
    .join(" / ");
  return {
    id: na(nameObj.id),
    name,
    photo: faceUrl(image.url),
    character,
  };
}

function peopleFromPrincipal(
  title: Record<string, unknown>,
  category: string,
) {
  const rows = Array.isArray(title.principalCredits) ? title.principalCredits : [];
  for (const row of rows) {
    const rec = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const cat = rec.category && typeof rec.category === "object"
      ? (rec.category as Record<string, unknown>)
      : {};
    if (na(cat.text).toLowerCase() !== category) continue;
    const credits = Array.isArray(rec.credits) ? rec.credits : [];
    return credits.map(packPerson).filter(Boolean);
  }
  return [];
}

function castFromTitle(title: Record<string, unknown>) {
  const credits = title.credits && typeof title.credits === "object"
    ? (title.credits as Record<string, unknown>)
    : {};
  const edges = Array.isArray(credits.edges) ? credits.edges : [];
  const fromCredits = edges
    .map((edge) => {
      const rec = edge && typeof edge === "object" ? (edge as Record<string, unknown>) : {};
      return packPerson(rec.node);
    })
    .filter(Boolean);
  if (fromCredits.length) return fromCredits;
  const stars = peopleFromPrincipal(title, "stars");
  return stars.length ? stars : peopleFromPrincipal(title, "cast");
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

async function imdbGql(query: string, variables: Record<string, unknown>) {
  const res = await fetch(IMDB_GQL, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: IMDB_HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const err = new Error(`IMDb ${res.status}`);
    (err as Error & { code?: string }).code = "upstream";
    throw err;
  }
  const data = await res.json();
  if (data?.errors?.length) {
    const err = new Error(String(data.errors[0]?.message || "IMDb GraphQL error"));
    (err as Error & { code?: string }).code = "upstream";
    throw err;
  }
  return data?.data || {};
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
    cast: [] as ReturnType<typeof packPerson>[],
    directors: [] as ReturnType<typeof packPerson>[],
  };
}

function packImdbTitle(title: Record<string, unknown>) {
  const imdbID = na(title.id);
  if (!imdbID) return null;
  const genres = texts(title.genres && typeof title.genres === "object"
    ? (title.genres as Record<string, unknown>).genres
    : [], "text");
  const languages = texts(
    title.spokenLanguages && typeof title.spokenLanguages === "object"
      ? (title.spokenLanguages as Record<string, unknown>).spokenLanguages
      : [],
    "text",
  );
  const countries = texts(
    title.countriesOfOrigin && typeof title.countriesOfOrigin === "object"
      ? (title.countriesOfOrigin as Record<string, unknown>).countries
      : [],
    "text",
  );
  const plot = title.plot && typeof title.plot === "object"
    ? (title.plot as Record<string, unknown>).plotText
    : null;
  const plotText = plot && typeof plot === "object"
    ? na((plot as Record<string, unknown>).plainText)
    : "";
  const ratings = title.ratingsSummary && typeof title.ratingsSummary === "object"
    ? (title.ratingsSummary as Record<string, unknown>)
    : {};
  const meta = title.metacritic && typeof title.metacritic === "object"
    ? (title.metacritic as Record<string, unknown>).metascore
    : null;
  const metaScore = meta && typeof meta === "object"
    ? na((meta as Record<string, unknown>).score)
    : "";
  const image = title.primaryImage && typeof title.primaryImage === "object"
    ? (title.primaryImage as Record<string, unknown>)
    : {};
  const titleText = title.titleText && typeof title.titleText === "object"
    ? (title.titleText as Record<string, unknown>)
    : {};
  const yearObj = title.releaseYear && typeof title.releaseYear === "object"
    ? (title.releaseYear as Record<string, unknown>)
    : {};
  const cert = title.certificate && typeof title.certificate === "object"
    ? (title.certificate as Record<string, unknown>)
    : {};
  const runtime = title.runtime && typeof title.runtime === "object"
    ? (title.runtime as Record<string, unknown>)
    : {};
  const rating = ratings.aggregateRating;
  const votes = ratings.voteCount;
  const directors = peopleFromPrincipal(title, "director").map((person) =>
    person ? { ...person, photo: "" } : person
  );
  const cast = castFromTitle(title);
  return {
    imdbID,
    title: na(titleText.text) || imdbID,
    year: yearObj.year != null ? String(yearObj.year) : "",
    rated: na(cert.rating),
    released: imdbDate(
      title.releaseDate && typeof title.releaseDate === "object"
        ? (title.releaseDate as Record<string, unknown>)
        : null,
    ),
    runtime: runtimeLabel(runtime.seconds),
    genre: genres.join(", "),
    director: directors.map((p) => p?.name).filter(Boolean).join(", "),
    writer: peopleFromPrincipal(title, "writer").map((p) => p?.name).filter(Boolean).join(", "),
    actors: cast.map((p) => p?.name).filter(Boolean).join(", "),
    plot: plotText,
    language: languages.join(", "),
    country: countries.join(", "),
    awards: "",
    poster: posterFromImdb(image.url),
    ratings: rating != null
      ? [{ source: "Internet Movie Database", value: `${rating}/10` }]
      : [],
    imdbRating: rating != null ? String(rating) : "",
    imdbVotes: votes != null ? Number(votes).toLocaleString("en-US") : "",
    metascore: metaScore,
    boxOffice: "",
    type: "movie",
    dvd: "",
    production: "",
    website: "",
    imdbUrl: `https://www.imdb.com/title/${encodeURIComponent(imdbID)}/`,
    cast,
    directors,
  };
}

function mergeTitle(
  omdb: ReturnType<typeof packTitle> | null,
  imdb: ReturnType<typeof packImdbTitle> | null,
) {
  if (!omdb && !imdb) return null;
  const base = { ...(imdb || {}), ...(omdb || {}) } as NonNullable<
    ReturnType<typeof packTitle>
  > & {
    cast: ReturnType<typeof packPerson>[];
    directors: ReturnType<typeof packPerson>[];
  };
  base.cast = (imdb?.cast?.length ? imdb.cast : omdb?.cast) || [];
  base.directors = (imdb?.directors?.length ? imdb.directors : omdb?.directors) || [];
  if (!base.poster && imdb?.poster) base.poster = imdb.poster;
  if (!base.plot && imdb?.plot) base.plot = imdb.plot;
  if (!base.imdbRating && imdb?.imdbRating) base.imdbRating = imdb.imdbRating;
  if (!base.genre && imdb?.genre) base.genre = imdb.genre;
  if (!base.director && imdb?.director) base.director = imdb.director;
  if (!base.actors && imdb?.actors) base.actors = imdb.actors;
  return base;
}

function voteCount(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function packPopular(title: Record<string, unknown>) {
  const typeObj = title.titleType && typeof title.titleType === "object"
    ? (title.titleType as Record<string, unknown>)
    : {};
  if (na(typeObj.id) !== "movie") return null;
  const packed = packImdbTitle(title);
  if (!packed) return null;
  return {
    imdbID: packed.imdbID,
    title: packed.title,
    year: packed.year,
    type: "movie",
    poster: packed.poster,
    plot: packed.plot,
    imdbRating: packed.imdbRating,
    imdbVotes: packed.imdbVotes,
    votes: voteCount(packed.imdbVotes),
    genre: packed.genre,
    rated: packed.rated,
    runtime: packed.runtime,
    released: packed.released,
    imdbUrl: packed.imdbUrl,
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
      const [omdbRes, imdbRes] = await Promise.allSettled([
        omdbGet({ i: id, plot: "full" }),
        imdbGql(TITLE_QUERY, { id }),
      ]);
      const omdbData = omdbRes.status === "fulfilled" ? omdbRes.value : null;
      const imdbTitle = imdbRes.status === "fulfilled"
        ? imdbRes.value?.title
        : null;
      if (omdbData?.Response === "False" && !imdbTitle) {
        return json({ error: omdbData?.Error || "Not found", code: "not_found" }, 404);
      }
      const movie = mergeTitle(
        omdbData && omdbData.Response !== "False" ? packTitle(omdbData) : null,
        imdbTitle ? packImdbTitle(imdbTitle) : null,
      );
      if (!movie) return json({ error: "Not found", code: "not_found" }, 404);
      return json({ ok: true, movie });
    }

    if (action === "popular" || action === "upcoming") {
      const n = Math.min(
        Math.max(Number(body.limit) || POPULAR_LIMIT, 6),
        48,
      );
      const today = todayOslo();
      const [soonRes, popularRes] = await Promise.allSettled([
        imdbGql(COMING_SOON_QUERY, { n, d: today }),
        imdbGql(POPULAR_QUERY, { n }),
      ]);
      const soonNodes = soonRes.status === "fulfilled"
        ? (Array.isArray(soonRes.value?.comingSoon?.edges)
          ? soonRes.value.comingSoon.edges
          : [])
          .map((edge: unknown) => {
            const rec = edge && typeof edge === "object"
              ? (edge as Record<string, unknown>)
              : {};
            return rec.node;
          })
          .filter(Boolean)
        : [];
      const popularNodes = popularRes.status === "fulfilled" &&
          Array.isArray(popularRes.value?.popularTitles?.titles)
        ? popularRes.value.popularTitles.titles
        : [];
      const soon = soonNodes
        .map((row) => packPopular(row as Record<string, unknown>))
        .filter((row): row is NonNullable<ReturnType<typeof packPopular>> =>
          Boolean(row && row.poster && isUpcomingRelease(row.released || row.year, today))
        );
      const popularUpcoming = popularNodes
        .map((row) => packPopular(row as Record<string, unknown>))
        .filter((row): row is NonNullable<ReturnType<typeof packPopular>> =>
          Boolean(row && row.poster && isUpcomingRelease(row.released || row.year, today))
        )
        .sort((a, b) => (b.votes - a.votes) || a.title.localeCompare(b.title));
      const seen = new Set(popularUpcoming.map((row) => row.imdbID));
      const soonKnown = soon
        .filter((row) =>
          !seen.has(row.imdbID) && (row.votes >= 400 || Number.parseFloat(row.imdbRating) >= 6.5)
        )
        .sort((a, b) => (b.votes - a.votes) || a.title.localeCompare(b.title));
      const movies = [...popularUpcoming];
      for (const row of soonKnown) {
        seen.add(row.imdbID);
        movies.push(row);
      }
      if (movies.length < 6) {
        for (const row of soon) {
          if (seen.has(row.imdbID)) continue;
          seen.add(row.imdbID);
          movies.push(row);
          if (movies.length >= 12) break;
        }
      }
      return json({ ok: true, movies: movies.slice(0, 18) });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    const code = (err as { code?: string })?.code || "upstream";
    const status = code === "config" ? 503 : 502;
    return json(
      { error: err instanceof Error ? err.message : "Lookup failed", code },
      status,
    );
  }
});
