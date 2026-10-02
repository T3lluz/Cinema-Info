/**
 * Cinema Info — Buen kino, for the people working it.
 *
 * This is the entry point: it reads the settings, wires the modules
 * together through `hooks`, runs the five-second beat that keeps every
 * number live, and handles what makes it feel like an installed app —
 * tabs, pull to refresh, the back gesture, updates, keeping the screen on.
 */
import {
  S,
  els,
  hooks,
  TAB_ORDER,
  DARK_MQ,
  SEATS_OPEN_MQ,
  WIDE_MQ,
  t,
  icon,
  escapeHtml,
  formatClock,
  todayKey,
  headerHeight,
  barHeight,
  loadPrefs,
  savePrefs,
  reducedMotion,
} from "./core.js?v=dev";
import {
  BEAT_MS,
  PROGRAM_RECHECK_MS,
  load,
  reloadProgramIfChanged,
  refreshLive,
  syncScanned,
  enrichVisibleDay,
  refreshForTab,
  programDays,
  setStatus,
} from "./data.js?v=dev";
import {
  patchList,
  setupHaptics,
  setupTapRescue,
  setupMotion,
  setupHScroll,
  syncHScroll,
  setupNotice,
  refreshNotice,
  slideTo,
  toast,
  hapticTick,
} from "./ui.js?v=dev";
import { setupSeatCharts, refreshOpenSeatCharts } from "./seats.js?v=dev";
import { pullServerLive } from "./live.js?v=dev";
import {
  renderDay,
  renderDayStrip,
  markDoneDays,
  moveDayIndicator,
  centerSelectedChip,
  setupDaySwipe,
  setupDayInteractions,
  focusShow,
  goToDay,
  selectDay,
  stepDay,
  updateJumpToday,
} from "./day.js?v=dev";
import { renderMovies, setupMovies, focusSearch, refreshSearchLanguage } from "./movies.js?v=dev";
import { renderStats, setupStats } from "./stats.js?v=dev";
import { renderSettings, setupSettings } from "./settings.js?v=dev";
import { armRipple, playRipple, warmRipple } from "./ripple.js?v=dev";
import { openMovie, setupSheet, isSheetOpen, refreshSheet } from "./sheet.js?v=dev";

/** A selection left longer ago than this is not restored: open on today. */
const RESUME_MS = 30 * 60 * 1000;

function boot() {
  collectElements();
  const prefs = loadPrefs();
  const fresh = Date.now() - (Number(prefs.selectedDayAt) || 0) < RESUME_MS;
  const wanted = new URLSearchParams(location.search).get("tab");
  S.selectedDay = fresh ? prefs.selectedDay || "" : "";
  S.activeTab = TAB_ORDER.includes(wanted) ? wanted : fresh && TAB_ORDER.includes(prefs.activeTab) ? prefs.activeTab : "day";
  S.lang = prefs.lang === "en" ? "en" : "nb";
  S.theme = ["light", "dark", "system"].includes(prefs.theme) ? prefs.theme : "system";
  S.showSeatNumbers = prefs.showSeatNumbers !== false;
  S.hapticsOn = prefs.haptics !== false;
  S.keepAwake = prefs.keepAwake === true;
  S.statsPeriod = prefs.statsPeriod === "month" ? "month" : "week";
  S.rippleOn = prefs.ripple !== false;
  if (wanted) {
    // A home-screen shortcut opened us; don't keep the tab in the URL.
    const url = new URL(location.href);
    url.searchParams.delete("tab");
    history.replaceState(history.state, "", url);
  }

  wireHooks();
  applyTheme(S.theme, { silent: true });
  DARK_MQ.addEventListener?.("change", () => {
    if (S.theme === "system") applyTheme("system");
  });
  applyLanguage();

  setupHaptics();
  setupTapRescue();
  setupMotion();
  setupHScroll();
  setupNotice();
  setupSeatCharts();
  setupDayInteractions();
  setupDaySwipe();
  setupMovies();
  setupStats();
  setupSettings();
  setupSheet();
  setupTabs();
  setupStatus();
  setupPullToRefresh();
  setupKeyboard();
  setupAppbarShadow();
  setupConnectivity();
  setupServiceWorker();
  setupInstall();

  setTab(S.activeTab, { initial: true });

  setInterval(liveBeat, BEAT_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // A phone in a pocket runs no beats; pick straight up again.
    rollToTodayIfStale();
    liveBeat();
    applyWakeLock();
    maybeCheckUpdate();
  });
  SEATS_OPEN_MQ.addEventListener?.("change", () => {
    if (S.activeTab === "day") renderDay();
  });

  start();
}

/** Resolves the first time a real page (not the skeleton) is on screen. */
let firstPaint = null;
const firstPainted = new Promise((resolve) => (firstPaint = resolve));

async function start() {
  // The opening ripple, once the first real page is on screen.
  armRipple(firstPainted);
  // The Movies tab, built ahead while the app is idle, posters and all.
  firstPainted.then(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    idle(() => S.activeTab !== "movies" && renderMovies({ background: true }), { timeout: 4000 });
    // And the ripple's WebGL, so the first pull does not stutter making it.
    idle(warmRipple, { timeout: 6000 });
  });
  await load({ forceLive: true });
  applyWakeLock();
  // Backfill check-in counts for every day in the background, so flipping
  // back to yesterday already has numbers.
  syncScanned({ quiet: true }).catch((err) => console.warn("Scan backfill failed", err));
}

function collectElements() {
  const $ = (id) => document.getElementById(id);
  Object.assign(els, {
    app: $("app"),
    appbar: $("appbar"),
    statusBtn: $("statusBtn"),
    statusText: $("statusText"),
    dayDock: $("dayDock"),
    dayBar: $("dayBar"),
    dayTabs: $("dayTabs"),
    jumpTodayBtn: $("jumpTodayBtn"),
    tabbar: $("tabbar"),
    tabIndicator: document.querySelector(".tab-indicator"),
    pager: $("pager"),
    dayPage: $("dayPage"),
    dayGhost: $("dayGhost"),
    moviesHead: $("moviesHead"),
    moviesBody: $("moviesBody"),
    searchInput: $("searchInput"),
    searchClear: $("searchClear"),
    searchResults: $("searchResults"),
    statsContent: $("statsContent"),
    settingsContent: $("settingsContent"),
    sheet: $("sheet"),
    sheetPanel: document.querySelector("#sheet .sheet-panel"),
    sheetBody: $("sheetBody"),
    toasts: $("toasts"),
    views: {
      day: $("view-day"),
      movies: $("view-movies"),
      stats: $("view-stats"),
      settings: $("view-settings"),
    },
  });
}

function wireHooks() {
  hooks.render = renderActive;
  hooks.renderStatus = renderStatus;
  hooks.programChanged = () => renderDayStrip();
  hooks.loadError = showLoadError;
  hooks.goToShow = focusShow;
  hooks.goToDay = goToDay;
  hooks.openMovie = openMovie;
  hooks.setTab = setTab;
  hooks.applyTheme = applyTheme;
  hooks.languageChanged = () => {
    applyLanguage();
    renderDayStrip();
    refreshSearchLanguage();
    refreshNotice();
    renderActive();
  };
  hooks.applyWakeLock = applyWakeLock;
  hooks.installState = installState;
  hooks.install = promptInstall;
  hooks.checkUpdate = checkUpdate;
  hooks.pullLive = pullServerLive;
}

/* —— Rendering ———————————————————————————————————————————————————— */

function renderActive() {
  if (!S.state?.shows) return;
  if (S.activeTab === "day") renderDay();
  else if (S.activeTab === "movies") renderMovies();
  else if (S.activeTab === "stats") renderStats();
  else renderSettings();
  refreshSheet();
  syncHScroll();
  firstPaint?.();
  firstPaint = null;
}

function showLoadError(message) {
  patchList(els.dayPage, [
    {
      key: "error",
      html: `<div class="empty is-error">
        <span class="empty-icon">${icon("offline")}</span>
        <p class="empty-title">${escapeHtml(message)}</p>
        <button type="button" class="btn btn-primary" data-action="retry">${escapeHtml(t("retry"))}</button>
      </div>`,
    },
  ]);
}

/* —— Beat ——————————————————————————————————————————————————————————
 * Every beat: redraw what the clock has moved (progress bars, the
 * now-line, a showing that just finished), then send off whatever
 * figures have come due. Each job skips a beat if its last run is still
 * going, so a slow purchase list never queues up behind itself.
 */
const beatJobs = new Set();

function beatJob(name, run) {
  if (beatJobs.has(name)) return;
  beatJobs.add(name);
  Promise.resolve()
    .then(run)
    .catch((err) => console.warn(`Live beat (${name}) failed`, err))
    .finally(() => beatJobs.delete(name));
}

function liveBeat() {
  if (document.visibilityState !== "visible" || !S.state?.shows) return;
  renderActive();
  markDoneDays();
  renderStatus();
  beatJob("program", async () => {
    if (Date.now() - S.lastProgramAt < PROGRAM_RECHECK_MS) return;
    await reloadProgramIfChanged();
  });
  // The server's answer first: whatever it covered is stamped fresh, so
  // the three reads below only go to DX for what it left out.
  const pulled = pullServerLive();
  beatJob("live", () => pulled.then(() => refreshLive({ quiet: true })));
  beatJob("scan", () => pulled.then(() => syncScanned({ quiet: true })));
  beatJob("seats", () => pulled.then(() => refreshOpenSeatCharts({ quiet: true })));
}

let sessionDay = todayKey();

/** If the device slept past midnight, move the selection to the new today. */
function rollToTodayIfStale() {
  const today = todayKey();
  if (today === sessionDay || !S.state?.shows) return;
  sessionDay = today;
  if (programDays().includes(today)) S.selectedDay = today;
  renderDayStrip();
  renderActive();
}

/* —— Tabs ——————————————————————————————————————————————————————————— */

const scrollMemory = {};

function setTab(tab, { initial = false } = {}) {
  if (!els.views[tab]) return;
  const prev = S.activeTab;
  if (!initial && prev === tab) {
    // Tapping the tab you are on: on Days, straight back to today (one
    // tap, wherever the page is scrolled); otherwise back to the top.
    popTabIcon(tab);
    const today = todayKey();
    if (tab === "day" && S.selectedDay !== today && programDays().includes(today)) selectDay(today);
    else if (window.scrollY > 4) window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    return;
  }
  if (!initial) {
    scrollMemory[prev] = window.scrollY;
    if (prev === "day") scrollMemory.dayKey = S.selectedDay;
  }
  S.activeTab = tab;
  savePrefs();
  document.body.dataset.tab = tab;

  for (const [key, view] of Object.entries(els.views)) view.hidden = key !== tab;
  for (const btn of els.tabbar.querySelectorAll(".tab")) {
    const on = btn.dataset.tab === tab;
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
  }
  moveTabIndicator({ instant: initial });
  if (!initial) popTabIcon(tab);

  const view = els.views[tab];
  if (!initial && !reducedMotion()) {
    // Slide in from the side the tab sits on, the way the indicator moves.
    view.dataset.dir = TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(prev) ? "next" : "prev";
    view.classList.remove("is-entering");
    void view.offsetWidth;
    view.classList.add("is-entering");
    clearTimeout(view._enter);
    view._enter = setTimeout(() => view.classList.remove("is-entering"), 700);
  }

  renderActive();
  if (tab === "day") {
    // The strip could not be measured while hidden; seat it now.
    requestAnimationFrame(() => {
      moveDayIndicator({ instant: true });
      centerSelectedChip("auto");
      updateJumpToday();
      syncHScroll();
    });
  }
  if (!initial) {
    // Back on Days but on another day than you left (a day picked from
    // Stats, say): its top, not wherever the old day was scrolled to.
    const otherDay = tab === "day" && scrollMemory.dayKey !== S.selectedDay;
    window.scrollTo(0, otherDay ? 0 : scrollMemory[tab] || 0);
  }
  hooks.headerChanged();

  if (!S.state?.shows) return;
  if (tab === "day") {
    const stale =
      Date.now() - S.lastLiveAt > 60_000 ||
      S.state.shows.some((s) => s.dayKey === S.selectedDay && s.eventId && s.sold == null);
    if (stale) enrichVisibleDay().catch((err) => console.warn("Day enrich failed", err));
  }
}

function moveTabIndicator({ instant = false } = {}) {
  const ind = els.tabIndicator;
  const btn = els.tabbar?.querySelector('.tab[aria-selected="true"]');
  if (!ind || !btn) return;
  slideTo(
    ind,
    { x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight },
    // The bar is a row on phones and a column (the rail) on desktop.
    { axis: WIDE_MQ.matches ? "y" : "x", instant }
  );
  ind.classList.add("is-placed");
}

/** The tab's icon plays its little animation (and again on a re-tap). */
function popTabIcon(tab) {
  if (reducedMotion()) return;
  const btn = els.tabbar?.querySelector(`.tab[data-tab="${tab}"]`);
  if (!btn) return;
  btn.classList.remove("is-pop");
  void btn.offsetWidth;
  btn.classList.add("is-pop");
  clearTimeout(btn._pop);
  btn._pop = setTimeout(() => btn.classList.remove("is-pop"), 900);
}

function setupTabs() {
  els.tabbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) setTab(btn.dataset.tab);
  });
  // Arrow keys move between tabs, as a tablist should.
  els.tabbar.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const tabs = [...els.tabbar.querySelectorAll(".tab")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    next.focus();
    setTab(next.dataset.tab);
  });
  const ro = "ResizeObserver" in window ? new ResizeObserver(() => moveTabIndicator({ instant: true })) : null;
  ro?.observe(els.tabbar);
  window.addEventListener("resize", () => moveTabIndicator({ instant: true }));
  document.fonts?.ready?.then(() => moveTabIndicator({ instant: true }));

  document.addEventListener("click", (e) => {
    if (e.target.closest('[data-action="retry"]')) load({ forceLive: true });
  });
}

/* —— Status chip ————————————————————————————————————————————————————— */

function statusLabel() {
  const { kind, at } = S.status;
  const time = at ? formatClock(new Date(at)) : "";
  if (kind === "live") return t("statusLive", { time });
  if (kind === "snapshot") return t("statusSnapshot", { time });
  if (kind === "offline") return t("statusOffline");
  if (kind === "error") return t("statusError");
  return t("statusLoading");
}

function renderStatus() {
  const btn = els.statusBtn;
  if (!btn) return;
  let kind = S.status.kind;
  // Live but quiet for a while (DX slow or unreachable): stop claiming it.
  if (kind === "live" && Date.now() - S.lastLiveAt > 3 * 60_000) kind = "stale";
  btn.dataset.kind = kind;
  btn.classList.toggle("is-busy", S.busy > 0);
  const label = statusLabel();
  if (els.statusText.textContent !== label) els.statusText.textContent = label;
  btn.setAttribute("aria-label", t("statusAria", { status: label }));
}

function setupStatus() {
  els.statusBtn?.addEventListener("click", refreshAll);
}

/* —— Theme & language ——————————————————————————————————————————————— */

const THEME_COLORS = { light: "#f4f2ef", dark: "#0c0c0e" };

function applyTheme(next, { silent = false } = {}) {
  S.theme = next;
  const resolved = next === "system" ? (DARK_MQ.matches ? "dark" : "light") : next;
  const root = document.documentElement;
  if (!silent && !reducedMotion()) {
    root.classList.add("theme-anim");
    clearTimeout(applyTheme._t);
    applyTheme._t = setTimeout(() => root.classList.remove("theme-anim"), 420);
  }
  root.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[resolved];
}

function applyLanguage() {
  document.documentElement.lang = S.lang === "en" ? "en" : "nb";
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
  }
  renderStatus();
  requestAnimationFrame(() => moveTabIndicator({ instant: true }));
}

/* —— Pull to refresh ————————————————————————————————————————————————
 * The DailyDash way: no spinner. The page under the header follows the
 * finger, a light tick every tenth of the way, a firmer click the moment
 * a release would refresh. Let go there and the page springs back, the
 * programme and every live figure are read again, and the liquid ripple
 * runs out from the header — the only sign it ran. The browser's own
 * pull-to-refresh is switched off (overscroll-behavior) so it cannot
 * reload the page.
 */
const PULL_THRESHOLD = 72;
const PULL_TICKS = 10;
const PULL_FOLLOW = 0.6;

/** One manual reload at a time; a second ask joins the one running. */
let manualReload = null;
function reloadAll() {
  manualReload ||= load({ forceLive: true }).finally(() => (manualReload = null));
  return manualReload;
}

/** Read everything again and let the ripple say so. Always answers the
 * tap, even while a background fetch (the one a day change starts, say)
 * is still running — that used to swallow it without a sign. */
async function refreshAll() {
  const done = reloadAll();
  playRipple();
  await done;
}

function setupPullToRefresh() {
  const root = document.documentElement;
  let startY = 0;
  let startX = 0;
  let mode = "idle"; // idle | pending | pull
  let pull = 0;
  let lastTick = 0;
  let armed = false;

  const set = (y) => {
    pull = y;
    root.style.setProperty("--pull-y", `${(y * PULL_FOLLOW).toFixed(1)}px`);
    const fraction = y / PULL_THRESHOLD;
    const tick = Math.min(PULL_TICKS, Math.floor(fraction * PULL_TICKS));
    if (fraction >= 1) {
      if (!armed) {
        // Past the point of no return: the click, and the wave starts
        // running out from the header under the finger, as in DailyDash.
        hapticTick("medium");
        playRipple({ follow: true });
      }
      armed = true;
    } else {
      if (armed) armed = false;
      if (tick > lastTick) hapticTick("light");
    }
    lastTick = tick;
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      if (isSheetOpen() || e.touches.length !== 1) return;
      if (window.scrollY > 0 || e.target.closest?.(".tl-scroll, .carousel, .day-strip, .cast, .sheet, .tabbar")) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      mode = "pending";
    },
    { passive: true }
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (mode !== "pending" && mode !== "pull") return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (mode === "pending") {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          mode = "idle";
          return;
        }
        if (dy < 8 || window.scrollY > 0) return;
        mode = "pull";
        lastTick = 0;
        armed = false;
        root.classList.remove("is-pull-settling");
        root.classList.add("is-pulling");
      }
      set(Math.max(0, Math.min(140, (dy - 8) * 0.5)));
    },
    { passive: true }
  );
  const end = () => {
    if (mode !== "pull") {
      if (mode === "pending") mode = "idle";
      return;
    }
    mode = "idle";
    const go = armed;
    armed = false;
    root.classList.remove("is-pulling");
    root.classList.add("is-pull-settling");
    root.style.setProperty("--pull-y", "0px");
    pull = 0;
    const settle = reducedMotion() ? 0 : 420;
    setTimeout(() => {
      root.classList.remove("is-pull-settling");
      root.style.removeProperty("--pull-y");
    }, settle);
    if (!go) return;
    hapticTick("strong");
    reloadAll().catch(() => {});
  };
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", end, { passive: true });
}

/* —— Keyboard ——————————————————————————————————————————————————————— */

function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (isSheetOpen()) return;
    const key = e.key;
    if (S.activeTab === "day" && (key === "ArrowLeft" || key === "ArrowRight")) {
      if (e.target.closest?.(".tabbar, .seg")) return;
      e.preventDefault();
      stepDay(key === "ArrowRight" ? 1 : -1);
    } else if (key === "t" || key === "T") {
      goToDay(todayKey());
    } else if (key === "/") {
      e.preventDefault();
      setTab("movies");
      requestAnimationFrame(focusSearch);
    } else if (/^[1-4]$/.test(key)) {
      setTab(TAB_ORDER[Number(key) - 1]);
    } else if (key === "r" || key === "R") {
      refreshAll();
    }
  });
}

/* —— Chrome ————————————————————————————————————————————————————————— */

/**
 * The header is one sheet of frosted glass (#headerGlass) behind the
 * brand row. A bar that pins under it — the day strip, or the stats
 * period switch — drops its own glass when it docks and the sheet grows
 * to cover it, so the two read as one panel with no seam between them.
 * The hairline and shadow sit at the bottom of the whole panel.
 */
function dockedBar() {
  if (S.activeTab === "day") return els.dayDock;
  return els.views[S.activeTab]?.querySelector(".period-bar") || null;
}

function setupAppbarShadow() {
  const glass = document.getElementById("headerGlass");
  const root = document.documentElement.style;
  let queued = false;
  let joined = null;
  const update = () => {
    queued = false;
    const bar = barHeight();
    const scrolled = window.scrollY > 4;
    const dock = dockedBar();
    const docked =
      scrolled && dock?.offsetHeight > 0 && dock.getBoundingClientRect().top <= bar + 0.5 ? dock : null;
    if (joined && joined !== docked) joined.classList.remove("is-docked");
    docked?.classList.add("is-docked");
    joined = docked;
    root.setProperty("--glass-h", `${bar + (docked ? docked.offsetHeight : 0)}px`);
    glass?.classList.toggle("is-scrolled", scrolled);
  };
  // Sticky pieces below the bars (stats period, desktop day summary, the
  // pull-to-refresh bubble) need their real heights, which change per tab.
  const measure = () => {
    root.setProperty("--bar-h", `${barHeight()}px`);
    root.setProperty("--appbar-h", `${headerHeight()}px`);
    update();
  };
  if ("ResizeObserver" in window && els.appbar) {
    const ro = new ResizeObserver(measure);
    ro.observe(els.appbar);
    if (els.dayDock) ro.observe(els.dayDock);
  }
  measure();
  hooks.headerChanged = measure;
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    },
    { passive: true }
  );
}

function setupConnectivity() {
  window.addEventListener("offline", () => {
    setStatus("offline");
    toast(t("offlineToast"), { id: "net", kind: "warn", timeout: 4000 });
  });
  window.addEventListener("online", () => {
    toast(t("backOnline"), { id: "net", timeout: 1800 });
    load({ forceLive: true, silent: true }).then(() => refreshForTab());
  });
}

/* —— Keep the screen on ——————————————————————————————————————————————— */

let wakeLock = null;

async function applyWakeLock() {
  if (!("wakeLock" in navigator)) return;
  if (S.keepAwake && document.visibilityState === "visible") {
    if (wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    } catch {
      wakeLock = null;
    }
  } else if (wakeLock) {
    try {
      await wakeLock.release();
    } catch {
      /* already gone */
    }
    wakeLock = null;
  }
}

/* —— Service worker & updates —————————————————————————————————————————
 * The worker serves the app offline. A deploy installs a new worker in
 * the background; when it takes over, a hidden app reloads itself and a
 * visible one offers the update instead of yanking the page.
 */
let swReg = null;
let lastUpdateCheck = 0;

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (local) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    return;
  }
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      swReg = reg;
    })
    .catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    if (document.visibilityState === "hidden") {
      reloading = true;
      location.reload();
      return;
    }
    toast(t("updateReady"), {
      id: "update",
      action: t("updateNow"),
      sticky: true,
      onAction: () => {
        reloading = true;
        location.reload();
      },
    });
  });
}

async function checkUpdate() {
  lastUpdateCheck = Date.now();
  if (!swReg) return false;
  try {
    await swReg.update();
  } catch {
    return false;
  }
  return Boolean(swReg.installing || swReg.waiting);
}

function maybeCheckUpdate() {
  if (Date.now() - lastUpdateCheck > 10 * 60_000) checkUpdate();
}

/* —— Install ————————————————————————————————————————————————————————— */

let installPrompt = null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function installState() {
  if (isStandalone()) return "installed";
  if (installPrompt) return "available";
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "ios";
  return "none";
}

async function promptInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  try {
    await installPrompt.userChoice;
  } catch {
    /* dismissed */
  }
  installPrompt = null;
  if (S.activeTab === "settings") renderSettings();
}

function setupInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    if (S.activeTab === "settings") renderSettings();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (S.activeTab === "settings") renderSettings();
  });
}

// Last, so every const above is initialised before boot reads it.
boot();
