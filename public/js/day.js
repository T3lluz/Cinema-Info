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
  formatUntil,
  formatRunning,
  formatDayLabel,
  relativeDayLabel,
  weekdayShort,
  todayKey,
  dayKeyDate,
  months,
  savePrefs,
  reducedMotion,
  headerHeight,
} from "./core.js?v=dev";
import {
  programDays,
  dayShows,
  showById,
  statusOf,
  doneProgress,
  showEndOf,
  adsStartOf,
  filmStartOf,
  turnaroundMin,
  TIGHT_TURNAROUND_MIN,
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
  hscroll,
  syncHScroll,
  slideTo,
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
    syncHScroll(els.dayBar);
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
  slideTo(
    indicator,
    { x: chip.offsetLeft, y: chip.offsetTop, w: chip.offsetWidth, h: chip.offsetHeight },
    { instant }
  );
  indicator.classList.add("is-placed");
}

/**
 * Bring the selected day to the middle of the strip. With `ifNeeded` a
 * day already well in view (clear of the strip's edges and of "I dag")
 * stays put: the strip does not slide away from under the finger on every
 * tap or swipe, only when the day nears an edge.
 */
export function centerSelectedChip(behavior = "smooth", { ifNeeded = false } = {}) {
  const strip = els.dayTabs;
  const chip = selectedChip();
  if (!strip || !chip) return;
  if (ifNeeded) {
    const s = strip.getBoundingClientRect();
    let roomLeft = 44;
    let roomRight = 44;
    const jump = els.jumpTodayBtn;
    if (jump?.classList.contains("is-shown")) {
      const j = jump.getBoundingClientRect();
      if (jump.dataset.dir === "back") roomLeft = Math.max(roomLeft, j.right - s.left + 8);
      else roomRight = Math.max(roomRight, s.right - j.left + 8);
    }
    const x = chip.offsetLeft - strip.scrollLeft;
    if (x >= roomLeft && x + chip.offsetWidth <= strip.clientWidth - roomRight) return;
  }
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
  // Not inert while it fades: a quick second tap must land on the fading
  // button (and do nothing), not fall through to the day under it. Once
  // faded it is visibility: hidden, which no tap reaches.
  btn.classList.toggle("is-shown", Boolean(away));
  btn.tabIndex = away ? 0 : -1;
  btn.setAttribute("aria-hidden", String(!away));
  // Only while it shows. Landing on today itself would flip it to the
  // other edge mid-fade, and it flashed there for a frame.
  if (away) btn.dataset.dir = S.selectedDay > today ? "back" : "forward";
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
  centerSelectedChip("smooth", { ifNeeded: true });
  return true;
}

/* —— Day page —————————————————————————————————————————————————————— */

/**
 * Everything on one day's page, as keyed pieces for patchList: `top` is
 * the page itself (summary, then a list holder), `cards` the showings
 * that go in the holder. Two levels, so a wide screen can lay the
 * showings out in columns while each card still patches on its own.
 */
function dayParts(day) {
  const shows = dayShows(day);
  const now = new Date();
  const top = [];

  if (PREVIEW_SCANNED) {
    top.push({
      key: "preview",
      html: `<p class="banner">${escapeHtml(t("previewScannedBanner"))}</p>`,
    });
  }
  top.push({ key: "day", html: dayCardHtml(day, shows, now) });

  if (!shows.length) {
    top.push({
      key: "empty",
      html: emptyState("day", t("emptyDay"), t("emptyDayHint")),
    });
    return { top, cards: null };
  }
  top.push({ key: "list", html: `<div class="day-shows"></div>` });

  // If DX answered for some of the day's shows, the ones it skipped are
  // worth flagging; if it answered for none, stay quiet about it.
  const gaps = shows.some((s) => s.scanned != null);
  const cards = [];
  shows.forEach((show, i) => {
    // The last showing in the same hall, not just the one before it.
    const prev = shows.slice(0, i).reverse().find((s) => s.screen === show.screen);
    const turn = turnaroundMin(prev, show);
    const gapMin = turn != null && turn > 0 ? turn : 0;
    // Single column: a divider between cards. In columns the divider
    // would break the grid, so the card itself carries the note.
    if (turn != null && prev === shows[i - 1]) {
      const tight = turn < TIGHT_TURNAROUND_MIN ? " is-tight" : "";
      cards.push({
        key: `gap-${show.id}`,
        html: `<div class="gap${tight}" title="${escapeHtml(gapTip(prev, show))}"><span>${icon(
          "gap",
          "icon icon-xs"
        )}${escapeHtml(t("gapLabel", { n: Math.max(0, turn), hall: show.screen }))}</span></div>`,
      });
    }
    cards.push({ key: show.id, html: showCardHtml(show, now, { gaps, gapMin }) });
  });
  return { top, cards };
}

/** Bring `page` in line with `day`, touching only what changed. */
function paintDayPage(page, day) {
  const { top, cards } = dayParts(day);
  patchList(page, top);
  const list = cards && page.querySelector(":scope > .day-shows");
  if (list) patchList(list, cards);
}

/**
 * The day in one card: the date, then the halls on a timeline. Today
 * each hall's row is captioned with what is on in it right now (or next,
 * with the ads and film times), so the card answers what the door asks
 * without a summary of its own.
 */
function dayCardHtml(day, shows, now) {
  const progress = doneProgress(shows, now);
  const pill = progress.all
    ? `<span class="pill pill-done">${icon("check", "icon icon-xs")}${escapeHtml(t("dayAllDone"))}</span>`
    : progress.done
      ? `<span class="pill">${escapeHtml(t("doneCount", { n: progress.done, total: progress.total }))}</span>`
      : "";
  return `<section class="card day-card tl-card${day === todayKey() ? " is-today" : ""}" aria-label="${escapeHtml(
    formatDayLabel(day)
  )}">
    <div class="day-head">
      <div class="day-heading">
        <p class="eyebrow">${escapeHtml(relativeDayLabel(day))}</p>
        <h2 class="day-title">${escapeHtml(formatDayLabel(day))}</h2>
      </div>
      <div class="day-side">${pill}${
        shows.length ? `<span class="tl-legend" aria-hidden="true"><i></i>${escapeHtml(t("tlAds"))}</span>` : ""
      }</div>
    </div>
    ${shows.length ? timelineHtml(day, shows, now) : ""}
  </section>`;
}

/**
 * A hall's row caption: what is on in it now, or next, or that it is
 * done. Captions sit in a layer over the scrolling day, not in it, so
 * they stay put however far the day is panned.
 */
function hallCaptionHtml(screen, inHall, day, now) {
  const hall = `<span class="tl-cap-hall">${escapeHtml(screen)}</span>`;
  if (day !== todayKey()) {
    const n = inHall.length;
    return `<div class="tl-cap">${hall}<span class="tl-cap-state">${escapeHtml(
      n === 1 ? t("showsOne") : t("showsMany", { n })
    )}</span></div>`;
  }
  const live = inHall.find((s) => statusOf(s, now) === "live");
  const next = inHall.find((s) => s.start > now);
  const show = live || next;
  if (!show) {
    return `<div class="tl-cap is-done">${hall}<span class="tl-cap-state">${escapeHtml(t("hallDone"))}</span></div>`;
  }
  const film = filmStartOf(show);
  let cls = "";
  let bits;
  if (live) {
    cls = "is-live";
    bits =
      now < film
        ? [t("adsOn"), t("filmAt", { time: formatClock(film) })]
        : [t("minLeft", { n: Math.max(0, Math.round((showEndOf(show) - now) / 60_000)) })];
  } else {
    const adsOn = now >= adsStartOf(show);
    if (adsOn || statusOf(show, now) === "soon") cls = "is-soon";
    bits = [adsOn ? t("adsOn") : formatUntil(show.start - now), t("filmAt", { time: formatClock(film) })];
  }
  // The pulse sits outside the text, which clips: its ring needs room.
  return `<button type="button" class="tl-cap ${cls}" data-goto-show="${escapeHtml(show.id)}">${hall}${
    live ? `<span class="pulse" aria-hidden="true"></span>` : ""
  }<span class="tl-cap-state"><strong>${escapeHtml(show.title)}</strong> · ${escapeHtml(bits.join(" · "))}</span></button>`;
}

/**
 * When the ads start and when the film does: the same two times the
 * timeline draws, in the same colours. While the ads run, that half
 * lights up.
 */
function timingHtml(show, now) {
  const ads = adsStartOf(show);
  const film = filmStartOf(show);
  const adsOn = now >= ads && now < film;
  return `<span class="timing is-${statusOf(show, now)}${adsOn ? " is-ads" : ""}">
      <span class="timing-ads">${
        adsOn ? `<span class="pulse" aria-hidden="true"></span>` : `<i aria-hidden="true"></i>`
      }${escapeHtml(adsOn ? t("adsOn") : t("adsAt", { time: formatClock(ads) }))}</span>
      <span class="timing-film">${icon("play", "icon")}${escapeHtml(t("filmAt", { time: formatClock(film) }))}</span>
    </span>`;
}

/** The gap in a hall: one showing out, to the next one in. */
function gapTip(prev, show) {
  const n = Math.max(0, turnaroundMin(prev, show));
  return t("gapTip", {
    n,
    from: formatClock(showEndOf(prev)),
    to: formatClock(show.start),
    ads: formatClock(adsStartOf(show)),
  });
}

/* —— Timeline ——————————————————————————————————————————————————————
 * Read like a TV guide: halls as rows, each with a caption saying what
 * is on in it now, showings as plain solid blocks
 * (times over the full title), nothing drawn inside them. Under each
 * block a thin rail marks the ads, from the loop before the listed time
 * to the film starting. In the gap between two blocks, the minutes staff
 * have to turn the hall around. A red line for now. Every hour gets
 * enough room for each title to read in full on two lines; a block half
 * scrolled away keeps its text in view. On a phone the day scrolls
 * sideways, opening at now.
 */
const TL_MIN_PX_PER_HOUR = 60;
const TL_MAX_PX_PER_HOUR = 240;
/** Bar padding plus a little air, so a measured title never just clips. */
const TL_BAR_SLACK_PX = 22;
/** A cleaning arrow wants this much to show "29 min"; never at any cost. */
const TL_BREAK_MIN_PX = 62;
const TL_BREAK_MAX_PX_PER_HOUR = 150;
const TL_TITLE_FONT = "680 12.5px";
const TL_TIME_FONT = "760 11px";
const HOUR = 3_600_000;

let measureCtx = null;
const measured = new Map();
function textWidth(text, font) {
  const key = `${font}|${text}`;
  let w = measured.get(key);
  if (w == null) {
    measureCtx ||= document.createElement("canvas").getContext("2d");
    measureCtx.font = `${font} ${getComputedStyle(document.body).fontFamily}`;
    w = measureCtx.measureText(text).width;
    measured.set(key, w);
  }
  return w;
}

/** The narrowest width at which `title` wraps to at most two lines. */
function twoLineWidth(title) {
  const words = String(title || "").split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const widths = words.map((w) => textWidth(w, TL_TITLE_FONT));
  const space = textWidth(" ", TL_TITLE_FONT);
  const lines = (max) => {
    let n = 1;
    let line = 0;
    for (const w of widths) {
      if (!line) line = w;
      else if (line + space + w <= max) line += space + w;
      else {
        n++;
        line = w;
      }
    }
    return n;
  };
  let lo = Math.max(...widths);
  let hi = widths.reduce((a, w) => a + w + space, 0);
  if (lines(lo) <= 2) return lo;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    if (lines(mid) <= 2) hi = mid;
    else lo = mid;
  }
  return hi;
}

function endLabel(show) {
  return show.end ? formatClock(show.end) : `~${formatClock(showEndOf(show))}`;
}

function timelineHtml(day, shows, now) {
  let t0 = Math.min(...shows.map((s) => adsStartOf(s).getTime()));
  let t1 = Math.max(...shows.map((s) => showEndOf(s).getTime()));
  t0 = Math.floor((t0 - 5 * 60_000) / HOUR) * HOUR;
  t1 = Math.ceil((t1 + 10 * 60_000) / HOUR) * HOUR;
  const span = t1 - t0;
  const hours = span / HOUR;
  const pct = (ms) => ((ms - t0) / span) * 100;
  const fx = (n) => n.toFixed(3);

  // Wide enough per hour that the tightest bar holds its title in full.
  let perHour = TL_MIN_PX_PER_HOUR;
  for (const s of shows) {
    const need =
      Math.max(twoLineWidth(s.title), textWidth(`${formatClock(s.start)}–${endLabel(s)}`, TL_TIME_FONT)) +
      TL_BAR_SLACK_PX;
    const h = (showEndOf(s) - s.start) / HOUR || 1;
    perHour = Math.max(perHour, need / h);
  }
  // And room for each cleaning arrow to carry its minutes.
  for (const screen of new Set(shows.map((s) => s.screen))) {
    const inHall = shows.filter((s) => s.screen === screen);
    for (let i = 1; i < inHall.length; i++) {
      const h = (inHall[i].start - showEndOf(inHall[i - 1])) / HOUR;
      if (h > 0) perHour = Math.max(perHour, Math.min(TL_BREAK_MAX_PX_PER_HOUR, TL_BREAK_MIN_PX / h));
    }
  }
  perHour = Math.min(TL_MAX_PX_PER_HOUR, Math.ceil(perHour));
  const minWidth = Math.round(hours * perHour);
  const px = (ms) => (ms / HOUR) * perHour;

  const screens = [...new Set(shows.map((s) => s.screen))].sort((a, b) => a.localeCompare(b, "nb"));
  const lanes = screens
    .map((screen) => {
      const inHall = shows.filter((s) => s.screen === screen);
      const parts = inHall.map((s, i) => {
        const start = s.start.getTime();
        const end = showEndOf(s).getTime();
        const adsFrom = adsStartOf(s).getTime();
        const film = filmStartOf(s).getTime();
        const status = statusOf(s, now);
        const tip = `${s.title} · ${formatClock(s.start)}–${endLabel(s)} · ${t("tlAdsTip", {
          from: formatClock(adsStartOf(s)),
          film: formatClock(filmStartOf(s)),
        })}`;
        let html = "";
        const prev = inHall[i - 1];
        const turn = turnaroundMin(prev, s);
        if (turn != null && turn > 0) {
          // Fills the space between the two blocks, with its length.
          const from = showEndOf(prev).getTime();
          const room = px(start - from);
          const tight = turn < TIGHT_TURNAROUND_MIN ? " is-tight" : "";
          const label =
            room >= 58
                ? escapeHtml(t("breakShort", { n: turn }))
                : room >= 34
                  ? String(turn)
                  : "";
          if (room >= 20) {
            html += `<span class="tl-break${tight}" style="left:${fx(pct(from))}%;width:${fx(
              pct(start) - pct(from)
            )}%" title="${escapeHtml(gapTip(prev, s))}"><span>${label}</span></span>`;
          }
        }

        html += `<button type="button" class="tl-bar is-${status}" style="left:${fx(pct(start))}%;width:${fx(
          Math.max(pct(end) - pct(start), 1)
        )}%" data-tl-show="${escapeHtml(s.id)}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(
          tip
        )}"><span class="tl-bar-in"><span class="tl-bar-time"><strong>${formatClock(
          s.start
        )}</strong>–${endLabel(s)}</span><span class="tl-bar-title">${escapeHtml(s.title)}</span></span></button>`;
        html += `<i class="tl-ads is-${status}" style="left:${fx(pct(adsFrom))}%;width:${fx(
          pct(film) - pct(adsFrom)
        )}%" aria-hidden="true"></i>`;
        return html;
      });
      return `<div class="tl-cap-space"></div><div class="tl-lane">${parts.join("")}</div>`;
    })
    .join("");

  const nowTs = now.getTime();
  const showNow = day === todayKey() && nowTs >= t0 && nowTs <= t1;
  const nowPct = pct(nowTs);
  // Open where what is playing starts, so its title is in view too.
  const liveStarts = shows.filter((s) => statusOf(s, now) === "live").map((s) => pct(s.start.getTime()));
  const focusPct = showNow ? Math.min(nowPct, ...liveStarts) : null;

  const step = perHour < 44 ? 2 : 1;
  const ticks = [];
  for (let ts = t0, i = 0; ts <= t1; ts += HOUR, i++) {
    if (i % step) continue;
    ticks.push({ ts, pct: pct(ts), label: String(new Date(ts).getHours()).padStart(2, "0") });
  }
  const grid = ticks.map((k) => `<i style="left:${fx(k.pct)}%"></i>`).join("");
  const hourLabels = ticks
    .map((k, i) => {
      const edge = i === 0 ? " is-first" : i === ticks.length - 1 ? " is-last" : "";
      // The now-pill sits on the hour row; an hour under it stays quiet.
      const hidden = showNow && Math.abs(px(k.ts - nowTs)) < 30 ? " is-covered" : "";
      return `<span class="tl-hour${edge}${hidden}" style="left:${fx(k.pct)}%">${k.label}</span>`;
    })
    .join("");

  const nowLine = showNow
    ? `<div class="tl-now${nowPct < 6 ? " is-start" : nowPct > 94 ? " is-end" : ""}" style="left:${fx(
        nowPct
      )}%"><span>${formatClock(now)}</span></div>`
    : "";

  return `<div class="tl" data-tl-day="${day}" ${
    showNow ? `data-now-pct="${nowPct.toFixed(2)}" data-focus-pct="${focusPct.toFixed(2)}"` : ""
  } aria-label="${escapeHtml(t("timelineAria", { day: formatDayLabel(day) }))}">
    <div class="tl-caps">${screens
      .map((screen) => `<div class="tl-cap-row">${hallCaptionHtml(screen, shows.filter((s) => s.screen === screen), day, now)}</div>`)
      .join("")}</div>
    ${hscroll(
      `<div class="tl-scroll" data-hs-track data-keep-scroll="tl" data-no-swipe>
      <div class="tl-canvas" style="width:${minWidth}px">
        <div class="tl-grid" aria-hidden="true">${grid}</div>
        <div class="tl-lanes">${lanes}</div>
        ${nowLine}
        <div class="tl-hours" aria-hidden="true">${hourLabels}</div>
      </div>
    </div>`,
      "hs-tl hs-sm"
    )}
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
  if (max > 1) {
    const nowPct = Number(tl.dataset.nowPct);
    const focusPct = Number(tl.dataset.focusPct);
    let left = 0;
    if (Number.isFinite(nowPct)) {
      const nowX = (nowPct / 100) * scroller.scrollWidth;
      const focusX = (focusPct / 100) * scroller.scrollWidth - 12;
      // The start of what is playing, unless that would push now out of view.
      left = nowX - focusX < scroller.clientWidth * 0.8 ? focusX : nowX - scroller.clientWidth * 0.3;
    }
    scroller.scrollLeft = Math.max(0, Math.min(max, left));
  }
  syncHScroll(tl);
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
    const film = filmStartOf(show);
    const label =
      now < film ? `${t("adsShort")} · ${t("filmAt", { time: formatClock(film) })}` : t("minLeft", { n: left });
    progress = `<div class="show-progress">
        <span class="progress" aria-hidden="true"><span style="width:${pct}%"></span></span>
        <span class="show-progress-label">${escapeHtml(label)}</span>
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
          ${
            opts.gapMin
              ? `<span class="chip chip-gap show-gap">${icon("gap", "icon icon-xs")}${escapeHtml(
                  t("gapBefore", { n: opts.gapMin })
                )}</span>`
              : ""
          }
        </div>
        <h3 class="show-title">${escapeHtml(show.title)}</h3>
        <p class="show-meta"><span class="show-hall">${escapeHtml(show.screen)}</span>${meta}</p>
        ${status !== "done" ? timingHtml(show, now) : ""}
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
    page._enterTimer = setTimeout(() => page.classList.remove("is-entering"), 800);
  }
  paintDayPage(page, S.selectedDay);
  syncTimelineScroll(page);
  observeAutoSeatCharts(page);
  prewarmGhost();
}

/**
 * Keep tomorrow's page built in the spare (hidden) page, refreshed in
 * idle time with every beat, so the next swipe forward finds it ready
 * instead of building a whole day under the finger. A swipe the other
 * way, or a copy gone stale, is painted when the swipe starts.
 */
const WARM_MS = 6000;
let warmQueued = false;
function prewarmGhost() {
  if (warmQueued) return;
  warmQueued = true;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 250));
  idle(
    () => {
      warmQueued = false;
      const ghost = els.dayGhost;
      if (pager || !ghost?.hidden || S.activeTab !== "day") return;
      const days = programDays();
      const next = days[days.indexOf(S.selectedDay) + 1];
      if (!next) return;
      ghost.dataset.day = next;
      paintDayPage(ghost, next);
      ghost._warmAt = Date.now();
    },
    { timeout: 2000 }
  );
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
 *
 * Nothing waits for a slide to finish: a new touch, chip tap or arrow
 * key lands the slide in flight on the spot and starts from there, so
 * days can be flicked through as fast as a finger moves. The slide
 * itself is timed from the flick, a fast one lands faster.
 */
const COMMIT_FRAC = 0.2;
const FLICK_PX_MS = 0.3;
const LOCK_PX = 8;
const SETTLE_MIN_MS = 150;
const SETTLE_MAX_MS = 290;

/** null, `{ mode: "drag" | "auto" }`, or `{ mode: "settling", end }`. */
let pager = null;
/** Where the current page is pushed sideways right now. */
let pageX = 0;

function pagerWidth() {
  return els.pager?.clientWidth || window.innerWidth || 1;
}

/** Land a slide in flight at once. False if something else holds the pager. */
function landPager() {
  if (!pager) return true;
  if (pager.end) pager.end();
  return !pager;
}

/** Fill the spare page with `day`, aligned to the top of the viewport. */
function prepareGhost(day) {
  const ghost = els.dayGhost;
  const warm = ghost.dataset.day === day && Date.now() - (ghost._warmAt || 0) < WARM_MS;
  ghost.dataset.day = day;
  if (!warm) paintDayPage(ghost, day);
  ghost._warmAt = 0;
  ghost.hidden = false;
  const header = headerHeight();
  const pagerTop = els.pager.getBoundingClientRect().top + window.scrollY;
  const offset = Math.max(0, window.scrollY + header - pagerTop);
  ghost.style.top = `${offset}px`;
  ghost.dataset.offset = String(offset);
}

function setX(el, x) {
  el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
  if (el === els.dayPage) pageX = x;
}

function finishSwap(day, offset) {
  const oldPage = els.dayPage;
  const newPage = els.dayGhost;
  els.pager.classList.remove("is-settling", "is-dragging");
  newPage.classList.remove("is-ghost");
  newPage.removeAttribute("aria-hidden");
  newPage.style.top = "";
  setX(newPage, 0);
  oldPage.classList.add("is-ghost");
  oldPage.setAttribute("aria-hidden", "true");
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
    const header = headerHeight();
    const pagerTop = els.pager.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, pagerTop - header));
  }
  setSelectedDay(day, { persist: false });
  savePrefs();
  syncTimelineScroll(newPage);
  observeAutoSeatCharts(newPage);
  pager = null;
  releaseRender();
  prewarmGhost();
  enrichVisibleDay().catch((err) => console.warn("Day enrich failed", err));
}

/** How long a slide over `distance` px takes, given the flick's speed. */
function settleMs(distance, velocity) {
  const speed = Math.max(Math.abs(velocity), 1.4);
  return Math.round(Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, distance / speed)));
}

/**
 * Animate the pages to their resting place, then swap if committing.
 * Until it lands, `pager.end` can land it early.
 */
function settle(commit, dir, day, velocity = 0) {
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
  const target = commit ? -dir * W : 0;
  const ms = settleMs(Math.abs(target - pageX), velocity);
  els.pager.style.setProperty("--settle-ms", `${ms}ms`);
  els.pager.classList.remove("is-dragging");
  els.pager.classList.add("is-settling");
  void page.offsetWidth;
  setX(page, target);
  setX(ghost, commit ? 0 : dir * W);
  let done = false;
  const onEnd = (e) => {
    if (e.target === ghost && e.propertyName === "transform") end();
  };
  const end = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    ghost.removeEventListener("transitionend", onEnd);
    if (commit) finishSwap(day, offset);
    else cancelSwipe();
  };
  const timer = setTimeout(end, ms + 40);
  ghost.addEventListener("transitionend", onEnd);
  pager = { mode: "settling", end };
}

/** Pulled past the first or last day: spring back, interruptibly. */
function springBack() {
  const ms = settleMs(Math.abs(pageX), 0);
  els.pager.style.setProperty("--settle-ms", `${ms}ms`);
  els.pager.classList.remove("is-dragging");
  els.pager.classList.add("is-settling");
  setX(els.dayPage, 0);
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cancelSwipe();
  };
  const timer = setTimeout(end, ms + 20);
  pager = { mode: "settling", end };
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
  prewarmGhost();
}

/**
 * Go to `day`. From a chip tap or an arrow key the page slides the same
 * way a swipe would; off the day tab (or with reduced motion) it simply
 * swaps.
 */
export function selectDay(day, { animate = true } = {}) {
  if (!day || !S.state?.shows) return;
  if (!landPager()) return;
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
  // Commit the start position, then slide — in the same task, so a
  // second tap a moment later finds a slide it can land.
  void els.dayGhost.offsetWidth;
  settle(true, dir, day);
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
    if (e.pointerType === "mouse" || !e.isPrimary || pointerId !== null) return;
    // A finger landing mid-slide finishes it now and starts a new swipe.
    if (!landPager()) return;
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
      if (target) settle(false, dir, target, vx);
      else springBack();
      return;
    }
    const projected = dx + vx * 160;
    const sameWay = dir === 1 ? vx <= FLICK_PX_MS * 0.5 : vx >= -FLICK_PX_MS * 0.5;
    const commit =
      (dir === 1 && (projected < -width * COMMIT_FRAC || vx < -FLICK_PX_MS) && sameWay) ||
      (dir === -1 && (projected > width * COMMIT_FRAC || vx > FLICK_PX_MS) && sameWay);
    if (commit) hapticTick("medium");
    settle(commit, dir, target, vx);
  };
  // On the window, not the pager: if the browser drops the capture, the
  // finger lifting anywhere must still end the swipe — a swipe left
  // "dragging" would make every later day change wait for it forever.
  window.addEventListener("pointerup", (e) => release(e, false));
  window.addEventListener("pointercancel", (e) => release(e, true));
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
    const header = headerHeight();
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
    setTimeout(go, reducedMotion() ? 0 : SETTLE_MAX_MS + 80);
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
  // A plain click: it lands on the button before the button hides. (Acting
  // on the finger lifting hid it first, and the click went through to the
  // day under it.) A click the phone drops is given back by the tap rescue.
  els.jumpTodayBtn?.addEventListener("click", () => {
    if (els.jumpTodayBtn.classList.contains("is-shown")) selectDay(todayKey());
  });

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
