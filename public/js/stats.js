/**
 * The stats dashboard. One period at a time — a week or a month, picked
 * from the week-for-week (month-for-month) chart at the top or stepped
 * with ‹ › — and everything under it scoped to that period: the headline
 * sold figure against the same point last period, attendance, the best
 * films and sales per day. Then two things that are not about one
 * period: the best weekdays and the records.
 *
 * "Sold" is what a showing has sold in total, so a day's figure is the
 * tickets for that day's showings, and a future day's is presale.
 */
import {
  S,
  els,
  hooks,
  t,
  icon,
  escapeHtml,
  formatClock,
  formatCount,
  formatPct,
  formatDayLabel,
  shortDayLabel,
  weekdayShort,
  todayKey,
  addDaysKey,
  daysBetween,
  dayKeyDate,
  isoWeekInfo,
  weekStartKey,
  months,
  weekdays,
  capitalize,
  savePrefs,
  HISTORY_KEEP_DAYS,
  WIDE_MQ,
  XL_MQ,
} from "./core.js?v=dev";
import {
  programDays,
  soldOf,
  isDone,
  ensureAllEnriched,
  isEnrichingAll,
} from "./data.js?v=dev";
import { paint, posterHtml, viewHead, emptyState, SEG_IND, syncSegs } from "./ui.js?v=dev";

/* —— Periods ——————————————————————————————————————————————————————— */

function monthStart(dayKey) {
  return `${dayKey.slice(0, 7)}-01`;
}

function monthEnd(dayKey) {
  const d = dayKeyDate(monthStart(dayKey));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return `${dayKey.slice(0, 7)}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDate(dayKey) {
  const [, m, d] = dayKey.split("-").map(Number);
  return `${d}.${m}`;
}

function periodOf(kind, anchor) {
  if (kind === "month") {
    const start = monthStart(anchor);
    const end = monthEnd(anchor);
    const [y, m] = start.split("-").map(Number);
    return {
      kind,
      start,
      end,
      label: `${capitalize(months()[m - 1])}`,
      sub: String(y),
      short: capitalize(months()[m - 1]).slice(0, 3),
    };
  }
  const start = weekStartKey(anchor);
  const end = addDaysKey(start, 6);
  const week = isoWeekInfo(start).week;
  return {
    kind,
    start,
    end,
    label: t("weekLabel", { n: week }),
    sub: `${shortDate(start)}–${shortDate(end)}`,
    short: String(week),
  };
}

function shiftPeriod(period, dir) {
  return periodOf(period.kind, dir < 0 ? addDaysKey(period.start, -1) : addDaysKey(period.end, 1));
}

function daysOf(period) {
  const out = [];
  for (let d = period.start; d <= period.end; d = addDaysKey(d, 1)) out.push(d);
  return out;
}

/* —— Model ————————————————————————————————————————————————————————— */

function summarize(shows, now) {
  const withSold = shows.filter((s) => s.sold != null && s.eventStatus !== "error");
  const sold = withSold.reduce((n, s) => n + soldOf(s), 0);
  const done = shows.filter((s) => isDone(s, now));
  const scanned = done.filter((s) => s.scanned != null && soldOf(s) > 0);
  const scanSold = scanned.reduce((n, s) => n + soldOf(s), 0);
  const scanIn = scanned.reduce((n, s) => n + Math.min(Number(s.scanned) || 0, soldOf(s)), 0);
  return {
    sold,
    shows: shows.length,
    films: new Set(shows.map((s) => s.title)).size,
    inside: scanIn,
    done: done.length,
    avg: withSold.length ? sold / withSold.length : null,
    attendance: scanSold ? (scanIn / scanSold) * 100 : null,
    hasData: withSold.length > 0,
  };
}

function showsBetween(start, end) {
  return (S.state?.shows || []).filter((s) => s.dayKey >= start && s.dayKey <= end);
}

function computeModel(period) {
  const now = new Date();
  const today = todayKey();
  const shows = showsBetween(period.start, period.end);
  const sum = summarize(shows, now);

  // Delta against the same stretch of the previous period: for the
  // period we are in, only the days played so far on both sides.
  const prev = shiftPeriod(period, -1);
  let delta = null;
  let deltaKind = "";
  if (period.start <= today) {
    const elapsed = period.end < today ? null : daysBetween(period.start, today);
    const curEnd = elapsed == null ? period.end : today;
    const prevEnd = elapsed == null ? prev.end : addDaysKey(prev.start, elapsed);
    const cur = showsBetween(period.start, curEnd).reduce((n, s) => n + soldOf(s), 0);
    const before = showsBetween(prev.start, prevEnd < prev.end ? prevEnd : prev.end).reduce(
      (n, s) => n + soldOf(s),
      0
    );
    if (before > 0) {
      delta = ((cur - before) / before) * 100;
      deltaKind = elapsed == null ? "full" : "partial";
    }
  }

  const byDay = daysOf(period).map((day) => {
    const list = shows.filter((s) => s.dayKey === day);
    return {
      day,
      sold: list.reduce((n, s) => n + soldOf(s), 0),
      shows: list.length,
      today: day === today,
      future: day > today,
    };
  });

  const films = new Map();
  for (const s of shows) {
    const f = films.get(s.title) || { title: s.title, posterUrl: s.posterUrl, sold: 0, shows: 0 };
    f.sold += soldOf(s);
    f.shows += 1;
    if (!f.posterUrl && s.posterUrl) f.posterUrl = s.posterUrl;
    films.set(s.title, f);
  }
  const top = [...films.values()].filter((f) => f.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 6);

  return {
    period,
    sum,
    delta,
    deltaKind,
    future: period.start > today,
    byDay,
    top,
  };
}

/** Sold per period for the trend chart, centred on the selected one. */
function trend(period) {
  const days = programDays();
  if (!days.length) return [];
  const first = periodOf(period.kind, days[0]);
  const last = periodOf(period.kind, days[days.length - 1]);
  const now = periodOf(period.kind, todayKey());
  // Wider screens have room for a longer run of periods to pick from.
  const back = XL_MQ.matches ? 19 : WIDE_MQ.matches ? 13 : 9;
  let from = now;
  for (let i = 0; i < back && from.start > first.start; i++) from = shiftPeriod(from, -1);
  let to = now;
  for (let i = 0; i < 2 && to.start < last.start; i++) to = shiftPeriod(to, 1);
  if (period.start < from.start) from = period;
  if (period.start > to.start) to = period;
  const list = [];
  for (let p = from; p.start <= to.start; p = shiftPeriod(p, 1)) list.push(p);
  const today = todayKey();
  return list.map((per) => ({
    period: per,
    sold: showsBetween(per.start, per.end).reduce((n, s) => n + soldOf(s), 0),
    current: per.start <= today && per.end >= today,
    future: per.start > today,
    selected: per.start === period.start,
  }));
}

/** Average sold per showing by weekday, over everything already played. */
function weekdayPattern() {
  const now = new Date();
  const rows = Array.from({ length: 7 }, () => ({ sold: 0, shows: 0 }));
  for (const s of S.state?.shows || []) {
    if (!isDone(s, now) || s.sold == null) continue;
    const dow = (s.start.getDay() + 6) % 7; // Monday first
    rows[dow].sold += soldOf(s);
    rows[dow].shows += 1;
  }
  return rows.map((r, i) => ({ dow: i, avg: r.shows ? r.sold / r.shows : 0, shows: r.shows }));
}

function records() {
  const now = new Date();
  const played = (S.state?.shows || []).filter((s) => isDone(s, now) && s.sold != null);
  if (!played.length) return null;
  const byDay = new Map();
  for (const s of played) byDay.set(s.dayKey, (byDay.get(s.dayKey) || 0) + soldOf(s));
  let bestDay = null;
  for (const [day, sold] of byDay) if (!bestDay || sold > bestDay.sold) bestDay = { day, sold };
  const bestShow = [...played].sort((a, b) => soldOf(b) - soldOf(a))[0];
  const mostInside = played
    .filter((s) => Number(s.scanned) > 0)
    .sort((a, b) => Number(b.scanned) - Number(a.scanned))[0];
  return { bestDay, bestShow, mostInside };
}

/* —— Charts ————————————————————————————————————————————————————————
 * Plain HTML columns: one baseline, thin rounded bars, the selected or
 * current one in the accent and everything else in quiet ink; presale
 * (future) a lighter step of the same ink. Values sit on the caps.
 */
function columns(rows, { max, labelAll = true, interactive = true, attr = () => "", cls = () => "", label, value, aria }) {
  const tag = interactive ? "button" : "div";
  const top = Math.max(max || 0, 1);
  const best = Math.max(...rows.map((r) => value(r)), 0);
  return `<div class="cols" style="--n:${rows.length}">
    ${rows
      .map((r, i) => {
        const v = value(r);
        const h = v ? Math.max((v / top) * 100, 3) : 0;
        const show = labelAll || v === best || cls(r).includes("is-hl");
        return `<${tag} ${interactive ? "type=\"button\"" : "role=\"img\""} class="col ${cls(r)}" ${attr(r)} aria-label="${escapeHtml(aria(r))}" style="--h:${h.toFixed(
          2
        )}%">
          <span class="col-val">${show && v ? escapeHtml(formatCount(Math.round(v))) : ""}</span>
          <span class="col-bar"></span>
          <span class="col-label">${escapeHtml(label(r, i))}</span>
        </${tag}>`;
      })
      .join("")}
  </div>`;
}

function deltaHtml(model) {
  if (model.future) {
    return `<p class="hero-note">${icon("clock", "icon icon-xs")}${escapeHtml(t("presaleNote"))}</p>`;
  }
  if (model.delta == null) return "";
  const up = model.delta >= 0;
  const n = Math.abs(Math.round(model.delta));
  const label =
    model.period.kind === "month"
      ? t(model.deltaKind === "full" ? "deltaMonthFull" : "deltaMonth")
      : t(model.deltaKind === "full" ? "deltaWeekFull" : "deltaWeek");
  return `<p class="delta ${up ? "is-up" : "is-down"}">
    <span class="delta-chip">${icon(up ? "arrowUp" : "arrowDown", "icon icon-xs")}${formatPct(n)}</span>
    <span>${escapeHtml(label)}</span>
  </p>`;
}

function kpiTile(value, label, sub = "", extra = "", count = null) {
  return `<div class="tile">
    <span class="tile-label">${escapeHtml(label)}</span>
    <span class="tile-value"${count != null ? ` data-count="${count}"` : ""}>${value}</span>
    ${sub ? `<span class="tile-sub">${escapeHtml(sub)}</span>` : ""}
    ${extra}
  </div>`;
}


/* —— Render ——————————————————————————————————————————————————————— */

function currentPeriod() {
  const kind = S.statsPeriod === "month" ? "month" : "week";
  return periodOf(kind, S.statsAnchor || todayKey());
}

export function renderStats() {
  const host = els.statsContent;
  if (!host || !S.state?.shows) return;
  ensureAllEnriched();

  const period = currentPeriod();
  const days = programDays();
  const model = computeModel(period);
  const { sum } = model;
  const isNow = period.start <= todayKey() && period.end >= todayKey();
  const canPrev = days.length && period.start > days[0];
  const canNext = days.length && period.end < days[days.length - 1];

  const updating = isEnrichingAll()
    ? `<p class="updating"><span class="spinner spinner-sm" aria-hidden="true"></span>${escapeHtml(t("statsUpdating"))}</p>`
    : "";
  // In the header, so it can come and go without pushing the page down.
  const head = viewHead(t("statsTitle"), t("statsSub"), updating);

  const bar = `<div class="period-bar" data-key="bar">
    <div class="seg" role="tablist" aria-label="${escapeHtml(t("periodWeek"))} / ${escapeHtml(t("periodMonth"))}">${SEG_IND}
      <button type="button" class="seg-btn" role="tab" data-period="week" aria-selected="${period.kind === "week"}">${escapeHtml(
        t("periodWeek")
      )}</button>
      <button type="button" class="seg-btn" role="tab" data-period="month" aria-selected="${period.kind === "month"}">${escapeHtml(
        t("periodMonth")
      )}</button>
    </div>
    <div class="period-nav">
      <button type="button" class="icon-btn" data-period="prev" aria-label="${escapeHtml(t("periodPrev"))}" ${
        canPrev ? "" : "disabled"
      }>${icon("chevronLeft")}</button>
      <button type="button" class="period-label${isNow ? " is-now" : ""}" data-period="now">
        <strong>${escapeHtml(period.label)}</strong><span>${escapeHtml(period.sub)}</span>
      </button>
      <button type="button" class="icon-btn" data-period="next" aria-label="${escapeHtml(t("periodNext"))}" ${
        canNext ? "" : "disabled"
      }>${icon("chevronRight")}</button>
    </div>
  </div>`;

  // The run of weeks (or months) as a picker: tap one and everything
  // below shows it. Right under the switch, so it reads as the filter.
  const month = period.kind === "month";
  const tr = trend(period);
  const picker =
    tr.length > 1
      ? `<section class="card chart-card period-picker" data-key="trend">
          <div class="section-head"><div><h2>${escapeHtml(
            t(month ? "chartTrendMonth" : "chartTrendWeek")
          )}</h2><p>${escapeHtml(t(month ? "trendSubMonth" : "trendSubWeek"))}</p></div></div>
          ${columns(tr, {
            max: Math.max(...tr.map((r) => r.sold), 0),
            labelAll: false,
            value: (r) => r.sold,
            label: (r) => r.period.short,
            cls: (r) =>
              [r.selected ? "is-hl is-sel" : "", r.future ? "is-future" : "", r.current && !r.selected ? "is-current" : ""]
                .filter(Boolean)
                .join(" "),
            attr: (r) => `data-period-jump="${r.period.start}" aria-pressed="${r.selected}"`,
            aria: (r) => `${r.period.label} ${r.period.sub}: ${r.sold} ${t("sold")}`,
          })}
        </section>`
      : "";

  if (!sum.shows) {
    paint(host, `${head}${bar}${picker}<div data-key="empty">${emptyState("stats", t("noSoldPeriod"))}</div>`);
    syncSegs(host);
    return;
  }

  const hero = `<section class="card stats-hero" data-key="hero">
    <p class="eyebrow">${escapeHtml(t("heroSold"))}</p>
    <p class="hero-figure"${sum.hasData ? ` data-count="${sum.sold}"` : ""}>${sum.hasData ? formatCount(sum.sold) : "–"}</p>
    ${deltaHtml(model)}
    <div class="tiles">
      ${kpiTile(String(sum.shows), t("kpiShowsT"), sum.done && sum.done < sum.shows ? t("kpiDoneOf", { n: sum.done }) : "", "", sum.shows)}
      ${kpiTile(sum.avg != null ? formatCount(Math.round(sum.avg)) : "–", t("kpiAvgShow"), "", "", sum.avg != null ? Math.round(sum.avg) : null)}
      ${kpiTile(String(sum.films), t("kpiFilms"), "", "", sum.films)}
      ${
        sum.attendance != null
          ? kpiTile(formatCount(sum.inside), t("kpiInsideT"), t("kpiAttendanceOf", { pct: formatPct(sum.attendance) }), "", sum.inside)
          : kpiTile("–", t("kpiInsideT"))
      }
    </div>
  </section>`;

  const maxDay = Math.max(...model.byDay.map((d) => d.sold), 0);
  const hasFuture = model.byDay.some((d) => d.future && d.sold);
  const hasPast = model.byDay.some((d) => !d.future && d.sold);
  const dayChart = `<section class="card chart-card" data-key="days">
    <div class="section-head">
      <div><h2>${escapeHtml(t("chartByDay"))}</h2><p>${escapeHtml(t("chartByDaySub"))}</p></div>
    </div>
    ${columns(model.byDay, {
      max: maxDay,
      labelAll: !month,
      value: (d) => d.sold,
      label: (d, i) =>
        month ? (i === 0 || (i + 1) % 5 === 0 ? String(Number(d.day.slice(8))) : "") : weekdayShort(d.day),
      cls: (d) =>
        [d.today ? "is-hl" : "", d.future ? "is-future" : "", d.shows ? "" : "is-empty"].filter(Boolean).join(" "),
      attr: (d) => (d.shows ? `data-stats-day="${d.day}"` : "disabled"),
      aria: (d) => `${formatDayLabel(d.day)}: ${d.sold} ${t("sold")}`,
    })}
    ${
      hasFuture || model.byDay.some((d) => d.today)
        ? `<div class="legend">
            ${hasPast ? `<span class="lg lg-played">${escapeHtml(t("legendPlayed"))}</span>` : ""}
            ${model.byDay.some((d) => d.today) ? `<span class="lg lg-today">${escapeHtml(t("legendToday"))}</span>` : ""}
            ${hasFuture ? `<span class="lg lg-future">${escapeHtml(t("legendPresale"))}</span>` : ""}
          </div>`
        : ""
    }
  </section>`;

  const maxFilm = Math.max(...model.top.map((f) => f.sold), 1);
  const topFilms = model.top.length
    ? `<section class="card" data-key="top">
        <div class="section-head"><div><h2>${escapeHtml(t("topFilms"))}</h2><p>${escapeHtml(t("topFilmsSub"))}</p></div></div>
        <ol class="rank">
          ${model.top
            .map((f, i) => {
              return `<li data-key="${escapeHtml(f.title)}"><button type="button" class="rank-row" data-open-movie="${escapeHtml(f.title)}" aria-label="${escapeHtml(
                t("statsOpenMovie", { title: f.title })
              )}">
                <span class="rank-n">${i + 1}</span>
                ${posterHtml(f, { w: 36, h: 54, cls: "rank-poster" })}
                <span class="rank-body">
                  <span class="rank-title">${escapeHtml(f.title)}</span>
                  <span class="rank-bar"><span style="width:${((f.sold / maxFilm) * 100).toFixed(1)}%"></span></span>
                  <span class="rank-sub">${escapeHtml(
                    [
                      f.shows === 1 ? t("showsOne") : t("showsMany", { n: f.shows }),
                      t("avgPerShow", { n: formatCount(Math.round(f.sold / f.shows)) }),
                    ].join(" · ")
                  )}</span>
                </span>
                <span class="rank-v">${formatCount(f.sold)}</span>
              </button></li>`;
            })
            .join("")}
        </ol>
      </section>`
    : "";

  const wk = weekdayPattern();
  const bestDow = wk.reduce((b, r) => (r.avg > (b?.avg ?? -1) ? r : b), null);
  const weekdayCard = wk.some((r) => r.shows)
    ? `<section class="card chart-card" data-key="weekday">
        <div class="section-head"><div><h2>${escapeHtml(t("chartWeekday"))}</h2><p>${escapeHtml(
          t("chartWeekdaySub")
        )}</p></div></div>
        ${columns(wk, {
          max: Math.max(...wk.map((r) => r.avg), 0),
          labelAll: true,
          value: (r) => r.avg,
          label: (r) => capitalize(weekdays()[(r.dow + 1) % 7]).slice(0, 3),
          cls: (r) => (r === bestDow ? "is-hl" : ""),
          interactive: false,
          aria: (r) => `${capitalize(weekdays()[(r.dow + 1) % 7])}: ${Math.round(r.avg)} ${t("perShow")}`,
        })}
      </section>`
    : "";

  const rec = records();
  const recordsCard = rec
    ? `<section class="card" data-key="records">
        <div class="section-head"><div><h2>${escapeHtml(t("records"))}</h2><p>${escapeHtml(
          t("recordsSub", { n: HISTORY_KEEP_DAYS })
        )}</p></div></div>
        <div class="records">
          ${
            rec.bestDay
              ? `<button type="button" class="record" data-stats-day="${rec.bestDay.day}">
                  <span class="record-icon">${icon("trophy")}</span>
                  <span class="record-label">${escapeHtml(t("recordBestDay"))}</span>
                  <strong class="record-v">${formatCount(rec.bestDay.sold)}</strong>
                  <span class="record-sub">${escapeHtml(formatDayLabel(rec.bestDay.day))}</span>
                </button>`
              : ""
          }
          ${
            rec.bestShow
              ? `<button type="button" class="record" data-goto-show="${escapeHtml(rec.bestShow.id)}">
                  <span class="record-icon">${icon("ticket")}</span>
                  <span class="record-label">${escapeHtml(t("recordBestShow"))}</span>
                  <strong class="record-v">${formatCount(soldOf(rec.bestShow))}</strong>
                  <span class="record-sub">${escapeHtml(`${rec.bestShow.title} · ${shortDayLabel(rec.bestShow.dayKey)}`)}</span>
                </button>`
              : ""
          }
          ${
            rec.mostInside
              ? `<button type="button" class="record" data-goto-show="${escapeHtml(rec.mostInside.id)}">
                  <span class="record-icon">${icon("users")}</span>
                  <span class="record-label">${escapeHtml(t("recordMostInside"))}</span>
                  <strong class="record-v">${formatCount(rec.mostInside.scanned)}</strong>
                  <span class="record-sub">${escapeHtml(`${rec.mostInside.title} · ${shortDayLabel(rec.mostInside.dayKey)}`)}</span>
                </button>`
              : ""
          }
        </div>
      </section>`
    : "";

  // Cards are dealt into as many columns as the screen has room for,
  // in a fixed order per layout, so nothing hops between columns when
  // a figure changes.
  // Sold per day always sits right above the best weekdays: the one
  // reads into the other.
  const layout = XL_MQ.matches
    ? [[hero, recordsCard], [topFilms], [dayChart, weekdayCard]]
    : WIDE_MQ.matches
      ? [
          [hero, dayChart, weekdayCard],
          [topFilms, recordsCard],
        ]
      : [[hero, topFilms, dayChart, weekdayCard, recordsCard]];

  paint(
    host,
    `${head}${bar}${picker}
    <div class="stats-grid cols-${layout.length}" data-key="grid">
      ${layout.map((cards, i) => `<div class="stats-col" data-key="c${i + 1}">${cards.join("")}</div>`).join("")}
    </div>`
  );
  syncSegs(host);
}

function setPeriod(next) {
  S.statsPeriod = next.kind;
  S.statsAnchor = next.start <= todayKey() && next.end >= todayKey() ? null : next.start;
  savePrefs();
  renderStats();
}

export function setupStats() {
  const relayout = () => {
    if (S.activeTab === "stats") renderStats();
  };
  WIDE_MQ.addEventListener?.("change", relayout);
  XL_MQ.addEventListener?.("change", relayout);
  els.statsContent?.addEventListener("click", (e) => {
    const p = e.target.closest("[data-period]");
    if (p) {
      const cur = currentPeriod();
      const what = p.dataset.period;
      if (what === "week" || what === "month") {
        if (cur.kind === what) return;
        // Same stretch of time, in the new unit.
        S.statsPeriod = what;
        savePrefs();
        renderStats();
      } else if (what === "prev" || what === "next") {
        setPeriod(shiftPeriod(cur, what === "prev" ? -1 : 1));
      } else if (what === "now") {
        S.statsAnchor = null;
        savePrefs();
        renderStats();
      }
      return;
    }
    const jump = e.target.closest("[data-period-jump]");
    if (jump) {
      setPeriod(periodOf(currentPeriod().kind, jump.dataset.periodJump));
      return;
    }
    const day = e.target.closest("[data-stats-day]");
    if (day) hooks.goToDay(day.dataset.statsDay);
  });
}
