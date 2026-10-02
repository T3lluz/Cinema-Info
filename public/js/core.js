/**
 * Shared ground for every module: the app's state, its settings keys,
 * the translator, date and number formatting, and the icon set.
 *
 * Modules never import each other in a circle. Anything that has to
 * reach "upwards" — a data refresh asking for a redraw, a stats bar
 * opening a day — goes through `hooks`, which app.js fills in at boot.
 */
import { I18N } from "./i18n.js?v=dev";

export const DATA_URL = "./data/program.json";
export const PREFS_KEY = "cinemaInfoPrefs";
export const HISTORY_KEY = "cinemaInfoHistory";
export const DX_AUTH_KEY = "cinemaInfoDxAuth";
export const SEAT_MAP_KEY = "cinemaInfoSeatMaps";
/**
 * The warning at the top of every tab (words in i18n.js, `noticeTitle`
 * and `noticeBody`). It cannot be dismissed; false takes it down.
 */
export const NOTICE_ON = true;
export const HISTORY_KEEP_DAYS = 120;
export const DX_PARTNER_ID = "202";
export const DX_API = "https://api.dx.no/v3";

/**
 * Where the two bridge functions live. Both are plain `Deno.serve`
 * handlers; `window.CINEMA_INFO_BRIDGE` (set in index.html) points them
 * at the self-hosted bridge, and the Supabase URLs are the fallback.
 * See `deploy/deno/README.md`.
 */
const BRIDGE = globalThis.CINEMA_INFO_BRIDGE || {};
export const DX_LOGIN_PROXY =
  BRIDGE.dxWebLogin ||
  "https://kypeegsbfaivyqeidnqp.supabase.co/functions/v1/dx-web-login";
export const OMDB_PROXY =
  BRIDGE.omdbLookup ||
  "https://kypeegsbfaivyqeidnqp.supabase.co/functions/v1/omdb-lookup";
/**
 * Everything live in one GET, prefetched by the server on t3lluz.com
 * (`server/live.ts`), and where staff feedback goes. Empty when the page
 * runs without the self-hosted bridge; the app then reads DX per showing.
 */
export const LIVE_URL = BRIDGE.live || "";
export const FEEDBACK_URL = BRIDGE.feedback || "";
export const DX_LOGIN_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5cGVlZ3NiZmFpdnlxZWlkbnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxODczMzQsImV4cCI6MjEwMDc2MzMzNH0.xUuL6dC8u_Nm6DqxS0y4KyjpMNlVn6IrxcvivSHeaaM";

/**
 * The release, as people read it: bump it with every change that ships
 * (major.minor.patch — a fix is a patch, a new feature a minor).
 */
export const APP_RELEASE = "2.5.0";

/** The build this page runs (the commit), stamped into the script URL on deploy. */
export const APP_VERSION =
  new URL(import.meta.url).searchParams.get("v") || "dev";

/** "2.4.0 (a1b2c3d)" — the release, and which build of it. */
export const APP_VERSION_LABEL = `${APP_RELEASE} (${APP_VERSION})`;

/** Example scanned counts for UI preview (`?previewScanned=1`). */
export const PREVIEW_SCANNED = new URLSearchParams(location.search).has(
  "previewScanned"
);

export const TAB_ORDER = ["day", "movies", "stats", "settings"];

export const DARK_MQ = window.matchMedia("(prefers-color-scheme: dark)");
/** Tablet and up has room to show every hall's seat chart unfolded. */
export const SEATS_OPEN_MQ = window.matchMedia("(min-width: 700px)");
/** Desktop: navigation moves to a rail and sheets become dialogs. */
export const WIDE_MQ = window.matchMedia("(min-width: 1024px)");
/** Big desktop screens: showings and stats spread over more columns. */
export const XL_MQ = window.matchMedia("(min-width: 1480px)");
const REDUCED_MQ = window.matchMedia("(prefers-reduced-motion: reduce)");

export function reducedMotion() {
  return REDUCED_MQ.matches;
}

/** Everything the app knows right now. One object, shared by every module. */
export const S = {
  /** @type {{ shows: any[], updatedAt?: string } | null} */
  state: null,
  selectedDay: "",
  activeTab: "day",
  lang: "nb",
  /** "light" | "dark" | "system" */
  theme: "system",
  showSeatNumbers: true,
  hapticsOn: true,
  keepAwake: false,
  /** The liquid ripple on opening and refreshing. */
  rippleOn: true,
  /** Stats tab: "week" or "month", and which one (null = current). */
  statsPeriod: "week",
  statsAnchor: null,
  enrichedAll: false,
  lastLiveAt: 0,
  lastProgramAt: 0,
  /** What the header chip says: live, snapshot, offline or error. */
  status: { kind: "loading", at: 0 },
  dxScanStatus: { at: 0, source: "", error: "" },
  busy: 0,
};

/** Seat chart state, shared by the data layer and the chart renderer.
 * `charts`: per-event `{ status, at, error, ...bridge payload }`.
 * `open`: shows whose chart was unfolded by hand. */
export const seatState = {
  charts: new Map(),
  open: new Set(),
};

/** Late-bound calls between modules; app.js assigns the real ones. */
export const hooks = {
  render() {},
  renderStatus() {},
  programChanged() {},
  loadError(_message) {},
  goToShow(_showId) {},
  goToDay(_dayKey) {},
  openMovie(_opts) {},
  setTab(_tab) {},
  applyTheme(_theme) {},
  languageChanged() {},
  applyWakeLock() {},
  /** Re-measure the pinned bars (after a tab switch). */
  headerChanged() {},
  /** "available" | "ios" | "installed" | "none" */
  installState() {
    return "none";
  },
  install() {},
  checkUpdate() {
    return Promise.resolve(false);
  },
  /** Take the server's prefetched figures; resolves true when it answered. */
  pullLive() {
    return Promise.resolve(false);
  },
};

/** DOM references, filled in by app.js once the page is parsed. */
export const els = {};

/** The header's height, status-bar inset included. */
export function barHeight() {
  return els.appbar?.offsetHeight || 0;
}

/** What is pinned to the top of the screen: the header, plus the day
 * strip under it on the day tab (zero high on the others). */
export function headerHeight() {
  return barHeight() + (els.dayDock?.offsetHeight || 0);
}

/* —— Preferences ——————————————————————————————————————————————— */

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        selectedDay: S.selectedDay,
        selectedDayAt: Date.now(),
        activeTab: S.activeTab,
        lang: S.lang,
        theme: S.theme,
        showSeatNumbers: S.showSeatNumbers,
        haptics: S.hapticsOn,
        keepAwake: S.keepAwake,
        statsPeriod: S.statsPeriod,
        ripple: S.rippleOn,
      })
    );
  } catch {
    /* private mode or full storage — preferences just won't stick */
  }
}

/* —— Language ————————————————————————————————————————————————— */

export function t(key, vars = {}) {
  const dict = I18N[S.lang] || I18N.nb;
  let str = dict[key] ?? I18N.nb[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

export function weekdays() {
  return (I18N[S.lang] || I18N.nb).weekdays;
}

export function months() {
  return (I18N[S.lang] || I18N.nb).months;
}

export function locale() {
  return S.lang === "en" ? "en-GB" : "nb-NO";
}

export function showsLabel(n) {
  return n === 1 ? t("showsOne") : t("showsMany", { n });
}

/* —— Text ————————————————————————————————————————————————————— */

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

export function hashStr(s) {
  let h = 0;
  for (const ch of String(s || "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/* —— Dates ————————————————————————————————————————————————————— */

export function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayKey() {
  return toDayKey(new Date());
}

export function dayKeyDate(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysKey(dayKey, n) {
  const date = dayKeyDate(dayKey);
  date.setDate(date.getDate() + n);
  return toDayKey(date);
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function parseLocalDateTime(value) {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || 0)
  );
}

export function formatLocalDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

export function isoWeekInfo(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return { key: `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, week };
}

/** Monday of the ISO week that holds `dayKey`. */
export function weekStartKey(dayKey) {
  const date = dayKeyDate(dayKey);
  const dow = date.getDay() || 7;
  date.setDate(date.getDate() - (dow - 1));
  return toDayKey(date);
}

/* —— Formatting ——————————————————————————————————————————————— */

export function formatClock(date) {
  return date.toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Thousands grouped for reading. nb-NO separates them with a full
 * non-breaking space, which at hero size reads as two numbers; a narrow
 * one keeps "1 274" a single figure.
 */
export function formatCount(n) {
  return Number(n || 0).toLocaleString(locale()).replaceAll("\u00A0", "\u202F");
}

/** "15 %" in Norwegian, "15%" in English. */
export function formatPct(n) {
  const v = Math.round(Number(n) || 0);
  return S.lang === "en" ? `${v}%` : `${v}\u202F%`;
}

export function formatDuration(minutes) {
  if (minutes == null) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = S.lang === "en" ? "h" : "t";
  if (h && m) return `${h}${hour} ${m}m`;
  if (h) return `${h}${hour}`;
  return `${m}m`;
}

/**
 * Running time in the short form the cards use. Buen sends it spelled
 * out ("2 t. 25 min."); trim it down, and say hours the way the chosen
 * language does.
 */
export function formatRunning(label, minutes) {
  if (!label) return formatDuration(minutes);
  const short = String(label).replace(" t. ", "t ").replace(" min.", "m");
  return S.lang === "en" ? short.replace(/(\d)t(\s|$)/, "$1h$2") : short;
}

/** "om 35 min" / "om 2 t 10 min" until a moment in the future. */
export function formatUntil(ms) {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return t("inMin", { n: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? t("inHours", { h, m }) : t("inHoursFlat", { h });
}

export function weekdayShort(dayKey) {
  return capitalize(weekdays()[dayKeyDate(dayKey).getDay()]).slice(0, 3);
}

/** "Torsdag 1. oktober" */
export function formatDayLabel(dayKey) {
  const [, m, d] = dayKey.split("-").map(Number);
  return t("dayFull", {
    weekday: capitalize(weekdays()[dayKeyDate(dayKey).getDay()]),
    d,
    month: months()[m - 1],
  });
}

/** The short name for a day: I dag / I går / I morgen, else "Lør 3.10". */
export function shortDayLabel(dayKey) {
  const diff = daysBetween(todayKey(), dayKey);
  if (diff === 0) return t("today");
  if (diff === -1) return t("yesterday");
  if (diff === 1) return t("tomorrow");
  const [, m, d] = dayKey.split("-").map(Number);
  return t("dayShort", { weekday: weekdayShort(dayKey), d, m });
}

/** How far a day is from today, said the way people say it. */
export function relativeDayLabel(dayKey) {
  const diff = daysBetween(todayKey(), dayKey);
  if (diff === 0) return t("today");
  if (diff === -1) return t("yesterday");
  if (diff === 1) return t("tomorrow");
  return diff > 0 ? t("inDays", { n: diff }) : t("daysAgo", { n: -diff });
}

/* —— Icons ————————————————————————————————————————————————————
 * Stroke glyphs on a 24×24 grid, drawn in currentColor. One idea, one
 * glyph, everywhere it appears.
 */
export const ICONS = {
  day: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/>',
  movie:
    '<path d="M4 11v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8H4Z"/><path d="m4 11-.9-2.9a2 2 0 0 1 1.3-2.5L16 2.1a2 2 0 0 1 2.5 1.3l.9 2.9L4 11Z"/><path d="m6.6 5 3.4 4.2M11.9 3.4l3.3 4.2"/>',
  stats: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-4M13 17V8M18 17v-7"/>',
  settings:
    '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ticket:
    '<path d="M3 9a3 3 0 0 0 0 6v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a3 3 0 0 0 0-6V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
  enter: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
  seats:
    '<path d="M4 4h16"/><rect x="4" y="9" width="4" height="4" rx="1"/><rect x="10" y="9" width="4" height="4" rx="1"/><rect x="16" y="9" width="4" height="4" rx="1"/><rect x="4" y="16" width="4" height="4" rx="1"/><rect x="10" y="16" width="4" height="4" rx="1"/><rect x="16" y="16" width="4" height="4" rx="1"/>',
  trophy:
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h2a2 2 0 0 1 2 2v.5a3.5 3.5 0 0 1-3.5 3.5H17M7 5H5a2 2 0 0 0-2 2v.5A3.5 3.5 0 0 0 6.5 11H7"/>',
  language:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
  haptics:
    '<rect x="8" y="4" width="8" height="16" rx="2"/><path d="m3 9 1.5 1.5L3 12l1.5 1.5L3 15M21 9l-1.5 1.5L21 12l-1.5 1.5L21 15"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  offline:
    '<path d="m2 2 20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.3-1.6M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-11.3-3.8"/><path d="M12 20h.01"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Z"/>',
  timeline: '<path d="M3 6h10M7 12h12M5 18h8"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  calendarRange:
    '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7 14h4M13 17h4"/>',
};

export function icon(name, className = "icon") {
  const body = ICONS[name];
  if (!body) return "";
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
