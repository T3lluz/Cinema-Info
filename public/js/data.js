/**
 * The programme and everything live about it: the snapshot, the copy
 * kept on the device, sold counts from DX's public API, check-in counts
 * through the bridge, and the rules for how often each is read.
 *
 * Nothing here draws. When a figure moves it calls `hooks.render()`,
 * and the active view decides what that means on screen.
 */
import {
  S,
  hooks,
  seatState,
  DATA_URL,
  HISTORY_KEY,
  HISTORY_KEEP_DAYS,
  DX_AUTH_KEY,
  DX_PARTNER_ID,
  DX_API,
  DX_LOGIN_PROXY,
  DX_LOGIN_ANON_KEY,
  OMDB_PROXY,
  PREVIEW_SCANNED,
  t,
  hashStr,
  toDayKey,
  parseLocalDateTime,
  formatLocalDateTime,
} from "./core.js?v=dev";

/** How many events one check-in lookup asks the bridge about at a time. */
const SCAN_BATCH = 12;

/**
 * The app's heartbeat. Every few seconds it redraws whatever the clock
 * has moved and re-reads every figure that has come due, so a screen
 * left open at the box office is never more than a beat behind the till.
 */
export const BEAT_MS = 5 * 1000;
/** A shade under the beat, so a timer firing early doesn't skip a read. */
const BEAT_FRESH_MS = 4 * 1000;
/**
 * At most this many event lookups leave on one beat, which puts a hard
 * ceiling on what the app asks of DX however much is on screen.
 */
const BEAT_MAX_EVENTS = 8;

/** Doors are busiest around the showing: guests arriving, tickets scanned. */
const DOOR_BEFORE_MS = 15 * 60 * 1000;
const DOOR_AFTER_MS = 15 * 60 * 1000;
/** Inside this lead, sold counts ride the beat whether on screen or not. */
const ACTIVE_LEAD_MS = 4 * 60 * 60 * 1000;
/** After this long past the end time a showing's numbers are final. */
const FINAL_AFTER_MS = 6 * 60 * 60 * 1000;
/** Sold counts off screen and far from their doors: a calmer cycle. */
const LIVE_CALM_MS = 2 * 60 * 1000;
/** Check-in counts and seat charts once the doors are shut. */
const DOOR_CALM_MS = 45 * 1000;
/** How long the programme snapshot is trusted before it is read again. */
export const PROGRAM_RECHECK_MS = 2 * 60 * 1000;

/* —— Busy indicator ——————————————————————————————————————————————
 * Reference-counted: the day enrich and the check-in sync overlap
 * constantly, and whichever finished first used to stop the spinner
 * while the other was still fetching.
 */
export function setBusy(on) {
  S.busy = Math.max(0, S.busy + (on ? 1 : -1));
  hooks.renderStatus();
}

export function setStatus(kind, at = Date.now()) {
  S.status = { kind, at };
  hooks.renderStatus();
}

/* —— DX bridge session token ——————————————————————————————————————
 * Optional opaque token cached on this device. The bridge can mint
 * sessions on its own from the shared credentials, so a missing token is
 * fine — and passwords are never stored in the browser.
 */
let dxAuth = loadDxAuth();

function loadDxAuth() {
  try {
    const raw = JSON.parse(localStorage.getItem(DX_AUTH_KEY) || "null");
    if (!raw || typeof raw !== "object") return { type: "dxweb" };
    // Drop legacy payloads that kept a password on the device.
    if (raw.password || raw.email) {
      localStorage.removeItem(DX_AUTH_KEY);
      return { type: "dxweb" };
    }
    if (raw.token && raw.type === "dxweb") {
      return { type: "dxweb", token: String(raw.token), partnerId: raw.partnerId };
    }
  } catch {
    /* fall through */
  }
  return { type: "dxweb" };
}

function saveDxAuth(next) {
  dxAuth = next && typeof next === "object" ? next : { type: "dxweb" };
  try {
    if (dxAuth.token) {
      localStorage.setItem(
        DX_AUTH_KEY,
        JSON.stringify({
          type: "dxweb",
          token: dxAuth.token,
          partnerId: dxAuth.partnerId || DX_PARTNER_ID,
        })
      );
    } else {
      localStorage.removeItem(DX_AUTH_KEY);
    }
  } catch {
    /* storage full — the bridge just mints a session next time */
  }
}

export function dxToken() {
  return dxAuth?.token || "";
}

export function rememberDxToken(token) {
  if (!token) return;
  saveDxAuth({
    type: "dxweb",
    token: String(token),
    partnerId: dxAuth?.partnerId || DX_PARTNER_ID,
  });
}

export function clearDxToken() {
  saveDxAuth({ type: "dxweb" });
}

export function partnerOf(show) {
  return String(show.promoterId || dxAuth?.partnerId || DX_PARTNER_ID);
}

/** Admissions are always on; the bridge signs in with the shared account. */
export function scanVisible() {
  return true;
}

/* —— History kept on the device —————————————————————————————————— */

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function serializeShow(show) {
  const { liveAt, scanTriedAt, ...rest } = show;
  return {
    ...rest,
    start: formatLocalDateTime(show.start),
    end: show.end ? formatLocalDateTime(show.end) : null,
  };
}

export function persistHistory(shows) {
  const hist = loadHistory();
  for (const show of shows) hist[show.id] = serializeShow(show);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_KEEP_DAYS);
  const cutoffKey = toDayKey(cutoff);
  for (const [id, show] of Object.entries(hist)) {
    if (!show?.dayKey || show.dayKey < cutoffKey) delete hist[id];
  }

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (err) {
    console.warn("Could not persist history", err);
  }
}

/** Forget showings for good, so a removed film cannot come back on reload. */
function forgetShows(ids) {
  const gone = ids instanceof Set ? ids : new Set(ids);
  if (!gone.size) return;
  try {
    const hist = loadHistory();
    for (const id of gone) delete hist[id];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (err) {
    console.warn("Could not forget removed shows", err);
  }
}

/**
 * Has this cached showing been taken off the programme? The snapshot
 * carries every showing Buen has programmed, history included, so
 * anything cached but missing from it is gone — as long as the snapshot
 * actually speaks for that date.
 */
function isOffProgram(show, snapshotDays, now) {
  if (show.start instanceof Date && show.start.getTime() > now) return true;
  return snapshotDays.has(show.dayKey);
}

function mergeShows(snapshotShows) {
  const byId = new Map();
  const snapshotIds = new Set(snapshotShows.map((s) => s.id));
  const snapshotDays = new Set(snapshotShows.map((s) => s.dayKey));
  const now = Date.now();
  const removed = new Set();

  for (const raw of Object.values(loadHistory())) {
    if (!raw?.id) continue;
    const cached = normalizeShow(raw);
    if (!cached.start) continue;
    if (snapshotIds.size && !snapshotIds.has(cached.id) && isOffProgram(cached, snapshotDays, now)) {
      removed.add(cached.id);
      continue;
    }
    byId.set(cached.id, cached);
  }
  forgetShows(removed);

  for (const show of snapshotShows) {
    const next = normalizeShow(show);
    if (!next.start) continue;
    const prev = byId.get(next.id);
    if (prev) {
      // Keep better live fields when the snapshot is stale or empty. A
      // sold count only grows between snapshots (refunds aside, and the
      // next live read corrects those), so the larger one is the fresher.
      if (prev.sold != null && (next.sold == null || prev.sold > next.sold)) {
        next.sold = prev.sold;
        if (prev.available != null) next.available = prev.available;
      }
      if (next.capacity == null && prev.capacity != null) {
        next.capacity = prev.capacity;
        next.available = prev.available ?? null;
        next.reserved = prev.reserved ?? null;
      }
      if (next.scanned == null && prev.scanned != null) next.scanned = prev.scanned;
      // Keep the sync bookkeeping so finished days aren't re-fetched.
      if (next.scannedAt == null && prev.scannedAt != null) next.scannedAt = prev.scannedAt;
      if (next.scanDone == null && prev.scanDone != null) next.scanDone = prev.scanDone;
      if (!next.end && prev.end) next.end = prev.end;
      // The programme API drops ticket links once a show starts; restore
      // the DX eventId so live updates keep working.
      if (!next.eventId && prev.eventId) {
        next.eventId = prev.eventId;
        next.promoterId = prev.promoterId || next.promoterId;
        if (next.eventStatus === "unavailable") next.eventStatus = "pending";
      }
      if (next.eventStatus === "pending" && prev.eventStatus === "ok") next.eventStatus = "ok";
    }
    byId.set(next.id, next);
  }

  return [...byId.values()].sort((a, b) => a.start - b.start);
}

function normalizeShow(show) {
  return {
    ...show,
    tags: cleanTags(show.tags),
    start: show.start instanceof Date ? show.start : parseLocalDateTime(show.start),
    end:
      show.end instanceof Date ? show.end : show.end ? parseLocalDateTime(show.end) : null,
  };
}

export function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => {
    const v = String(tag || "").trim().toUpperCase();
    return v && v !== "2D" && v !== "3D";
  });
}

/* —— Loading the programme ——————————————————————————————————————— */

async function loadProgramSnapshot() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${t("loadError")} (${res.status})`);
  return res.json();
}

/**
 * Read the snapshot and rebuild the programme. The screen is drawn from
 * the snapshot straight away; live numbers follow as they arrive, so the
 * app never sits on a spinner waiting for DX.
 */
export async function load({ forceLive = false, silent = false, ifChanged = false } = {}) {
  if (!silent) setBusy(true);
  try {
    let data;
    try {
      data = await loadProgramSnapshot();
    } catch (err) {
      // No network and no cached snapshot: fall back to the showings this
      // device has already seen, so a phone in a basement still opens.
      if (!S.state) {
        const shows = mergeShows([]);
        if (shows.length) {
          S.state = { updatedAt: null, shows };
          setStatus("offline");
          hooks.programChanged();
          hooks.render();
          return true;
        }
      }
      throw err;
    }
    S.lastProgramAt = Date.now();
    if (ifChanged && S.state && data.updatedAt && data.updatedAt === S.state.updatedAt) {
      return false;
    }

    S.enrichedAll = false;
    const shows = mergeShows(data.shows || []);
    persistHistory(shows);
    S.state = { updatedAt: data.updatedAt, shows };

    hooks.programChanged();
    if (S.status.kind !== "live" || Date.now() - S.lastLiveAt > 60_000) {
      setStatus("snapshot", data.updatedAt ? Date.parse(data.updatedAt) : Date.now());
    }
    applyPreviewScanned();
    hooks.render();

    if (forceLive) await refreshForTab({ force: true });
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) {
      setStatus(navigator.onLine === false ? "offline" : "error");
      if (!S.state) hooks.loadError(err?.message || t("loadError"));
    } else {
      console.warn("Program re-check failed", err);
    }
    return false;
  } finally {
    if (!silent) setBusy(false);
  }
}

/** A manual refresh: whatever the visible tab reads, read it all again now. */
export async function refreshForTab({ force = false } = {}) {
  if (!S.state?.shows) return;
  if (S.activeTab === "day") {
    await enrichVisibleDay({ force });
  } else if (S.activeTab === "movies" || S.activeTab === "stats") {
    if (await hooks.pullLive()) force = false;
    await refreshLive({ all: true, force });
    S.enrichedAll = true;
    await syncScanned({ force });
  } else {
    // Settings shows no showings, but the header chip should still say
    // "Live" here as on every other tab: read the selected day.
    await enrichVisibleDay({ force });
  }
}

/** Re-read the snapshot in the background; rebuild only when it changed. */
export function reloadProgramIfChanged() {
  if (!S.state) return Promise.resolve(false);
  return load({ forceLive: true, silent: true, ifChanged: true });
}

/* —— Programme queries ———————————————————————————————————————————— */

export function programDays() {
  return [...new Set((S.state?.shows || []).map((s) => s.dayKey))].sort();
}

export function dayShows(day) {
  return (S.state?.shows || [])
    .filter((s) => s.dayKey === day)
    .sort((a, b) => a.start - b.start);
}

export function showById(id) {
  return S.state?.shows?.find((s) => s.id === id) || null;
}

export function showEndOf(show) {
  if (show.end) return show.end;
  const mins = Number(show.runningMinutes) || 120;
  // No confirmed end time: estimate from runtime plus ads and trailers.
  return new Date(show.start.getTime() + (mins + 15) * 60_000);
}

/*
 * Ads. DX books every showing as runtime + 10 minutes from the listed
 * time, so the film itself starts ten minutes in: ads and trailers fill
 * the gap. The hall's ad loop also runs for about ten minutes before the
 * listed time while people find their seats. Neither is in the data as
 * such; both are read off DX's end time or, failing that, assumed.
 */
export const ADS_BEFORE_MIN = 10;
const ADS_AFTER_MIN = 10;

/** When the ad loop starts, ahead of the listed time. */
export function adsStartOf(show) {
  return new Date(show.start.getTime() - ADS_BEFORE_MIN * 60_000);
}

/** When the film itself starts: DX's end minus the runtime, if that adds up. */
export function filmStartOf(show) {
  const mins = Number(show.runningMinutes);
  if (show.end && mins > 0) {
    const lead = show.end.getTime() - mins * 60_000 - show.start.getTime();
    if (lead >= 0 && lead <= 30 * 60_000) return new Date(show.start.getTime() + lead);
  }
  return new Date(show.start.getTime() + ADS_AFTER_MIN * 60_000);
}

/**
 * Minutes staff have to turn a hall around: from the end of `prev` to
 * the ads starting for `show` in the same hall. Null across halls.
 */
export function turnaroundMin(prev, show) {
  if (!prev || !show || prev.screen !== show.screen) return null;
  return Math.round((adsStartOf(show) - showEndOf(prev)) / 60_000);
}

/** Under this, a turnaround is flagged as tight. */
export const TIGHT_TURNAROUND_MIN = 15;

export function statusOf(show, now = new Date()) {
  if (show.end && now >= show.start && now < show.end) return "live";
  if (!show.end && now >= show.start && now - show.start < 3 * 60 * 60_000) return "live";
  if (show.end && now >= show.end) return "done";
  if (show.start > now && show.start - now <= 45 * 60_000) return "soon";
  if (show.start <= now) return "done";
  return "upcoming";
}

export function isDone(show, now = new Date()) {
  return statusOf(show, now) === "done";
}

export function doneProgress(shows, now = new Date()) {
  const total = shows.length;
  const done = shows.reduce((n, s) => n + (isDone(s, now) ? 1 : 0), 0);
  return { done, total, all: total > 0 && done === total };
}

export function soldOf(show) {
  return show.sold != null && show.eventStatus !== "error" ? Number(show.sold) || 0 : 0;
}

/**
 * Best-effort spoken language from Buen's version tags. Norwegian-dubbed
 * shows are tagged "Norsk tale"; English-language shows run in original
 * version ("Original tale") and/or with Norwegian subtitles ("Norsk tekst").
 */
export function spokenLanguage(tags) {
  if (!Array.isArray(tags)) return "";
  const values = tags.map((tag) => String(tag || "").trim().toLowerCase());
  if (values.some((v) => v.includes("norsk tale"))) return "nb";
  if (values.some((v) => v.includes("engelsk"))) return "en";
  if (values.some((v) => v.includes("original tale") || v.includes("norsk tekst"))) return "en";
  return "";
}

/** "12 år" stays Norwegian; in English it reads "12+" / "All ages". */
export function formatAge(age) {
  if (!age) return "";
  if (S.lang !== "en") return age;
  const years = String(age).match(/\d+/)?.[0];
  if (years) return `${years}+`;
  return /alle/i.test(age) ? t("ageAll") : age;
}

const GENRE_NB = {
  action: "Action",
  adventure: "Eventyr",
  animation: "Animasjon",
  biography: "Biografi",
  comedy: "Komedie",
  crime: "Krim",
  documentary: "Dokumentar",
  drama: "Drama",
  family: "Familie",
  fantasy: "Fantasi",
  "film-noir": "Film noir",
  history: "Historie",
  horror: "Skrekk",
  music: "Musikk",
  musical: "Musikal",
  mystery: "Mysterie",
  romance: "Romantikk",
  "sci-fi": "Sci-fi",
  short: "Kortfilm",
  sport: "Sport",
  thriller: "Thriller",
  war: "Krig",
  western: "Western",
};

/** Genres are stored in English (IMDb); Norwegian when the app is. */
export function formatGenre(genre) {
  const label = String(genre || "").trim();
  if (!label || S.lang !== "nb") return label;
  return GENRE_NB[label.toLowerCase()] || label;
}

const RATING_KEYS = ["imdb", "letterboxd", "tomatoes", "metacritic"];

/** Merge rating sources; later parts win only for keys they carry. */
export function mergeRatingSources(...parts) {
  const out = {};
  for (const ratings of parts) {
    if (!ratings || typeof ratings !== "object") continue;
    for (const key of RATING_KEYS) {
      if (ratings[key] != null) out[key] = ratings[key];
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Every film in the programme with its showings, films with something
 * left to play first (soonest at the top), finished runs underneath.
 */
export function groupMovies() {
  const map = new Map();
  for (const show of S.state?.shows || []) {
    const key = show.title;
    if (!map.has(key)) {
      map.set(key, {
        title: show.title,
        posterUrl: show.posterUrl,
        age: show.age,
        runningLabel: show.runningLabel,
        runningMinutes: show.runningMinutes,
        tags: show.tags || [],
        genres: show.genres || null,
        director: show.director || null,
        ratings: show.ratings || null,
        premiere: show.premiere || null,
        showType: show.showType || null,
        kinoklubb: Boolean(show.kinoklubb),
        shows: [],
      });
    }
    const movie = map.get(key);
    movie.shows.push(show);
    if (!movie.posterUrl && show.posterUrl) movie.posterUrl = show.posterUrl;
    if (!movie.genres && show.genres) movie.genres = show.genres;
    if (!movie.director && show.director) movie.director = show.director;
    if (!movie.premiere && show.premiere) movie.premiere = show.premiere;
    if (!movie.showType && show.showType) movie.showType = show.showType;
    if (!movie.age && show.age) movie.age = show.age;
    if (show.kinoklubb) movie.kinoklubb = true;
    // Per-source merge — a history row with only Letterboxd must not
    // block a later row's IMDb.
    if (show.ratings) movie.ratings = mergeRatingSources(movie.ratings, show.ratings);
  }

  const now = new Date();
  return [...map.values()]
    .map((m) => {
      m.shows.sort((a, b) => a.start - b.start);
      m.soldSum = m.shows.reduce((n, s) => n + soldOf(s), 0);
      m.next = m.shows.find((s) => !isDone(s, now)) || null;
      m.last = m.shows[m.shows.length - 1] || null;
      m.upcomingCount = m.shows.filter((s) => !isDone(s, now)).length;
      m.allDone = !m.next;
      m.started = m.shows.some((s) => s.start <= now);
      m.imdbID = String(m.ratings?.imdb?.id || "").trim();
      m.anchor = (m.next || m.last)?.start?.getTime() ?? 0;
      return m;
    })
    .sort((a, b) => {
      if (a.allDone !== b.allDone) return a.allDone ? 1 : -1;
      if (a.anchor !== b.anchor) return a.allDone ? b.anchor - a.anchor : a.anchor - b.anchor;
      return a.title.localeCompare(b.title, S.lang === "en" ? "en" : "nb");
    });
}

export function movieByTitle(title) {
  return groupMovies().find((m) => m.title === title) || null;
}

export function movieByImdb(imdbID) {
  const id = String(imdbID || "").trim();
  if (!id) return null;
  return groupMovies().find((m) => m.imdbID === id) || null;
}

/* —— Admissions ——————————————————————————————————————————————————
 * The check-in picture for one show: how many of the sold tickets have
 * been scanned, and what someone working the door needs to read off it.
 *
 *  complete — every sold ticket is scanned
 *  partial  — people are still coming in, `missing` are outstanding
 *  none     — doors are open but nobody has scanned yet
 *  unknown  — DX is connected but hasn't given a number for this show
 *
 * Null when there is nothing to say (show hours away, nothing sold).
 */
export function admissionOf(show, now = new Date(), { gaps = false } = {}) {
  if (!scanVisible() || show.sold == null) return null;

  const sold = Number(show.sold) || 0;
  const scanned = show.scanned == null ? null : Math.max(0, Number(show.scanned) || 0);
  const status = statusOf(show, now);
  const open = status !== "upcoming";
  const over = status === "done";

  if (scanned == null) {
    if (!open || !sold) return null;
    if (!gaps && status !== "live" && status !== "soon") return null;
    return { state: "unknown", scanned: null, sold, missing: null, pct: 0, over };
  }
  if (!sold) {
    if (!scanned) return null;
    return { state: "complete", scanned, sold: scanned, missing: 0, pct: 100, over };
  }

  const missing = Math.max(sold - scanned, 0);
  const pct = Math.min(Math.round((scanned / sold) * 100), 100);
  const state = scanned >= sold ? "complete" : scanned > 0 ? "partial" : "none";
  if (state === "none" && !open) return null;
  return { state, scanned, sold, missing, pct, over };
}

export function admissionLabel(admission) {
  if (admission.state === "unknown") return t("admitUnknown");
  if (admission.state === "complete") return t("admitAllIn");
  if (admission.state === "none") return admission.over ? t("admitNobodyCame") : t("admitNone");
  return t(admission.over ? "admitNoShow" : "admitMissing", { n: admission.missing });
}

/**
 * Fill example scanned / reserved counts so the UI can be reviewed
 * without live DX check-in data (`?previewScanned=1`).
 */
export function applyPreviewScanned() {
  if (!PREVIEW_SCANNED || !S.state?.shows) return false;
  const now = new Date();
  let changed = false;
  for (const show of S.state.shows) {
    if (show.sold == null) continue;
    const sold = Number(show.sold) || 0;
    const status = statusOf(show, now);
    const jitter = (hashStr(show.id) % 13) / 100;
    let ratio = 0.08;
    if (status === "done") ratio = 0.78 + jitter;
    else if (status === "live") ratio = 0.42 + jitter;
    else if (status === "soon") ratio = 0.12 + jitter / 2;
    const next = Math.min(sold, Math.max(0, Math.round(sold * ratio)));
    if (show.scanned !== next) {
      show.scanned = next;
      changed = true;
    }
    if (!(Number(show.reserved) > 0) && sold > 0) {
      const room = Math.max((Number(show.capacity) || 0) - sold, 0);
      const holds = Math.min(room, 2 + (hashStr(show.id) % 4));
      if (holds > 0) {
        show.reserved = holds;
        changed = true;
      }
    }
  }
  return changed;
}

/* —— Live windows ———————————————————————————————————————————————— */

/** Doors open: from a little before the start until a little after the end. */
export function inDoorWindow(show, now = Date.now()) {
  if (!show?.start) return false;
  return (
    now >= show.start.getTime() - DOOR_BEFORE_MS &&
    now <= showEndOf(show).getTime() + DOOR_AFTER_MS
  );
}

/** Is anything about this showing still moving — sales, or the door? */
function inActiveWindow(show, now = Date.now()) {
  if (!show?.start) return false;
  return (
    now >= show.start.getTime() - ACTIVE_LEAD_MS &&
    now <= showEndOf(show).getTime() + DOOR_AFTER_MS
  );
}

/** How stale a check-in count or seat chart may get before re-reading. */
export function doorFreshMs(show, now = Date.now()) {
  return inDoorWindow(show, now) ? BEAT_FRESH_MS : DOOR_CALM_MS;
}

/** Which of the elements carrying `data-<key>` are inside the viewport. */
export function idsOnScreen(selector, key) {
  const ids = new Set();
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  for (const el of document.querySelectorAll(selector)) {
    const box = el.getBoundingClientRect();
    if (!box.width && !box.height) continue;
    if (box.bottom > 0 && box.top < vh && box.right > 0 && box.left < vw) {
      ids.add(el.dataset[key]);
    }
  }
  return ids;
}

function showsOnScreen() {
  return idsOnScreen("[data-show]", "show");
}

/* —— Sold counts (public DX API) —————————————————————————————————— */

/**
 * Every showing on the day the visitor just opened, at once and without
 * the beat's cap — switching day should land on real numbers.
 */
export async function enrichVisibleDay({ force = false } = {}) {
  if (!S.state?.shows || !S.selectedDay) return;
  // The server has usually read the whole day already. Its answer stamps
  // what it covered, and the passes below fetch only what it did not.
  if (await hooks.pullLive()) force = false;
  const list = S.state.shows.filter((s) => s.dayKey === S.selectedDay && s.eventId);
  if (!list.length) return;
  await refreshLive({ shows: list, all: true, force });
  // Check-in numbers are their own pass: the visible day first, then
  // everything else in the background.
  await syncScanned({ shows: list, force });
  syncScanned().catch((err) => console.warn("Scan sync failed", err));
}

/**
 * Movies and Stats read the whole programme, so their first visit fills
 * in every showing the beat has not reached yet — in the background, the
 * view is already drawn from the snapshot.
 */
let enrichAllRun = null;
export function ensureAllEnriched() {
  if (S.enrichedAll || !S.state?.shows) return Promise.resolve();
  if (enrichAllRun) return enrichAllRun;
  enrichAllRun = (async () => {
    try {
      await refreshLive({ all: true, quiet: true });
      S.enrichedAll = true;
      await syncScanned({ quiet: true });
    } finally {
      enrichAllRun = null;
      hooks.render();
    }
  })();
  hooks.render();
  return enrichAllRun;
}

export function isEnrichingAll() {
  return Boolean(enrichAllRun);
}

function shouldFetchLive(show, now, onScreen, force) {
  if (!show.eventId) return false;
  if (show.eventStatus === "gone") return false;
  if (force) return true;
  if (show.start && now - showEndOf(show).getTime() > FINAL_AFTER_MS) {
    // Long over: history. Only a showing DX never answered for is worth
    // another look, and even that one can wait for the calm cycle.
    if (show.sold != null) return false;
    return !show.liveAt || now - show.liveAt >= LIVE_CALM_MS;
  }
  if (!show.liveAt) return true;
  return now - show.liveAt >= liveFreshMs(show, now, onScreen);
}

function liveFreshMs(show, now, onScreen) {
  if (onScreen?.has(show.id)) return BEAT_FRESH_MS;
  if (inActiveWindow(show, now)) return BEAT_FRESH_MS;
  return LIVE_CALM_MS;
}

/** Showings being read right now, so overlapping passes never double up. */
const liveInFlight = new Set();

/**
 * Read the showings whose sold counts have come due, the ones on screen
 * and the stalest first. A plain beat takes at most `BEAT_MAX_EVENTS`;
 * `all` lifts that cap for the passes a visitor is waiting on.
 */
export async function refreshLive({ shows, force = false, all = false, quiet = false } = {}) {
  if (!S.state?.shows) return false;

  const now = Date.now();
  const onScreen = showsOnScreen();
  const due = (shows || S.state.shows)
    .filter((s) => !liveInFlight.has(s.id) && shouldFetchLive(s, now, onScreen, force))
    .map((show) => ({ show, freshMs: liveFreshMs(show, now, onScreen) }))
    .sort((a, b) => a.freshMs - b.freshMs || (a.show.liveAt || 0) - (b.show.liveAt || 0))
    .map((row) => row.show);
  if (!due.length) return false;

  const targets = all || force ? due : due.slice(0, BEAT_MAX_EVENTS);
  for (const show of targets) liveInFlight.add(show.id);
  if (!quiet) setBusy(true);
  let changed = false;
  let anyOk = false;

  try {
    const batchSize = 8;
    for (let i = 0; i < targets.length; i += batchSize) {
      const results = await Promise.all(targets.slice(i, i + batchSize).map(enrichOne));
      for (const r of results) {
        if (r.moved) changed = true;
        if (r.ok) anyOk = true;
      }
    }

    const removed = dropRemovedShows();
    if (removed.size) changed = true;
    // Storing the history means rewriting the lot; only when it moved.
    if (changed) persistHistory(targets.filter((s) => !removed.has(s.id)));
    if (anyOk) {
      S.lastLiveAt = Date.now();
      setStatus("live");
    } else if (navigator.onLine === false) {
      setStatus("offline");
    }
    applyPreviewScanned();
  } finally {
    for (const show of targets) liveInFlight.delete(show.id);
    if (!quiet) setBusy(false);
  }

  if (changed) hooks.render();
  return changed;
}

async function fetchDxEvent(show) {
  const promoterId = show.promoterId || DX_PARTNER_ID;
  const res = await fetch(`${DX_API}/partners/${promoterId}/events/${show.eventId}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const err = new Error(`DX ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Put one event's figures on a showing, whether this device read DX
 * itself or the server did (`server/live.ts` sends the same fields).
 * True when anything a card shows has moved.
 */
function applyEventFigures(show, f) {
  const before = liveFigures(show);
  if (f.status === "gone") {
    show.eventStatus = "gone";
    return liveFigures(show) !== before;
  }
  const begin = parseLocalDateTime(f.begin);
  const end = parseLocalDateTime(f.end);
  if (begin) show.start = begin;
  if (end) show.end = end;
  show.sold = Number(f.sold) || 0;
  show.reserved = Number(f.reserved) || 0;
  show.capacity = Number(f.capacity) || null;
  show.available = f.available != null ? Number(f.available) : null;
  if (f.screen) show.screen = f.screen;
  show.eventStatus = "ok";
  return liveFigures(show) !== before;
}

/** Read one showing from DX. */
async function enrichOne(show) {
  try {
    const event = await fetchDxEvent(show);
    const sale = event.ticketSale || {};
    const moved = applyEventFigures(show, {
      sold: sale.sold,
      reserved: sale.reserved,
      capacity: sale.capacity,
      available: sale.available,
      begin: event.begin,
      end: event.end,
      screen: event.locationName
        ? String(event.locationName).replace(/\s*-\s*Kino$/i, "").trim()
        : "",
    });
    return { moved, ok: true };
  } catch (err) {
    // A deleted event means the showing has left the programme; a
    // network hiccup means nothing, so only DX's own 404 counts.
    if (err.status === 404 || err.status === 410) {
      const gone = show.eventStatus !== "gone";
      show.eventStatus = "gone";
      return { moved: gone, ok: true };
    }
    console.warn("Live event fetch failed", show.eventId, err);
    if (show.sold == null) show.eventStatus = "error";
    return { moved: false, ok: false };
  } finally {
    // Stamped whatever DX answered, so an event it cannot answer for
    // backs off with the rest instead of being retried every beat.
    show.liveAt = Date.now();
  }
}

function liveFigures(show) {
  return [
    show.sold,
    show.reserved,
    show.capacity,
    show.available,
    show.screen,
    show.eventStatus,
    show.start?.getTime(),
    show.end?.getTime(),
  ].join("|");
}

/**
 * The server's bulk answer (`/api/live`): sold counts for the programme
 * and final check-in counts for every past showing. Each showing it
 * covers is stamped as just read, so the beat leaves it alone and only
 * asks DX about what the server did not. Seat charts are seats.js's half.
 */
export function applyServerLive(body) {
  if (!S.state?.shows) return false;
  const now = Date.now();
  const events = body.events || {};
  const scanned = body.scanned || {};
  const touched = [];

  for (const show of S.state.shows) {
    if (!show.eventId) continue;
    const id = String(show.eventId);
    const ev = events[id];
    if (ev) {
      if (applyEventFigures(show, ev)) touched.push(show);
      show.liveAt = now;
    }
    const count = scanned[id];
    if (count && typeof count.scanned === "number") {
      if (
        show.scanned !== count.scanned ||
        (typeof count.sold === "number" && show.sold !== count.sold)
      ) {
        show.scanned = count.scanned;
        if (typeof count.sold === "number") show.sold = count.sold;
        touched.push(show);
      }
      show.scannedAt = now;
      show.scanDone = true;
    }
  }

  const removed = dropRemovedShows();
  if (touched.length) persistHistory(touched.filter((s) => !removed.has(s.id)));
  if (Object.keys(events).length) {
    S.lastLiveAt = now;
    setStatus("live");
  }
  applyPreviewScanned();
  return touched.length > 0 || removed.size > 0;
}

/**
 * Take showings DX has deleted out of the app. One that already started
 * stays — it played — but one still to come is simply not happening.
 */
function dropRemovedShows() {
  const empty = new Set();
  if (!S.state?.shows) return empty;
  const now = Date.now();
  const removed = S.state.shows.filter(
    (s) => s.eventStatus === "gone" && s.start instanceof Date && s.start.getTime() > now
  );
  if (!removed.length) return empty;

  const ids = new Set(removed.map((s) => s.id));
  const daysBefore = new Set(S.state.shows.map((s) => s.dayKey));
  S.state.shows = S.state.shows.filter((s) => !ids.has(s.id));
  forgetShows(ids);
  for (const show of removed) {
    seatState.charts.delete(String(show.eventId));
    seatState.open.delete(show.id);
  }
  const daysAfter = new Set(S.state.shows.map((s) => s.dayKey));
  if (daysBefore.size !== daysAfter.size) hooks.programChanged();
  return ids;
}

/* —— Check-in counts (bridge) ——————————————————————————————————— */

export function dxError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * A non-ok reply from the bridge, tagged with what the caller can do
 * about it. 402/404/5xx is the host itself being down — retrying never
 * clears it, so it is reported as a flat outage rather than a hiccup.
 */
export function bridgeFailure(status, data) {
  const down = status === 402 || status === 404 || status >= 500;
  const why = data.error || data.message || `bridge ${status}`;
  return dxError(why, down ? "down" : "bridge");
}

/** POST to the DX bridge. Never throws on HTTP status — callers decide. */
export async function callDxProxy(body) {
  let res;
  try {
    res = await fetch(DX_LOGIN_PROXY, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${DX_LOGIN_ANON_KEY}`,
        apikey: DX_LOGIN_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw dxError("DX bridge unreachable", "network");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, ok: res.ok, data };
}

/** Check-in counts for a batch of events, as `{ eventId: {scanned, sold} }`. */
async function fetchScannedCounts(partnerId, eventIds, { retry = true } = {}) {
  if (!eventIds.length) return null;
  const payload = { action: "scanned", partnerId, eventIds };
  if (dxToken()) payload.token = dxToken();

  const { status, ok, data } = await callDxProxy(payload);
  if (status === 401 || status === 403) {
    if (retry) {
      clearDxToken();
      return fetchScannedCounts(partnerId, eventIds, { retry: false });
    }
    throw dxError(data.error || "DX session expired", "auth");
  }
  if (!ok) {
    S.dxScanStatus.error = bridgeFailure(status, data).message;
    return null;
  }
  if (data.token) rememberDxToken(data.token);
  if (data.source) S.dxScanStatus.source = data.source;
  S.dxScanStatus.error = "";
  return data.counts || {};
}

/**
 * Should this show's check-in count be fetched right now? A show whose
 * count was never fetched always qualifies, however old — a worker looks
 * back to see whether everyone got in. Once it is well over, it is final.
 */
function shouldFetchScan(show, now, force) {
  if (!show.eventId || !show.start) return false;
  if (show.start.getTime() - now > ACTIVE_LEAD_MS) return false;
  if (show.eventStatus === "ok" && show.sold === 0) return false;
  if (force) return true;
  if (show.scanDone) return false;
  if (!show.scannedAt) {
    return !show.scanTriedAt || now - show.scanTriedAt >= doorFreshMs(show, now);
  }
  if (now - showEndOf(show).getTime() > FINAL_AFTER_MS) return show.scanned == null;
  return now - show.scannedAt >= doorFreshMs(show, now);
}

let scanSyncRunning = false;

/** Fetch check-in counts for every show that needs one, across all days. */
export async function syncScanned({ shows, force = false, quiet = false } = {}) {
  if (!S.state?.shows) return false;
  if (scanSyncRunning && !force) return false;

  const now = Date.now();
  const targets = (shows || S.state.shows).filter((s) => shouldFetchScan(s, now, force));
  if (!targets.length) return false;

  scanSyncRunning = true;
  if (!quiet) setBusy(true);
  let changed = false;
  let settled = false;
  let fetched = 0;
  let lastError = "";
  let expired = false;

  try {
    for (const [partnerId, list] of groupByPartner(targets)) {
      for (let i = 0; i < list.length && !expired; i += SCAN_BATCH) {
        const chunk = list.slice(i, i + SCAN_BATCH);
        let counts = null;
        try {
          counts = await fetchScannedCounts(partnerId, chunk.map((s) => String(s.eventId)));
        } catch (err) {
          if (err?.code === "auth") {
            expired = true;
            lastError = "auth";
            break;
          }
          lastError = String(err?.message || err);
          for (const show of chunk) show.scanTriedAt = Date.now();
          continue;
        }
        if (!counts) {
          for (const show of chunk) show.scanTriedAt = Date.now();
          continue;
        }

        for (const show of chunk) {
          show.scannedAt = Date.now();
          const count = counts[String(show.eventId)];
          if (count && typeof count.scanned === "number") {
            fetched += 1;
            if (show.scanned !== count.scanned) {
              show.scanned = count.scanned;
              changed = true;
            }
            // DX counts tickets net of refunds; trust it over a stale sold.
            if (typeof count.sold === "number" && show.sold !== count.sold) {
              show.sold = count.sold;
              changed = true;
            }
          }
          if (!show.scanDone && Date.now() - showEndOf(show).getTime() > FINAL_AFTER_MS) {
            show.scanDone = true;
            settled = true;
          }
        }
      }
    }

    if (expired) {
      console.warn("DX bridge session failed — will retry on next beat");
      clearDxToken();
    }
    S.dxScanStatus = {
      at: fetched ? Date.now() : S.dxScanStatus.at,
      source: S.dxScanStatus.source,
      error: expired ? lastError || "auth" : fetched ? "" : lastError || S.dxScanStatus.error,
    };
    if (changed || settled) persistHistory(targets);
  } finally {
    scanSyncRunning = false;
    if (!quiet) setBusy(false);
  }

  if (changed) hooks.render();
  return changed;
}

function groupByPartner(shows) {
  const byPartner = new Map();
  for (const show of shows) {
    const id = partnerOf(show);
    if (!byPartner.has(id)) byPartner.set(id, []);
    byPartner.get(id).push(show);
  }
  return byPartner;
}

/**
 * Ask the bridge about one event and report exactly what DX said, so a
 * blank admission column can be explained instead of guessed at.
 */
export async function runDxScanDiagnostics() {
  const show = diagnosticShow();
  if (!show) return { code: "noShows" };

  const payload = {
    action: "scanned",
    partnerId: partnerOf(show),
    eventIds: [String(show.eventId)],
    debug: true,
  };
  if (dxToken()) payload.token = dxToken();

  let result;
  try {
    result = await callDxProxy(payload);
  } catch (err) {
    return { code: "empty", show, details: String(err?.message || err) };
  }

  const { status, ok, data } = result;
  const lines = [
    `bridge → HTTP ${status}`,
    ...(Array.isArray(data.log) ? data.log : []),
    ...(data.error ? [`error: ${data.error}`] : []),
  ];

  if (status === 401 || status === 403) {
    clearDxToken();
    return { code: "auth", show, details: lines.join("\n") };
  }
  if (data.token) rememberDxToken(data.token);

  const count = ok && data.counts ? data.counts[String(show.eventId)] : null;
  if (count && typeof count.scanned === "number") {
    show.scanned = count.scanned;
    show.scannedAt = Date.now();
    if (typeof count.sold === "number" && show.sold == null) show.sold = count.sold;
    persistHistory([show]);
    S.dxScanStatus = { at: Date.now(), source: data.source || S.dxScanStatus.source, error: "" };
    return { code: "ok", scanned: count.scanned, show, details: lines.join("\n") };
  }
  return { code: "empty", show, details: lines.join("\n") };
}

/** Prefer a show that has actually been let in: the most recent past one. */
function diagnosticShow() {
  const shows = (S.state?.shows || []).filter((s) => s.eventId && (s.sold ?? 0) > 0);
  if (!shows.length) return null;
  const now = Date.now();
  const past = shows.filter((s) => s.start.getTime() <= now).sort((a, b) => b.start - a.start);
  return past[0] || shows[0];
}

/** Force the next sync to revisit days already written off. */
export function resetScanDone() {
  for (const show of S.state?.shows || []) show.scanDone = false;
}

/* —— Film metadata (OMDb / IMDb bridge) ———————————————————————————— */

export async function callOmdbProxy(body, signal) {
  const res = await fetch(OMDB_PROXY, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${DX_LOGIN_ANON_KEY}`,
      apikey: DX_LOGIN_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `OMDb ${res.status}`);
    err.code = data.code || "upstream";
    throw err;
  }
  return data;
}

/** Film details by IMDb id, cached for the session. */
const titleCache = new Map();
export function fetchTitle(imdbID) {
  const id = String(imdbID || "").trim();
  if (!id) return Promise.reject(new Error("no id"));
  if (!titleCache.has(id)) {
    const p = callOmdbProxy({ action: "title", id })
      .then((data) => data?.movie || null)
      .catch((err) => {
        titleCache.delete(id);
        throw err;
      });
    titleCache.set(id, p);
  }
  return titleCache.get(id);
}
