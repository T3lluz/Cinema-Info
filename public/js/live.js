/**
 * The server's prefetched figures, in one GET.
 *
 * The server on t3lluz.com (`server/live.ts`) reads DX on everyone's
 * behalf: sold counts for the programme, seat charts and check-ins for
 * the days that matter, on a schedule that follows the doors. This
 * module collects its answer for today and the day on screen, hands it
 * to data.js and seats.js, and stamps what it covered as just read, so
 * the beat's own per-showing reads only go out for what it left out.
 *
 * Nothing breaks without it. If the server does not answer, it waits a
 * while before asking again, and the app reads DX itself as it always
 * has.
 */
import { S, hooks, LIVE_URL, PREVIEW_SCANNED, todayKey } from "./core.js?v=dev";
import { applyServerLive } from "./data.js?v=dev";
import { applyServerSeats, knownHallKeys } from "./seats.js?v=dev";

/** Long enough for a slow phone network, short enough not to hold a beat. */
const TIMEOUT_MS = 5000;
/** After a failure, read DX directly for this long before trying again. */
const BACKOFF_MS = 30 * 1000;

let etag = "";
let lastBody = null;
let lastQuery = "";
let failedUntil = 0;
let running = null;

function query() {
  const days = [...new Set([todayKey(), S.selectedDay].filter(Boolean))];
  const params = new URLSearchParams({ days: days.join(",") });
  const have = knownHallKeys();
  if (have.length) params.set("have", have.join(","));
  return params.toString();
}

async function fetchLive() {
  const q = query();
  const headers = { Accept: "application/json" };
  // The same question as last time can be answered with a 304.
  if (etag && lastBody && q === lastQuery) headers["If-None-Match"] = etag;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${LIVE_URL}?${q}`, {
      cache: "no-store",
      headers,
      signal: ctrl.signal,
    });
    if (res.status === 304 && lastBody) return lastBody;
    if (!res.ok) throw new Error(`live ${res.status}`);
    const body = await res.json();
    etag = res.headers.get("ETag") || "";
    lastBody = body;
    lastQuery = q;
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Apply one answer. True when a card's figures moved. */
function apply(body) {
  const cards = applyServerLive(body);
  const seats = applyServerSeats(body);
  return cards || seats;
}

/**
 * Ask the server for everything it has read. Resolves true when it
 * answered (whether or not anything moved), false when the app should
 * read DX itself. Overlapping callers share one request.
 */
export function pullServerLive() {
  if (!LIVE_URL || PREVIEW_SCANNED || !S.state?.shows) return Promise.resolve(false);
  if (Date.now() < failedUntil) return Promise.resolve(false);
  if (running) return running;

  running = (async () => {
    try {
      const body = await fetchLive();
      if (apply(body)) hooks.render();
      return true;
    } catch (err) {
      failedUntil = Date.now() + BACKOFF_MS;
      console.warn("Server live feed unavailable, reading DX directly", err);
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}
