#!/usr/bin/env node
/**
 * Builds data/program.json for the GitHub Pages site.
 * Buen kino API is not CORS-friendly in browsers, so we snapshot it here.
 * Sold counts + real end times come from DX/eBillett.
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
const OUT = join(__dirname, "..", "data", "program.json");

const PROGRAM_URL =
  "https://www.buenkino.no/api/program?includeDocuments=true&first=500";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One JSON GET that survives a flaky night: timeouts, resets and DX's
 * rate limiting are retried with backoff, while a straight answer of
 * "no such thing" is passed on as-is so callers can act on it.
 */
async function fetchJson(url, init = {}) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Accept: "application/json",
          "User-Agent": "Cinema-Info/1.0 (+https://github.com/T3lluz/Cinema-Info)",
          ...init.headers,
        },
        ...init,
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
 * Buen's feed lists every upcoming showing, so a show still in the
 * future that has left the feed has been pulled or moved — those must
 * go, or the app keeps advertising a film that is not playing. Anything
 * that has already started is history the feed cannot speak for: it is
 * kept, and the recent part of it is re-checked against DX so a showing
 * cancelled on the day is caught too.
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
  const data = await fetchJson(PROGRAM_URL);
  const movies = data.filmwebMovies || {};
  const raw = Array.isArray(data.shows) ? data.shows : [];
  if (!raw.length) {
    throw new Error(
      "Buen program feed returned no shows — refusing to overwrite the snapshot"
    );
  }

  const baseShows = raw
    .map((show) => {
      const movie =
        movies[show.movieMainVersionId] || movies[show.movieVersionId] || null;
      const ticket = parseTicketLink(show.ticketSaleUrl);
      const start = show.showStart;
      if (!start) return null;

      return {
        id: `${show.movieVersionId}-${show.showStart}-${show.screenName}`,
        title: show.movieTitle || movie?.title || "Ukjent film",
        screen: show.screenName || "Ukjent sal",
        start,
        end: null,
        dayKey: dayKeyFromShowStart(start),
        runningMinutes: parseRunningTime(movie?.runningTime),
        runningLabel: movie?.runningTime || null,
        age: movie?.ageRating?.age || null,
        tags: cleanTags((show.versionTags || []).map((t) => t.tag)),
        posterUrl: pickPosterUrl(movie),
        ticketUrl: ticket?.url || "",
        eventId: ticket?.eventId || null,
        promoterId: ticket?.promoterId || "202",
        sold: null,
        eventStatus: ticket ? "pending" : "unavailable",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start.localeCompare(b.start));

  const previousShows = loadPreviousShows();
  restoreEventIds(baseShows, previousShows);

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

  const merged = mergeWithHistory(kept, history).map((show) => ({
    ...show,
    tags: cleanTags(show.tags),
  }));
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
