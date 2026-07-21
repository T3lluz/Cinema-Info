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

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "program.json");

const PROGRAM_URL =
  "https://www.buenkino.no/api/program?includeDocuments=true&first=500";

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "Cinema-Info/1.0 (+https://github.com/T3lluz/Cinema-Info)",
      ...init.headers,
    },
    ...init,
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
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

function dayKeyFromShowStart(value) {
  return String(value).slice(0, 10);
}

function dayKeyDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

async function enrichShow(show) {
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
    console.warn(`Event ${show.eventId} failed:`, err.message);
    return { ...show, sold: null, end: null, eventStatus: "error" };
  }
}

async function main() {
  const data = await fetchJson(PROGRAM_URL);
  const movies = data.filmwebMovies || {};
  const raw = Array.isArray(data.shows) ? data.shows : [];

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
        tags: (show.versionTags || []).map((t) => t.tag).filter(Boolean),
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

  // Buen's program API also drops entire shows once they've started.
  // Pull recent ones back from the previous snapshot so their sold
  // counts keep updating during and right after the show.
  const rescueCutoff = dayKeyDaysAgo(2);
  const baseIds = new Set(baseShows.map((s) => s.id));
  for (const prev of previousShows) {
    if (!baseIds.has(prev.id) && prev.eventId && prev.dayKey >= rescueCutoff) {
      baseShows.push({ ...prev, eventStatus: "pending" });
    }
  }
  baseShows.sort((a, b) => String(a.start).localeCompare(String(b.start)));

  // Enrich in modest batches to avoid rate limits.
  const shows = [];
  const batchSize = 6;
  for (let i = 0; i < baseShows.length; i += batchSize) {
    const batch = baseShows.slice(i, i + batchSize);
    const enriched = await Promise.all(batch.map(enrichShow));
    shows.push(...enriched);
  }

  const merged = mergeWithHistory(shows, previousShows);
  const payload = {
    updatedAt: new Date().toISOString(),
    cinema: "Buen kino",
    shows: merged,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${merged.length} shows (${shows.length} fresh + history) → ${OUT} (${payload.updatedAt})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
