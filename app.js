const DATA_URL = "./data/program.json";
const PREFS_KEY = "cinemaInfoPrefs";
const HISTORY_KEY = "cinemaInfoHistory";
const DX_AUTH_KEY = "cinemaInfoDxAuth";
const SEAT_MAP_KEY = "cinemaInfoSeatMaps";
const HISTORY_KEEP_DAYS = 120;
const DX_PARTNER_ID = "202";
const DX_API = "https://api.dx.no/v3";
const DX_WEB_URL = "https://app.dx.no";
const DX_LOGIN_PROXY =
  "https://kypeegsbfaivyqeidnqp.supabase.co/functions/v1/dx-web-login";
const DX_LOGIN_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5cGVlZ3NiZmFpdnlxZWlkbnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxODczMzQsImV4cCI6MjEwMDc2MzMzNH0.xUuL6dC8u_Nm6DqxS0y4KyjpMNlVn6IrxcvivSHeaaM";

/** How many events one check-in lookup asks the bridge about at a time. */
const SCAN_BATCH = 12;

/** Nothing is scanned long before the doors open; don't poll those shows. */
const SCAN_LEAD_MS = 4 * 60 * 60 * 1000;
/** After this long past the end time a show's check-in count is final. */
const SCAN_FINAL_AFTER_MS = 6 * 60 * 60 * 1000;
/** How long a fetched count stays fresh for a show that is still relevant. */
const SCAN_FRESH_MS = 60 * 1000;

/** An open seat chart re-reads the hall no more often than this. */
const SEAT_FRESH_MS = 45 * 1000;
/** Hall geometry only changes when someone rebuilds an auditorium. */
const SEAT_LAYOUT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Example scanned counts for UI preview (`?previewScanned=1`). */
const PREVIEW_SCANNED = new URLSearchParams(location.search).has(
  "previewScanned"
);

const I18N = {
  nb: {
    "nav.day": "Dager",
    "nav.movies": "Filmer",
    "nav.stats": "Statistikk",
    "nav.settings": "Innstillinger",
    loading: "Henter program…",
    refresh: "Oppdater",
    emptyDay: "Ingen filmer for valgt dag.",
    gap: "{n} min pause",
    now: "Nå",
    soon: "Snart",
    done: "Ferdig",
    doneCount: "{n}/{total} ferdig",
    dayAllDone: "Dagen er ferdig",
    sold: "solgt",
    error: "Feil",
    retry: "Prøv igjen",
    loadError: "Kunne ikke hente programmet.",
    updated: "Oppdatert {time}",
    liveAt: "Live {time}",
    showsOne: "1 forestilling",
    showsMany: "{n} forestillinger",
    ongoing: "pågår",
    soldLabel: "solgt",
    soldOut: "Utsolgt",
    fewLeft: "{n} igjen",
    reservedShort: "{n} res.",
    admitAllIn: "Alle inne",
    admitMissing: "{n} mangler",
    admitNoShow: "{n} møtte ikke",
    admitNone: "Ingen inne ennå",
    admitNobodyCame: "Ingen skannet",
    admitUnknown: "Ingen skann-data",
    admitAria: "Innslipp: {n} av {total} billetter skannet",
    seatMapLabel: "Salkart",
    seatMapOpen: "Vis salkart for {title} {time}",
    seatMapHint: "{sold} av {capacity} plasser",
    seatMapLoading: "Henter salkart…",
    seatMapError: "Kunne ikke hente salkartet.",
    seatMapNone: "Ingen salkart for denne salen.",
    seatMapFree: "Fri plassering — ingen nummererte plasser.",
    seatMapRetry: "Prøv igjen",
    seatScreen: "Lerret",
    seatFree: "Ledig",
    seatSold: "Solgt",
    seatWaiting: "Ikke skannet",
    seatIn: "Inne",
    seatUnseated: "{n} uten fast plass",
    seatReservedNote: "{n} reservert vises ikke",
    seatBlockedNote: "{n} plasser er stengt for denne forestillingen",
    seatPicked: "Rad {row} · Plass {seat} — {state}",
    seatAria:
      "Salkart for {screen}: {sold} av {capacity} plasser solgt, {scanned} skannet inn.",
    nextShow: "Neste {time}",
    endsShow: "Slutt {time}",
    inMinutes: "om {n} min",
    today: "I dag",
    yesterday: "I går",
    tomorrow: "I morgen",
    dayTab: "{weekday} {d}.{m}",
    dayFull: "{weekday} {d}. {month}",
    moviesTitle: "Filmer",
    moviesSubtitle: "Alle tider gruppert per film",
    noMovies: "Ingen filmer i programmet.",
    statsTitle: "Solgte billetter",
    statsSubtitle: "Ukens salgstall, live",
    soldWeekLabel: "Solgt denne uken",
    periodTotal: "{n} totalt i perioden",
    soldAvgDay: "Snitt per dag",
    soldBestDay: "Beste dag",
    soldByDay: "Solgt per dag",
    soldByWeek: "Solgt per uke",
    topSold: "Mest solgte filmer",
    weekLabel: "Uke {n}",
    tickets: "billetter",
    noSoldData: "Ingen salgsdata ennå — trykk oppdater.",
    settingsTitle: "Innstillinger",
    settingsSubtitle: "Språk, utseende og DX-konto",
    language: "Språk",
    languageHint: "Velg språk for appen",
    theme: "Tema",
    themeHint: "Lys eller mørk modus",
    themeLight: "Lys",
    themeDark: "Mørk",
    langNb: "Norsk",
    langEn: "English",
    spokenNorwegian: "Norsk tale",
    spokenEnglish: "Engelsk tale",
    dxTitle: "DX-konto",
    dxSubtitle:
      "Logg inn med DX-kontoen din for å se hvor mange som har skannet billetten.",
    dxConnectedAs: "Tilkoblet som {email}",
    dxConnectedPat: "Tilkoblet med tilgangstoken",
    dxConnectedHint:
      "Innslipp hentes for i dag og tidligere dager når du åpner appen.",
    dxKeepLabel: "Hold meg innlogget",
    dxKeepHint:
      "DX logger ut etter noen dager. Passordet lagres kun på denne enheten så appen kan fornye økten selv.",
    dxRenewLabel: "Automatisk fornying",
    dxRenewOn: "På",
    dxRenewOff: "Av — logg inn på nytt hver 3. dag",
    dxEmailLabel: "E-post",
    dxPasswordLabel: "Passord",
    dxLoginHint:
      "Samme e-post og passord som i DX Check-in / på app.dx.no.",
    dxConnect: "Koble til",
    dxDisconnect: "Koble fra",
    dxOpenWeb: "Åpne DX Web",
    dxConnecting: "Kobler til…",
    dxConnectOk: "Tilkoblet",
    dxConnectFail: "Kunne ikke koble til. Sjekk e-post og passord.",
    dxNeedCreds: "Fyll inn e-post og passord.",
    dxInvalidLogin: "Feil e-post eller passord.",
    dxNetworkFail: "Fikk ikke kontakt med DX. Sjekk nettforbindelsen.",
    dxSourceLabel: "Kilde",
    dxSyncedLabel: "Sist oppdatert",
    dxCoverageLabel: "Skann-data",
    dxCoverageValue: "{n} av {total} forestillinger",
    dxNeverSynced: "Ikke hentet ennå",
    dxTest: "Test innslipp",
    dxTesting: "Tester…",
    dxRefreshScans: "Hent på nytt",
    dxRefreshing: "Henter…",
    dxTestOk: "OK — DX svarte med {n} skannede billetter for {show}.",
    dxTestEmpty:
      "Innlogget, men DX ga ingen skann-tall for {show}. Detaljene under kan sendes videre.",
    dxTestNoShows: "Ingen forestillinger med DX-ID å teste mot ennå.",
    dxTestAuth: "DX avviste pålogging. Koble til på nytt.",
    dxDetails: "Detaljer",
    previewScannedBanner:
      "Forhåndsvisning: skannet-tall er eksempeldata (ikke live fra DX).",
    weekdays: [
      "søndag",
      "mandag",
      "tirsdag",
      "onsdag",
      "torsdag",
      "fredag",
      "lørdag",
    ],
    months: [
      "januar",
      "februar",
      "mars",
      "april",
      "mai",
      "juni",
      "juli",
      "august",
      "september",
      "oktober",
      "november",
      "desember",
    ],
  },
  en: {
    "nav.day": "Days",
    "nav.movies": "Movies",
    "nav.stats": "Stats",
    "nav.settings": "Settings",
    loading: "Loading program…",
    refresh: "Refresh",
    emptyDay: "No movies for the selected day.",
    gap: "{n} min break",
    now: "Now",
    soon: "Soon",
    done: "Done",
    doneCount: "{n}/{total} done",
    dayAllDone: "Day is done",
    sold: "sold",
    error: "Error",
    retry: "Try again",
    loadError: "Could not load the program.",
    updated: "Updated {time}",
    liveAt: "Live {time}",
    showsOne: "1 showing",
    showsMany: "{n} showings",
    ongoing: "playing",
    soldLabel: "sold",
    soldOut: "Sold out",
    fewLeft: "{n} left",
    reservedShort: "{n} res.",
    admitAllIn: "All in",
    admitMissing: "{n} to go",
    admitNoShow: "{n} no-shows",
    admitNone: "None in yet",
    admitNobodyCame: "None scanned",
    admitUnknown: "No scan data",
    admitAria: "Admission: {n} of {total} tickets scanned",
    seatMapLabel: "Seat map",
    seatMapOpen: "Show the seat map for {title} {time}",
    seatMapHint: "{sold} of {capacity} seats",
    seatMapLoading: "Loading seat map…",
    seatMapError: "Could not load the seat map.",
    seatMapNone: "No seat map for this auditorium.",
    seatMapFree: "Free seating — no numbered seats.",
    seatMapRetry: "Try again",
    seatScreen: "Screen",
    seatFree: "Free",
    seatSold: "Sold",
    seatWaiting: "Not scanned",
    seatIn: "Inside",
    seatUnseated: "{n} without a seat",
    seatReservedNote: "{n} reserved not shown",
    seatBlockedNote: "{n} seats are closed for this showing",
    seatPicked: "Row {row} · Seat {seat} — {state}",
    seatAria:
      "Seat map for {screen}: {sold} of {capacity} seats sold, {scanned} scanned in.",
    nextShow: "Next {time}",
    endsShow: "Ends {time}",
    inMinutes: "in {n} min",
    today: "Today",
    yesterday: "Yesterday",
    tomorrow: "Tomorrow",
    dayTab: "{weekday} {d}.{m}",
    dayFull: "{weekday} {d} {month}",
    moviesTitle: "Movies",
    moviesSubtitle: "All times grouped by movie",
    noMovies: "No movies in the program.",
    statsTitle: "Tickets sold",
    statsSubtitle: "This week's sales, live",
    soldWeekLabel: "Sold this week",
    periodTotal: "{n} total for the period",
    soldAvgDay: "Avg per day",
    soldBestDay: "Best day",
    soldByDay: "Sold by day",
    soldByWeek: "Sold by week",
    topSold: "Top sold movies",
    weekLabel: "Week {n}",
    tickets: "tickets",
    noSoldData: "No sales data yet — tap refresh.",
    settingsTitle: "Settings",
    settingsSubtitle: "Language, appearance, and DX account",
    language: "Language",
    languageHint: "Choose app language",
    theme: "Theme",
    themeHint: "Light or dark mode",
    themeLight: "Light",
    themeDark: "Dark",
    langNb: "Norsk",
    langEn: "English",
    spokenNorwegian: "Norwegian",
    spokenEnglish: "English",
    dxTitle: "DX account",
    dxSubtitle:
      "Sign in with your DX account to see how many guests have scanned their ticket.",
    dxConnectedAs: "Connected as {email}",
    dxConnectedPat: "Connected with access token",
    dxConnectedHint:
      "Admissions are fetched for today and earlier days when you open the app.",
    dxKeepLabel: "Keep me signed in",
    dxKeepHint:
      "DX signs you out after a few days. The password is kept on this device only, so the app can renew the session itself.",
    dxRenewLabel: "Auto renew",
    dxRenewOn: "On",
    dxRenewOff: "Off — sign in again every 3 days",
    dxEmailLabel: "Email",
    dxPasswordLabel: "Password",
    dxLoginHint:
      "Same email and password you use in DX Check-in / on app.dx.no.",
    dxConnect: "Connect",
    dxDisconnect: "Disconnect",
    dxOpenWeb: "Open DX Web",
    dxConnecting: "Connecting…",
    dxConnectOk: "Connected",
    dxConnectFail: "Could not connect. Check email and password.",
    dxNeedCreds: "Enter email and password.",
    dxInvalidLogin: "Wrong email or password.",
    dxNetworkFail: "Could not reach DX. Check your connection.",
    dxSourceLabel: "Source",
    dxSyncedLabel: "Last updated",
    dxCoverageLabel: "Scan data",
    dxCoverageValue: "{n} of {total} showings",
    dxNeverSynced: "Not fetched yet",
    dxTest: "Test admissions",
    dxTesting: "Testing…",
    dxRefreshScans: "Fetch again",
    dxRefreshing: "Fetching…",
    dxTestOk: "OK — DX returned {n} scanned tickets for {show}.",
    dxTestEmpty:
      "Signed in, but DX returned no scan numbers for {show}. The details below can be passed on.",
    dxTestNoShows: "No showings with a DX id to test against yet.",
    dxTestAuth: "DX rejected the sign-in. Please connect again.",
    dxDetails: "Details",
    previewScannedBanner:
      "Preview: scanned counts are sample data (not live from DX).",
    weekdays: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ],
    months: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  },
};

const els = {
  content: document.getElementById("content"),
  daySwipe: document.getElementById("daySwipe"),
  dayPanePrev: document.getElementById("dayPanePrev"),
  dayPaneNext: document.getElementById("dayPaneNext"),
  moviesContent: document.getElementById("moviesContent"),
  statsContent: document.getElementById("statsContent"),
  settingsContent: document.getElementById("settingsContent"),
  dayTabs: document.getElementById("dayTabs"),
  dayControls: document.getElementById("dayControls"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusText: document.getElementById("statusText"),
  summary: document.getElementById("summary"),
  timeline: document.getElementById("timeline"),
  views: {
    day: document.getElementById("view-day"),
    movies: document.getElementById("view-movies"),
    stats: document.getElementById("view-stats"),
    settings: document.getElementById("view-settings"),
  },
};

const TAB_ORDER = ["day", "movies", "stats", "settings"];

const TAB_ANIM_CLASSES = [
  "tab-in-right",
  "tab-in-left",
  "tab-ghost",
  "tab-out-right",
  "tab-out-left",
];

/** Undo hook for an in-flight tab slide, so a new switch can start clean. */
let tabAnimCleanup = null;

/** @type {{ shows: any[], updatedAt?: string } | null} */
let state = null;
let selectedDay = "";
let enrichToken = 0;
let activeTab = "day";
let lang = "nb";
let theme = "light";
let enrichedAll = false;
let lastLiveAt = 0;
/** @type {null | { type: 'dxapi'|'pat'|'session'|'auth0'|'dxweb', token: string, scheme?: string, email?: string, partnerId?: string, connectedAt?: string, refreshToken?: string }} */
let dxAuth = loadDxAuth();
/** Last outcome of syncing check-in counts, surfaced under Settings → DX. */
let dxScanStatus = { at: 0, source: "", error: "" };
/** Guards against two check-in syncs racing over the same shows. */
let scanSyncRunning = false;
/** Hall geometry by `partnerId:locationId`, kept between visits. */
let seatLayouts = loadSeatLayouts();
/** Which hall a screen name turned out to be, so repeat looks skip the layout. */
const seatHalls = new Map();
/** Per-event seat state: `{ status, at, error, ...bridge payload }`. */
const seatCharts = new Map();
/** Shows whose seat chart the visitor unfolded by hand. */
const openSeatCharts = new Set();
/** Tablet and desktop have room for every hall at once, so charts there
 * are unfolded from the start instead of hiding behind a button. */
const SEATS_OPEN_MQ = window.matchMedia("(min-width: 700px)");
/** Loads auto-unfolded halls as they scroll into view. */
let seatAutoObserver = null;
/** How many fetches are in flight; the refresh button spins while any are. */
let busyCount = 0;

/** Set by setupDaySwipe: play the swipe slide for a day change that did not
 * come from a gesture. Returns false when it cannot run and the caller
 * should switch day without animating. */
let slideToDay = null;

init();

async function init() {
  const prefs = loadPrefs();
  selectedDay = prefs.selectedDay || "";
  activeTab = prefs.activeTab || "day";
  lang = prefs.lang === "en" ? "en" : "nb";
  theme = prefs.theme === "dark" ? "dark" : "light";

  applyTheme(theme);
  applyLanguage();
  setActiveTab(activeTab, { skipRender: true });

  els.refreshBtn.addEventListener("click", () => load({ forceLive: true }));
  document.querySelectorAll(".pill-tab").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  setupSeatCharts();

  // Let mouse users scroll the day strip with the wheel.
  els.dayTabs.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        els.dayTabs.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );

  // Keep numbers live while the tab is open (e.g. box-office screen).
  setInterval(() => {
    if (document.visibilityState === "visible") {
      refreshLive();
      refreshOpenSeatCharts();
    }
  }, 120_000);

  // Nudge the timeline "now" marker and chip countdowns every minute.
  setInterval(() => {
    if (document.visibilityState === "visible" && state?.shows) {
      renderTimeline();
      renderSummary();
      markDoneDays();
    }
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    rollToTodayIfStale();
    if (Date.now() - lastLiveAt > 120_000) refreshLive();
  });

  setupPullToRefresh();
  setupDaySwipe();

  // Keep liquid indicators aligned after layout changes.
  window.addEventListener("resize", () => {
    movePillIndicator(activeTab, { instant: true });
    moveDayIndicator({ instant: true });
  });

  // Crossing the tablet threshold changes whether seat charts are folded
  // away. Only the day list draws them, so only it needs redrawing.
  SEATS_OPEN_MQ.addEventListener("change", () => {
    if (activeTab === "day") renderDay();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  await load({ forceLive: true });

  // Backfill check-in counts for every day in the background — not only
  // the visible one — so flipping back to yesterday already has numbers.
  if (isDxConnected()) {
    syncScanned().catch((err) => console.warn("Scan backfill failed", err));
  } else if (PREVIEW_SCANNED) {
    enrichAllShows()
      .then(() => {
        applyPreviewScanned();
        renderActiveView();
      })
      .catch((err) => console.warn("Background enrich failed", err));
  }
}

function setupPullToRefresh() {
  let startY = 0;
  let pulling = false;

  document.addEventListener(
    "touchstart",
    (e) => {
      if (window.scrollY <= 0 && !els.refreshBtn.disabled) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 90 && window.scrollY <= 0) {
        pulling = false;
        load({ forceLive: true });
      }
    },
    { passive: true }
  );

  document.addEventListener("touchend", () => {
    pulling = false;
  });
}

/**
 * One set of listeners for every seat chart: the day list is rebuilt
 * wholesale on each refresh, so nothing can hold onto its own elements.
 */
function setupSeatCharts() {
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest?.("[data-seat-toggle]");
    if (toggle) {
      toggleSeatChart(toggle.dataset.seatToggle);
      return;
    }

    const retry = e.target.closest?.("[data-seat-retry]");
    if (retry) {
      const show = state?.shows?.find((s) => s.id === retry.dataset.seatRetry);
      if (show) loadSeatChart(show, { force: true });
      return;
    }

    const seat = e.target.closest?.(".seat");
    if (seat) describeSeat(seat);
  });

  // Hovering reads out seats too, for anyone on a desktop box-office screen.
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const seat = e.target.closest?.(".seat");
    if (seat) describeSeat(seat);
  });
}

/** Name the seat under the pointer in its chart's legend row. */
function describeSeat(seat) {
  const caption = seat.closest(".seat-chart")?.querySelector(".seat-picked");
  if (!caption) return;
  const state = seat.dataset.state;
  const phase = seat.closest(".seat-chart")?.classList.contains("phase-sales");
  const label =
    state === "2" ? t("seatIn") : state === "1" ? t(phase ? "seatSold" : "seatWaiting") : t("seatFree");
  caption.textContent = t("seatPicked", {
    row: seat.dataset.row,
    seat: seat.dataset.seat,
    state: label,
  });
}

/** While a swipe gesture is in progress, live refreshes must not replace
 * the day list under the finger (that used to kill the touch stream and
 * leave the page frozen between days). renderDay checks this flag and
 * queues itself; the swipe code replays the render once the gesture ends. */
let holdDayRender = false;
let queuedDayRender = false;

function releaseDayRender({ discardQueued = false } = {}) {
  holdDayRender = false;
  const replay = queuedDayRender && !discardQueued;
  queuedDayRender = false;
  if (replay) renderDay();
}

/**
 * Interactive swipe between days: the page follows the finger while the
 * neighbouring day peeks in from the side, then a spring animation
 * carries it to the new day (or back) using the release velocity.
 *
 * Built for robustness against every "stuck between days" failure mode:
 * - Pointer events with capture on the (stable) day view, so the gesture
 *   survives DOM re-renders that would silently end a touch-event stream.
 * - The settle animation runs on requestAnimationFrame instead of a CSS
 *   transition, so it can never be left hanging by a missed transitionend.
 * - A new touch can grab the page mid-flight and keep dragging from
 *   exactly where it is; if the grabbed animation was already committing,
 *   the day is committed on the spot so quick repeated swipes flow
 *   naturally from day to day.
 *
 * The header (day pills and timeline) travels with the page rather than
 * after it: it moves onto the incoming day as soon as the drag is clearly
 * heading there, and at the latest when the settle animation starts, so
 * both land together. Day-pill taps run the same slide via slideToDay.
 */
function setupDaySwipe() {
  const view = els.views.day;
  const track = els.daySwipe;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /** @type {"idle"|"pending"|"drag"|"ignore"|"animating"} */
  let mode = "idle";
  /** Pointer that owns the gesture; extra fingers are ignored so a stray
   * second touch can't end the drag early. */
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  /** Track offset at gesture start (non-zero when grabbing an animation). */
  let baseX = 0;
  let curX = 0;
  let width = 0;
  let days = [];
  let idx = -1;
  let lastX = 0;
  let lastT = 0;
  let vx = 0;
  let raf = 0;
  /** Direction of the currently running snap animation (−1/0/1). */
  let animDir = 0;
  /** Day that animation commits to on arrival ("" while springing back). */
  let animDay = "";
  /** Ends the running snap animation right now, or null when idle. */
  let finishAnim = null;
  /** Side the header is previewing mid-drag (−1/0/1). */
  let previewDir = 0;

  const setX = (x) => {
    curX = x;
    track.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
  };

  /** Land on `day`: the peek pane already showed it, so the list swaps in
   * without replaying the card entrance animation. */
  const commitDay = (day) => {
    els.content.dataset.key = day;
    setSelectedDay(day);
    renderDay();
    enrichVisibleDay();
  };

  /** Move the header onto the day the drag is heading for once it is past
   * halfway, so the pills and timeline animate alongside the page instead
   * of starting over once it has landed. The wider entry threshold keeps a
   * drag that hovers around the middle from flip-flopping. */
  const previewHeader = () => {
    const frac = -curX / width;
    const enter = previewDir !== 0 && Math.sign(frac) === previewDir ? 0.3 : 0.45;
    let dir = Math.abs(frac) > enter ? Math.sign(frac) : 0;
    if ((dir > 0 && idx >= days.length - 1) || (dir < 0 && idx <= 0)) dir = 0;
    if (dir === previewDir) return;
    previewDir = dir;
    setSelectedDay(days[idx + dir]);
  };

  view.addEventListener("pointerdown", (e) => {
    // Touch/pen only: mouse users scroll and click, they don't swipe.
    if (e.pointerType === "mouse" || !e.isPrimary || pointerId !== null) return;
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startY = e.clientY;
    lastT = e.timeStamp;
    vx = 0;
    if (mode === "animating") {
      // Catch the page mid-flight and let the finger take over from
      // exactly where it is — no jump, no waiting. If the animation
      // was already committing to a neighbour day, commit it now and
      // rebase the track so a follow-up swipe moves on from the new day.
      cancelAnimationFrame(raf);
      finishAnim = null;
      if (animDir !== 0) {
        const newDay = animDay;
        releaseDayRender({ discardQueued: true });
        commitDay(newDay);
        holdDayRender = true;
        setX(curX + width * animDir);
        // A tapped pill can slide in a day that is not the neighbour, so
        // re-find where we landed instead of stepping the index.
        idx = days.indexOf(newDay);
        els.dayPanePrev.innerHTML =
          idx > 0 ? buildDayListHTML(days[idx - 1]) : "";
        els.dayPaneNext.innerHTML =
          idx < days.length - 1 ? buildDayListHTML(days[idx + 1]) : "";
        animDir = 0;
        animDay = "";
      }
      baseX = curX;
      previewDir = 0;
      mode = "drag";
      try {
        view.setPointerCapture(pointerId);
      } catch {}
    } else {
      baseX = 0;
      mode = "pending";
    }
  });

  view.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    if (mode !== "pending" && mode !== "drag") return;
    const x = e.clientX;
    const y = e.clientY;

    if (mode === "pending") {
      const dx = x - startX;
      const dy = y - startY;
      // Wait until the gesture direction is clear; vertical wins so
      // normal scrolling is never hijacked (touch-action: pan-y keeps
      // vertical panning with the browser).
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        mode = "ignore";
        return;
      }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (!state?.shows) {
        mode = "ignore";
        return;
      }
      days = [...new Set(state.shows.map((s) => s.dayKey))].sort();
      idx = days.indexOf(selectedDay);
      if (idx === -1) {
        mode = "ignore";
        return;
      }
      width = track.offsetWidth || view.offsetWidth || 1;
      els.dayPanePrev.innerHTML = idx > 0 ? buildDayListHTML(days[idx - 1]) : "";
      els.dayPaneNext.innerHTML =
        idx < days.length - 1 ? buildDayListHTML(days[idx + 1]) : "";
      // Re-base on the engage point so the page starts moving from
      // right under the finger instead of jumping the 10px dead zone.
      startX = x;
      lastX = x;
      lastT = e.timeStamp;
      mode = "drag";
      holdDayRender = true;
      // Route the rest of the gesture to this (permanent) element, so a
      // background re-render of the list can't cut the swipe short.
      try {
        view.setPointerCapture(pointerId);
      } catch {}
    }

    const dt = e.timeStamp - lastT;
    if (dt > 0) {
      const inst = (x - lastX) / dt;
      // Low-pass the velocity so one noisy sample can't fake a flick.
      vx = vx === 0 ? inst : inst * 0.6 + vx * 0.4;
      lastX = x;
      lastT = e.timeStamp;
    }

    const target = baseX + (x - startX);
    // Rubber-band past the first/last day instead of moving freely.
    const blocked =
      (target > 0 && idx <= 0) || (target < 0 && idx >= days.length - 1);
    let next = blocked ? target * 0.3 : target;
    // Only one neighbour is rendered on each side; resist dragging
    // past it instead of exposing blank space.
    if (next > width) next = width + (next - width) * 0.2;
    else if (next < -width) next = -width + (next + width) * 0.2;
    setX(next);
    previewHeader();
  });

  const settle = () => {
    if (mode === "drag") {
      const canPrev = idx > 0;
      const canNext = idx < days.length - 1;
      // Where would the page coast to? Position plus a bit of momentum
      // decides, so slow far drags and quick short flicks both commit.
      const projected = curX + vx * 140;
      const dragDX = curX - baseX;
      let dir = 0;
      if (canNext && dragDX < -8 && (projected < -width * 0.3 || vx < -0.25)) {
        dir = 1;
      } else if (canPrev && dragDX > 8 && (projected > width * 0.3 || vx > 0.25)) {
        dir = -1;
      }
      snapTo(dir);
    } else if (mode !== "animating") {
      mode = "idle";
    }
  };

  view.addEventListener("pointerup", (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    settle();
  });

  view.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (mode === "drag") snapTo(0);
    else if (mode !== "animating") mode = "idle";
  });

  // Last-resort recovery: if the view's own capture is ever lost without
  // a pointerup or pointercancel, spring back instead of freezing
  // mid-swipe. (Bubbled events from a child losing its implicit capture
  // when ours kicks in must not end the gesture, hence the target check.)
  view.addEventListener("lostpointercapture", (e) => {
    if (e.target !== view || e.pointerId !== pointerId) return;
    pointerId = null;
    if (mode === "drag") snapTo(0);
    else if (mode !== "animating") mode = "idle";
  });

  /** Spring the track to its resting spot; dir −1/1 slides to the
   * previous/next side, 0 springs back to the current day. `day` is the
   * day to land on ("" for a spring-back) and `v0` the launch velocity. */
  function snapTo(dir, { day = dir === 0 ? "" : days[idx + dir], v0 = vx } = {}) {
    // Never leave an earlier spring running: two loops would fight over
    // the transform and neither could be stopped.
    cancelAnimationFrame(raf);
    mode = "animating";
    animDir = dir;
    animDay = day;
    const target = dir === 0 ? 0 : dir === 1 ? -width : width;

    // Send the header off now so the pills and timeline animate while the
    // page glides, and both arrive at roughly the same moment. A gesture
    // that gave up goes back to the day the list still shows.
    if (day) setSelectedDay(day);
    else if (previewDir !== 0) setSelectedDay(days[idx]);
    previewDir = 0;

    const finish = () => {
      cancelAnimationFrame(raf);
      finishAnim = null;
      animDir = 0;
      animDay = "";
      // Commits re-render anyway; a queued refresh is only replayed
      // when the gesture ends back on the same day.
      releaseDayRender({ discardQueued: dir !== 0 });
      if (day) commitDay(day);
      setX(0);
      els.dayPanePrev.innerHTML = "";
      els.dayPaneNext.innerHTML = "";
      mode = "idle";
    };
    finishAnim = finish;

    if (curX === target || reduceMotion.matches) {
      finish();
      return;
    }

    // Critically damped spring driven by the release velocity: fast
    // flicks land fast, gentle releases glide, and it never oscillates.
    // The frequency is picked so even a full-width slide is done in about
    // 350ms — in step with the header's morph, so the two land together.
    const omega = 0.024; // rad/ms
    let x = curX;
    let v = Math.max(-3, Math.min(3, v0));
    const side = Math.sign(x - target);
    let prevTs = performance.now();

    const stepFrame = (ts) => {
      const dt = Math.min(Math.max(ts - prevTs, 0.001), 64);
      prevTs = ts;
      // Exact closed-form step of x'' = -ω²(x-target) - 2ωx'.
      const A = x - target;
      const B = v + omega * A;
      const decay = Math.exp(-omega * dt);
      x = target + (A + B * dt) * decay;
      v = (B - omega * (A + B * dt)) * decay;
      const done =
        (Math.abs(x - target) < 0.5 && Math.abs(v) < 0.02) ||
        Math.sign(x - target) !== side;
      if (done) {
        finish();
        return;
      }
      setX(x);
      raf = requestAnimationFrame(stepFrame);
    };
    raf = requestAnimationFrame(stepFrame);
  }

  /** Slide to `day` without a gesture (day-pill taps), reusing the swipe
   * animation so the page and the header always move as one. Returns false
   * when no slide is possible and the caller should just switch day. */
  slideToDay = (day) => {
    if (!state?.shows || els.views.day.hidden) return false;
    // A gesture owns the track; let it finish and win.
    if (mode === "pending" || mode === "drag" || pointerId !== null) return false;
    // Tapped during a slide: land that one first, then start from there.
    if (mode === "animating") finishAnim?.();
    if (day === selectedDay) return true;

    const all = [...new Set(state.shows.map((s) => s.dayKey))].sort();
    const from = all.indexOf(selectedDay);
    const to = all.indexOf(day);
    if (from === -1 || to === -1) return false;
    width = track.offsetWidth || view.offsetWidth || 0;
    if (!width) return false;

    days = all;
    idx = from;
    baseX = 0;
    setX(0);
    const dir = to > from ? 1 : -1;
    // A far-away day slides in from the near side, so every tap gets the
    // same one-screen motion a swipe would give.
    els.dayPanePrev.innerHTML = dir === -1 ? buildDayListHTML(day) : "";
    els.dayPaneNext.innerHTML = dir === 1 ? buildDayListHTML(day) : "";
    holdDayRender = true;
    // A tap brings no release velocity, so launch it with a gentle flick's
    // worth — a full screen from a standstill otherwise starts sluggishly.
    snapTo(dir, { day, v0: -dir * 2 });
    return true;
  };
}

let sessionDay = toDayKey(new Date());

/** If the device slept past midnight, move selection to the new "today". */
function rollToTodayIfStale() {
  const today = toDayKey(new Date());
  if (today === sessionDay || !state?.shows) return;
  sessionDay = today;
  const days = new Set(state.shows.map((s) => s.dayKey));
  if (days.has(today)) {
    selectedDay = today;
    savePrefs();
    populateFilters();
    if (activeTab === "day") renderDay();
  }
}

async function refreshLive() {
  if (!state?.shows) return;
  lastLiveAt = Date.now();
  if (activeTab === "day") {
    await enrichVisibleDay();
  } else if (activeTab === "movies" || activeTab === "stats") {
    await enrichAllShows({ force: true });
    renderActiveView();
  } else {
    await syncScanned();
  }
}

function t(key, vars = {}) {
  const dict = I18N[lang] || I18N.nb;
  let str = dict[key] ?? I18N.nb[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

function weekdays() {
  return (I18N[lang] || I18N.nb).weekdays;
}

function months() {
  return (I18N[lang] || I18N.nb).months;
}

function showsLabel(n) {
  return n === 1 ? t("showsOne") : t("showsMany", { n });
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function loadDxAuth() {
  try {
    const raw = JSON.parse(localStorage.getItem(DX_AUTH_KEY) || "null");
    if (!raw || typeof raw !== "object") return null;
    // Older builds stored credentials for DX surfaces that turned out not
    // to carry check-in state; those cannot work, so ask for a fresh login.
    if (!raw.token || raw.type !== "dxweb") return null;
    return raw;
  } catch {
    return null;
  }
}

function saveDxAuth(next) {
  dxAuth = next;
  if (!next) localStorage.removeItem(DX_AUTH_KEY);
  else localStorage.setItem(DX_AUTH_KEY, JSON.stringify(next));
}

function isDxConnected() {
  return Boolean(dxAuth?.token);
}

/** True when the UI should make room for check-in numbers at all. */
function scanVisible() {
  return isDxConnected() || PREVIEW_SCANNED;
}

/**
 * Forget the DX account and every check-in number that came with it, in
 * memory and in the stored history, so disconnecting really clears the UI.
 */
function disconnectDx() {
  saveDxAuth(null);
  dxScanStatus = { at: 0, source: "", error: "" };
  seatCharts.clear();
  openSeatCharts.clear();
  for (const show of state?.shows || []) {
    show.scanned = null;
    show.scannedAt = null;
    show.scanDone = false;
  }
  try {
    const hist = loadHistory();
    for (const show of Object.values(hist)) {
      if (!show || typeof show !== "object") continue;
      show.scanned = null;
      show.scannedAt = null;
      show.scanDone = false;
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (err) {
    console.warn("Could not clear scanned history", err);
  }
}

/**
 * Fill example scanned counts so the UI can be reviewed without live DX
 * check-in data (`?previewScanned=1`). Skips shows that already have a
 * real scanned value.
 */
function applyPreviewScanned() {
  if (!PREVIEW_SCANNED || !state?.shows) return false;
  const now = new Date();
  let changed = false;
  for (const show of state.shows) {
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
  }
  return changed;
}

function hashStr(s) {
  let h = 0;
  for (const ch of String(s || "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      selectedDay,
      activeTab,
      lang,
      theme,
    })
  );
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
  } catch {
    return {};
  }
}

function serializeShow(show) {
  return {
    ...show,
    start: formatLocalDateTime(show.start),
    end: show.end ? formatLocalDateTime(show.end) : null,
  };
}

function persistHistory(shows) {
  const hist = loadHistory();
  for (const show of shows) {
    hist[show.id] = serializeShow(show);
  }

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

function mergeShows(snapshotShows) {
  const byId = new Map();

  for (const raw of Object.values(loadHistory())) {
    if (!raw?.id) continue;
    byId.set(raw.id, normalizeCachedShow(raw));
  }

  for (const show of snapshotShows) {
    const next = normalizeCachedShow(show);
    const prev = byId.get(next.id);
    if (prev) {
      // Keep better live fields when snapshot is stale/empty.
      if (next.sold == null && prev.sold != null) next.sold = prev.sold;
      if (next.capacity == null && prev.capacity != null) {
        next.capacity = prev.capacity;
        next.available = prev.available ?? null;
        next.reserved = prev.reserved ?? null;
      }
      if (next.scanned == null && prev.scanned != null) {
        next.scanned = prev.scanned;
      }
      // Keep the sync bookkeeping so finished days aren't re-fetched.
      if (next.scannedAt == null && prev.scannedAt != null) {
        next.scannedAt = prev.scannedAt;
      }
      if (next.scanDone == null && prev.scanDone != null) {
        next.scanDone = prev.scanDone;
      }
      if (!next.end && prev.end) next.end = prev.end;
      // The program API drops ticket links once a show starts;
      // restore the DX eventId so live updates keep working.
      if (!next.eventId && prev.eventId) {
        next.eventId = prev.eventId;
        next.promoterId = prev.promoterId || next.promoterId;
        if (next.eventStatus === "unavailable") next.eventStatus = "pending";
      }
      if (next.eventStatus === "pending" && prev.eventStatus === "ok") {
        next.eventStatus = "ok";
      }
    }
    byId.set(next.id, next);
  }

  return [...byId.values()].sort((a, b) => a.start - b.start);
}

function applyTheme(next) {
  theme = next;
  // Cross-fade colors while the theme flips, then drop the hook.
  const root = document.documentElement;
  root.classList.add("theme-anim");
  clearTimeout(applyTheme._t);
  applyTheme._t = setTimeout(() => root.classList.remove("theme-anim"), 400);
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#151312" : "#c41e2a";
  const bar = document.querySelector(
    'meta[name="apple-mobile-web-app-status-bar-style"]'
  );
  if (bar) bar.content = theme === "dark" ? "black-translucent" : "default";
}

function applyLanguage() {
  document.documentElement.lang = lang === "en" ? "en" : "nb";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  els.refreshBtn.setAttribute("aria-label", t("refresh"));
  els.dayTabs.setAttribute(
    "aria-label",
    lang === "en" ? "Choose day" : "Velg dag"
  );
  document.querySelector(".pill-nav")?.setAttribute(
    "aria-label",
    lang === "en" ? "Main menu" : "Hovedmeny"
  );
}

/**
 * Liquid indicator move: the blob glides to the target in one springy
 * motion while squashing flatter and slightly wider — a droplet sliding
 * across — then relaxes back to its resting shape as it lands.
 */
const LIQUID_SETTLE_MS = 170;

function liquidMove(indicator, target, { instant = false } = {}) {
  if (!indicator || !target) return;
  const newL = target.offsetLeft;
  const newW = target.offsetWidth;

  // Hidden targets measure 0×0; bail so we don't park the indicator at
  // width 0 and leave the selected pill unstyled when it shows again.
  if (!newW) {
    delete indicator.dataset.placed;
    return;
  }

  const hasPos = indicator.dataset.placed === "1";
  if (instant || !hasPos) {
    clearTimeout(indicator._settle);
    indicator.classList.remove("liquid-travel");
    indicator.classList.add("no-trans");
    indicator.style.left = `${newL}px`;
    indicator.style.width = `${newW}px`;
    indicator.dataset.placed = "1";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => indicator.classList.remove("no-trans"))
    );
    return;
  }

  const curL = parseFloat(indicator.style.left) || newL;
  const curW = parseFloat(indicator.style.width) || newW;
  if (Math.abs(curL - newL) < 1 && Math.abs(curW - newW) < 1) return;

  clearTimeout(indicator._settle);
  indicator.classList.add("liquid-travel");
  indicator.style.left = `${newL}px`;
  indicator.style.width = `${newW}px`;
  // Mid-flight, release the squash so the blob springs back to full
  // height while it finishes gliding onto the target.
  indicator._settle = setTimeout(() => {
    indicator.classList.remove("liquid-travel");
  }, LIQUID_SETTLE_MS);
}

function movePillIndicator(tab, opts = {}) {
  const indicator = document.querySelector(".pill-indicator");
  const btn = document.querySelector(`.pill-tab[data-tab="${tab}"]`);
  liquidMove(indicator, btn, opts);
}

async function setActiveTab(tab, { skipRender = false } = {}) {
  if (!els.views[tab]) return;
  const prevTab = activeTab;
  activeTab = tab;
  savePrefs();
  document.body.dataset.tab = tab;

  if (tabAnimCleanup) tabAnimCleanup();

  Object.entries(els.views).forEach(([key, el]) => {
    el.hidden = key !== tab;
  });

  // Slide the whole page sideways: the old view glides out while the new
  // one comes in from the side it lives on in the tab order.
  if (!skipRender && prevTab !== tab && els.views[prevTab]) {
    const forward = TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(prevTab);
    const view = els.views[tab];
    const prevView = els.views[prevTab];

    // The outgoing view turns into an absolutely-positioned ghost; shift
    // it by the old scroll offset so it doesn't jump when we scroll the
    // new view to the top.
    const scrollY = window.scrollY || 0;
    prevView.hidden = false;
    prevView.style.setProperty("--tab-shift", `${-scrollY}px`);
    prevView.classList.add("tab-ghost", forward ? "tab-out-left" : "tab-out-right");
    window.scrollTo(0, 0);

    const cleanup = () => {
      if (tabAnimCleanup === cleanup) tabAnimCleanup = null;
      clearTimeout(fallback);
      view.removeEventListener("animationend", onEnd);
      view.classList.remove(...TAB_ANIM_CLASSES);
      prevView.classList.remove(...TAB_ANIM_CLASSES);
      prevView.style.removeProperty("--tab-shift");
      prevView.hidden = true;
    };
    // Card entrance animations bubble up from children; only the view's
    // own slide ending should finish the transition.
    const onEnd = (e) => {
      if (e.target === view) cleanup();
    };
    const fallback = setTimeout(cleanup, 450);
    tabAnimCleanup = cleanup;

    // Restart the animation even if the class was just removed.
    void view.offsetWidth;
    view.classList.add(forward ? "tab-in-right" : "tab-in-left");
    view.addEventListener("animationend", onEnd);
  }

  document.querySelectorAll(".pill-tab").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
  });
  movePillIndicator(tab, { instant: skipRender });
  if (state?.shows) {
    renderTimeline();
    renderSummary();
  }

  els.dayControls.hidden = tab !== "day";
  els.refreshBtn.hidden = tab === "settings";
  // The day strip was unmeasurable while hidden; re-seat its indicator
  // now that it is visible again so the selected pill keeps its color.
  if (tab === "day") moveDayIndicator({ instant: true });

  if (skipRender || !state?.shows) return;

  if (tab === "day") {
    renderDay();
    // Arriving from a tab that never needed live numbers (e.g. settings)
    // can leave the day without sold counts — top it up, but only when
    // what we already have has gone stale.
    const stale =
      Date.now() - lastLiveAt > 60_000 ||
      state.shows.some(
        (s) => s.dayKey === selectedDay && s.eventId && s.sold == null
      );
    if (stale) await enrichVisibleDay();
  } else if (tab === "movies") {
    await ensureAllEnriched();
    renderMovies();
  } else if (tab === "stats") {
    await ensureAllEnriched();
    renderStats();
  } else if (tab === "settings") renderSettings();
}

async function load({ forceLive = false } = {}) {
  setLoading(true);
  enrichedAll = false;
  try {
    const data = await loadProgramSnapshot();
    const shows = mergeShows(data.shows || []);
    persistHistory(shows);

    state = {
      updatedAt: data.updatedAt,
      shows,
    };

    populateFilters();
    els.statusText.textContent = state.updatedAt
      ? t("updated", { time: formatClock(new Date(state.updatedAt)) })
      : t("updated", { time: formatClock(new Date()) });

    if (forceLive) {
      if (activeTab === "day") await enrichVisibleDay({ force: true });
      else if (activeTab === "movies" || activeTab === "stats") {
        await enrichAllShows({ force: true });
      } else {
        await syncScanned();
      }
    }

    applyPreviewScanned();
    renderActiveView();
  } catch (err) {
    console.error(err);
    showError(err?.message || t("loadError"));
  } finally {
    setLoading(false);
  }
}

function renderActiveView() {
  if (activeTab === "day") renderDay();
  else if (activeTab === "movies") renderMovies();
  else if (activeTab === "stats") renderStats();
  else if (activeTab === "settings") renderSettings();
  if (activeTab !== "day") {
    renderTimeline();
    renderSummary();
  }
}

async function loadProgramSnapshot() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${t("loadError")} (${res.status})`);
  return res.json();
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => {
    const t = String(tag || "").trim().toUpperCase();
    return t && t !== "2D" && t !== "3D";
  });
}

/**
 * Best-effort spoken language from Buen's version tags. Norwegian-dubbed
 * shows are tagged "Norsk tale"; English-language shows never carry an
 * explicit English tag — they run in original version ("Original tale")
 * and/or with Norwegian subtitles ("Norsk tekst").
 * Returns "nb", "en" or "" when unknown.
 */
function spokenLanguage(tags) {
  if (!Array.isArray(tags)) return "";
  const values = tags.map((tag) => String(tag || "").trim().toLowerCase());
  if (values.some((v) => v.includes("norsk tale"))) return "nb";
  if (values.some((v) => v.includes("engelsk"))) return "en";
  if (values.some((v) => v.includes("original tale") || v.includes("norsk tekst"))) {
    return "en";
  }
  return "";
}

function normalizeCachedShow(show) {
  return {
    ...show,
    tags: cleanTags(show.tags),
    start:
      show.start instanceof Date ? show.start : parseLocalDateTime(show.start),
    end:
      show.end instanceof Date
        ? show.end
        : show.end
          ? parseLocalDateTime(show.end)
          : null,
  };
}

function populateFilters() {
  const days = [...new Set(state.shows.map((s) => s.dayKey))].sort();

  const today = toDayKey(new Date());
  if (!selectedDay || !days.includes(selectedDay)) {
    selectedDay = days.includes(today)
      ? today
      : days.find((d) => d >= today) || days[days.length - 1] || today;
  }

  els.dayTabs.innerHTML =
    `<span class="day-indicator" aria-hidden="true"></span>` +
    days
      .map((day) => {
        const past = day < today;
        const selected = day === selectedDay;
        return `<button type="button" class="day-tab${past ? " past" : ""}" role="tab" data-day="${day}" aria-selected="${selected}">${doneGlyph(
          "day-tab-check"
        )}<span class="day-tab-label">${escapeHtml(
          shortDayLabel(day)
        )}</span></button>`;
      })
      .join("");

  els.dayTabs.querySelectorAll(".day-tab").forEach((btn) => {
    btn.addEventListener("click", () => selectDay(btn.dataset.day));
  });

  markDoneDays();

  els.dayTabs
    .querySelector('.day-tab[aria-selected="true"]')
    ?.scrollIntoView({ inline: "center", block: "nearest" });
  moveDayIndicator({ instant: true });
}

/**
 * Point the app at `day` and bring the header (pills, timeline, chips)
 * along, without touching the day list. Kept apart from the list so a
 * swipe can start the header moving while the page is still gliding.
 * Returns true when the day actually changed.
 */
function setSelectedDay(day) {
  if (!day || day === selectedDay || !state?.shows) return false;
  selectedDay = day;
  savePrefs();
  // Update selection in place so the liquid indicator can travel.
  els.dayTabs.querySelectorAll(".day-tab").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.day === day));
  });
  moveDayIndicator();
  els.dayTabs
    .querySelector('.day-tab[aria-selected="true"]')
    ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  renderSummary();
  renderTimeline();
  return true;
}

/** Day change from a tap: slides the page like a swipe would, so the list
 * and the header move together whichever way the day was picked. */
async function selectDay(day) {
  if (!day || day === selectedDay || !state?.shows) return;
  if (slideToDay?.(day)) return;
  if (!setSelectedDay(day)) return;
  renderDay();
  await enrichVisibleDay();
}

function moveDayIndicator(opts = {}) {
  const indicator = els.dayTabs.querySelector(".day-indicator");
  const btn = els.dayTabs.querySelector('.day-tab[aria-selected="true"]');
  liquidMove(indicator, btn, opts);
}

/**
 * Tick off the days whose last showing has finished. Re-run on the minute
 * tick as well as after a render, because a day turns done with the clock
 * rather than with new data.
 */
function markDoneDays() {
  if (!state?.shows) return;
  const now = new Date();
  let changed = false;
  for (const btn of els.dayTabs.querySelectorAll(".day-tab")) {
    const done = doneProgress(dayShows(btn.dataset.day), now).all;
    if (btn.classList.contains("done") === done) continue;
    btn.classList.toggle("done", done);
    changed = true;
  }
  // The checkmark widens the pill; keep the indicator sitting on it.
  if (changed) moveDayIndicator({ instant: true });
}

function shortDayLabel(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = capitalize(weekdays()[date.getDay()]).slice(0, 3);
  const today = toDayKey(new Date());
  if (dayKey === today) return `${t("today")} ${d}.${m}`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey === toDayKey(yesterday)) return `${t("yesterday")} ${d}.${m}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey === toDayKey(tomorrow)) return `${t("tomorrow")} ${d}.${m}`;
  return t("dayTab", { weekday, d, m });
}

function formatDayLabel(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return t("dayFull", {
    weekday: capitalize(weekdays()[date.getDay()]),
    d,
    month: months()[m - 1],
  });
}

function dayShows(day) {
  return state.shows
    .filter((s) => s.dayKey === day)
    .sort((a, b) => a.start - b.start);
}

/** Full markup for one day's list; used for the visible day and for the
 * peek panes while swiping between days. */
function buildDayListHTML(day) {
  const shows = dayShows(day);
  const now = new Date();

  if (!shows.length) {
    return `<div class="empty-note">${escapeHtml(t("emptyDay"))}</div>`;
  }

  // If DX answered for some of the day's shows, the ones it skipped are
  // worth flagging; if it answered for none, stay quiet about it.
  const gaps = shows.some((s) => s.scanned != null);

  const parts = [];
  for (let i = 0; i < shows.length; i++) {
    const show = shows[i];
    const prev = shows[i - 1];
    // Gaps only make sense between consecutive shows in the same screen.
    if (prev && prev.screen === show.screen && show.end && prev.end) {
      const gapMin = Math.round((show.start - prev.end) / 60_000);
      if (gapMin >= 15) {
        parts.push(
          `<div class="gap-row">${escapeHtml(t("gap", { n: gapMin }))}</div>`
        );
      }
    }
    parts.push(renderShowCard(show, now, i, { gaps }));
  }

  return `
    ${
      PREVIEW_SCANNED
        ? `<p class="preview-banner">${escapeHtml(t("previewScannedBanner"))}</p>`
        : ""
    }
    <div class="day-block">
      <div class="section-label${doneProgress(shows, now).all ? " all-done" : ""}">
        <span class="section-label-text">${escapeHtml(formatDayLabel(day))}</span>
        ${doneTag(shows, { allLabel: "dayAllDone", now })}
      </div>
      ${parts.join("")}
    </div>
  `;
}

function renderDay() {
  if (!state?.shows) return;

  // Never replace the list while a swipe is following the finger —
  // wait for the gesture to finish, then apply the freshest data.
  if (holdDayRender) {
    queuedDayRender = true;
    return;
  }

  // Replay entrance animations only when the visible day changes,
  // not on periodic live refreshes.
  const renderKey = selectedDay;
  const isRefresh = els.content.dataset.key === renderKey;
  els.content.classList.toggle("no-anim", isRefresh);
  els.content.dataset.key = renderKey;

  renderSummary();
  renderTimeline();
  markDoneDays();

  els.content.innerHTML = buildDayListHTML(selectedDay);
  observeAutoSeatCharts();
}

function showEndOf(show) {
  if (show.end) return show.end;
  const mins = Number(show.runningMinutes) || 120;
  // No confirmed end time: estimate from runtime plus ads/trailers.
  return new Date(show.start.getTime() + (mins + 15) * 60_000);
}

/** How long timeline pieces get to finish their exit transition. */
const TL_EXIT_MS = 500;

/** Everything needed to draw the header timeline for one day, expressed
 * as percentages so the same data drives both a fresh build and a morph. */
function computeTimelineLayout() {
  const now = new Date();
  // Day tab follows the selected day; other tabs always show today.
  const day = activeTab === "day" ? selectedDay : toDayKey(now);
  const shows = state.shows
    .filter((s) => s.dayKey === day)
    .sort((a, b) => a.start - b.start);

  if (!shows.length) return { day, lanes: [] };

  const HOUR = 3_600_000;
  let t0 = Math.min(...shows.map((s) => s.start.getTime()));
  let t1 = Math.max(...shows.map((s) => showEndOf(s).getTime()));
  t0 = Math.floor((t0 - 20 * 60_000) / HOUR) * HOUR;
  t1 = Math.ceil((t1 + 15 * 60_000) / HOUR) * HOUR;
  const span = t1 - t0;
  const pctOf = (ms) => ((ms - t0) / span) * 100;

  const screens = [...new Set(shows.map((s) => s.screen))].sort((a, b) =>
    a.localeCompare(b, "nb")
  );

  const lanes = screens.map((screen) => ({
    screen,
    blocks: shows
      .filter((s) => s.screen === screen)
      .map((s) => {
        const start = s.start.getTime();
        const end = showEndOf(s).getTime();
        const left = pctOf(start);
        return {
          left,
          width: Math.max(pctOf(end) - left, 1.5),
          status: statusOf(s, now),
          estimated: !s.end,
          label: formatClock(s.start),
          title: `${s.title} · ${formatClock(s.start)}–${
            s.end ? formatClock(s.end) : "~" + formatClock(showEndOf(s))
          }`,
        };
      }),
  }));

  // Hour marks double as gridlines; keyed by timestamp so a morph can
  // slide marks for the same hour and cross-fade the rest.
  const stepHours = span > 9 * HOUR ? 2 : 1;
  const marks = [];
  for (let ts = t0; ts <= t1; ts += stepHours * HOUR) {
    marks.push({ ts, pct: pctOf(ts), label: String(new Date(ts).getHours()) });
  }

  const nowTs = now.getTime();
  const showNow = day === toDayKey(now) && nowTs >= t0 && nowTs <= t1;
  return { day, lanes, marks, nowPct: showNow ? pctOf(nowTs) : null };
}

function renderTimeline() {
  if (!state?.shows) return;
  const layout = computeTimelineLayout();

  if (!layout.lanes.length) {
    els.timeline.hidden = true;
    els.timeline.innerHTML = "";
    return;
  }

  // Morph the existing bars into the new day's layout when possible;
  // build from scratch only when there is nothing on screen yet.
  if (!els.timeline.hidden && els.timeline.querySelector(".tl-tracks")) {
    morphTimeline(layout);
  } else {
    buildTimeline(layout);
  }
}

function buildTimeline(layout) {
  const blockHTML = (b) => `<div class="tl-block ${b.status}${b.estimated ? " estimated" : ""}"
      style="left:${b.left}%;width:${b.width}%"
      title="${escapeHtml(b.title)}">
      <span class="tl-block-label">${b.label}</span>
    </div>`;

  els.timeline.hidden = false;
  els.timeline.innerHTML = `
    <div class="tl-names">${layout.lanes
      .map(
        (l) =>
          `<span class="tl-lane-name" data-screen="${escapeHtml(l.screen)}">${escapeHtml(l.screen)}</span>`
      )
      .join("")}</div>
    <div class="tl-area">
      <div class="tl-gridlines">${layout.marks
        .map(
          (m) =>
            `<span class="tl-gridline" data-ts="${m.ts}" style="left:${m.pct}%"></span>`
        )
        .join("")}</div>
      <div class="tl-tracks">${layout.lanes
        .map(
          (l) =>
            `<div class="tl-track" data-screen="${escapeHtml(l.screen)}">${l.blocks
              .map(blockHTML)
              .join("")}</div>`
        )
        .join("")}</div>
      ${
        layout.nowPct != null
          ? `<div class="tl-now" style="left:${layout.nowPct}%"><span class="tl-now-dot"></span></div>`
          : ""
      }
      <div class="tl-hours">${layout.marks
        .map(
          (m) =>
            `<span class="tl-hour" data-ts="${m.ts}" style="left:${m.pct}%">${m.label}</span>`
        )
        .join("")}</div>
    </div>
  `;
}

/**
 * Update the timeline in place so CSS transitions carry every piece to
 * its new spot: bars stretch/shrink and slide to the new day's shows,
 * leftover bars collapse away, new ones grow in, and hour marks slide
 * or cross-fade. Also used by the minute refresh, where only statuses
 * and the "now" line move.
 */
function morphTimeline(layout) {
  const namesBox = els.timeline.querySelector(".tl-names");
  const gridsBox = els.timeline.querySelector(".tl-gridlines");
  const tracksBox = els.timeline.querySelector(".tl-tracks");
  const hoursBox = els.timeline.querySelector(".tl-hours");
  const area = els.timeline.querySelector(".tl-area");

  /** Finishing touches for entering nodes, applied one frame after they
   * are inserted with their start styles so the transition can play. */
  const entered = [];

  const applyBlock = (el, b) => {
    el.className = `tl-block ${b.status}${b.estimated ? " estimated" : ""}`;
    el.style.left = `${b.left}%`;
    el.style.width = `${b.width}%`;
    el.style.opacity = "";
    el.title = b.title;
    el.firstElementChild.textContent = b.label;
  };

  const exitEl = (el, style) => {
    el.classList.add("tl-exit");
    Object.assign(el.style, style, { opacity: "0" });
    setTimeout(() => el.remove(), TL_EXIT_MS);
  };

  // Lanes (screen names + their tracks), keyed by screen name.
  const oldNames = new Map(
    [...namesBox.querySelectorAll(".tl-lane-name:not(.tl-exit)")].map((el) => [
      el.dataset.screen,
      el,
    ])
  );
  const oldTracks = new Map(
    [...tracksBox.querySelectorAll(".tl-track:not(.tl-exit)")].map((el) => [
      el.dataset.screen,
      el,
    ])
  );

  let prevName = null;
  let prevTrack = null;
  for (const lane of layout.lanes) {
    let nameEl = oldNames.get(lane.screen);
    let trackEl = oldTracks.get(lane.screen);
    oldNames.delete(lane.screen);
    oldTracks.delete(lane.screen);

    if (!nameEl) {
      nameEl = document.createElement("span");
      nameEl.className = "tl-lane-name";
      nameEl.dataset.screen = lane.screen;
      nameEl.textContent = lane.screen;
      nameEl.style.height = "0px";
      nameEl.style.opacity = "0";
      entered.push(() => {
        nameEl.style.height = "20px";
        nameEl.style.opacity = "1";
      });
    }
    if (!trackEl) {
      trackEl = document.createElement("div");
      trackEl.className = "tl-track";
      trackEl.dataset.screen = lane.screen;
      trackEl.style.height = "0px";
      trackEl.style.opacity = "0";
      entered.push(() => {
        trackEl.style.height = "20px";
        trackEl.style.opacity = "1";
      });
    }
    // Keep names and tracks in the same (sorted) order.
    namesBox.insertBefore(nameEl, prevName ? prevName.nextSibling : namesBox.firstChild);
    tracksBox.insertBefore(
      trackEl,
      prevTrack ? prevTrack.nextSibling : tracksBox.firstChild
    );
    prevName = nameEl;
    prevTrack = trackEl;

    // Pair old and new bars in time order: paired bars glide and stretch
    // into place, extras collapse into their midpoint, new ones grow out.
    const oldBlocks = [...trackEl.querySelectorAll(".tl-block:not(.tl-exit)")];
    lane.blocks.forEach((b, i) => {
      if (i < oldBlocks.length) {
        applyBlock(oldBlocks[i], b);
        return;
      }
      const el = document.createElement("div");
      el.className = `tl-block ${b.status}${b.estimated ? " estimated" : ""}`;
      el.style.left = `${b.left + b.width / 2}%`;
      el.style.width = "0%";
      el.style.opacity = "0";
      el.appendChild(document.createElement("span")).className = "tl-block-label";
      trackEl.appendChild(el);
      entered.push(() => applyBlock(el, b));
    });
    for (let i = lane.blocks.length; i < oldBlocks.length; i++) {
      const el = oldBlocks[i];
      const mid =
        (parseFloat(el.style.left) || 0) + (parseFloat(el.style.width) || 0) / 2;
      exitEl(el, { left: `${mid}%`, width: "0%" });
    }
  }
  for (const el of oldNames.values()) exitEl(el, { height: "0px" });
  for (const el of oldTracks.values()) exitEl(el, { height: "0px" });

  // Hour gridlines and labels, keyed by timestamp.
  const patchMarks = (box, cls, withLabel) => {
    const old = new Map(
      [...box.querySelectorAll(`.${cls}:not(.tl-exit)`)].map((el) => [
        el.dataset.ts,
        el,
      ])
    );
    for (const m of layout.marks) {
      let el = old.get(String(m.ts));
      if (el) {
        old.delete(String(m.ts));
        el.style.left = `${m.pct}%`;
        if (withLabel) el.textContent = m.label;
      } else {
        el = document.createElement("span");
        el.className = cls;
        el.dataset.ts = m.ts;
        el.style.left = `${m.pct}%`;
        el.style.opacity = "0";
        if (withLabel) el.textContent = m.label;
        box.appendChild(el);
        entered.push(() => {
          el.style.opacity = "1";
        });
      }
    }
    for (const el of old.values()) exitEl(el, {});
  };
  patchMarks(gridsBox, "tl-gridline", false);
  patchMarks(hoursBox, "tl-hour", true);

  // "Now" line: slide when it stays, fade when it appears or leaves.
  let nowEl = area.querySelector(".tl-now:not(.tl-exit)");
  if (layout.nowPct != null) {
    if (nowEl) {
      nowEl.style.left = `${layout.nowPct}%`;
    } else {
      nowEl = document.createElement("div");
      nowEl.className = "tl-now";
      nowEl.style.left = `${layout.nowPct}%`;
      nowEl.style.opacity = "0";
      nowEl.appendChild(document.createElement("span")).className = "tl-now-dot";
      area.insertBefore(nowEl, hoursBox);
      entered.push(() => {
        nowEl.style.opacity = "1";
      });
    }
  } else if (nowEl) {
    exitEl(nowEl, {});
  }

  // Flush start styles, then let entering pieces transition into place.
  if (entered.length) {
    void area.offsetWidth;
    for (const fn of entered) fn();
  }
}

/** Header stat chips. Shown on every tab: the day tab follows the
 * selected day, other tabs always show today. */
function renderSummary() {
  if (!state?.shows) return;
  const now = new Date();
  const day = activeTab === "day" ? selectedDay : toDayKey(now);
  const shows = state.shows
    .filter((s) => s.dayKey === day)
    .sort((a, b) => a.start - b.start);

  // Replay chip entrance only when the day context changes,
  // not on periodic live refreshes.
  const renderKey = day;
  els.summary.classList.toggle("no-anim", els.summary.dataset.key === renderKey);
  els.summary.dataset.key = renderKey;

  // Keep the row mounted even for empty days so the header height is
  // stable and the layout doesn't jump when flipping between days.
  els.summary.hidden = false;

  if (!shows.length) {
    els.summary.innerHTML = "";
    return;
  }

  const soldSum = shows.reduce((n, s) => n + soldOf(s), 0);
  const hasSold = shows.some((s) => s.sold != null);

  els.summary.innerHTML = `
    ${
      hasSold
        ? `<span class="chip"><strong>${soldSum}</strong> ${escapeHtml(t("soldLabel"))}</span>`
        : ""
    }
    ${nextChip(shows, now)}
    ${endsChip(shows, now)}
  `;
}

function nextChip(shows, now) {
  const next = shows.find((s) => s.start > now);
  if (!next) return "";
  const mins = Math.round((next.start - now) / 60_000);
  if (mins > 12 * 60) return "";
  const when =
    mins < 60
      ? t("inMinutes", { n: mins })
      : formatClock(next.start);
  return `<span class="chip next"><strong>${escapeHtml(
    t("nextShow", { time: when })
  )}</strong></span>`;
}

/** Chip for when the movie that finishes soonest is ending. */
function endsChip(shows, now) {
  const ending = shows
    .filter((s) => s.start <= now && showEndOf(s) > now)
    .sort((a, b) => showEndOf(a) - showEndOf(b))[0];
  if (!ending) return "";
  const end = showEndOf(ending);
  const mins = Math.round((end - now) / 60_000);
  const when = mins < 60 ? t("inMinutes", { n: mins }) : formatClock(end);
  return `<span class="chip ends"><strong>${escapeHtml(
    t("endsShow", { time: when })
  )}</strong></span>`;
}

/**
 * Finished showings are struck through everywhere they appear — the
 * timeline, the day list, the day strip, the movie tiles — so "done" is
 * something you see rather than something you infer from a faint card.
 * These helpers keep that judgement in one place.
 */
function isDone(show, now = new Date()) {
  return statusOf(show, now) === "done";
}

/** How much of a set of showings is behind us. */
function doneProgress(shows, now = new Date()) {
  const total = shows.length;
  const done = shows.reduce((n, s) => n + (isDone(s, now) ? 1 : 0), 0);
  return { done, total, all: total > 0 && done === total };
}

function doneGlyph(className = "done-glyph") {
  return `<svg class="${className}" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.6 8.5l3.6 3.6 7.2-8" /></svg>`;
}

/** The "3/5 ferdig" / "Dagen er ferdig" tag used by day and movie headers. */
function doneTag(shows, { allLabel, className = "done-tag", now = new Date() } = {}) {
  const { done, total, all } = doneProgress(shows, now);
  if (!total || !done) return "";
  const label = all ? t(allLabel) : t("doneCount", { n: done, total });
  return `<span class="${className}${all ? " all" : ""}">${
    all ? doneGlyph() : ""
  }${escapeHtml(label)}</span>`;
}

function statusOf(show, now) {
  if (show.end && now >= show.start && now < show.end) return "live";
  if (!show.end && now >= show.start && now - show.start < 3 * 60 * 60_000) {
    return "live";
  }
  if (show.end && now >= show.end) return "done";
  if (show.start > now && show.start - now <= 45 * 60_000) return "soon";
  if (show.start <= now) return "done";
  return "upcoming";
}

/**
 * The check-in picture for one show: how many of the sold tickets have
 * been scanned, and what someone working the door needs to read off it.
 *
 *  complete — every sold ticket is scanned, the room is full
 *  partial  — people are still coming in, `missing` are outstanding
 *  none     — doors are open but nobody has scanned yet
 *  unknown  — DX is connected but hasn't given a number for this show
 *
 * Returns null when there is simply nothing to say (no DX account, show
 * still hours away, nothing sold).
 */
function admissionOf(show, now = new Date(), { gaps = false } = {}) {
  if (!scanVisible() || show.sold == null) return null;

  const sold = Number(show.sold) || 0;
  const scanned =
    show.scanned == null ? null : Math.max(0, Number(show.scanned) || 0);
  const status = statusOf(show, now);
  // Before the doors open there is nothing to let in yet.
  const open = status !== "upcoming";
  const over = status === "done";

  if (scanned == null) {
    if (!open || !sold) return null;
    // A blank slot is only worth pointing out while people are actually
    // coming in, or when the rest of the day did report numbers.
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

function admissionLabel(admission) {
  if (admission.state === "unknown") return t("admitUnknown");
  if (admission.state === "complete") return t("admitAllIn");
  // Once the film is over the gap is no-shows, not people still queueing.
  if (admission.state === "none") {
    return admission.over ? t("admitNobodyCame") : t("admitNone");
  }
  const key = admission.over ? "admitNoShow" : "admitMissing";
  return t(key, { n: admission.missing });
}

function admissionIcon(state) {
  if (state === "complete") {
    return `<svg class="admit-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.4l3.6 3.6 7.4-8" /></svg>`;
  }
  if (state === "unknown") {
    return `<svg class="admit-glyph dashed" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /></svg>`;
  }
  // Someone stepping through the door.
  return `<svg class="admit-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.6 2.6h3.1v10.8H9.6" /><path d="M2.2 8h6.2M6.1 5.6 8.5 8l-2.4 2.4" /></svg>`;
}

/** The admission strip under a show card — the door-side answer at a glance. */
function renderAdmission(show, now, opts) {
  const admission = admissionOf(show, now, opts);
  if (!admission) return "";

  const count =
    admission.state === "unknown"
      ? `<span class="admit-count unknown">–<span class="admit-total">/${admission.sold}</span></span>`
      : `<span class="admit-count"><strong>${admission.scanned}</strong><span class="admit-total">/${admission.sold}</span></span>`;

  return `
      <div class="admit ${admission.state}" role="group" aria-label="${escapeHtml(
        t("admitAria", { n: admission.scanned ?? 0, total: admission.sold })
      )}">
        ${admissionIcon(admission.state)}
        ${count}
        <span class="admit-track" aria-hidden="true"><span class="admit-fill" style="width:${admission.pct}%"></span></span>
        <span class="admit-state">${escapeHtml(admissionLabel(admission))}</span>
      </div>
  `;
}

/* —— Seat chart ——————————————————————————————————————————————
 *
 * The admission strip answers "how many are in?"; the seat chart
 * answers "where are they sitting?". It stays folded away behind one
 * button per show so the day list keeps its shape, and the hall is only
 * fetched when someone actually asks to see it.
 */

function loadSeatLayouts() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEAT_MAP_KEY) || "{}");
    if (!raw || typeof raw !== "object") return {};
    const fresh = {};
    for (const [key, entry] of Object.entries(raw)) {
      if (entry?.layout && Date.now() - (entry.at || 0) < SEAT_LAYOUT_TTL_MS) {
        fresh[key] = entry;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function seatLayoutKey(partnerId, locationId) {
  return `${partnerId}:${locationId}`;
}

function rememberSeatLayout(partnerId, locationId, layout) {
  if (!layout || locationId == null) return;
  seatLayouts[seatLayoutKey(partnerId, locationId)] = { at: Date.now(), layout };
  try {
    localStorage.setItem(SEAT_MAP_KEY, JSON.stringify(seatLayouts));
  } catch (err) {
    console.warn("Could not store seat layout", err);
  }
}

function seatPartnerOf(show) {
  return String(show.promoterId || dxAuth?.partnerId || DX_PARTNER_ID);
}

/** The hall drawing for a show, from whichever cache already knows it. */
function seatLayoutOf(show, locationId) {
  const id = locationId ?? seatHalls.get(show.screen);
  if (id == null) return null;
  return seatLayouts[seatLayoutKey(seatPartnerOf(show), id)]?.layout || null;
}

/**
 * Is a seat chart worth offering for this show? Any numbered hall with
 * a DX event — including when nothing has sold yet — and never for
 * halls DX has already said have no numbered seats.
 */
function seatChartOffered(show) {
  if (!show.eventId || show.eventStatus === "unavailable") return false;
  if (!scanVisible()) return false;
  const chart = seatCharts.get(String(show.eventId));
  if (chart?.status === "empty") return false;
  return true;
}

/**
 * Seats a guest could still buy: the hall DX opened for this show, less
 * the ones held by reservations. That is the capacity the show card
 * already counts against, so both places agree.
 */
function seatsOnSale(chart) {
  return Math.max((chart.capacity || 0) - (chart.reserved || 0), 0);
}

/** Sold seats read as plain sales until the doors open and scanning starts. */
function seatPhaseOf(show, chart, now = new Date()) {
  if (chart?.scanned > 0) return "door";
  return statusOf(show, now) === "upcoming" ? "sales" : "door";
}

/**
 * Pull one hall from the bridge. The layout only travels when this
 * device has never seen that auditorium; after that a refresh is just
 * the occupied seat ids.
 */
async function loadSeatChart(show, { force = false, retry = true } = {}) {
  const key = String(show.eventId);
  const previous = seatCharts.get(key);
  if (previous?.status === "loading") return;
  if (
    !force &&
    previous?.status === "ready" &&
    Date.now() - previous.at < SEAT_FRESH_MS
  ) {
    return;
  }

  if (PREVIEW_SCANNED && !isDxConnected()) {
    seatCharts.set(key, previewSeatChart(show));
    paintSeatChart(show);
    return;
  }

  seatCharts.set(key, { ...previous, status: "loading" });
  paintSeatChart(show);

  const partnerId = seatPartnerOf(show);
  let cardChanged = false;
  setBusy(true);
  try {
    const { status, ok, data } = await callDxProxy({
      action: "seats",
      token: dxAuth.token,
      partnerId,
      eventId: key,
      withLayout: !seatLayoutOf(show),
    });

    if (status === 401 || status === 403) {
      if (retry && (await reauthenticateDx())) {
        seatCharts.delete(key);
        return loadSeatChart(show, { force: true, retry: false });
      }
      throw dxError(data.error || "DX session expired", "auth");
    }
    if (!ok) throw new Error(data.error || `bridge ${status}`);

    if (data.token) saveDxAuth({ ...dxAuth, token: String(data.token) });
    if (data.locationId != null) seatHalls.set(show.screen, data.locationId);
    if (data.layout) {
      rememberSeatLayout(partnerId, data.locationId, data.layout);
    }

    const layout = seatLayoutOf(show, data.locationId);
    const empty = Boolean(data.freeSeating) || !layout;
    const capacity = Number(data.capacity) || 0;
    seatCharts.set(key, {
      status: empty ? "empty" : "ready",
      reason: data.freeSeating ? "free" : layout ? "" : "noMap",
      at: Date.now(),
      locationId: data.locationId,
      // DX counts held seats inside the hall's capacity; the show card
      // counts against what is left to sell. Without a capacity from DX
      // the card's own figure is already the second kind.
      capacity: capacity || show.capacity || 0,
      reserved: capacity ? Number(data.reserved) || 0 : 0,
      sold: Number(data.sold) || 0,
      scanned: Number(data.scanned) || 0,
      unseated: Number(data.unseated) || 0,
      seats: data.seats || {},
    });

    // The same call DX answers with seats also carries the freshest
    // sold/scanned pair, so the card above the chart stays in step.
    if (typeof data.sold === "number" && show.sold !== data.sold) {
      show.sold = data.sold;
      cardChanged = true;
    }
    if (typeof data.scanned === "number" && show.scanned !== data.scanned) {
      show.scanned = data.scanned;
      show.scannedAt = Date.now();
      cardChanged = true;
    }
    if (cardChanged) persistHistory([show]);
  } catch (err) {
    if (err?.code === "auth") {
      console.warn("DX credentials expired — disconnecting");
      disconnectDx();
      renderActiveView();
      return;
    }
    seatCharts.set(key, {
      status: "error",
      at: Date.now(),
      error: String(err?.message || err),
    });
  } finally {
    setBusy(false);
  }

  // Fresher numbers redraw the card and, with it, every chart below one;
  // otherwise only this chart needs repainting.
  if (cardChanged) renderActiveView();
  paintSeatChart(show);
}

/** Replace just this show's chart, so opening one never reflows the day. */
function paintSeatChart(show) {
  const open = seatChartExpanded(show);
  for (const host of document.querySelectorAll(
    `[data-seat-show="${cssEscape(show.id)}"]`
  )) {
    host.innerHTML = renderSeatChart(show);
    host.closest(".show-row")?.classList.toggle("seats-open", open);
  }
  for (const btn of document.querySelectorAll(
    `[data-seat-toggle="${cssEscape(show.id)}"]`
  )) {
    btn.setAttribute("aria-expanded", String(open));
  }
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

async function toggleSeatChart(showId) {
  const show = state?.shows?.find((s) => s.id === showId);
  if (!show || seatsAlwaysOpen()) return;

  if (openSeatCharts.has(showId)) {
    openSeatCharts.delete(showId);
    paintSeatChart(show);
    return;
  }
  openSeatCharts.add(showId);
  paintSeatChart(show);
  await loadSeatChart(show);
}

/**
 * Fetch the halls that are unfolded by width as they come into view, so a
 * wide day list costs one lookup per chart the visitor actually reaches
 * instead of one per show the moment the day opens.
 */
function observeAutoSeatCharts() {
  if (!seatsAlwaysOpen() || typeof IntersectionObserver !== "function") {
    seatAutoObserver?.disconnect();
    return;
  }

  if (!seatAutoObserver) {
    seatAutoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          seatAutoObserver.unobserve(entry.target);
          const show = state?.shows?.find(
            (s) => s.id === entry.target.dataset.seatShow
          );
          if (!show) continue;
          loadSeatChart(show).catch((err) =>
            console.warn("Seat chart load failed", err)
          );
        }
      },
      { rootMargin: "300px 0px" }
    );
  } else {
    seatAutoObserver.disconnect();
  }

  for (const host of document.querySelectorAll("[data-seat-show]")) {
    const show = state?.shows?.find((s) => s.id === host.dataset.seatShow);
    if (!show) continue;
    // Halls this device already knows are kept current by the live
    // refresh; only the ones with nothing to draw need fetching here.
    const chart = seatCharts.get(String(show.eventId));
    if (chart && chart.status !== "error") continue;
    seatAutoObserver.observe(host);
  }
}

/** Is this show's chart somewhere the visitor can actually see it? */
function seatChartOnScreen(show) {
  const host = document.querySelector(
    `[data-seat-show="${cssEscape(show.id)}"]`
  );
  if (!host) return false;
  const box = host.getBoundingClientRect();
  if (!box.width && !box.height) return false;
  return (
    box.bottom > 0 &&
    box.top < (window.innerHeight || 0) &&
    box.right > 0 &&
    box.left < (window.innerWidth || 0)
  );
}

/** Keep unfolded charts current alongside the two-minute live refresh. */
async function refreshOpenSeatCharts() {
  if (!state?.shows) return;
  for (const show of state.shows) {
    if (!seatChartExpanded(show)) continue;
    // A show that ended hours ago cannot gain another guest.
    if (show.scanDone) continue;
    // Charts nobody asked for are only worth refreshing while on screen.
    if (!openSeatCharts.has(show.id) && !seatChartOnScreen(show)) continue;
    await loadSeatChart(show).catch((err) =>
      console.warn("Seat chart refresh failed", err)
    );
  }
}

function seatsAlwaysOpen() {
  return SEATS_OPEN_MQ.matches;
}

/** Is this show's hall on screen right now — unfolded by hand, or by width? */
function seatChartExpanded(show) {
  return seatsAlwaysOpen() || openSeatCharts.has(show.id);
}

/** The strip under a show card: a fold-out button on phones, a plain
 * heading for the chart that is already open on wider screens. */
function renderSeatToggle(show) {
  const open = seatChartExpanded(show);
  const chart = seatCharts.get(String(show.eventId));
  const capacity = show.capacity || (chart ? seatsOnSale(chart) : 0);
  const hint = capacity
    ? t("seatMapHint", { sold: show.sold ?? 0, capacity })
    : "";

  const head = `
      <svg class="seat-strip-glyph" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.2 7.2V4.1a1.1 1.1 0 0 1 1.1-1.1h7.4a1.1 1.1 0 0 1 1.1 1.1v3.1" />
        <rect x="2" y="7.2" width="12" height="4.2" rx="1.1" />
        <path d="M4.4 11.4v1.6M11.6 11.4v1.6" />
      </svg>
      <span class="seat-strip-label">${escapeHtml(t("seatMapLabel"))}</span>
      ${hint ? `<span class="seat-strip-hint">${escapeHtml(hint)}</span>` : ""}`;

  const strip = seatsAlwaysOpen()
    ? `<div class="seat-strip static">${head}</div>`
    : `<button class="seat-strip" type="button" data-seat-toggle="${escapeHtml(show.id)}"
            aria-expanded="${open}" aria-controls="seatchart-${escapeHtml(show.id)}"
            aria-label="${escapeHtml(
              t("seatMapOpen", {
                title: show.title,
                time: formatClock(show.start),
              })
            )}">
      ${head}
      <svg class="seat-chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4.4 6.2 3.6 3.6 3.6-3.6" />
      </svg>
    </button>`;

  return `
    ${strip}
    <div class="seat-panel" id="seatchart-${escapeHtml(show.id)}">
      <div class="seat-wrap" data-seat-show="${escapeHtml(show.id)}">${
        open ? renderSeatChart(show) : ""
      }</div>
    </div>
  `;
}

function renderSeatChart(show) {
  if (!seatChartExpanded(show)) return "";
  const chart = seatCharts.get(String(show.eventId));

  if (!chart || chart.status === "loading") {
    return `<div class="seat-note">
      <span class="seat-spinner" aria-hidden="true"></span>${escapeHtml(t("seatMapLoading"))}
    </div>`;
  }
  if (chart.status === "error") {
    return `<div class="seat-note error">
      <span>${escapeHtml(t("seatMapError"))}</span>
      <button class="seat-retry" type="button" data-seat-retry="${escapeHtml(show.id)}">${escapeHtml(
        t("seatMapRetry")
      )}</button>
    </div>`;
  }
  if (chart.status === "empty") {
    return `<div class="seat-note">${escapeHtml(
      t(chart.reason === "free" ? "seatMapFree" : "seatMapNone")
    )}</div>`;
  }

  const layout = seatLayoutOf(show, chart.locationId);
  if (!layout) return `<div class="seat-note">${escapeHtml(t("seatMapNone"))}</div>`;

  const phase = seatPhaseOf(show, chart);
  const taken = Object.keys(chart.seats).length;
  const scannedSeats = Object.values(chart.seats).filter((s) => s === 2).length;
  const free = Math.max(seatsOnSale(chart) - taken, 0);

  // Held and closed-off seats have no coordinates DX will tell us about,
  // so they are said in words rather than drawn in the wrong place.
  const blocked = Math.max(layout.seats - (chart.capacity || layout.seats), 0);
  const notes = [
    chart.unseated ? t("seatUnseated", { n: chart.unseated }) : "",
    chart.reserved ? t("seatReservedNote", { n: chart.reserved }) : "",
    blocked ? t("seatBlockedNote", { n: blocked }) : "",
  ].filter(Boolean);

  const legend =
    phase === "sales"
      ? [
          ["free", t("seatFree"), free],
          ["sold", t("seatSold"), taken],
        ]
      : [
          ["free", t("seatFree"), free],
          ["sold", t("seatWaiting"), taken - scannedSeats],
          ["in", t("seatIn"), scannedSeats],
        ];

  return `
    <div class="seat-chart phase-${phase}">
      ${seatChartSvg(layout, chart.seats, show)}
      <div class="seat-legend">
        ${legend
          .map(
            ([key, label, n]) => `<span class="seat-key ${key}">
              <span class="seat-swatch" aria-hidden="true"></span>${escapeHtml(label)}
              <strong>${n}</strong>
            </span>`
          )
          .join("")}
        <span class="seat-picked" data-seat-picked="${escapeHtml(show.id)}"></span>
      </div>
      ${
        notes.length
          ? `<p class="seat-notes">${escapeHtml(notes.join(" · "))}</p>`
          : ""
      }
    </div>
  `;
}

/**
 * The hall itself, drawn in DX's own coordinates so it matches the chart
 * staff see in DX: screen at the top, row 1 nearest it.
 */
function seatChartSvg(layout, seats, show) {
  const { box, pitch } = layout;
  const w = pitch.x * 0.78;
  const h = pitch.y * 0.72;
  const gutter = pitch.x * 1.7;
  const pad = pitch.x * 0.5;

  // The screen sits above row 1: an arc, with its caption clear of the apex.
  const arcY = box.y - pitch.y / 2 - pitch.y * 0.9;
  const arcRise = pitch.y * 0.55;
  const labelSize = pitch.y * 0.58;
  const labelY = arcY - arcRise - pitch.y * 0.4;

  const top = labelY - labelSize;
  const bottom = box.y + box.h + pitch.y / 2 + pad;
  const vb = {
    x: box.x - pitch.x / 2 - gutter - pad,
    y: top,
    w: box.w + pitch.x + (gutter + pad) * 2,
    h: bottom - top,
  };
  const left = box.x - pitch.x / 2 - gutter / 2;
  const right = box.x + box.w + pitch.x / 2 + gutter / 2;

  // A row's number is repeated at both ends, the way it is painted on
  // the walls of a cinema, so a seat is easy to find from either aisle.
  const rowLabel = (row, x) =>
    `<text class="seat-row-label" x="${x.toFixed(1)}" y="${row.y}" dy="0.34em"
       font-size="${(pitch.y * 0.62).toFixed(1)}">${escapeHtml(row.name)}</text>`;

  const rows = layout.rows
    .map((row) => {
      const seatEls = row.seats
        .map((seat) => {
          const state = seats[seat.i] || 0;
          const cls = state === 2 ? "in" : state === 1 ? "sold" : "free";
          return `<rect class="seat ${cls}" x="${(seat.x - w / 2).toFixed(
            1
          )}" y="${(row.y - h / 2).toFixed(1)}" width="${w.toFixed(
            1
          )}" height="${h.toFixed(1)}" rx="${(w * 0.22).toFixed(
            1
          )}" data-row="${escapeHtml(row.name)}" data-seat="${
            seat.n
          }" data-state="${state}" />`;
        })
        .join("");
      return `<g class="seat-row">
        ${rowLabel(row, left)}${seatEls}${rowLabel(row, right)}
      </g>`;
    })
    .join("");

  const screenX1 = box.x - pitch.x / 2;
  const screenX2 = box.x + box.w + pitch.x / 2;
  const screenMid = (screenX1 + screenX2) / 2;

  return `
    <svg class="seat-svg" viewBox="${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(
      1
    )} ${vb.h.toFixed(1)}" role="img" aria-label="${escapeHtml(
      t("seatAria", {
        screen: show.screen,
        sold: Object.keys(seats).length,
        capacity: layout.seats,
        scanned: Object.values(seats).filter((s) => s === 2).length,
      })
    )}">
      <path class="seat-screen" d="M${screenX1.toFixed(1)} ${arcY.toFixed(
        1
      )} Q ${screenMid.toFixed(1)} ${(arcY - arcRise * 2).toFixed(
        1
      )} ${screenX2.toFixed(1)} ${arcY.toFixed(1)}" />
      <text class="seat-screen-label" x="${screenMid.toFixed(1)}" y="${labelY.toFixed(
        1
      )}" font-size="${labelSize.toFixed(1)}" letter-spacing="${(
        pitch.y * 0.08
      ).toFixed(2)}">${escapeHtml(t("seatScreen")).toUpperCase()}</text>
      ${rows}
    </svg>
  `;
}

/** A believable hall for `?previewScanned=1`, so the chart can be reviewed. */
function previewSeatChart(show) {
  const capacity = Number(show.capacity) || 110;
  const perRow = Math.max(8, Math.min(26, Math.round(Math.sqrt(capacity * 2.2))));
  const rowCount = Math.ceil(capacity / perRow);
  const pitch = { x: 20, y: 20 };

  const rows = [];
  let id = 1;
  let placed = 0;
  for (let r = 0; r < rowCount; r++) {
    const n = Math.min(perRow, capacity - placed);
    placed += n;
    const inset = ((perRow - n) / 2) * pitch.x;
    rows.push({
      name: String(r + 1),
      y: pitch.y * (r + 1),
      seats: Array.from({ length: n }, (_, i) => ({
        i: id++,
        n: i + 1,
        x: pitch.x * (i + 1) + inset,
      })),
    });
  }

  // Fill from the middle outwards, the way a hall actually fills up.
  const all = rows.flatMap((row) =>
    row.seats.map((seat) => ({
      id: seat.i,
      weight:
        Math.abs(seat.x - pitch.x * (perRow / 2 + 1)) / pitch.x +
        Math.abs(Number(row.name) - rowCount * 0.62) * 1.4 +
        (hashStr(`${show.id}:${seat.i}`) % 100) / 42,
    }))
  );
  all.sort((a, b) => a.weight - b.weight);

  const sold = Math.min(Number(show.sold) || 0, all.length);
  const scanned = Math.min(Number(show.scanned) || 0, sold);
  const seats = {};
  all.slice(0, sold).forEach((seat, i) => {
    seats[seat.id] = i < scanned ? 2 : 1;
  });

  const locationId = `preview-${show.screen}`;
  rememberSeatLayout(seatPartnerOf(show), locationId, {
    locationId,
    rows,
    seats: placed,
    box: { x: pitch.x, y: pitch.y, w: pitch.x * (perRow - 1), h: pitch.y * (rowCount - 1) },
    pitch,
  });
  seatHalls.set(show.screen, locationId);

  return {
    status: "ready",
    at: Date.now(),
    locationId,
    capacity,
    sold,
    scanned,
    reserved: Number(show.reserved) || 0,
    unseated: 0,
    seats,
  };
}

function renderShowCard(show, now, index = 0, opts = {}) {
  const status = statusOf(show, now);
  const badge =
    status === "live"
      ? `<span class="badge live">${escapeHtml(t("now"))}</span>`
      : status === "soon"
        ? `<span class="badge soon">${escapeHtml(t("soon"))}</span>`
        : status === "done"
          ? `<span class="badge done">${doneGlyph("badge-check")}${escapeHtml(
              t("done")
            )}</span>`
          : "";

  const endLabel = show.end ? formatClock(show.end) : "…";
  const duration = show.runningLabel
    ? show.runningLabel.replace(" t. ", "t ").replace(" min.", "m")
    : formatDuration(show.runningMinutes);

  const metaBits = [
    `<span class="screen">${escapeHtml(show.screen)}</span>`,
    show.age ? `<span class="dot">${escapeHtml(show.age)}</span>` : "",
    `<span class="dot">${escapeHtml(duration)}</span>`,
    badge,
  ]
    .filter(Boolean)
    .join("");

  const spoken = spokenLanguage(show.tags);
  const langLine = spoken
    ? `<div class="meta-line lang-line"><span>${escapeHtml(
        t(spoken === "nb" ? "spokenNorwegian" : "spokenEnglish")
      )}</span></div>`
    : "";

  let progress = "";
  if (status === "live" && show.end) {
    const pct = Math.min(
      Math.round(((now - show.start) / (show.end - show.start)) * 100),
      100
    );
    const left = Math.max(Math.round((show.end - now) / 60_000), 0);
    progress = `
      <div class="live-progress">
        <div class="live-track">
          <div class="live-fill" style="width:${pct}%"></div>
          <span class="live-dot" style="left:${pct}%"></span>
        </div>
        <span class="live-left">${left} min</span>
      </div>
    `;
  }

  const admissionRow = renderAdmission(show, now, opts);
  const admissionState = admissionOf(show, now, opts)?.state || "";
  const cardClass = [
    "show-card",
    status,
    admissionState ? `has-admit admit-${admissionState}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = `
      ${renderPoster(show, 52, 74)}
      <div class="show-main">
        <div class="time-range">${formatClock(show.start)}<span class="sep">–</span>${endLabel}</div>
        <h2 class="show-title">${escapeHtml(show.title)}</h2>
        <div class="meta-line">${metaBits}</div>
        ${langLine}
        ${progress}
      </div>
      ${renderTicketCol(show)}
      ${admissionRow}
  `;

  // Link to the eBillett page so staff can jump straight to ticket sales.
  const card = show.ticketUrl
    ? `<a class="${cardClass} linked" style="--i:${index}" href="${escapeHtml(
        show.ticketUrl
      )}" target="_blank" rel="noopener">${inner}</a>`
    : `<article class="${cardClass}" style="--i:${index}">${inner}</article>`;

  // The seat chart button has to sit outside that link, so the card and
  // its fold-out share one wrapper instead of being one element.
  if (!seatChartOffered(show)) return card;
  const rowClass = ["show-row", status, seatChartExpanded(show) ? "seats-open" : ""]
    .filter(Boolean)
    .join(" ");
  return `<div class="${rowClass}" style="--i:${index}">${card}${renderSeatToggle(
    show
  )}</div>`;
}

function renderPoster(show, w, h, className = "poster") {
  if (show.posterUrl) {
    return `<img class="${className}" src="${escapeHtml(
      show.posterUrl
    )}" alt="" loading="lazy" width="${w}" height="${h}" />`;
  }
  return `<div class="${className}-fallback" aria-hidden="true">${escapeHtml(
    (show.title || "?").slice(0, 1)
  )}</div>`;
}

function renderTicketCol(show) {
  if (show.eventStatus === "unavailable") {
    return `<div class="ticket-col"><span class="ticket-missing">—</span></div>`;
  }
  if (show.eventStatus === "error") {
    return `<div class="ticket-col"><span class="ticket-missing">${escapeHtml(
      t("error")
    )}</span></div>`;
  }
  if (show.sold == null) {
    return `<div class="ticket-col"><span class="ticket-loading">…</span></div>`;
  }

  const cap = show.capacity || 0;
  const pct = cap ? Math.min(Math.round((show.sold / cap) * 100), 100) : null;
  // Zero sold renders an empty track; any sales get a visible sliver.
  const fillPct = pct == null ? null : show.sold ? Math.max(pct, 6) : 0;
  const level = pct == null ? "" : pct >= 100 ? "full" : pct >= 75 ? "high" : pct >= 40 ? "mid" : "low";

  const flag =
    cap && show.available === 0
      ? `<span class="ticket-flag full">${escapeHtml(t("soldOut"))}</span>`
      : cap && show.available != null && show.available <= 10
        ? `<span class="ticket-flag few">${escapeHtml(t("fewLeft", { n: show.available }))}</span>`
        : "";

  return `
    <div class="ticket-col">
      <div class="ticket-ratio">${show.sold}${
        cap ? `<span class="ticket-cap">/${cap}</span>` : ""
      }</div>
      ${
        pct != null
          ? `<div class="occ-track" title="${pct}%"><div class="occ-fill ${level}" style="width:${fillPct}%"></div></div>`
          : `<div class="ticket-sub">${escapeHtml(t("sold"))}</div>`
      }
      ${flag}
      ${
        show.reserved
          ? `<span class="ticket-res">${escapeHtml(t("reservedShort", { n: show.reserved }))}</span>`
          : ""
      }
    </div>
  `;
}

function groupMovies() {
  const map = new Map();
  for (const show of state.shows) {
    const key = show.title;
    if (!map.has(key)) {
      map.set(key, {
        title: show.title,
        posterUrl: show.posterUrl,
        age: show.age,
        runningLabel: show.runningLabel,
        runningMinutes: show.runningMinutes,
        tags: show.tags || [],
        shows: [],
      });
    }
    const movie = map.get(key);
    movie.shows.push(show);
    if (!movie.posterUrl && show.posterUrl) movie.posterUrl = show.posterUrl;
  }

  return [...map.values()]
    .map((m) => {
      m.shows.sort((a, b) => a.start - b.start);
      m.soldSum = m.shows.reduce((n, s) => n + soldOf(s), 0);
      return m;
    })
    .sort((a, b) => a.title.localeCompare(b.title, lang === "en" ? "en" : "nb"));
}

function renderMovies() {
  if (!state?.shows) return;
  const movies = groupMovies();
  const now = new Date();

  els.moviesContent.classList.toggle(
    "no-anim",
    els.moviesContent.dataset.rendered === "1"
  );
  els.moviesContent.dataset.rendered = "1";

  if (!movies.length) {
    els.moviesContent.innerHTML = `<div class="empty-note">${escapeHtml(
      t("noMovies")
    )}</div>`;
    return;
  }

  els.moviesContent.innerHTML = `
    <div class="view-intro">
      <h2>${escapeHtml(t("moviesTitle"))}</h2>
      <p>${escapeHtml(t("moviesSubtitle"))}</p>
    </div>
    <div class="movie-grid">
      ${movies.map((m, i) => renderMovieTile(m, now, i)).join("")}
    </div>
  `;
}

function renderMovieTile(movie, now, index = 0) {
  const duration = movie.runningLabel
    ? movie.runningLabel.replace(" t. ", "t ").replace(" min.", "m")
    : formatDuration(movie.runningMinutes);

  const meta = [movie.age, duration, movie.tags?.[0], showsLabel(movie.shows.length)]
    .filter(Boolean)
    .map((x) => escapeHtml(String(x)))
    .join(" · ");

  const progress = doneProgress(movie.shows, now);

  const times = movie.shows
    .map((show) => {
      const status = statusOf(show, now);
      const soldOut = show.capacity && show.available === 0;
      const sold =
        show.sold != null
          ? soldOut
            ? `<span class="tile-sold out">${escapeHtml(t("soldOut"))}</span>`
            : `<span class="tile-sold">${show.sold}${
                show.capacity ? `<span class="tile-cap">/${show.capacity}</span>` : ""
              }</span>`
          : "";
      const admission = admissionOf(show, now);
      const admitted =
        admission && admission.state !== "unknown"
          ? `<span class="tile-admit ${admission.state}" title="${escapeHtml(
              admissionLabel(admission)
            )}">${admissionIcon(admission.state)}${admission.scanned}</span>`
          : "";
      const inner = `
          <span class="tile-day">${escapeHtml(shortShowDay(show.dayKey))}</span>
          <span class="tile-time">${formatClock(show.start)}</span>
          <span class="tile-screen">${escapeHtml(show.screen)}</span>
          <span class="tile-nums">${sold}${admitted}</span>
      `;
      if (show.ticketUrl) {
        return `<a class="tile-show ${status}" href="${escapeHtml(
          show.ticketUrl
        )}" target="_blank" rel="noopener">${inner}</a>`;
      }
      return `<div class="tile-show ${status}">${inner}</div>`;
    })
    .join("");

  return `
    <article class="movie-tile${progress.all ? " all-done" : ""}" style="--i:${index}">
      ${renderPoster(movie, 72, 104, "movie-poster")}
      <div class="movie-tile-body">
        <div class="movie-tile-head">
          <h3 class="movie-tile-title">${escapeHtml(movie.title)}</h3>
          ${doneTag(movie.shows, { allLabel: "done", now })}
        </div>
        <p class="movie-tile-meta">${meta}</p>
        <div class="tile-shows">${times}</div>
      </div>
    </article>
  `;
}

function shortShowDay(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const today = toDayKey(new Date());
  if (dayKey === today) return t("today");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey === toDayKey(yesterday)) return t("yesterday");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey === toDayKey(tomorrow)) return t("tomorrow");
  const date = new Date(y, m - 1, d);
  const wd = capitalize(weekdays()[date.getDay()]).slice(0, 3);
  return `${wd} ${d}.${m}`;
}

function soldOf(show) {
  return show.sold != null && show.eventStatus !== "error"
    ? Number(show.sold) || 0
    : 0;
}

function isoWeekInfo(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return {
    key: `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    week,
  };
}

function weekRangeLabel(dayKeys) {
  const sorted = [...dayKeys].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const [, fm, fd] = first.split("-").map(Number);
  const [, lm, ld] = last.split("-").map(Number);
  if (first === last) return `${fd}.${fm}`;
  return `${fd}.${fm}–${ld}.${lm}`;
}

function renderStats() {
  if (!state?.shows) return;
  const shows = state.shows;
  const hasSold = shows.some((s) => s.sold != null);
  const totalSold = shows.reduce((n, s) => n + soldOf(s), 0);

  const dayMap = new Map();
  for (const show of shows) {
    const cur = dayMap.get(show.dayKey) || { day: show.dayKey, sold: 0 };
    cur.sold += soldOf(show);
    dayMap.set(show.dayKey, cur);
  }
  const todayKey = toDayKey(new Date());
  const allDays = [...dayMap.values()].sort((a, b) =>
    a.day.localeCompare(b.day)
  );

  // Weekly focus: hero + day chart follow the current ISO week. If the
  // current week has no program days (period over / not started), fall
  // back to the closest week that does.
  let weekInfo = isoWeekInfo(todayKey);
  let weekDays = allDays.filter(
    (d) => isoWeekInfo(d.day).key === weekInfo.key
  );
  if (!weekDays.length && allDays.length) {
    const pastDays = allDays.filter((d) => d.day <= todayKey);
    const anchor = pastDays[pastDays.length - 1] || allDays[0];
    weekInfo = isoWeekInfo(anchor.day);
    weekDays = allDays.filter((d) => isoWeekInfo(d.day).key === weekInfo.key);
  }
  const weekSold = weekDays.reduce((n, d) => n + d.sold, 0);

  // Chart the week's days up to the last one with sales, so future
  // zero-days don't add an empty tail but mid-week gaps stay visible.
  const lastRelevant = weekDays.reduce(
    (max, d) => (d.sold > 0 && d.day > max ? d.day : max),
    todayKey
  );
  let byDay = weekDays.filter((d) => d.day <= lastRelevant);
  if (!byDay.length) byDay = weekDays;
  const maxDaySold = Math.max(...byDay.map((d) => d.sold), 1);
  const daysWithSold = byDay.filter((d) => d.sold > 0);
  const avgDay = daysWithSold.length
    ? Math.round(weekSold / daysWithSold.length)
    : 0;
  const bestDay = daysWithSold.length
    ? [...daysWithSold].sort((a, b) => b.sold - a.sold)[0]
    : null;

  // The week chart still covers the whole period, trimmed of the
  // future zero-week tail.
  const lastSaleDay = allDays.reduce(
    (max, d) => (d.sold > 0 && d.day > max ? d.day : max),
    todayKey
  );
  const weekMap = new Map();
  for (const row of allDays.filter((d) => d.day <= lastSaleDay)) {
    const info = isoWeekInfo(row.day);
    const cur = weekMap.get(info.key) || {
      key: info.key,
      week: info.week,
      sold: 0,
      days: [],
    };
    cur.sold += row.sold;
    cur.days.push(row.day);
    weekMap.set(info.key, cur);
  }
  const byWeek = [...weekMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const maxWeekSold = Math.max(...byWeek.map((w) => w.sold), 1);

  const topSold = groupMovies()
    .map((m) => ({
      title: m.title,
      posterUrl: m.posterUrl,
      soldSum: m.shows.reduce((n, s) => n + soldOf(s), 0),
      showCount: m.shows.length,
    }))
    .filter((m) => m.soldSum > 0)
    .sort((a, b) => b.soldSum - a.soldSum)
    .slice(0, 10);

  if (!hasSold && totalSold === 0) {
    els.statsContent.innerHTML = `
      <div class="view-intro">
        <h2>${escapeHtml(t("statsTitle"))}</h2>
        <p>${escapeHtml(t("noSoldData"))}</p>
      </div>
    `;
    return;
  }

  const weekMeta = weekDays.length
    ? `${t("weekLabel", { n: weekInfo.week })} · ${weekRangeLabel(
        weekDays.map((d) => d.day)
      )}`
    : t("weekLabel", { n: weekInfo.week });

  els.statsContent.innerHTML = `
    <div class="stats-hero">
      <div class="stats-hero-main">
        <p class="stats-hero-label">${escapeHtml(t("soldWeekLabel"))}</p>
        <p class="stats-hero-value">${weekSold.toLocaleString(
          lang === "en" ? "en-GB" : "nb-NO"
        )}</p>
        <p class="stats-hero-sub">${escapeHtml(weekMeta)}</p>
      </div>
      <div class="stats-hero-side">
        <div class="stats-mini">
          <span class="stats-mini-value">${avgDay}</span>
          <span class="stats-mini-label">${escapeHtml(t("soldAvgDay"))}</span>
        </div>
        <div class="stats-mini">
          <span class="stats-mini-value">${bestDay?.sold ?? 0}</span>
          <span class="stats-mini-label">${escapeHtml(t("soldBestDay"))}${
            bestDay ? ` · ${escapeHtml(shortShowDay(bestDay.day))}` : ""
          }</span>
        </div>
      </div>
    </div>

    <section class="stats-panel">
      <div class="stats-panel-head">
        <h3>${escapeHtml(t("soldByDay"))}</h3>
        <span class="stats-panel-meta">${escapeHtml(weekMeta)}</span>
      </div>
      <div class="bar-list">
        ${byDay
          .map((row, i) => {
            const pct = Math.max((row.sold / maxDaySold) * 100, row.sold ? 4 : 0);
            return `
              <div class="bar-row" style="--i:${i}">
                <span class="bar-label">${escapeHtml(shortShowDay(row.day))}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                <span class="bar-value">${row.sold}</span>
              </div>`;
          })
          .join("")}
      </div>
    </section>

    <section class="stats-panel">
      <div class="stats-panel-head">
        <h3>${escapeHtml(t("soldByWeek"))}</h3>
        <span class="stats-panel-meta">${escapeHtml(
          t("periodTotal", {
            n: totalSold.toLocaleString(lang === "en" ? "en-GB" : "nb-NO"),
          })
        )}</span>
      </div>
      <div class="bar-list">
        ${byWeek
          .map((row, i) => {
            const pct = Math.max(
              (row.sold / maxWeekSold) * 100,
              row.sold ? 4 : 0
            );
            return `
              <div class="bar-row" style="--i:${i}">
                <div class="bar-label-stack">
                  <span class="bar-label">${escapeHtml(
                    t("weekLabel", { n: row.week })
                  )}</span>
                  <span class="bar-sub">${escapeHtml(
                    weekRangeLabel(row.days)
                  )}</span>
                </div>
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                <span class="bar-value">${row.sold}</span>
              </div>`;
          })
          .join("")}
      </div>
    </section>

    <section class="stats-panel">
      <div class="stats-panel-head">
        <h3>${escapeHtml(t("topSold"))}</h3>
      </div>
      ${
        topSold.length
          ? `<div class="top-list">
              ${topSold
                .map(
                  (m, i) => `
                <div class="rank-row" style="--i:${i}">
                  <span class="top-rank">${i + 1}</span>
                  ${renderPoster(m, 36, 52, "stats-poster")}
                  <div class="top-body">
                    <span class="top-title">${escapeHtml(m.title)}</span>
                    <span class="top-sub">${escapeHtml(showsLabel(m.showCount))}</span>
                  </div>
                  <span class="top-sold">${m.soldSum}</span>
                </div>`
                )
                .join("")}
            </div>`
          : `<p class="empty-note soft">${escapeHtml(t("noSoldData"))}</p>`
      }
    </section>
  `;
}

function renderSettings() {
  const connected = isDxConnected();
  const statusLabel = connected
    ? dxAuth.email
      ? t("dxConnectedAs", { email: dxAuth.email })
      : t("dxConnectedPat")
    : "";

  els.settingsContent.innerHTML = `
    <div class="view-intro">
      <h2>${escapeHtml(t("settingsTitle"))}</h2>
      <p>${escapeHtml(t("settingsSubtitle"))}</p>
    </div>

    <section class="settings-section">
      <div class="settings-head">
        <h3>${escapeHtml(t("language"))}</h3>
        <p>${escapeHtml(t("languageHint"))}</p>
      </div>
      <div class="segmented" role="group" aria-label="${escapeHtml(t("language"))}">
        <span class="seg-indicator" aria-hidden="true"></span>
        <button type="button" class="seg-btn" data-lang="nb" aria-pressed="${lang === "nb"}">${escapeHtml(t("langNb"))}</button>
        <button type="button" class="seg-btn" data-lang="en" aria-pressed="${lang === "en"}">${escapeHtml(t("langEn"))}</button>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-head">
        <h3>${escapeHtml(t("theme"))}</h3>
        <p>${escapeHtml(t("themeHint"))}</p>
      </div>
      <div class="segmented" role="group" aria-label="${escapeHtml(t("theme"))}">
        <span class="seg-indicator" aria-hidden="true"></span>
        <button type="button" class="seg-btn" data-theme-opt="light" aria-pressed="${theme === "light"}">${escapeHtml(t("themeLight"))}</button>
        <button type="button" class="seg-btn" data-theme-opt="dark" aria-pressed="${theme === "dark"}">${escapeHtml(t("themeDark"))}</button>
      </div>
    </section>

    <section class="settings-section dx-section">
      <div class="settings-head">
        <h3>${escapeHtml(t("dxTitle"))}</h3>
        <p>${escapeHtml(t("dxSubtitle"))}</p>
      </div>
      ${
        connected
          ? `<div class="dx-status connected">
              <p class="dx-status-title">${escapeHtml(statusLabel)}</p>
              <p class="dx-status-hint">${escapeHtml(t("dxConnectedHint"))}</p>
              ${renderDxFacts()}
              <p class="dx-msg" id="dxTestMsg" hidden></p>
              <details class="dx-advanced" id="dxDetails" hidden>
                <summary>${escapeHtml(t("dxDetails"))}</summary>
                <pre class="dx-log" id="dxLog"></pre>
              </details>
              <div class="dx-actions">
                <button type="button" class="dx-btn ghost" id="dxRefreshBtn">${escapeHtml(t("dxRefreshScans"))}</button>
                <button type="button" class="dx-btn ghost" id="dxTestBtn">${escapeHtml(t("dxTest"))}</button>
              </div>
              <button type="button" class="dx-btn ghost danger" id="dxDisconnectBtn">${escapeHtml(t("dxDisconnect"))}</button>
            </div>`
          : `<form class="dx-form" id="dxConnectForm" autocomplete="on">
              <p class="dx-hint">${escapeHtml(t("dxLoginHint"))}
                <a href="${DX_WEB_URL}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("dxOpenWeb"))}</a>
              </p>
              <label class="dx-field">
                <span>${escapeHtml(t("dxEmailLabel"))}</span>
                <input id="dxEmailInput" name="dx-email" type="email" autocomplete="username" />
              </label>
              <label class="dx-field">
                <span>${escapeHtml(t("dxPasswordLabel"))}</span>
                <input id="dxPasswordInput" name="dx-password" type="password" autocomplete="current-password" />
              </label>
              <label class="dx-check">
                <input id="dxKeepInput" type="checkbox" checked />
                <span>
                  <strong>${escapeHtml(t("dxKeepLabel"))}</strong>
                  ${escapeHtml(t("dxKeepHint"))}
                </span>
              </label>
              <p class="dx-msg" id="dxConnectMsg" hidden></p>
              <button type="submit" class="dx-btn primary" id="dxConnectBtn">${escapeHtml(t("dxConnect"))}</button>
            </form>`
      }
    </section>
  `;

  // Place each liquid indicator on the pressed button.
  els.settingsContent.querySelectorAll(".segmented").forEach((group) => {
    const indicator = group.querySelector(".seg-indicator");
    const active = group.querySelector('.seg-btn[aria-pressed="true"]');
    liquidMove(indicator, active, { instant: true });
  });

  els.settingsContent.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if ((btn.dataset.lang === "en") === (lang === "en")) return;
      lang = btn.dataset.lang === "en" ? "en" : "nb";
      savePrefs();
      segSelect(btn);
      // Let the liquid animation play before texts re-render.
      setTimeout(() => {
        applyLanguage();
        if (state?.shows) populateFilters();
        renderSettings();
        renderActiveView();
      }, 340);
    });
  });

  els.settingsContent.querySelectorAll("[data-theme-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.themeOpt === "dark" ? "dark" : "light";
      if (next === theme) return;
      applyTheme(next);
      savePrefs();
      segSelect(btn);
    });
  });

  const disconnectBtn = els.settingsContent.querySelector("#dxDisconnectBtn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", () => {
      disconnectDx();
      renderSettings();
      renderActiveView();
    });
  }

  const refreshBtn = els.settingsContent.querySelector("#dxRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = t("dxRefreshing");
      // A manual re-fetch should also revisit days already written off.
      for (const show of state?.shows || []) show.scanDone = false;
      try {
        await syncScanned({ force: true });
      } finally {
        renderSettings();
      }
    });
  }

  const testBtn = els.settingsContent.querySelector("#dxTestBtn");
  if (testBtn) {
    testBtn.addEventListener("click", () => runDxTest(testBtn));
  }

  const form = els.settingsContent.querySelector("#dxConnectForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await connectDxAccount();
    });
  }
}

/** Connection facts, so a blank admission column is never a mystery. */
function renderDxFacts() {
  const shows = (state?.shows || []).filter((s) => s.eventId);
  const withScan = shows.filter((s) => s.scanned != null).length;
  const source = dxScanStatus.source || dxAuth?.type || "—";
  const synced = dxScanStatus.at
    ? formatClock(new Date(dxScanStatus.at))
    : t("dxNeverSynced");

  const facts = [
    [t("dxSourceLabel"), source],
    [t("dxSyncedLabel"), synced],
    [
      t("dxCoverageLabel"),
      t("dxCoverageValue", { n: withScan, total: shows.length }),
    ],
    [t("dxRenewLabel"), dxAuth?.keepSignedIn ? t("dxRenewOn") : t("dxRenewOff")],
  ];

  return `<ul class="dx-facts">${facts
    .map(
      ([label, value]) =>
        `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(
          String(value)
        )}</strong></li>`
    )
    .join("")}</ul>`;
}

async function runDxTest(btn) {
  btn.disabled = true;
  btn.textContent = t("dxTesting");

  let result;
  try {
    result = await runDxScanDiagnostics();
  } catch (err) {
    result = { code: "empty", details: String(err?.message || err) };
  }

  const title = result.show
    ? `${result.show.title} ${formatClock(result.show.start)}`
    : "";
  const text =
    result.code === "ok"
      ? t("dxTestOk", { n: result.scanned, show: title })
      : result.code === "noShows"
        ? t("dxTestNoShows")
        : result.code === "auth"
          ? t("dxTestAuth")
          : t("dxTestEmpty", { show: title });

  // Rebuild first so the facts above reflect the run, then write the
  // verdict into the fresh markup.
  renderSettings();
  const msg = els.settingsContent.querySelector("#dxTestMsg");
  if (msg) {
    msg.hidden = false;
    msg.textContent = text;
    msg.classList.toggle("ok", result.code === "ok");
    msg.classList.toggle("err", result.code !== "ok");
  }
  const details = els.settingsContent.querySelector("#dxDetails");
  const log = els.settingsContent.querySelector("#dxLog");
  if (details && log && result.details) {
    details.hidden = false;
    log.textContent = result.details;
  }
}

async function connectDxAccount() {
  const email = els.settingsContent.querySelector("#dxEmailInput")?.value?.trim() || "";
  const password = els.settingsContent.querySelector("#dxPasswordInput")?.value || "";
  const keep = els.settingsContent.querySelector("#dxKeepInput")?.checked ?? true;
  const msg = els.settingsContent.querySelector("#dxConnectMsg");
  const btn = els.settingsContent.querySelector("#dxConnectBtn");

  const setMsg = (text, ok = false) => {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.classList.toggle("ok", ok);
    msg.classList.toggle("err", Boolean(text) && !ok);
  };

  if (!email || !password) {
    setMsg(t("dxNeedCreds"));
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = t("dxConnecting");
  }
  setMsg("");

  try {
    saveDxAuth(await connectWithPassword(email, password, keep));
    dxScanStatus = { at: 0, source: "", error: "" };
    // A new credential deserves a clean sweep over every day again.
    for (const show of state?.shows || []) {
      show.scannedAt = null;
      show.scanDone = false;
    }
    setMsg(t("dxConnectOk"), true);
    renderSettings();
    await syncScanned({ force: true });
    renderActiveView();
  } catch (err) {
    console.warn("DX connect failed", err);
    const code = err?.code;
    setMsg(
      code === "login"
        ? t("dxInvalidLogin")
        : code === "network"
          ? t("dxNetworkFail")
          : t("dxConnectFail")
    );
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("dxConnect");
    }
  }
}

/**
 * Email + password from the settings screen. Check-in state lives in
 * app.dx.no's purchase list, and app.dx.no sends no CORS headers at all,
 * so the sign-in and every later lookup go through the login proxy.
 */
async function connectWithPassword(email, password, keepSignedIn) {
  const session = await loginDxWebProxy(email, password);
  return {
    type: "dxweb",
    token: session.token,
    email: session.email || email,
    partnerId: session.partnerId || DX_PARTNER_ID,
    connectedAt: new Date().toISOString(),
    keepSignedIn: Boolean(keepSignedIn),
    // DX signs you out after about three days. Kept on this device only,
    // so the app can renew quietly instead of stopping mid-week.
    password: keepSignedIn ? password : undefined,
  };
}

function dxError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** POST to the DX bridge. Never throws on HTTP status — callers decide. */
async function callDxProxy(body) {
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

async function loginDxWebProxy(email, password) {
  const { status, ok, data } = await callDxProxy({ email, password });
  if (!ok || !data.token) {
    const code = data.code === "login" || status === 403 ? "login" : "auth0";
    throw dxError(data.error || `DX login ${status}`, code);
  }
  return {
    token: String(data.token),
    email: data.email || email,
    partnerId: data.partnerId || DX_PARTNER_ID,
  };
}

/**
 * Check-in counts for a batch of events, as `{ eventId: {scanned, sold} }`.
 *
 * The DX session behind the token is short-lived. The bridge renews it
 * from the Auth0 cookie by itself and hands back a fresh token; once
 * even that has aged out, sign in again with the stored password if the
 * user asked us to keep them signed in.
 */
async function fetchScannedCounts(partnerId, eventIds, { retry = true } = {}) {
  if (!dxAuth?.token || !eventIds.length) return null;

  const { status, ok, data } = await callDxProxy({
    action: "scanned",
    token: dxAuth.token,
    partnerId,
    eventIds,
  });

  if (status === 401 || status === 403) {
    if (retry && (await reauthenticateDx())) {
      return fetchScannedCounts(partnerId, eventIds, { retry: false });
    }
    throw dxError(data.error || "DX session expired", "auth");
  }
  if (!ok) {
    dxScanStatus.error = data.error || `bridge ${status}`;
    return null;
  }

  if (data.token) saveDxAuth({ ...dxAuth, token: String(data.token) });
  if (data.source) dxScanStatus.source = data.source;
  return data.counts || {};
}

/** Sign in again in the background, when we were asked to remember how. */
async function reauthenticateDx() {
  if (!dxAuth?.keepSignedIn || !dxAuth.email || !dxAuth.password) return false;
  try {
    const session = await loginDxWebProxy(dxAuth.email, dxAuth.password);
    saveDxAuth({ ...dxAuth, token: session.token });
    return true;
  } catch (err) {
    console.warn("DX re-authentication failed", err);
    return false;
  }
}

function segSelect(btn) {
  const group = btn.closest(".segmented");
  group.querySelectorAll(".seg-btn").forEach((b) => {
    b.setAttribute("aria-pressed", String(b === btn));
  });
  liquidMove(group.querySelector(".seg-indicator"), btn);
}

async function enrichVisibleDay({ force = false } = {}) {
  if (!state?.shows || !selectedDay) return;
  const dayShows = state.shows.filter(
    (s) => s.dayKey === selectedDay && s.eventId
  );
  if (!dayShows.length) return;

  const token = ++enrichToken;
  setBusy(true);
  try {
    await Promise.all(dayShows.map((show) => enrichOne(show)));
    if (token !== enrichToken) return;

    persistHistory(dayShows);
    lastLiveAt = Date.now();
    applyPreviewScanned();
    if (activeTab === "day") renderDay();
    els.statusText.textContent = t("liveAt", { time: formatClock(new Date()) });
  } finally {
    setBusy(false);
  }

  // Check-in numbers are their own pass: the visible day first so it
  // updates immediately, then everything else in the background.
  await syncScanned({ shows: dayShows, force });
  syncScanned().catch((err) => console.warn("Scan sync failed", err));
}

async function ensureAllEnriched() {
  if (enrichedAll || !state?.shows) return;
  await enrichAllShows();
}

async function enrichAllShows({ force = false } = {}) {
  if (!state?.shows) return;
  const targets = state.shows.filter(
    (s) =>
      s.eventId && (force || s.sold == null || s.eventStatus === "pending")
  );
  if (!targets.length) {
    enrichedAll = true;
    await syncScanned();
    return;
  }

  const token = ++enrichToken;
  setBusy(true);

  try {
    const batchSize = 8;
    for (let i = 0; i < targets.length; i += batchSize) {
      if (token !== enrichToken) return;
      await Promise.all(targets.slice(i, i + batchSize).map(enrichOne));
    }

    if (token !== enrichToken) return;
    persistHistory(targets);
    enrichedAll = true;
    lastLiveAt = Date.now();
    applyPreviewScanned();
    els.statusText.textContent = t("liveAt", { time: formatClock(new Date()) });
  } finally {
    setBusy(false);
  }

  await syncScanned({ force });
}

async function enrichOne(show) {
  try {
    const event = await fetchDxEvent(show);
    const end = parseLocalDateTime(event.end);
    const begin = parseLocalDateTime(event.begin);
    if (begin) show.start = begin;
    if (end) show.end = end;
    const sale = event.ticketSale || {};
    show.sold = Number(sale.sold) || 0;
    show.reserved = Number(sale.reserved) || 0;
    show.capacity = Number(sale.capacity) || null;
    show.available = sale.available != null ? Number(sale.available) : null;
    if (event.locationName) {
      show.screen = String(event.locationName)
        .replace(/\s*-\s*Kino$/i, "")
        .trim();
    }
    show.eventStatus = "ok";
  } catch (err) {
    console.warn("Live event fetch failed", show.eventId, err);
    if (show.sold == null) show.eventStatus = "error";
  }
}

/**
 * Should this show's check-in count be fetched right now?
 *
 * Past days matter as much as today — a worker looks back to see whether
 * everyone got in — so a show whose count was never fetched always
 * qualifies, however old it is. Once it has been fetched and the show is
 * well and truly over the number can no longer change, and the show is
 * marked done so later syncs skip it.
 */
function shouldFetchScan(show, now, force) {
  if (!show.eventId || !show.start) return false;
  // Nothing can be scanned long before the doors open.
  if (show.start.getTime() - now > SCAN_LEAD_MS) return false;
  // Nor when the show sold nothing — there is no one to let in.
  if (show.eventStatus === "ok" && show.sold === 0) return false;
  if (force) return true;
  if (show.scanDone) return false;
  if (!show.scannedAt) return true;
  if (now - showEndOf(show).getTime() > SCAN_FINAL_AFTER_MS) {
    return show.scanned == null;
  }
  return now - show.scannedAt >= SCAN_FRESH_MS;
}

/**
 * Fetch check-in counts for every show that needs one, across all days.
 * Resolves to true when a number actually changed, so callers know
 * whether a re-render is worth it.
 */
async function syncScanned({ shows, force = false } = {}) {
  if (!isDxConnected() || !state?.shows) return false;
  if (scanSyncRunning && !force) return false;

  const now = Date.now();
  const targets = (shows || state.shows).filter((s) =>
    shouldFetchScan(s, now, force)
  );
  if (!targets.length) return false;

  scanSyncRunning = true;
  setBusy(true);
  let changed = false;
  let fetched = 0;
  let lastError = "";
  let expired = false;

  try {
    // One bridge call covers a batch of events; each DX purchase list is
    // a heavy payload, so asking per show would be needlessly slow.
    for (const [partnerId, list] of groupByPartner(targets)) {
      for (let i = 0; i < list.length && !expired; i += SCAN_BATCH) {
        const chunk = list.slice(i, i + SCAN_BATCH);
        let counts = null;
        try {
          counts = await fetchScannedCounts(
            partnerId,
            chunk.map((s) => String(s.eventId))
          );
        } catch (err) {
          if (err?.code === "auth") {
            expired = true;
            lastError = "auth";
            break;
          }
          lastError = String(err?.message || err);
          continue;
        }

        for (const show of chunk) {
          show.scannedAt = Date.now();
          const count = counts?.[String(show.eventId)];
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
          // Nothing more can happen to a show that ended hours ago.
          if (Date.now() - showEndOf(show).getTime() > SCAN_FINAL_AFTER_MS) {
            show.scanDone = true;
          }
        }
      }
    }

    if (expired) {
      console.warn("DX credentials expired — disconnecting");
      disconnectDx();
    } else {
      dxScanStatus = {
        at: fetched ? Date.now() : dxScanStatus.at,
        source: dxScanStatus.source,
        error: fetched ? "" : lastError,
      };
    }
    persistHistory(targets);
  } finally {
    scanSyncRunning = false;
    setBusy(false);
  }

  // Losing the account changes the settings screen too; short of that,
  // leave it alone — re-rendering wipes the message a test just wrote.
  if (expired) {
    renderActiveView();
    return true;
  }
  if (changed && activeTab !== "settings") renderActiveView();
  return changed;
}

/** Shows keyed by the DX partner that owns them (Buen is the only one today). */
function groupByPartner(shows) {
  const byPartner = new Map();
  for (const show of shows) {
    const id = String(show.promoterId || dxAuth?.partnerId || DX_PARTNER_ID);
    if (!byPartner.has(id)) byPartner.set(id, []);
    byPartner.get(id).push(show);
  }
  return byPartner;
}

async function fetchDxEvent(show) {
  const promoterId = show.promoterId || DX_PARTNER_ID;
  const url = `${DX_API}/partners/${promoterId}/events/${show.eventId}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Referer: show.ticketUrl || "https://checkout.ebillett.no/",
    },
  });
  if (!res.ok) throw new Error(`DX ${res.status}`);
  return res.json();
}

/**
 * Ask the bridge about one event and report exactly what DX said, so a
 * blank admission column can be explained instead of guessed at.
 */
async function runDxScanDiagnostics() {
  if (!dxAuth?.token) return { code: "auth" };
  const show = diagnosticShow();
  if (!show) return { code: "noShows" };

  const partnerId = show.promoterId || dxAuth.partnerId || DX_PARTNER_ID;
  let result;
  try {
    result = await callDxProxy({
      action: "scanned",
      token: dxAuth.token,
      partnerId,
      eventIds: [String(show.eventId)],
      debug: true,
    });
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
    return { code: "auth", show, details: lines.join("\n") };
  }
  if (data.token) saveDxAuth({ ...dxAuth, token: String(data.token) });

  const count = ok && data.counts ? data.counts[String(show.eventId)] : null;
  if (count && typeof count.scanned === "number") {
    show.scanned = count.scanned;
    show.scannedAt = Date.now();
    if (typeof count.sold === "number" && show.sold == null) show.sold = count.sold;
    persistHistory([show]);
    dxScanStatus = {
      at: Date.now(),
      source: data.source || dxScanStatus.source,
      error: "",
    };
    return { code: "ok", scanned: count.scanned, show, details: lines.join("\n") };
  }
  return { code: "empty", show, details: lines.join("\n") };
}

/** Prefer a show that has actually been let in: the most recent past one. */
function diagnosticShow() {
  const shows = (state?.shows || []).filter((s) => s.eventId && (s.sold ?? 0) > 0);
  if (!shows.length) return null;
  const now = Date.now();
  const past = shows
    .filter((s) => s.start.getTime() <= now)
    .sort((a, b) => b.start - a.start);
  return past[0] || shows[0];
}

function parseLocalDateTime(value) {
  if (!value || typeof value !== "string") return null;
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/
  );
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

function formatLocalDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatClock(date) {
  return date.toLocaleTimeString(lang === "en" ? "en-GB" : "nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(minutes) {
  if (minutes == null) return "?";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}t ${m}m`;
  if (h) return `${h}t`;
  return `${m}m`;
}

/**
 * Reference-counted spinner: the day enrich and the check-in sync overlap
 * constantly, and whichever finished first used to stop the animation
 * while the other was still fetching.
 */
function setBusy(on) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  els.refreshBtn.classList.toggle("spinning", busyCount > 0);
}

function setLoading(isLoading) {
  els.refreshBtn.disabled = isLoading;
  setBusy(isLoading);
  if (isLoading && !state) {
    els.content.innerHTML = `
      <div class="state loading">
        <div class="spinner" aria-hidden="true"></div>
        <p>${escapeHtml(t("loading"))}</p>
      </div>
    `;
  }
}

function showError(message) {
  els.summary.hidden = true;
  els.statusText.textContent = t("error");
  els.content.innerHTML = `
    <div class="state error">
      <p>${escapeHtml(message)}</p>
      <button type="button" id="retryBtn">${escapeHtml(t("retry"))}</button>
    </div>
  `;
  document.getElementById("retryBtn")?.addEventListener("click", () =>
    load({ forceLive: true })
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
