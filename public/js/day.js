/**
 * The day view — the screen staff live in.
 *
 * A strip of days in the header; under it one page per day: a summary
 * card (what sold, who is in, what is playing now and next, the day on a
 * timeline) and a card per showing with its sold count, check-ins and
 * seat chart. Swiping drags the next day in under the finger.
 */
import {
  S,
  els,
  hooks,
  PREVIEW_SCANNED,
  WIDE_MQ,
  t,
  icon,
  escapeHtml,
  cssEscape,
  formatClock,
  formatCount,
  formatRunning,
  formatDayLabel,
  relativeDayLabel,
  weekdayShort,
  todayKey,
  dayKeyDate,
  months,
  savePrefs,
  reducedMotion,
} from "./core.js?v=dev";
import {
  programDays,
  dayShows,
  showById,
  statusOf,
  doneProgress,
  showEndOf,
  soldOf,
  spokenLanguage,
  formatAge,
  enrichVisibleDay,
} from "./data.js?v=dev";
import {
  patchList,
  posterHtml,
  specialBadges,
  statusChip,
  ticketBlock,
  admissionStrip,
  emptyState,
  hapticTick,
} from "./ui.js?v=dev";
import {
  seatChartOffered,
  seatChartExpanded,
  seatToggleHtml,
  observeAutoSeatCharts,
} from "./seats.js?v=dev";

/* —— Day strip ———————————————————————————————————————————————————— */

/** Build the strip of day chips. Called when the programme changes. */
export function renderDayStrip() {
  const strip = els.dayTabs;
  if (!strip || !S.state?.shows) return;
  const days = programDays();
  const today = todayKey();

  if (!S.selectedDay || !days.includes(S.selectedDay)) {
    S.selectedDay = days.includes(today)
      ? today
      : days.find((d) => d >= today) || days[days.length - 1] || today;
  }

  const counts = new Map();
  for (const show of S.state.shows) counts.set(show.dayKey, (counts.get(show.dayKey) || 0) + 1);

  let lastMonth = -1;
  const chips = days.map((day) => {
    const date = dayKeyDate(day);
    const month = date.getMonth();
    const marker =
      month !== lastMonth
        ? `<span class="day-month" aria-hidden="true">${escapeHtml(months()[month].slice(0, 3))}</span>`
        : "";
    lastMonth = month;
    const n = Math.min(counts.get(day) || 0, 4);
    const cls = ["day-chip", day < today ? "is-past" : "", day === today ? "is-today" : ""]
      .filter(Boolean)
      .join(" ");
    return `${marker}<button type="button" class="${cls}" role="tab" data-day="${day}" aria-selected="${
      day === S.selectedDay
    }" aria-label="${escapeHtml(formatDayLabel(day))}">
        <span class="dc-wd">${escapeHtml(day === today ? t("today") : weekdayShort(day))}</span>
        <span class="dc-num">${date.getDate()}</span>
        <span class="dc-dots" aria-hidden="true">${'<i></i>'.repeat(n)}</span>
        <span class="dc-check" aria-hidden="true">${icon("check", "icon")}</span>
      </button>`;
  });

  strip.innerHTML = `<div class="day-track"><span class="day-indicator" aria-hidden="true"></span>${chips.join(
    ""
  )}</div>`;
  markDoneDays();
  updateJumpToday();
  requestAnimationFrame(() => {
    moveDayIndicator({ instant: true });
    centerSelectedChip("auto");
  });
}

/** Tick off the days whose last showing has finished. */
export function markDoneDays() {
  if (!S.state?.shows || !els.dayTabs) return;
  const now = new Date();
  for (const chip of els.dayTabs.querySelectorAll(".day-chip")) {
    const done = doneProgress(dayShows(chip.dataset.day), now).all;
    chip.classList.toggle("is-done", done);
  }
}

function selectedChip() {
  return els.dayTabs?.querySelector('.day-chip[aria-selected="true"]');
}

export function moveDayIndicator({ instant = false } = {}) {
  const indicator = els.dayTabs?.querySelector(".day-indicator");
  const chip = selectedChip();
  if (!indicator || !chip || !chip.offsetWidth) return;
  if (instant) indicator.classList.add("no-trans");
  indicator.style.width = `${chip.offsetWidth}px`;
  indicator.style.transform = `translateX(${chip.offsetLeft}px)`;
  indicator.classList.add("is-placed");
  if (instant) {
    requestAnimationFrame(() => requestAnimationFrame(() => indicator.classList.remove("no-trans")));
  }
}

export function centerSelectedChip(behavior = "smooth") {
  const strip = els.dayTabs;
  const chip = selectedChip();
  if (!strip || !chip) return;
  const left = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
  strip.scrollTo({ left: Math.max(0, left), behavior: reducedMotion() ? "auto" : behavior });
}

/** A one-tap "I dag" when the selected day is not today. */
export function updateJumpToday() {
  const btn = els.jumpTodayBtn;
  if (!btn) return;
  const today = todayKey();
  const hasToday = programDays().includes(today);
  const away = hasToday && S.selectedDay && S.selectedDay !== today;
  btn.classList.toggle("is-shown", Boolean(away));
  btn.toggleAttribute("inert", !away);
  btn.setAttribute("aria-hidden", String(!away));
  btn.dataset.dir = S.selectedDay > today ? "back" : "forward";
}

/** Point the app at `day` and bring the strip along (not the page). */
function setSelectedDay(day, { persist = true } = {}) {
  if (!day || day === S.selectedDay) return false;
  S.selectedDay = day;
  if (persist) savePrefs();
  els.dayTabs?.querySelectorAll(".day-chip").forEach((chip) => {
    chip.setAttribute("aria-selected", String(chip.dataset.day === day));
  });
  updateJumpToday();
  moveDayIndicator();
  centerSelectedChip("smooth");
  return true;
}

/* —— Day page —————————————————————————————————————————————————————— */

/** Everything on one day's page, as keyed pieces for patchList. */
function dayItems(day) {
  const shows = dayShows(day);
  const now = new Date();
  const items = [];

  if (PREVIEW_SCANNED) {
    items.push({
      key: "preview",
      html: `<p class="banner">${escapeHtml(t("previewScannedBanner"))}</p>`,
    });
  }
  items.push({ key: "hero", html: heroHtml(day, shows, now) });

  if (!shows.length) {
    items.push({
      key: "empty",
      html: emptyState("day", t("emptyDay"), t("emptyDayHint")),
    });
    return items;
  }

  // If DX answered for some of the day's shows, the ones it skipped are
  // worth flagging; if it answered for none, stay quiet about it.
  const gaps = shows.some((s) => s.scanned != null);
  shows.forEach((show, i) => {
    const prev = shows[i - 1];
    if (prev && prev.screen === show.screen && show.end && prev.end) {
      const gapMin = Math.round((show.start - prev.end) / 60_000);
      if (gapMin >= 15) {
        items.push({
          key: `gap-${show.id}`,
          html: `<div class="gap"><span>${escapeHtml(t("gap", { n: gapMin }))}</span></div>`,
        });
      }
    }
    items.push({ key: show.id, html: showCardHtml(show, now, { gaps }) });
  });
  return items;
}

function heroHtml(day, shows, now) {
  const today = todayKey();
  const isToday = day === today;
  const future = day > today;
  const progress = doneProgress(shows, now);

  const withSold = shows.filter((s) => s.sold != null);
  const sold = shows.reduce((n, s) => n + soldOf(s), 0);
  const scanShows = shows.filter((s) => s.scanned != null && s.sold != null);
  const scanned = scanShows.reduce((n, s) => n + Math.min(Number(s.scanned) || 0, soldOf(s)), 0);
  const scanSold = scanShows.reduce((n, s) => n + soldOf(s), 0);
  const showDoors = scanShows.length > 0 && !future;

  const pill = progress.all
    ? `<span class="pill pill-done">${icon("check", "icon icon-xs")}${escapeHtml(t("dayAllDone"))}</span>`
    : progress.done
      ? `<span class="pill">${escapeHtml(t("doneCount", { n: progress.done, total: progress.total }))}</span>`
      : "";

  const kpis = shows.length
    ? `<div class="kpis">
        <div class="kpi">
          <span class="kpi-v"${withSold.length ? ` data-count="${sold}"` : ""}>${withSold.length ? formatCount(sold) : "–"}</span>
          <span class="kpi-l">${escapeHtml(t(future ? "kpiPresold" : "kpiSold"))}</span>
        </div>
        ${
          showDoors
            ? `<div class="kpi">
          <span class="kpi-v">${formatCount(scanned)}<small>/${formatCount(scanSold)}</small></span>
          <span class="kpi-l">${escapeHtml(t("kpiInside"))}</span>
        </div>`
            : `<div class="kpi">
          <span class="kpi-v">${formatClock(shows[0].start)}</span>
          <span class="kpi-l">${escapeHtml(t("kpiFirst"))}</span>
        </div>`
        }
        <div class="kpi">
          <span class="kpi-v">${shows.length}</span>
          <span class="kpi-l">${escapeHtml(t(shows.length === 1 ? "kpiShow" : "kpiShows"))}</span>
        </div>
      </div>`
    : "";

  return `<section class="card day-hero${isToday ? " is-today" : ""}${
    progress.all ? " is-done" : ""
  }" aria-label="${escapeHtml(formatDayLabel(day))}">
    <div class="hero-head">
      <div class="hero-heading">
        <p class="eyebrow">${escapeHtml(relativeDayLabel(day))}</p>
        <h2 class="hero-title">${escapeHtml(formatDayLabel(day))}</h2>
      </div>
      ${pill}
    </div>
    ${kpis}
    ${isToday ? nowNextHtml(shows, now) : ""}
    ${shows.length ? timelineHtml(day, shows, now) : ""}
  </section>`;
}

/** Today's "playing now" and "up next", the two things the door asks. */
function nowNextHtml(shows, now) {
  const live = shows.filter((s) => statusOf(s, now) === "live");
  const next = shows.find((s) => s.start > now);
  if (!live.length && !next) {
    if (doneProgress(shows, now).all) return "";
    return `<p class="nn-empty">${escapeHtml(t("noMoreToday"))}</p>`;
  }

  const items = live.map((show) => {
    const end = showEndOf(show);
    const span = end - show.start || 1;
    const pct = Math.min(100, Math.max(0, Math.round(((now - show.start) / span) * 100)));
    const left = Math.max(0, Math.round((end - now) / 60_000));
    return `<button type="button" class="nn nn-live" data-goto-show="${escapeHtml(show.id)}">
        <span class="nn-label"><span class="pulse" aria-hidden="true"></span>${escapeHtml(
          t("nowPlaying")
        )} · ${escapeHtml(show.screen)}</span>
        <span class="nn-title">${escapeHtml(show.title)}</span>
        <span class="progress" aria-hidden="true"><span style="width:${pct}%"></span></span>
        <span class="nn-sub">${escapeHtml(t("minLeft", { n: left }))} · ${escapeHtml(
          t("endsAt", { time: formatClock(end) })
        )}</span>
      </button>`;
  });

  if (next) {
    const sold = next.sold != null ? `${formatCount(next.sold)} ${t("sold")}` : "";
    items.push(`<button type="button" class="nn nn-next" data-goto-show="${escapeHtml(next.id)}">
        <span class="nn-label">${icon("clock", "icon icon-xs")}${escapeHtml(t("upNext"))} · ${escapeHtml(
          formatUntilShort(next.start - now)
        )}</span>
        <span class="nn-title">${escapeHtml(next.title)}</span>
        <span class="nn-sub">${escapeHtml(
          [formatClock(next.start), next.screen, sold].filter(Boolean).join(" · ")
        )}</span>
      </button>`);
  }
  return `<div class="nownext${items.length > 1 ? " is-pair" : ""}">${items.join("")}</div>`;
}

function formatUntilShort(ms) {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return t("inMin", { n: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? t("inHours", { h, m }) : t("inHoursFlat", { h });
}

/* —— Timeline ——————————————————————————————————————————————————————
 * Halls as lanes, showings as bars, a red line for now. The plot keeps a
 * minimum hour width so bars stay tappable; a long day scrolls sideways,
 * and today's opens with the now-line in view.
 */
const TL_MIN_PX_PER_HOUR = 38;
const HOUR = 3_600_000;

function shortScreenLabel(screen) {
  const name = String(screen || "").trim();
  if (/sal$/i.test(name) && name.length > 4) return name.slice(0, -3);
  return name;
}

function timelineHtml(day, shows, now) {
  let t0 = Math.min(...shows.map((s) => s.start.getTime()));
  let t1 = Math.max(...shows.map((s) => showEndOf(s).getTime()));
  t0 = Math.floor((t0 - 15 * 60_000) / HOUR) * HOUR;
  t1 = Math.ceil((t1 + 10 * 60_000) / HOUR) * HOUR;
  const span = t1 - t0;
  const hours = span / HOUR;
  const pct = (ms) => ((ms - t0) / span) * 100;
  const minWidth = Math.round(hours * TL_MIN_PX_PER_HOUR);

  const screens = [...new Set(shows.map((s) => s.screen))].sort((a, b) => a.localeCompare(b, "nb"));
  const lanes = screens
    .map((screen) => {
      const bars = shows
        .filter((s) => s.screen === screen)
        .map((s) => {
          const left = pct(s.start.getTime());
          const width = Math.max(pct(showEndOf(s).getTime()) - left, 1);
          const status = statusOf(s, now);
          const end = s.end ? formatClock(s.end) : `~${formatClock(showEndOf(s))}`;
          const tip = `${s.title} · ${formatClock(s.start)}–${end}`;
          return `<button type="button" class="tl-bar is-${status}" style="left:${left.toFixed(
            3
          )}%;width:${width.toFixed(3)}%" data-tl-show="${escapeHtml(s.id)}" title="${escapeHtml(
            tip
          )}" aria-label="${escapeHtml(tip)}"><strong>${formatClock(s.start)}</strong><span>${escapeHtml(
            s.title
          )}</span></button>`;
        })
        .join("");
      return `<div class="tl-lane">${bars}</div>`;
    })
    .join("");

  const step = hours > 10 && TL_MIN_PX_PER_HOUR < 44 ? 2 : 1;
  const ticks = [];
  for (let ts = t0, i = 0; ts <= t1; ts += HOUR, i++) {
    if (i % step) continue;
    ticks.push({ pct: pct(ts), label: String(new Date(ts).getHours()).padStart(2, "0") });
  }
  const grid = ticks.map((k) => `<i style="left:${k.pct.toFixed(3)}%"></i>`).join("");
  const hourLabels = ticks
    .map((k, i) => {
      const edge = i === 0 ? " is-first" : i === ticks.length - 1 ? " is-last" : "";
      return `<span class="tl-hour${edge}" style="left:${k.pct.toFixed(3)}%">${k.label}</span>`;
    })
    .join("");

  const nowTs = now.getTime();
  const showNow = day === todayKey() && nowTs >= t0 && nowTs <= t1;
  const nowLine = showNow
    ? `<div class="tl-now${pct(nowTs) < 6 ? " is-start" : pct(nowTs) > 94 ? " is-end" : ""}" style="left:${pct(nowTs).toFixed(3)}%"><span>${formatClock(now)}</span></div>`
    : "";

  return `<div class="tl" data-tl-day="${day}" ${
    showNow ? `data-now-pct="${pct(nowTs).toFixed(2)}"` : ""
  } aria-label="${escapeHtml(t("timelineAria", { day: formatDayLabel(day) }))}">
    <div class="tl-names" aria-hidden="true">${screens
      .map((s) => `<span title="${escapeHtml(s)}">${escapeHtml(shortScreenLabel(s))}</span>`)
      .join("")}</div>
    <div class="tl-scroll" data-keep-scroll="tl" data-no-swipe>
      <div class="tl-canvas" style="width:${minWidth}px">
        <div class="tl-grid" aria-hidden="true">${grid}</div>
        <div class="tl-lanes">${lanes}</div>
        ${nowLine}
        <div class="tl-hours" aria-hidden="true">${hourLabels}</div>
      </div>
    </div>
  </div>`;
}

/** Keep today's now-line in view the first time a day's timeline shows.
 * Remembered on the element itself: redraws morph it in place, so a pan
 * by the visitor survives every beat. */
function syncTimelineScroll(page) {
  const tl = page?.querySelector(".tl");
  const scroller = tl?.querySelector(".tl-scroll");
  if (!scroller || scroller._syncedDay === tl.dataset.tlDay) return;
  scroller._syncedDay = tl.dataset.tlDay;
  const max = scroller.scrollWidth - scroller.clientWidth;
  if (max <= 1) return;
  const nowPct = Number(tl.dataset.nowPct);
  if (Number.isFinite(nowPct)) {
    scroller.scrollLeft = Math.max(0, Math.min(max, (nowPct / 100) * scroller.scrollWidth - scroller.clientWidth * 0.3));
  } else {
    scroller.scrollLeft = 0;
  }
}

/* —— Show card ————————————————————————————————————————————————————— */

function showCardHtml(show, now, opts) {
  const status = statusOf(show, now);
  const isToday = show.dayKey === todayKey();
  const meta = [formatAge(show.age), formatRunning(show.runningLabel, show.runningMinutes)]
    .filter(Boolean)
    .map((x) => `<span>${escapeHtml(x)}</span>`)
    .join("");

  let progress = "";
  if (status === "live") {
    const end = showEndOf(show);
    const pct = Math.min(100, Math.max(0, Math.round(((now - show.start) / (end - show.start || 1)) * 100)));
    const left = Math.max(0, Math.round((end - now) / 60_000));
    progress = `<div class="show-progress">
        <span class="progress" aria-hidden="true"><span style="width:${pct}%"></span></span>
        <span class="show-progress-label">${escapeHtml(t("minLeft", { n: left }))}</span>
      </div>`;
  }

  const seats = seatChartOffered(show);
  const cls = [
    "card",
    "show",
    `is-${status}`,
    seats && seatChartExpanded(show) ? "seats-open" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const spoken = spokenLanguage(show.tags);
  const tags =
    specialBadges(show) +
    (spoken
      ? `<span class="tag tag-lang">${escapeHtml(t(spoken === "nb" ? "spokenNorwegian" : "spokenEnglish"))}</span>`
      : "");

  return `<article class="${cls}" data-show="${escapeHtml(show.id)}">
    <div class="show-main" role="button" tabindex="0" data-open-show="${escapeHtml(
      show.id
    )}" aria-label="${escapeHtml(t("openMovie", { title: show.title }))}">
      <div class="show-poster">${posterHtml(show, { w: 64, h: 96 })}</div>
      <div class="show-body">
        <div class="show-when">
          <span class="show-time"><strong>${formatClock(show.start)}</strong>${
            show.end ? `<span>–${formatClock(show.end)}</span>` : ""
          }</span>
          ${statusChip(show, now, { countdown: isToday })}
        </div>
        <h3 class="show-title">${escapeHtml(show.title)}</h3>
        <p class="show-meta"><span class="show-hall">${escapeHtml(show.screen)}</span>${meta}</p>
        ${tags ? `<div class="tags">${tags}</div>` : ""}
      </div>
      ${ticketBlock(show)}
    </div>
    ${progress}
    ${admissionStrip(show, now, opts)}
    ${seats ? seatToggleHtml(show) : ""}
  </article>`;
}

/* —— Rendering ——————————————————————————————————————————————————————
 * While a day change is in flight, live refreshes must not replace the
 * page under the finger; renderDay queues itself and replays on landing.
 */
let holdRender = false;
let queuedRender = false;

export function renderDay() {
  if (!S.state?.shows || !els.dayPage) return;
  if (holdRender) {
    queuedRender = true;
    return;
  }
  markDoneDays();
  const page = els.dayPage;
  const fresh = page.dataset.day !== S.selectedDay;
  page.dataset.day = S.selectedDay;
  if (fresh && !reducedMotion()) {
    page.classList.add("is-entering");
    clearTimeout(page._enterTimer);
    page._enterTimer = setTimeout(() => page.classList.remove("is-entering"), 700);
  }
  patchList(page, dayItems(S.selectedDay));
  syncTimelineScroll(page);
  observeAutoSeatCharts(page);
}

function releaseRender() {
  holdRender = false;
  if (queuedRender) {
    queuedRender = false;
    renderDay();
  }
}

/* —— Pager ————————————————————————————————————————————————————————
 * Two page elements trade places: the current one in the flow, the
 * neighbour absolutely positioned beside it while a swipe or a slide is
 * in flight. Both move with the finger 1:1, like a native pager.
 */
const COMMIT_FRAC = 0.22;
const FLICK_PX_MS = 0.32;
const LOCK_PX = 10;
const SETTLE_MS = 360;

let pager = null;

function pagerWidth() {
  return els.pager?.clientWidth || window.innerWidth || 1;
}

/** Fill the spare page with `day`, aligned to the top of the viewport. */
function prepareGhost(day) {
  const ghost = els.dayGhost;
  ghost.dataset.day = day;
  patchList(ghost, dayItems(day));
  ghost.hidden = false;
  const header = els.appbar?.offsetHeight || 0;
  const pagerTop = els.pager.getBoundingClientRect().top + window.scrollY;
  const offset = Math.max(0, window.scrollY + header - pagerTop);
  ghost.style.top = `${offset}px`;
  ghost.dataset.offset = String(offset);
}

function setX(el, x) {
  el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
}

function finishSwap(day, offset) {
  const oldPage = els.dayPage;
  const newPage = els.dayGhost;
  els.pager.classList.remove("is-settling", "is-dragging");
  newPage.classList.remove("is-ghost");
  newPage.style.top = "";
  setX(newPage, 0);
  oldPage.classList.add("is-ghost");
  oldPage.hidden = true;
  setX(oldPage, 0);
  oldPage.replaceChildren();
  delete oldPage.dataset.day;
  els.dayPage = newPage;
  els.dayGhost = oldPage;
  // The new page now sits at the top of the pager. If it slid in lower
  // down (the old day was scrolled), scroll so it stays exactly where it
  // was on screen.
  if (offset > 0) {
    const header = els.appbar?.offsetHeight || 0;
    const pagerTop = els.pager.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, pagerTop - header));
  }
  setSelectedDay(day, { persist: false });
  savePrefs();
  syncTimelineScroll(newPage);
  observeAutoSeatCharts(newPage);
  pager = null;
  releaseRender();
  enrichVisibleDay().catch((err) => console.warn("Day enrich failed", err));
}

/** Animate the pages to their resting place, then swap if committing. */
function settle(commit, dir, day) {
  const W = pagerWidth();
  const page = els.dayPage;
  const ghost = els.dayGhost;
  const offset = Number(ghost.dataset.offset) || 0;
  if (commit) {
    setSelectedDay(day, { persist: false });
  }
  if (reducedMotion()) {
    if (commit) finishSwap(day, offset);
    else cancelSwipe();
    return;
  }
  els.pager.classList.remove("is-dragging");
  els.pager.classList.add("is-settling");
  void page.offsetWidth;
  setX(page, commit ? -dir * W : 0);
  setX(ghost, commit ? 0 : dir * W);
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (commit) finishSwap(day, offset);
    else cancelSwipe();
  };
  const timer = setTimeout(end, SETTLE_MS + 60);
  ghost.addEventListener("transitionend", (e) => {
    if (e.target === ghost && e.propertyName === "transform") end();
  }, { once: true });
}

function cancelSwipe() {
  els.pager.classList.remove("is-settling", "is-dragging");
  setX(els.dayPage, 0);
  setX(els.dayGhost, 0);
  els.dayGhost.hidden = true;
  els.dayGhost.replaceChildren();
  delete els.dayGhost.dataset.day;
  pager = null;
  releaseRender();
}

/**
 * Go to `day`. From a chip tap or an arrow key the page slides the same
 * way a swipe would; off the day tab (or with reduced motion) it simply
 * swaps.
 */
export function selectDay(day, { animate = true } = {}) {
  if (!day || !S.state?.shows) return;
  if (pager) return;
  if (day === S.selectedDay) {
    if (S.activeTab === "day") window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    return;
  }
  const visible = S.activeTab === "day" && !els.views.day.hidden;
  if (!animate || !visible || reducedMotion()) {
    setSelectedDay(day);
    renderDay();
    if (visible) window.scrollTo(0, 0);
    enrichVisibleDay().catch((err) => console.warn("Day enrich failed", err));
    return;
  }
  const dir = day > S.selectedDay ? 1 : -1;
  holdRender = true;
  pager = { mode: "auto" };
  prepareGhost(day);
  els.pager.classList.add("is-dragging");
  setX(els.dayGhost, dir * pagerWidth());
  requestAnimationFrame(() => settle(true, dir, day));
}

export function stepDay(delta) {
  const days = programDays();
  const i = days.indexOf(S.selectedDay);
  const next = days[i + delta];
  if (next) selectDay(next);
}

export function setupDaySwipe() {
  const host = els.pager;
  if (!host) return;
  let pointerId = null;
  let mode = "idle"; // idle | pending | drag | ignore
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastT = 0;
  let vx = 0;
  let dx = 0;
  let dir = 0;
  let days = [];
  let idx = -1;
  let width = 1;

  host.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || !e.isPrimary || pointerId !== null || pager) return;
    if (e.target.closest?.("[data-no-swipe]")) {
      const sc = e.target.closest(".tl-scroll");
      // A timeline that fits needs no sideways scroll; let it page.
      if (!sc || sc.scrollWidth > sc.clientWidth + 1) return;
    }
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startY = e.clientY;
    lastT = e.timeStamp;
    vx = 0;
    dx = 0;
    dir = 0;
    mode = "pending";
  });

  host.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId || (mode !== "pending" && mode !== "drag")) return;
    const x = e.clientX;
    if (mode === "pending") {
      const mx = x - startX;
      const my = e.clientY - startY;
      if (Math.abs(my) > LOCK_PX && Math.abs(my) >= Math.abs(mx)) {
        mode = "ignore";
        return;
      }
      if (Math.abs(mx) < LOCK_PX || Math.abs(mx) < Math.abs(my) * 1.2) return;
      days = programDays();
      idx = days.indexOf(S.selectedDay);
      if (idx === -1) {
        mode = "ignore";
        return;
      }
      width = pagerWidth();
      startX = x;
      lastX = x;
      lastT = e.timeStamp;
      mode = "drag";
      holdRender = true;
      pager = { mode: "drag" };
      host.classList.add("is-dragging");
      try {
        host.setPointerCapture(pointerId);
      } catch {
        /* best effort */
      }
    }

    const dt = e.timeStamp - lastT;
    if (dt > 0) {
      const inst = (x - lastX) / dt;
      vx = dt < 64 ? inst * 0.6 + vx * 0.4 : inst;
      lastX = x;
      lastT = e.timeStamp;
    }

    let move = x - startX;
    const want = move < 0 ? 1 : move > 0 ? -1 : dir;
    const target = days[idx + want];
    if (!target) {
      // Rubber band at either end of the programme.
      move *= 0.22;
      els.dayGhost.hidden = true;
      dir = 0;
    } else if (want !== dir) {
      dir = want;
      prepareGhost(target);
    }
    dx = move;
    setX(els.dayPage, dx);
    if (dir) setX(els.dayGhost, dx + dir * width);
  });

  const release = (e, cancelled) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (mode !== "drag") {
      mode = "idle";
      return;
    }
    mode = "idle";
    const target = dir ? days[idx + dir] : null;
    if (!target || cancelled) {
      if (target) settle(false, dir, target);
      else {
        els.pager.classList.add("is-settling");
        setX(els.dayPage, 0);
        setTimeout(cancelSwipe, SETTLE_MS);
      }
      return;
    }
    const projected = dx + vx * 160;
    const sameWay = dir === 1 ? vx <= FLICK_PX_MS * 0.5 : vx >= -FLICK_PX_MS * 0.5;
    const commit =
      (dir === 1 && (projected < -width * COMMIT_FRAC || vx < -FLICK_PX_MS) && sameWay) ||
      (dir === -1 && (projected > width * COMMIT_FRAC || vx > FLICK_PX_MS) && sameWay);
    if (commit) hapticTick();
    settle(commit, dir, target);
  };
  host.addEventListener("pointerup", (e) => release(e, false));
  host.addEventListener("pointercancel", (e) => release(e, true));
  host.addEventListener("lostpointercapture", (e) => {
    if (e.target === host && pointerId === e.pointerId) release(e, false);
  });
}

/* —— Navigation into a showing ————————————————————————————————————— */

/** Open the day a showing is on and bring its card into view. */
export function focusShow(showId) {
  const show = showById(showId);
  if (!show) return;
  const go = () => {
    const card = els.dayPage?.querySelector(`[data-show="${cssEscape(showId)}"]`);
    if (!card) return;
    const header = els.appbar?.offsetHeight || 0;
    const top = card.getBoundingClientRect().top + window.scrollY - header - 16;
    const rect = card.getBoundingClientRect();
    const fits = rect.height < window.innerHeight - header - 120;
    window.scrollTo({
      top: fits ? top - (window.innerHeight - header - rect.height) / 3 : top,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
    setTimeout(() => card.classList.remove("is-flash"), 1600);
  };

  if (S.activeTab !== "day") {
    if (show.dayKey !== S.selectedDay) setSelectedDay(show.dayKey);
    hooks.setTab("day");
    requestAnimationFrame(() => requestAnimationFrame(go));
    return;
  }
  if (show.dayKey !== S.selectedDay) {
    selectDay(show.dayKey);
    setTimeout(go, reducedMotion() ? 0 : SETTLE_MS + 120);
    return;
  }
  go();
}

/** Open a day on the day tab. */
export function goToDay(dayKey) {
  if (!programDays().includes(dayKey)) return;
  if (S.activeTab !== "day") {
    setSelectedDay(dayKey);
    hooks.setTab("day");
  } else {
    selectDay(dayKey);
  }
}

export function setupDayInteractions() {
  els.dayTabs?.addEventListener("click", (e) => {
    const chip = e.target.closest(".day-chip");
    if (chip) selectDay(chip.dataset.day);
  });
  // Let mouse users scroll the day strip with the wheel.
  els.dayTabs?.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        els.dayTabs.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );
  els.jumpTodayBtn?.addEventListener("click", () => selectDay(todayKey()));

  document.addEventListener("click", (e) => {
    const bar = e.target.closest?.("[data-tl-show]");
    if (bar) {
      focusShow(bar.dataset.tlShow);
      return;
    }
    const goto = e.target.closest?.("[data-goto-show]");
    if (goto && !goto.closest(".sheet")) {
      focusShow(goto.dataset.gotoShow);
      return;
    }
    const open = e.target.closest?.("[data-open-show]");
    if (open) {
      const show = showById(open.dataset.openShow);
      if (show) hooks.openMovie({ title: show.title, showId: show.id });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const open = e.target.closest?.('[data-open-show][role="button"]');
    if (!open || e.target !== open) return;
    e.preventDefault();
    const show = showById(open.dataset.openShow);
    if (show) hooks.openMovie({ title: show.title, showId: show.id });
  });

  // Rotation or a resized window: re-seat the indicator and re-centre
  // the selected day once the layout has settled.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    moveDayIndicator({ instant: true });
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      moveDayIndicator({ instant: true });
      centerSelectedChip("auto");
    }, 150);
  });
  WIDE_MQ.addEventListener?.("change", () => renderDay());
}
