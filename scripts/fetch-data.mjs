#!/usr/bin/env node
/**
 * Builds public/data/program.json for the GitHub Pages site.
 * Buen kino API is not CORS-friendly in browsers, so we snapshot it here.
 * Cinema days also come from DX's public event catalogue, which reaches
 * further than Buen's website feed and still lists shows after they start.
 * Sold counts + real end times come from that listing (and DX/eBillett
 * per event when the listing did not have them).
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEEP_DAYS = 120;

/**
 * How far back a showing the program feed no longer lists is re-checked
 * against DX. Covers both the sold counts of shows that just played and
 * showings pulled from the programme after they were due to start.
 */
const VERIFY_DAYS = 14;

/**
 * Buen drops a showing from the feed the moment it starts, so absence
 * only means "unprogrammed" for a show still comfortably in the future.
 */
const START_GRACE_MIN = 45;

const RETRIES = 3;
const TIMEOUT_MS = 20000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "data", "program.json");

const PROGRAM_URL =
  "https://www.buenkino.no/api/program?includeDocuments=true&first=500";

/**
 * Public DX event catalogue. `lastPage` always claims 1 and `perPage` is
 * ignored (15 rows), but `page` walks the partner's archive in time
 * order — cinema, concerts and the rest mixed together. That is how we
 * see days Buen's website has not published yet, and history Buen drops
 * the moment a showing starts.
 */
const DX_EVENTS_URL = "https://api.dx.no/v3/partners/202/events";
const DX_LIST_PER_PAGE = 15;
const DX_LIST_PAGE_CAP = 4000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One JSON GET that survives a flaky night: timeouts, resets and DX's
 * rate limiting are retried with backoff, while a straight answer of
 * "no such thing" is passed on as-is so callers can act on it.
 */
async function fetchJson(url, init = {}) {
  let lastErr;
  const { headers: initHeaders, ...rest } = init;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1));
    let res;
    try {
      // Spread init first, then force-merge headers so callers can pass
      // method/body without clobbering Accept / User-Agent defaults.
      res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...rest,
        headers: {
          Accept: "application/json",
          "User-Agent": "Cinema-Info/1.0 (+https://github.com/T3lluz/Cinema-Info)",
          ...initHeaders,
        },
      });
    } catch (err) {
      lastErr = new Error(`${url} → ${err.name === "TimeoutError" ? "timeout" : err.message}`);
      continue;
    }
    if (res.ok) return res.json();

    const err = new Error(`${url} → ${res.status}`);
    err.status = res.status;
    if (res.status < 500 && res.status !== 429) throw err;
    lastErr = err;
  }
  throw lastErr;
}

function parseTicketLink(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/checkout\.ebillett\.no\/(\d+)\/events\/(\d+)/i);
  if (!m) return null;
  return { url, promoterId: m[1], eventId: m[2] };
}

function dxEventBegin(event) {
  return String(event?.begin || "")
    .replace(" ", "T")
    .slice(0, 19);
}

function dxEventEnd(event) {
  const end = String(event?.end || "").replace(" ", "T").slice(0, 19);
  return end || null;
}

function dxTicketUrl(event) {
  const id = event?.id;
  if (id == null || id === "") return "";
  return `https://checkout.ebillett.no/202/events/${id}/purchase?kanal=dxf`;
}

/** Hall name as the app already stores it: "Storsal - Kino" → "Storsal". */
function dxScreenName(event) {
  return String(event?.roomName || event?.locationName || event?.location || "")
    .replace(/\s*-\s*Kino$/i, "")
    .trim() || "Ukjent sal";
}

function isDxCinemaEvent(event) {
  if (!event || event.draft) return false;
  if (String(event.productionType || "").toLowerCase() === "film") return true;
  const loc = String(
    event.roomName || event.locationName || event.location || ""
  ).toLowerCase();
  return loc.includes("kino");
}

function parseDxTitle(raw) {
  const full = String(raw || "").trim();
  const m = full.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { title: full || "Ukjent film", tags: [] };
  return {
    title: m[1].trim() || full,
    tags: cleanTags(
      m[2]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    ),
  };
}

function formatDxAge(event, movie) {
  const fromMovie = movie?.ageRating?.age;
  if (fromMovie) return fromMovie;
  const rating = String(event?.ageRating || event?.age || "").trim();
  if (!rating) return null;
  if (/^\d+$/.test(rating)) return `${rating} år`;
  return rating;
}

async function fetchDxEventPage(page) {
  const url = `${DX_EVENTS_URL}?perPage=50&page=${page}`;
  const data = await fetchJson(url, {
    headers: { Referer: "https://checkout.ebillett.no/" },
  });
  return Array.isArray(data?.data) ? data.data : [];
}

/**
 * First catalogue page whose last row is on or after `dayKey`. Empty
 * pages are treated as past the end of the archive.
 */
async function findDxPageForDay(dayKey) {
  let lo = 1;
  let hi = DX_LIST_PAGE_CAP;
  let found = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rows = await fetchDxEventPage(mid);
    if (!rows.length) {
      hi = mid - 1;
      continue;
    }
    const lastDay = dxEventBegin(rows[rows.length - 1]).slice(0, 10);
    if (lastDay && lastDay < dayKey) lo = mid + 1;
    else {
      found = mid;
      hi = mid - 1;
    }
  }
  return found;
}

async function fetchDxCinemaEvents(fromDay) {
  const startPage = await findDxPageForDay(fromDay);
  const byId = new Map();
  let empty = 0;
  let lastPage = startPage;
  const from = Math.max(1, startPage - 1);
  for (let page = from; page <= from + 500; page++) {
    const rows = await fetchDxEventPage(page);
    if (!rows.length) {
      empty += 1;
      if (empty >= 2) break;
      continue;
    }
    empty = 0;
    lastPage = page;
    for (const event of rows) {
      const day = dxEventBegin(event).slice(0, 10);
      if (!day || day < fromDay) continue;
      if (!isDxCinemaEvent(event)) continue;
      byId.set(String(event.id), event);
    }
  }
  const events = [...byId.values()].sort((a, b) =>
    dxEventBegin(a).localeCompare(dxEventBegin(b))
  );
  const first = events[0] ? dxEventBegin(events[0]).slice(0, 10) : null;
  const last = events.length
    ? dxEventBegin(events[events.length - 1]).slice(0, 10)
    : null;
  console.log(
    `DX cinema listing: ${events.length} films ` +
      `${first || "?"} → ${last || "?"} (pages ${from}–${lastPage})`
  );
  return events;
}

function applyDxSale(show, event) {
  const sale = event.ticketSale || {};
  const start = dxEventBegin(event);
  const end = dxEventEnd(event);
  if (start) show.start = start;
  if (end) show.end = end;
  if (start) show.dayKey = start.slice(0, 10);
  show.screen = dxScreenName(event) || show.screen;
  show.sold = Number(sale.sold) || 0;
  show.reserved = Number(sale.reserved) || 0;
  show.capacity = Number(sale.capacity) || null;
  show.available = sale.available != null ? Number(sale.available) : null;
  show.eventStatus = "ok";
  show.eventId = String(event.id);
  show.promoterId = String(event.partnerId || show.promoterId || "202");
  show.ticketUrl = show.ticketUrl || dxTicketUrl(event);
  return show;
}

function showFromDxEvent(event, movies, previousShows, prevByEventId) {
  const start = dxEventBegin(event);
  const screen = dxScreenName(event);
  const versionId = String(event.productionReference || "").trim();
  const movie = (versionId && movies[versionId]) || null;
  const parsed = parseDxTitle(event.title);
  const prev =
    prevByEventId?.get(String(event.id)) ||
    previousShows.find((s) => s.id === `${versionId || "dx"}-${start}-${screen}`) ||
    null;
  const title =
    movie?.title || prev?.title || parsed.title || "Ukjent film";
  return applyDxSale(
    {
      id: prev?.id || `${versionId || "dx"}-${start}-${screen}`,
      title,
      screen,
      start,
      end: dxEventEnd(event),
      dayKey: start.slice(0, 10),
      runningMinutes:
        prev?.runningMinutes ?? parseRunningTime(movie?.runningTime),
      runningLabel: prev?.runningLabel || movie?.runningTime || null,
      age: formatDxAge(event, movie) || prev?.age || null,
      tags: parsed.tags.length ? parsed.tags : cleanTags(prev?.tags),
      showType: prev?.showType || null,
      kinoklubb: Boolean(prev?.kinoklubb),
      genres: prev?.genres || null,
      director:
        String(movie?.directorV2 || "").trim() || prev?.director || null,
      premiere: movie?.premiere?.premiereDate || prev?.premiere || null,
      posterUrl: pickPosterUrl(movie) || prev?.posterUrl || event.imageUrl || null,
      ticketUrl: prev?.ticketUrl || dxTicketUrl(event),
      eventId: String(event.id),
      promoterId: String(event.partnerId || "202"),
      sold: null,
      eventStatus: "ok",
    },
    event
  );
}

function parseRunningTime(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const hours = value.match(/(\d+)\s*t/);
  const mins = value.match(/(\d+)\s*min/);
  if (!hours && !mins) return null;
  return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
}

function pickPosterUrl(movie) {
  const posters = movie?.postersV2;
  if (!Array.isArray(posters) || !posters.length) return null;
  const base = posters[0]?.asset?.url;
  if (!base) return null;
  return `${base}?w=240&h=340&fit=crop&auto=format`;
}

/** Drop obsolete dimension tags — 3D is gone, so "2D" is just noise. */
function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => {
    const t = String(tag || "").trim().toUpperCase();
    return t && t !== "2D" && t !== "3D";
  });
}

const OMDB_API_KEY = String(process.env.OMDB_API_KEY || "").trim();
const IMDB_GQL = "https://caching.graphql.imdb.com/";
const IMDB_SUGGEST = "https://v2.sg.media-imdb.com/suggestion";
const RATING_UA =
  "Mozilla/5.0 (compatible; CinemaInfo/1.0; +https://github.com/T3lluz/Cinema-Info)";

function movieYear(movie) {
  const direct = Number(movie?.year);
  if (Number.isFinite(direct) && direct >= 1900) return direct;
  const premiere = String(movie?.premiere?.premiereDate || "").slice(0, 4);
  const fromPremiere = Number(premiere);
  if (Number.isFinite(fromPremiere) && fromPremiere >= 1900) return fromPremiere;
  return null;
}

/** Titles worth trying when looking a film up off Buen's Norwegian name. */
function ratingQueryTitles(movie, showTitle) {
  const titles = [
    movie?.originalTitle,
    showTitle,
    movie?.title,
  ]
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => t.replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter(Boolean);

  // Buen often keeps the local title; English catalogues use another.
  const aliases = {
    vaiana: ["Moana"],
    "minions & monstre": ["Minions & Monsters", "Minions Monsters"],
    "paw patrol: dinofilmen": ["PAW Patrol: The Dino Movie", "Paw Patrol Dino Movie"],
    "superhunden charlie": ["Charlie the Wonderdog"],
  };
  for (const t of [...titles]) {
    const extra = aliases[t.toLowerCase()];
    if (extra) titles.push(...extra);
  }

  return [...new Set(titles)];
}

function slugify(title, joiner) {
  return String(title)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, ` ${joiner === "_" ? "and" : "and"} `)
    .replace(/[^a-z0-9]+/g, joiner)
    .replace(new RegExp(`^${joiner}|${joiner}$`, "g"), "");
}

function slugCandidates(title, year, joiner) {
  const base = slugify(title, joiner);
  if (!base) return [];
  const noAnd = base.replaceAll(`${joiner}and${joiner}`, joiner);
  const out = [];
  for (const s of [base, noAnd]) {
    if (!s) continue;
    if (year) out.push(`${s}${joiner}${year}`);
    out.push(s);
  }
  return [...new Set(out)];
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": RATING_UA, Accept: "text/html,application/json" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) return null;
  return { url: res.url, text: await res.text() };
}

function pickOmdbGenres(data) {
  const raw = String(data?.Genre || "")
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g && g !== "N/A");
  return raw.length ? raw.slice(0, 3) : null;
}

const IMDB_GENRE_NAMES = new Set([
  "action",
  "adventure",
  "animation",
  "biography",
  "comedy",
  "crime",
  "documentary",
  "drama",
  "family",
  "fantasy",
  "film-noir",
  "history",
  "horror",
  "music",
  "musical",
  "mystery",
  "romance",
  "sci-fi",
  "short",
  "sport",
  "thriller",
  "war",
  "western",
]);

function looksLikeImdbGenres(genres) {
  if (!Array.isArray(genres) || !genres.length) return false;
  return genres.every((g) => IMDB_GENRE_NAMES.has(String(g || "").trim().toLowerCase()));
}

function packImdbHit(id, ratingValue, genres, runtimeMinutes) {
  if (!id) return null;
  // "Vaiana" without a year can hit a short — skip non-features.
  if (genres?.length === 1 && genres[0].toLowerCase() === "short") return null;
  if (Number.isFinite(runtimeMinutes) && runtimeMinutes > 0 && runtimeMinutes < 40) {
    return null;
  }
  const value = Number.parseFloat(ratingValue);
  const imdb = Number.isFinite(value)
    ? {
        value: Math.round(value * 10) / 10,
        id,
        url: `https://www.imdb.com/title/${id}/`,
      }
    : null;
  return { imdb, genres: genres?.length ? genres.slice(0, 3) : null };
}

/**
 * OMDb hit: IMDb rating when available, plus English genres for the
 * Movies tab (Buen's Filmweb genres stay Norwegian-only).
 */
function parseOmdbMovie(data, expectedYear) {
  if (!data || data.Response === "False") return null;
  if (expectedYear) {
    const y = Number.parseInt(String(data.Year || "").slice(0, 4), 10);
    // Remakes share a title — reject a hit from a clearly different year.
    if (Number.isFinite(y) && Math.abs(y - expectedYear) > 1) return null;
  }
  if (!data.imdbID) return null;

  const genres = pickOmdbGenres(data);
  const runtime = Number.parseInt(String(data.Runtime || ""), 10);
  return packImdbHit(
    data.imdbID,
    data.imdbRating,
    genres,
    Number.isFinite(runtime) ? runtime : null
  );
}

/**
 * Direct IMDb: suggestion search for the title id, then the public
 * GraphQL cache for rating + genres. HTML title pages are WAF-blocked
 * from CI; these two endpoints are not.
 */
async function lookupImdbDirect(titles, year) {
  async function suggest(title) {
    const q = String(title || "").trim().toLowerCase();
    if (!q) return [];
    const prefix = /^[a-z0-9]/i.test(q[0]) ? q[0] : "x";
    const url = `${IMDB_SUGGEST}/${encodeURIComponent(prefix)}/${encodeURIComponent(q)}.json`;
    const data = await fetchJson(url, {
      headers: { "User-Agent": RATING_UA, Accept: "application/json" },
    });
    const rows = Array.isArray(data?.d) ? data.d : [];
    return rows.filter((row) => {
      const id = String(row?.id || "");
      if (!/^tt\d+$/.test(id)) return false;
      const kind = String(row.qid || row.q || "").toLowerCase();
      // Features only — skip TV, shorts, lists, people.
      return kind === "movie" || kind === "feature";
    });
  }

  async function detail(id) {
    const body = {
      query: `query Title($id: ID!) {
        title(id: $id) {
          id
          ratingsSummary { aggregateRating voteCount }
          genres { genres { text } }
          runtime { seconds }
          releaseYear { year }
        }
      }`,
      variables: { id },
    };
    const data = await fetchJson(IMDB_GQL, {
      method: "POST",
      headers: {
        "User-Agent": RATING_UA,
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-imdb-client-name": "imdb-web-app",
      },
      body: JSON.stringify(body),
    });
    return data?.data?.title || null;
  }

  function yearOk(candidateYear, expected) {
    if (!expected) return true;
    const y = Number(candidateYear);
    if (!Number.isFinite(y)) return false;
    return Math.abs(y - expected) <= 1;
  }

  // Prefer a concrete year across every title alias first. A bare
  // Norwegian name with no year (e.g. "Vaiana") can hit an unrelated short.
  const yearTries = year ? [year, year + 1, year - 1, null] : [null];

  for (const y of yearTries) {
    for (const title of titles) {
      try {
        const candidates = await suggest(title);
        const match =
          candidates.find((c) => yearOk(c.y, y)) ||
          (y == null ? candidates[0] : null);
        if (!match?.id) continue;
        const titleData = await detail(match.id);
        if (!titleData?.id) continue;
        if (y != null && !yearOk(titleData.releaseYear?.year, y)) continue;
        const genres = (titleData.genres?.genres || [])
          .map((g) => String(g?.text || "").trim())
          .filter(Boolean);
        const runtimeMin = Number.isFinite(titleData.runtime?.seconds)
          ? titleData.runtime.seconds / 60
          : null;
        const hit = packImdbHit(
          titleData.id,
          titleData.ratingsSummary?.aggregateRating,
          genres.length ? genres : null,
          runtimeMin
        );
        if (hit) return hit;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function lookupOmdb(titles, year) {
  if (!OMDB_API_KEY) return null;

  async function byTitle(title, y) {
    const params = new URLSearchParams({
      t: title,
      apikey: OMDB_API_KEY,
      type: "movie",
    });
    if (y) params.set("y", String(y));
    const data = await fetchJson(`https://www.omdbapi.com/?${params}`);
    return parseOmdbMovie(data, y || null);
  }

  async function bySearch(title, y) {
    const params = new URLSearchParams({
      s: title,
      apikey: OMDB_API_KEY,
      type: "movie",
    });
    if (y) params.set("y", String(y));
    const data = await fetchJson(`https://www.omdbapi.com/?${params}`);
    const candidates = Array.isArray(data?.Search) ? data.Search : [];
    const first =
      candidates.find((c) => {
        if (!y) return true;
        const cy = Number.parseInt(String(c.Year || "").slice(0, 4), 10);
        return Number.isFinite(cy) && Math.abs(cy - y) <= 1;
      }) || null;
    if (!first?.imdbID) return null;
    const detail = await fetchJson(
      `https://www.omdbapi.com/?i=${encodeURIComponent(first.imdbID)}&apikey=${encodeURIComponent(OMDB_API_KEY)}`
    );
    return parseOmdbMovie(detail, y || null);
  }

  // Prefer a concrete year across every title alias first. A bare
  // Norwegian name with no year (e.g. "Vaiana") can hit an unrelated short.
  const yearTries = year ? [year, year + 1, year - 1] : [];

  for (const y of [...yearTries, null]) {
    for (const title of titles) {
      try {
        const hit = await byTitle(title, y);
        if (hit) return hit;
      } catch {
        /* try next */
      }
    }
  }

  for (const y of [...yearTries, null]) {
    for (const title of titles) {
      try {
        const hit = await bySearch(title, y);
        if (hit) return hit;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

/** IMDb rating + genres: OMDb when keyed, else (or on miss) direct GraphQL. */
async function lookupImdb(titles, year) {
  if (OMDB_API_KEY) {
    try {
      const omdb = await lookupOmdb(titles, year);
      if (omdb?.imdb) return omdb;
    } catch (err) {
      console.warn("OMDb lookup failed:", err.message);
    }
  }
  try {
    return await lookupImdbDirect(titles, year);
  } catch (err) {
    console.warn("IMDb direct lookup failed:", err.message);
    return null;
  }
}

function extractLbRating(html, pageUrl, expectedYear) {
  if (expectedYear) {
    // Letterboxd JSON-LD includes dateCreated as the release year.
    const yearHit = html.match(
      /"dateCreated"\s*:\s*"(\d{4})"|Release date[^<]*(\d{4})/i
    );
    const y = Number(yearHit?.[1] || yearHit?.[2]);
    if (Number.isFinite(y) && Math.abs(y - expectedYear) > 1) return null;
  }
  const m = html.match(
    /"aggregateRating"\s*:\s*\{[^}]*?"ratingValue"\s*:\s*([0-9.]+)[^}]*\}/
  );
  if (!m) return null;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    value: Math.round(value * 100) / 100,
    url: pageUrl.split("?")[0],
  };
}

async function lookupLetterboxd(titles, year) {
  for (const title of titles) {
    for (const slug of slugCandidates(title, year, "-")) {
      try {
        const page = await fetchText(`https://letterboxd.com/film/${slug}/`);
        if (!page) continue;
        const hit = extractLbRating(page.text, page.url, year);
        if (hit) return hit;
      } catch {
        /* try next slug */
      }
    }
  }
  return null;
}

/** Rotten Tomatoes audience score (not the critics Tomatometer). */
function extractAudienceScore(html, pageUrl, expectedYear) {
  if (expectedYear) {
    const yearHit = html.match(/"dateCreated"\s*:\s*"(\d{4})"/i);
    // Prefer the movie name in JSON-LD when it includes (YEAR).
    const named = html.match(/"name"\s*:\s*"([^"]*\((\d{4})\))"/);
    const y = Number(named?.[2] || yearHit?.[1]);
    if (Number.isFinite(y) && Math.abs(y - expectedYear) > 1) return null;
  }
  // Prefer the primary audienceScore block RT embeds for the page hero
  // (verified ratings). Avoid the critics Tomatometer JSON-LD entirely.
  const m =
    html.match(
      /"audienceScore"\s*:\s*\{[^{}]*?"score"\s*:\s*"?(\d+)"?/
    ) ||
    html.match(
      /"audienceScore"\s*:\s*\{[^{}]*?"scorePercent"\s*:\s*"?(\d+)%?"?/
    );
  if (!m) return null;
  const value = Number.parseInt(m[1], 10);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return {
    value,
    url: pageUrl.split("?")[0],
  };
}

async function lookupTomatoes(titles, year) {
  for (const title of titles) {
    for (const slug of slugCandidates(title, year, "_")) {
      try {
        const page = await fetchText(
          `https://www.rottentomatoes.com/m/${slug}`
        );
        if (!page) continue;
        const hit = extractAudienceScore(page.text, page.url, year);
        if (hit) return hit;
      } catch {
        /* try next slug */
      }
    }
  }
  return null;
}

/**
 * IMDb (OMDb and/or direct), Letterboxd and RT audience score.
 * Missing sources are omitted — not every film is listed everywhere yet.
 */
async function lookupRatings(movie, showTitle) {
  const titles = ratingQueryTitles(movie, showTitle);
  const year = movieYear(movie);
  if (!titles.length) return null;

  const [imdbHit, letterboxd, tomatoes] = await Promise.all([
    lookupImdb(titles, year),
    lookupLetterboxd(titles, year),
    lookupTomatoes(titles, year),
  ]);

  const ratings = {};
  if (imdbHit?.imdb) ratings.imdb = imdbHit.imdb;
  if (letterboxd) ratings.letterboxd = letterboxd;
  if (tomatoes) ratings.tomatoes = tomatoes;

  const out = {};
  if (Object.keys(ratings).length) out.ratings = ratings;
  if (imdbHit?.genres?.length) out.genres = imdbHit.genres;
  return Object.keys(out).length ? out : null;
}

function ratingsCacheKey(showTitle, movie) {
  return [
    String(showTitle || "").trim().toLowerCase(),
    String(movie?.originalTitle || movie?.title || "")
      .trim()
      .toLowerCase(),
    movie?.year || "",
  ].join("|");
}

/**
 * Merge rating sources per key. Later parts win for a source they
 * carry; a missing source (e.g. OMDb skipped) must not wipe last
 * night's IMDb when Letterboxd/RT still came back.
 */
function mergeRatings(...parts) {
  const out = {};
  for (const ratings of parts) {
    if (!ratings || typeof ratings !== "object") continue;
    for (const key of ["imdb", "letterboxd", "tomatoes"]) {
      if (ratings[key] != null) out[key] = ratings[key];
    }
  }
  return Object.keys(out).length ? out : null;
}

function dayKeyFromShowStart(value) {
  return String(value).slice(0, 10);
}

/**
 * Showtimes are Oslo wall clock without an offset, and this runs on a
 * UTC CI box, so "has it started?" has to be asked in the cinema's own
 * time rather than the runner's.
 */
function osloWallClock(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(date)
      .replace(" ", "T");
  } catch {
    return new Date(date.getTime()).toISOString().slice(0, 19);
  }
}

function dayKeyDaysAgo(days, today = osloWallClock().slice(0, 10)) {
  const [y, m, d] = today.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCDate(anchor.getUTCDate() - days);
  return anchor.toISOString().slice(0, 10);
}

const startOf = (show) => String(show?.start || "").slice(0, 19);

function loadPreviousShows() {
  if (!existsSync(OUT)) return [];
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    return Array.isArray(prev.shows) ? prev.shows : [];
  } catch {
    return [];
  }
}

function mergeWithHistory(freshShows, previousShows) {
  const byId = new Map();
  const cutoff = dayKeyDaysAgo(KEEP_DAYS);

  for (const show of previousShows) {
    if (!show?.id || !show.dayKey || show.dayKey < cutoff) continue;
    byId.set(show.id, show);
  }

  for (const show of freshShows) {
    const prev = byId.get(show.id);
    if (prev && show.sold == null && prev.sold != null) {
      byId.set(show.id, {
        ...show,
        sold: prev.sold,
        reserved: show.reserved ?? prev.reserved ?? null,
        capacity: show.capacity ?? prev.capacity ?? null,
        available: show.available ?? prev.available ?? null,
        end: show.end || prev.end,
        eventStatus:
          show.eventStatus === "ok" ? "ok" : prev.eventStatus || show.eventStatus,
      });
    } else {
      byId.set(show.id, show);
    }
  }

  return [...byId.values()].sort((a, b) =>
    String(a.start).localeCompare(String(b.start))
  );
}

/**
 * Buen's program API drops ticketSaleUrl once a show has started,
 * which loses the DX eventId. Restore it from the previous snapshot
 * so live sold counts keep working during and after the show.
 */
function restoreEventIds(baseShows, previousShows) {
  const prevById = new Map(previousShows.map((s) => [s.id, s]));
  for (const show of baseShows) {
    if (show.eventId) continue;
    const prev = prevById.get(show.id);
    if (prev?.eventId) {
      show.eventId = prev.eventId;
      show.promoterId = prev.promoterId || show.promoterId;
      show.ticketUrl = show.ticketUrl || prev.ticketUrl || "";
      show.eventStatus = "pending";
    }
  }
}

async function enrichShow(show, gone) {
  if (!show.eventId) {
    return { ...show, sold: null, end: null, eventStatus: "unavailable" };
  }

  // The DX catalogue page already carried live sales + real end times.
  // Re-fetching every row would turn a 120-day backfill into hundreds of
  // extra calls for figures we just read.
  if (show.eventStatus === "ok" && show.sold != null && show.end) {
    return show;
  }

  try {
    const event = await fetchJson(
      `https://api.dx.no/v3/partners/${show.promoterId}/events/${show.eventId}`,
      {
        headers: {
          Referer: show.ticketUrl || "https://checkout.ebillett.no/",
        },
      }
    );

    let screen = show.screen;
    if (event.locationName) {
      screen = String(event.locationName).replace(/\s*-\s*Kino$/i, "").trim();
    }

    const sale = event.ticketSale || {};
    return {
      ...show,
      screen,
      start: event.begin ? event.begin.replace(" ", "T") : show.start,
      end: event.end ? event.end.replace(" ", "T") : null,
      sold: Number(sale.sold) || 0,
      reserved: Number(sale.reserved) || 0,
      capacity: Number(sale.capacity) || null,
      available: sale.available != null ? Number(sale.available) : null,
      eventStatus: "ok",
    };
  } catch (err) {
    // A deleted event is DX saying the showing is off the programme —
    // worth remembering, unlike a network hiccup.
    if (err.status === 404 || err.status === 410) gone?.add(show.id);
    else console.warn(`Event ${show.eventId} failed:`, err.message);
    return { ...show, sold: null, end: null, eventStatus: "error" };
  }
}

/**
 * Sort last night's snapshot against today's programme.
 *
 * Buen's feed lists upcoming website showings, and the DX catalogue
 * fills in cinema days the site has not published (and history the
 * feed drops once a film has started). A future showing that has left
 * both is pulled or moved — those must go. Anything that has already
 * started is history the feed cannot speak for: it is kept, and the
 * recent part of it is re-checked against DX so a showing cancelled
 * on the day is caught too.
 */
function planPreviousShows(previousShows, freshShows) {
  const freshIds = new Set(freshShows.map((s) => s.id));
  const keepCutoff = dayKeyDaysAgo(KEEP_DAYS);
  const verifyCutoff = dayKeyDaysAgo(VERIFY_DAYS);
  const graceIso = osloWallClock(new Date(Date.now() + START_GRACE_MIN * 60000));

  // How far the feed reaches. Beyond it, absence proves nothing — a
  // truncated or half-broken feed must not wipe out later showings.
  const horizon = freshShows.reduce(
    (max, s) => (startOf(s) > max ? startOf(s) : max),
    ""
  );

  const unprogrammed = [];
  const recheck = [];
  for (const prev of previousShows) {
    if (!prev?.id || !prev.dayKey || prev.dayKey < keepCutoff) continue;
    if (freshIds.has(prev.id)) continue;

    if (startOf(prev) > graceIso) {
      if (horizon > startOf(prev)) unprogrammed.push(prev);
      else recheck.push(prev);
      continue;
    }
    if (prev.dayKey >= verifyCutoff) recheck.push(prev);
  }

  return { unprogrammed, recheck };
}

async function main() {
  const previousShows = loadPreviousShows();
  const fromDay = dayKeyDaysAgo(KEEP_DAYS);

  let dxEvents = [];
  try {
    dxEvents = await fetchDxCinemaEvents(fromDay);
  } catch (err) {
    console.warn("DX cinema listing failed:", err.message);
  }

  const data = await fetchJson(PROGRAM_URL);
  const movies = data.filmwebMovies || {};
  const raw = Array.isArray(data.shows) ? data.shows : [];
  if (!raw.length && !dxEvents.length) {
    throw new Error(
      "Buen program feed returned no shows — refusing to overwrite the snapshot"
    );
  }
  if (!raw.length) {
    console.warn(
      "Buen program feed returned no shows — continuing from the DX cinema listing"
    );
  }

  // One ratings lookup per distinct film — shared across every showing.
  const ratingJobs = new Map();
  const ratingsFor = (movie, showTitle) => {
    const key = ratingsCacheKey(showTitle, movie);
    if (!ratingJobs.has(key)) {
      ratingJobs.set(
        key,
        lookupRatings(movie, showTitle).catch((err) => {
          console.warn(`Ratings for ${showTitle}:`, err.message);
          return null;
        })
      );
    }
    return ratingJobs.get(key);
  };

  const drafted = raw
    .map((show) => {
      const movie =
        movies[show.movieMainVersionId] || movies[show.movieVersionId] || null;
      const ticket = parseTicketLink(show.ticketSaleUrl);
      const start = show.showStart;
      if (!start) return null;
      const title = show.movieTitle || movie?.title || "Ukjent film";

      return {
        id: `${show.movieVersionId}-${show.showStart}-${show.screenName}`,
        title,
        screen: show.screenName || "Ukjent sal",
        start,
        end: null,
        dayKey: dayKeyFromShowStart(start),
        runningMinutes: parseRunningTime(movie?.runningTime),
        runningLabel: movie?.runningTime || null,
        age: movie?.ageRating?.age || null,
        tags: cleanTags((show.versionTags || []).map((t) => t.tag)),
        // Special programming worth a badge: "Norgespremiere",
        // "Dagkino", "Seniorkino" — and Kinoklubb screenings.
        showType: String(show.showType || "").trim() || null,
        kinoklubb: Boolean(show.isKinoklubb),
        genres: null,
        director: String(movie?.directorV2 || "").trim() || null,
        premiere: movie?.premiere?.premiereDate || null,
        ratingsPromise: ratingsFor(movie, title),
        posterUrl: pickPosterUrl(movie),
        ticketUrl: ticket?.url || "",
        eventId: ticket?.eventId || null,
        promoterId: ticket?.promoterId || "202",
        sold: null,
        eventStatus: ticket ? "pending" : "unavailable",
      };
    })
    .filter(Boolean);

  const prevByEventId = new Map(
    previousShows
      .filter((show) => show?.eventId)
      .map((show) => [String(show.eventId), show])
  );
  const dxByEventId = new Map(dxEvents.map((event) => [String(event.id), event]));
  const dxByStartScreen = new Map();
  for (const event of dxEvents) {
    dxByStartScreen.set(`${dxEventBegin(event)}|${dxScreenName(event)}`, event);
  }
  const seenEventIds = new Set();
  for (const show of drafted) {
    if (!show.eventId) {
      const match = dxByStartScreen.get(`${startOf(show)}|${show.screen}`);
      if (match) {
        show.eventId = String(match.id);
        show.promoterId = String(match.partnerId || show.promoterId || "202");
        show.ticketUrl = show.ticketUrl || dxTicketUrl(match);
        show.eventStatus = "pending";
      }
    }
    if (show.eventId && dxByEventId.has(String(show.eventId))) {
      applyDxSale(show, dxByEventId.get(String(show.eventId)));
      seenEventIds.add(String(show.eventId));
    }
  }
  for (const event of dxEvents) {
    if (seenEventIds.has(String(event.id))) continue;
    const show = showFromDxEvent(event, movies, previousShows, prevByEventId);
    const movie = event.productionReference
      ? movies[event.productionReference] || null
      : null;
    show.ratingsPromise = ratingsFor(movie, show.title);
    drafted.push(show);
    seenEventIds.add(String(event.id));
  }
  const dxOnly = [...seenEventIds].filter(
    (id) => !raw.some((show) => parseTicketLink(show.ticketSaleUrl)?.eventId === id)
  ).length;
  console.log(
    `Merged ${dxEvents.length} DX cinema events ` +
      `(${dxOnly} not on Buen's website feed)`
  );

  // Resolve every film's ratings once before enrichment batches start.
  await Promise.all([...ratingJobs.values()]);
  if (OMDB_API_KEY) {
    console.log(`OMDB_API_KEY set (${OMDB_API_KEY.length} chars) — IMDb via OMDb first`);
  } else {
    console.warn(
      "OMDB_API_KEY not set — IMDb ratings + genres via direct IMDb GraphQL (set repo Actions secret OMDB_API_KEY to prefer OMDb)"
    );
  }
  const baseShows = [];
  const freshRatingsByTitle = new Map();
  const freshGenresByTitle = new Map();
  for (const draft of drafted) {
    const { ratingsPromise, ...show } = draft;
    const packed = (await ratingsPromise) || null;
    const ratings = packed?.ratings || null;
    const genres = packed?.genres || null;
    if (ratings) freshRatingsByTitle.set(show.title, ratings);
    if (genres) freshGenresByTitle.set(show.title, genres);
    baseShows.push({
      ...show,
      ratings,
      genres,
    });
  }
  baseShows.sort((a, b) => a.start.localeCompare(b.start));

  restoreEventIds(baseShows, previousShows);

  // Keep last night's ratings/genres when today's lookup came up empty
  // or only partially filled (e.g. OMDb key missing → Letterboxd/RT
  // succeed but IMDb is omitted and must not wipe yesterday's score).
  const prevRatingsByTitle = new Map();
  const prevGenresByTitle = new Map();
  for (const prev of previousShows) {
    if (prev?.title && prev.ratings && !prevRatingsByTitle.has(prev.title)) {
      prevRatingsByTitle.set(prev.title, prev.ratings);
    }
    // Only keep prior genres that look like IMDb/OMDb English labels —
    // older snapshots still carry Buen's Norwegian Filmweb names.
    if (
      prev?.title &&
      looksLikeImdbGenres(prev.genres) &&
      !prevGenresByTitle.has(prev.title)
    ) {
      prevGenresByTitle.set(prev.title, prev.genres);
    }
  }
  for (const show of baseShows) {
    const merged = mergeRatings(
      prevRatingsByTitle.get(show.title),
      show.ratings
    );
    if (merged) show.ratings = merged;
    if (!show.genres && prevGenresByTitle.has(show.title)) {
      show.genres = prevGenresByTitle.get(show.title);
    }
  }

  const { unprogrammed, recheck } = planPreviousShows(previousShows, baseShows);
  const dropped = new Map(unprogrammed.map((s) => [s.id, "off programme"]));

  // Showings the feed no longer carries are asked about directly, so
  // their sold counts stay live and DX gets to say whether they exist.
  const offProgram = new Set(recheck.map((s) => s.id));
  for (const prev of recheck) baseShows.push({ ...prev, eventStatus: "pending" });
  baseShows.sort((a, b) => String(a.start).localeCompare(String(b.start)));

  // Enrich in modest batches to avoid rate limits.
  const gone = new Set();
  const shows = [];
  const batchSize = 6;
  for (let i = 0; i < baseShows.length; i += batchSize) {
    const batch = baseShows.slice(i, i + batchSize);
    const enriched = await Promise.all(batch.map((s) => enrichShow(s, gone)));
    shows.push(...enriched);
  }

  // DX no longer has the event: the showing was deleted, not just
  // unlisted. Sold tickets from a show that did play are kept as
  // history; a showing that never sold anything simply never happened.
  const prevById = new Map(previousShows.map((s) => [s.id, s]));
  for (const id of gone) {
    if (!offProgram.has(id)) continue;
    if (Number(prevById.get(id)?.sold) > 0) continue;
    dropped.set(id, "deleted in DX");
  }

  const kept = shows.filter((show) => !dropped.has(show.id));
  const history = previousShows.filter((show) => !dropped.has(show.id));

  const ratingsByTitle = new Map();
  const genresByTitle = new Map(freshGenresByTitle);
  // Seed with previous + any row we already filled, then let fresh
  // sources win per key without dropping ones the fresh lookup missed.
  for (const [title, ratings] of prevRatingsByTitle) {
    ratingsByTitle.set(title, ratings);
  }
  for (const show of kept) {
    if (show.title && show.ratings) {
      ratingsByTitle.set(
        show.title,
        mergeRatings(ratingsByTitle.get(show.title), show.ratings)
      );
    }
    if (show.title && looksLikeImdbGenres(show.genres)) {
      genresByTitle.set(show.title, show.genres);
    }
  }
  for (const [title, ratings] of freshRatingsByTitle) {
    ratingsByTitle.set(
      title,
      mergeRatings(ratingsByTitle.get(title), ratings)
    );
  }
  for (const [title, genres] of freshGenresByTitle) {
    genresByTitle.set(title, genres);
  }

  // History-only titles never hit the live-feed ratings jobs. Fill any
  // still-missing IMDb score so past films keep their badges too.
  const titlesNeedingImdb = new Set();
  for (const show of [...kept, ...history]) {
    if (!show?.title) continue;
    if (ratingsByTitle.get(show.title)?.imdb) continue;
    if (show.ratings?.imdb) continue;
    titlesNeedingImdb.add(show.title);
  }
  if (titlesNeedingImdb.size) {
    await Promise.all(
      [...titlesNeedingImdb].map(async (title) => {
        try {
          const sample =
            kept.find((s) => s.title === title) ||
            history.find((s) => s.title === title);
          const year = sample?.premiere
            ? Number(String(sample.premiere).slice(0, 4)) || null
            : null;
          const packed = await lookupImdb(ratingQueryTitles(null, title), year);
          if (!packed) return;
          if (packed.imdb) {
            ratingsByTitle.set(
              title,
              mergeRatings(ratingsByTitle.get(title), { imdb: packed.imdb })
            );
          }
          if (packed.genres?.length && !genresByTitle.has(title)) {
            genresByTitle.set(title, packed.genres);
          }
        } catch (err) {
          console.warn(`History IMDb for ${title}:`, err.message);
        }
      })
    );
  }

  const merged = mergeWithHistory(kept, history).map((show) => {
    const { reviews: _drop, ...rest } = show;
    // Per-source merge: fresh wins where present; prior fills the gaps.
    const ratings = mergeRatings(
      prevRatingsByTitle.get(rest.title),
      rest.ratings,
      ratingsByTitle.get(rest.title)
    );
    const genres =
      genresByTitle.get(rest.title) ||
      rest.genres ||
      prevGenresByTitle.get(rest.title) ||
      null;
    return {
      ...rest,
      tags: cleanTags(rest.tags),
      ratings,
      genres,
    };
  });
  const payload = {
    updatedAt: new Date().toISOString(),
    cinema: "Buen kino",
    shows: merged,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

  for (const [id, why] of dropped) {
    const show = prevById.get(id);
    console.log(
      `Removed ${show?.start || id} ${show?.title || ""} (${show?.screen || "?"}) — ${why}`
    );
  }
  console.log(
    `Wrote ${merged.length} shows (${kept.length} fresh + history, ` +
      `${dropped.size} removed) → ${OUT} (${payload.updatedAt})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
