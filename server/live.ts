/**
 * Live figures, kept warm on the server.
 *
 * Every phone used to ask DX on its own: sold counts from the public event
 * API, check-ins and seat maps through the bridge, a showing at a time.
 * Opening the app meant a burst of lookups and a few seconds of empty seat
 * charts, and ten phones at the box office asked the same questions ten
 * times. This process asks once, on a schedule that follows the doors, and
 * the app collects everything for the days it is showing in one GET
 * (`/api/live`). The bridge's own `seats` and `scanned` actions answer from
 * the same cache, so a chart for a day outside the bulk answer is still one
 * round trip to this server rather than four to DX.
 */
import { handler as dxHandler } from "../supabase/functions/dx-web-login/index.ts";

const DX_API = "https://api.dx.no/v3";
const PARTNER_ID = "202";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The same windows the app uses (public/js/data.js). */
const DOOR_BEFORE_MS = 15 * MIN;
const DOOR_AFTER_MS = 15 * MIN;
const ACTIVE_LEAD_MS = 4 * HOUR;
const FINAL_AFTER_MS = 6 * HOUR;

/**
 * How far ahead seat charts are kept warm. Sales for a showing two weeks
 * out move slowly, so those are read every ten minutes; today's every
 * minute; anything with its doors open every few seconds.
 */
const SEATS_AHEAD_MS = 14 * DAY;
/** Showings that ended this long ago are fetched once more, then frozen. */
const SEATS_BEHIND_MS = 2 * DAY;

/** Hall geometry changes when someone rebuilds an auditorium. */
const LAYOUT_TTL_MS = DAY;

/** Parallel lookups. A seat chart is four DX calls, an event one. */
const SEAT_SLOTS = 3;
const EVENT_SLOTS = 6;
const TICK_MS = 2 * SEC;

/** An answer this old is left out of /api/live; the app then asks itself. */
const LIVE_STALE_DOOR_MS = MIN;
const LIVE_STALE_MS = 15 * MIN;

type Show = {
  id: string;
  eventId: string;
  partnerId: string;
  dayKey: string;
  start: number;
  end: number;
};

type EventFigures = {
  sold: number;
  reserved: number;
  capacity: number | null;
  available: number | null;
  begin: string | null;
  end: string | null;
  screen: string | null;
};

type EventEntry = { at: number; status: "ok" | "gone"; data?: EventFigures };
type SeatEntry = { at: number; data: Record<string, unknown> };
type CountEntry = {
  at: number;
  scanned: number;
  sold: number;
  final: boolean;
  /** DX had no purchase list for it: known, but nothing to show. */
  none?: boolean;
};
type LayoutEntry = { at: number; layout: unknown };

const events = new Map<string, EventEntry>();
const seats = new Map<string, SeatEntry>();
const counts = new Map<string, CountEntry>();
const layouts = new Map<string, LayoutEntry>();
/** eventId → hall, once a seat answer has named it. */
const halls = new Map<string, string>();

const inFlight = new Map<string, Promise<unknown>>();
let seatBusy = 0;
let eventBusy = 0;

let shows: Show[] = [];
let byEvent = new Map<string, Show>();
let programAt = "";
let programMtime = 0;

/** The shared DX session, carried across restarts so a deploy is not a login. */
let dxToken = "";
const health = {
  startedAt: Date.now(),
  lastDxOk: 0,
  lastDxError: "",
  lastDxErrorAt: 0,
  dxCalls: 0,
  eventCalls: 0,
};

let siteDir = "";
let dataDir = "";
let dirty = false;

/* —— Time ——————————————————————————————————————————————————————————— */

const OSLO_DAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function osloDayKey(at = Date.now()): string {
  return OSLO_DAY.format(new Date(at));
}

/**
 * Buen and DX write local Oslo wall-clock times with no offset. The
 * container runs with TZ=Europe/Oslo, so `Date` reads them the way the
 * app does on a phone in Mandal; `checkTimeZone` says so loudly if not.
 */
function parseLocal(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = new Date(value.length === 16 ? `${value}:00` : value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function checkTimeZone() {
  const probe = new Date("2026-07-01T12:00:00").getTimezoneOffset();
  if (probe !== -120) {
    console.warn(
      `TZ looks wrong (offset ${probe} min in July, expected -120). ` +
        "Set TZ=Europe/Oslo or showtimes will be off by hours.",
    );
  }
}

/* —— Programme ————————————————————————————————————————————————————— */

async function readProgram() {
  const path = `${siteDir}/data/program.json`;
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(path);
  } catch {
    return;
  }
  const mtime = stat.mtime?.getTime() || 0;
  if (mtime === programMtime) return;

  try {
    const raw = JSON.parse(await Deno.readTextFile(path));
    const next: Show[] = [];
    for (const s of Array.isArray(raw.shows) ? raw.shows : []) {
      const eventId = String(s.eventId || "");
      const start = parseLocal(s.start);
      if (!/^\d+$/.test(eventId) || start == null) continue;
      const end = parseLocal(s.end) ??
        start + (Number(s.runningMinutes) || 120) * MIN;
      next.push({
        id: String(s.id),
        eventId,
        partnerId: String(s.promoterId || PARTNER_ID),
        dayKey: String(s.dayKey || osloDayKey(start)),
        start,
        end,
      });
    }
    shows = next;
    byEvent = new Map(next.map((s) => [s.eventId, s]));
    programAt = String(raw.updatedAt || "");
    programMtime = mtime;
    console.log(`program: ${next.length} showings with DX events (${programAt})`);
  } catch (err) {
    console.warn("program.json unreadable", err);
  }
}

/* —— Windows ——————————————————————————————————————————————————————— */

/** The show's end as DX last told us, falling back to the snapshot. */
function endOf(show: Show) {
  const live = parseLocal(events.get(show.eventId)?.data?.end);
  return live ?? show.end;
}

function startOf(show: Show) {
  const live = parseLocal(events.get(show.eventId)?.data?.begin);
  return live ?? show.start;
}

function inDoor(show: Show, now: number) {
  return now >= startOf(show) - DOOR_BEFORE_MS &&
    now <= endOf(show) + DOOR_AFTER_MS;
}

function inActive(show: Show, now: number) {
  return now >= startOf(show) - ACTIVE_LEAD_MS &&
    now <= endOf(show) + DOOR_AFTER_MS;
}

function isFinal(show: Show | undefined, now: number) {
  // A showing the snapshot no longer lists is history older than it.
  if (!show) return true;
  return now > endOf(show) + FINAL_AFTER_MS;
}

/** How old a seat chart (and with it the check-in count) may get. */
function seatsFreshMs(show: Show | undefined, now: number) {
  if (!show) return 30 * MIN;
  if (inDoor(show, now)) return 6 * SEC;
  if (isFinal(show, now)) return Infinity;
  if (inActive(show, now) || now > endOf(show)) return 30 * SEC;
  if (show.dayKey === osloDayKey(now)) return MIN;
  if (startOf(show) - now < 2 * DAY) return 3 * MIN;
  return 10 * MIN;
}

/** How old a public sold count may get. */
function eventFreshMs(show: Show, now: number) {
  if (inActive(show, now)) return 6 * SEC;
  if (show.dayKey === osloDayKey(now)) return 30 * SEC;
  return 2 * MIN;
}

/* —— DX calls —————————————————————————————————————————————————————— */

/** Run the bridge in-process, carrying the shared session. */
async function callBridge(body: Record<string, unknown>) {
  health.dxCalls++;
  const res = await dxHandler(
    new Request("http://bridge.local/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(dxToken ? { token: dxToken } : {}) }),
    }),
  );
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (typeof data.token === "string" && data.token) {
    dxToken = data.token;
    dirty = true;
  }
  if (res.ok) {
    health.lastDxOk = Date.now();
  } else {
    health.lastDxError = String(data.error || `HTTP ${res.status}`);
    health.lastDxErrorAt = Date.now();
    // A session the bridge could not heal is worth forgetting.
    if (res.status === 401) dxToken = "";
  }
  return { status: res.status, ok: res.ok, data };
}

/** Never hand the shared DX session (or the bridge's log) to a browser. */
function publicSeatAnswer(data: Record<string, unknown>) {
  const { token: _t, log: _l, layout: _layout, ...rest } = data;
  return rest;
}

function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = run().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function layoutKey(partnerId: string, locationId: unknown) {
  return `${partnerId}:${locationId}`;
}

function needsLayout(partnerId: string, eventId: string, now: number) {
  const hall = halls.get(eventId);
  if (!hall) return true;
  const entry = layouts.get(layoutKey(partnerId, hall));
  return !entry || now - entry.at > LAYOUT_TTL_MS;
}

/** One seat chart from DX, stored, and its counts with it. */
function fetchSeatChart(partnerId: string, eventId: string) {
  return once(`seats:${eventId}`, async () => {
    const now = Date.now();
    const { status, ok, data } = await callBridge({
      action: "seats",
      partnerId,
      eventId,
      withLayout: needsLayout(partnerId, eventId, now),
    });
    if (!ok) {
      const err = new Error(String(data.error || `bridge ${status}`)) as
        & Error
        & { status?: number };
      err.status = status;
      throw err;
    }
    const at = Date.now();
    if (data.locationId != null) {
      halls.set(eventId, String(data.locationId));
      if (data.layout) {
        layouts.set(layoutKey(partnerId, data.locationId), {
          at,
          layout: data.layout,
        });
        dirty = true;
      }
    }
    const clean = publicSeatAnswer(data);
    seats.set(eventId, { at, data: clean });
    if (typeof data.scanned === "number" && typeof data.sold === "number") {
      rememberCount(eventId, data.scanned, data.sold, at);
    }
    return clean;
  });
}

function rememberCount(eventId: string, scanned: number, sold: number, at: number) {
  const final = isFinal(byEvent.get(eventId), at);
  const prev = counts.get(eventId);
  counts.set(eventId, { at, scanned, sold, final });
  if (final && (!prev?.final || prev.scanned !== scanned || prev.sold !== sold)) {
    dirty = true;
  }
}

/** The public event: sold, capacity, real start and end. No session needed. */
function fetchEvent(show: Show) {
  return once(`event:${show.eventId}`, async () => {
    health.eventCalls++;
    const res = await fetch(
      `${DX_API}/partners/${show.partnerId}/events/${show.eventId}`,
      { headers: { Accept: "application/json" } },
    );
    const at = Date.now();
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel();
      events.set(show.eventId, { at, status: "gone" });
      return;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`DX event ${res.status}`);
    }
    const event = await res.json();
    const sale = event.ticketSale || {};
    events.set(show.eventId, {
      at,
      status: "ok",
      data: {
        sold: Number(sale.sold) || 0,
        reserved: Number(sale.reserved) || 0,
        capacity: Number(sale.capacity) || null,
        available: sale.available != null ? Number(sale.available) : null,
        begin: typeof event.begin === "string" ? event.begin : null,
        end: typeof event.end === "string" ? event.end : null,
        screen: event.locationName
          ? String(event.locationName).replace(/\s*-\s*Kino$/i, "").trim()
          : null,
      },
    });
  });
}

/* —— The prefetch loop ————————————————————————————————————————————— */

/** Most overdue first; a chart never fetched counts as very overdue. */
function overdue(at: number | undefined, freshMs: number, now: number) {
  if (!at) return Infinity;
  return (now - at) / freshMs;
}

function tick() {
  const now = Date.now();
  readProgram().catch(() => {});

  // Seat charts (and check-ins with them).
  if (seatBusy < SEAT_SLOTS) {
    const due: Array<{ show: Show; score: number }> = [];
    for (const show of shows) {
      if (startOf(show) > now + SEATS_AHEAD_MS) continue;
      if (endOf(show) < now - SEATS_BEHIND_MS) continue;
      if (events.get(show.eventId)?.status === "gone") continue;
      // Free seating has no chart, but the same answer carries its
      // check-in count, so it rides the same schedule.
      const entry = seats.get(show.eventId);
      const fresh = seatsFreshMs(show, now);
      if (entry && (fresh === Infinity || now - entry.at < fresh)) continue;
      if (inFlight.has(`seats:${show.eventId}`)) continue;
      due.push({ show, score: overdue(entry?.at, fresh, now) });
    }
    due.sort((a, b) => b.score - a.score || a.show.start - b.show.start);
    for (const { show } of due.slice(0, SEAT_SLOTS - seatBusy)) {
      seatBusy++;
      fetchSeatChart(show.partnerId, show.eventId)
        .catch((err) => {
          // Back off: stamp a failed read so it waits its turn again.
          const prev = seats.get(show.eventId);
          if (!prev) seats.set(show.eventId, { at: Date.now(), data: { error: true } });
          if (err?.status !== 401) console.warn(`seats ${show.eventId}: ${err?.message || err}`);
        })
        .finally(() => seatBusy--);
    }
  }

  backfillHistory(now);

  // Public sold counts for the whole programme still to come.
  if (eventBusy < EVENT_SLOTS) {
    const due: Array<{ show: Show; score: number }> = [];
    for (const show of shows) {
      if (isFinal(show, now)) continue;
      const entry = events.get(show.eventId);
      if (entry?.status === "gone") continue;
      const fresh = eventFreshMs(show, now);
      if (entry && now - entry.at < fresh) continue;
      if (inFlight.has(`event:${show.eventId}`)) continue;
      due.push({ show, score: overdue(entry?.at, fresh, now) });
    }
    due.sort((a, b) => b.score - a.score || a.show.start - b.show.start);
    for (const { show } of due.slice(0, EVENT_SLOTS - eventBusy)) {
      eventBusy++;
      fetchEvent(show)
        .catch((err) => {
          const prev = events.get(show.eventId);
          events.set(show.eventId, { ...(prev || { status: "ok" }), at: Date.now() });
          console.warn(`event ${show.eventId}: ${err?.message || err}`);
        })
        .finally(() => eventBusy--);
    }
  }
}

/**
 * Check-in history: every past showing in the snapshot gets its final
 * count once, a batch at a time while nothing more urgent is running,
 * so a phone opening the app for the first time finds the whole history
 * in /api/live instead of asking for it twelve showings at a time.
 */
const HISTORY_BATCH = 12;
const HISTORY_EVERY_MS = 10 * SEC;
let historyAt = 0;

function backfillHistory(now: number) {
  if (now - historyAt < HISTORY_EVERY_MS || seatBusy > 0) return;
  if (inFlight.has("history")) return;
  const missing = shows.filter((s) =>
    isFinal(s, now) && !counts.has(s.eventId) &&
    events.get(s.eventId)?.status !== "gone"
  );
  if (!missing.length) return;
  historyAt = now;
  const batch = missing.slice(-HISTORY_BATCH);
  const partnerId = batch[0].partnerId;
  once("history", async () => {
    const ids = batch.filter((s) => s.partnerId === partnerId).map((s) => s.eventId);
    const { ok, data } = await callBridge({ action: "scanned", partnerId, eventIds: ids });
    if (!ok) return;
    const got = (data.counts || {}) as Record<string, { scanned: number; sold: number }>;
    const at = Date.now();
    for (const id of ids) {
      const c = got[id];
      if (c && typeof c.scanned === "number") {
        rememberCount(id, c.scanned, c.sold, at);
      } else {
        // Nothing to show, but not worth asking about again either.
        counts.set(id, { at, scanned: 0, sold: 0, final: true, none: true });
        dirty = true;
      }
    }
  }).catch((err) => console.warn(`history: ${err?.message || err}`));
}

/* —— Persistence ——————————————————————————————————————————————————— */

type Persisted = {
  token?: string;
  counts?: Record<string, CountEntry>;
  layouts?: Record<string, LayoutEntry>;
  halls?: Record<string, string>;
};

async function loadState() {
  try {
    const raw = JSON.parse(
      await Deno.readTextFile(`${dataDir}/live-cache.json`),
    ) as Persisted;
    dxToken = raw.token || "";
    for (const [k, v] of Object.entries(raw.counts || {})) counts.set(k, v);
    for (const [k, v] of Object.entries(raw.layouts || {})) layouts.set(k, v);
    for (const [k, v] of Object.entries(raw.halls || {})) halls.set(k, v);
    console.log(
      `live cache: ${counts.size} counts, ${layouts.size} halls restored`,
    );
  } catch {
    // First start, or a file from an older shape: start empty.
  }
}

async function saveState() {
  if (!dirty) return;
  dirty = false;
  const finals: Record<string, CountEntry> = {};
  for (const [k, v] of counts) if (v.final) finals[k] = v;
  const body: Persisted = {
    token: dxToken,
    counts: finals,
    layouts: Object.fromEntries(layouts),
    halls: Object.fromEntries(halls),
  };
  const tmp = `${dataDir}/live-cache.json.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(body));
  await Deno.rename(tmp, `${dataDir}/live-cache.json`);
}

/* —— Public surface ———————————————————————————————————————————————— */

export async function startLive(opts: { siteDir: string; dataDir: string }) {
  siteDir = opts.siteDir;
  dataDir = opts.dataDir;
  checkTimeZone();
  await loadState();
  await readProgram();
  tick();
  setInterval(tick, TICK_MS);
  setInterval(() => saveState().catch((e) => console.warn("save failed", e)), 30 * SEC);
}

/**
 * Everything the app needs for the given days, in one answer: sold counts
 * for every showing still to come, seat charts (and with them check-ins)
 * for those days, final check-in counts for every past showing, and the
 * hall layouts the caller said it does not have yet.
 */
export function liveSnapshot(days: string[], have: Set<string>) {
  const now = Date.now();
  const wanted = new Set(days.length ? days : [osloDayKey(now)]);
  wanted.add(osloDayKey(now));

  const ev: Record<string, unknown> = {};
  for (const show of shows) {
    if (isFinal(show, now) && !wanted.has(show.dayKey)) continue;
    const entry = events.get(show.eventId);
    if (!entry || now - entry.at > LIVE_STALE_MS) continue;
    ev[show.eventId] = entry.status === "gone"
      ? { status: "gone" }
      : { status: "ok", ...entry.data };
  }

  const st: Record<string, unknown> = {};
  const needHalls = new Set<string>();
  for (const show of shows) {
    if (!wanted.has(show.dayKey)) continue;
    const entry = seats.get(show.eventId);
    if (!entry || entry.data.error) continue;
    const limit = inDoor(show, now) ? LIVE_STALE_DOOR_MS : isFinal(show, now) ? Infinity : LIVE_STALE_MS;
    if (now - entry.at > limit) continue;
    st[show.eventId] = entry.data;
    const hall = halls.get(show.eventId);
    if (hall) needHalls.add(layoutKey(show.partnerId, hall));
  }

  const sc: Record<string, { scanned: number; sold: number }> = {};
  for (const show of shows) {
    if (!isFinal(show, now)) continue;
    const c = counts.get(show.eventId);
    if (c && !c.none) sc[show.eventId] = { scanned: c.scanned, sold: c.sold };
  }

  const lay: Record<string, unknown> = {};
  for (const key of needHalls) {
    if (have.has(key)) continue;
    const entry = layouts.get(key);
    if (entry) lay[key] = entry.layout;
  }

  return { program: programAt, events: ev, seats: st, scanned: sc, layouts: lay };
}

/** The bridge's `seats` action, answered from the cache when it is fresh. */
export async function cachedSeats(body: Record<string, unknown>) {
  const partnerId = String(body.partnerId || PARTNER_ID);
  const eventId = String(body.eventId ?? "");
  if (!/^\d+$/.test(eventId)) {
    return { status: 400, data: { error: "eventId required" } };
  }
  const now = Date.now();
  const show = byEvent.get(eventId);
  let entry = seats.get(eventId);
  const fresh = seatsFreshMs(show, now);
  const usable = entry && !entry.data.error &&
    (fresh === Infinity || now - entry.at < fresh);

  if (!usable) {
    try {
      await fetchSeatChart(partnerId, eventId);
      entry = seats.get(eventId);
    } catch (err) {
      const e = err as Error & { status?: number };
      // A recent good chart beats an error while DX hiccups.
      if (!entry || entry.data.error || now - entry.at > 10 * MIN) {
        return {
          status: e.status && e.status >= 400 ? e.status : 502,
          data: { error: e.message || "DX bridge failed" },
        };
      }
    }
  }
  if (!entry) return { status: 502, data: { error: "no answer" } };

  const out: Record<string, unknown> = { ...entry.data };
  if (body.withLayout !== false) {
    const hall = halls.get(eventId);
    const layout = hall ? layouts.get(layoutKey(partnerId, hall)) : undefined;
    if (layout) out.layout = layout.layout;
  }
  return { status: 200, data: out };
}

/** The bridge's `scanned` action: cached counts, DX only for the rest. */
export async function cachedScanned(body: Record<string, unknown>) {
  const partnerId = String(body.partnerId || PARTNER_ID);
  const ids = (Array.isArray(body.eventIds) ? body.eventIds : [])
    .map((id) => String(id))
    .filter((id) => /^\d+$/.test(id))
    .slice(0, 24);
  if (!ids.length) return { status: 400, data: { error: "eventIds required" } };

  const now = Date.now();
  const out: Record<string, { scanned: number; sold: number }> = {};
  const missing: string[] = [];
  for (const id of ids) {
    const c = counts.get(id);
    const show = byEvent.get(id);
    const fresh = seatsFreshMs(show, now);
    if (c && (c.final || fresh === Infinity || now - c.at < fresh)) {
      if (!c.none) out[id] = { scanned: c.scanned, sold: c.sold };
    } else {
      missing.push(id);
    }
  }

  if (missing.length) {
    const key = `scanned:${missing.join(",")}`;
    try {
      const { status, ok, data } = await once(key, () =>
        callBridge({ action: "scanned", partnerId, eventIds: missing })
      );
      if (!ok) {
        if (!Object.keys(out).length) {
          return { status, data: { error: data.error || `bridge ${status}` } };
        }
      } else {
        const got = (data.counts || {}) as Record<
          string,
          { scanned: number; sold: number }
        >;
        const at = Date.now();
        for (const [id, c] of Object.entries(got)) {
          if (typeof c?.scanned !== "number") continue;
          rememberCount(id, c.scanned, c.sold, at);
          out[id] = { scanned: c.scanned, sold: c.sold };
        }
      }
    } catch (err) {
      if (!Object.keys(out).length) {
        return { status: 502, data: { error: String((err as Error)?.message || err) } };
      }
    }
  }
  return { status: 200, data: { counts: out, source: "t3lluz.com/CinemaInfo" } };
}

/** Diagnostics and session checks go straight to the bridge. */
export async function passThrough(body: Record<string, unknown>) {
  const { status, data } = await callBridge(body);
  const { token: _t, ...rest } = data;
  return { status, data: rest };
}

export function liveHealth() {
  const now = Date.now();
  const doorOpen = shows.filter((s) => inDoor(s, now)).length;
  return {
    program: programAt,
    showings: shows.length,
    doorsOpen: doorOpen,
    events: events.size,
    seatCharts: seats.size,
    counts: counts.size,
    halls: layouts.size,
    lastDxOk: health.lastDxOk || null,
    lastDxError: health.lastDxError || null,
    lastDxErrorAt: health.lastDxErrorAt || null,
    dxCalls: health.dxCalls,
    eventCalls: health.eventCalls,
    upSince: health.startedAt,
  };
}
