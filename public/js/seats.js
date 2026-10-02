/**
 * The seat chart: which seats are sold, which of those are inside, and
 * which are held or closed — drawn in DX's own coordinates, so a square
 * is exactly the seat printed on the ticket.
 *
 * Hall geometry is fetched once per auditorium and kept on the device
 * for a month; after that a refresh is one purchase-list lookup.
 */
import {
  S,
  hooks,
  seatState,
  SEAT_MAP_KEY,
  SEATS_OPEN_MQ,
  PREVIEW_SCANNED,
  t,
  icon,
  escapeHtml,
  cssEscape,
  hashStr,
  formatClock,
  reducedMotion,
} from "./core.js?v=dev";
import {
  callDxProxy,
  bridgeFailure,
  dxError,
  dxToken,
  rememberDxToken,
  clearDxToken,
  persistHistory,
  partnerOf,
  statusOf,
  doorFreshMs,
  idsOnScreen,
  showById,
  scanVisible,
} from "./data.js?v=dev";

/** Hall geometry only changes when someone rebuilds an auditorium. */
const SEAT_LAYOUT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Bumped when the layout shape changes, so cached halls are refetched. */
const SEAT_LAYOUT_VERSION = 2;

const charts = seatState.charts;
const opened = seatState.open;
let seatLayouts = loadSeatLayouts();
/** Which hall a screen name turned out to be, so repeat looks skip the layout. */
const seatHalls = new Map();

function loadSeatLayouts() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEAT_MAP_KEY) || "{}");
    if (!raw || typeof raw !== "object") return {};
    const fresh = {};
    for (const [key, entry] of Object.entries(raw)) {
      if (
        entry?.layout &&
        entry.v === SEAT_LAYOUT_VERSION &&
        Date.now() - (entry.at || 0) < SEAT_LAYOUT_TTL_MS
      ) {
        fresh[key] = entry;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function rememberSeatLayout(partnerId, locationId, layout, { persist = true } = {}) {
  if (!layout || locationId == null) return;
  seatLayouts[`${partnerId}:${locationId}`] = { at: Date.now(), v: SEAT_LAYOUT_VERSION, layout };
  if (!persist) return;
  try {
    localStorage.setItem(SEAT_MAP_KEY, JSON.stringify(seatLayouts));
  } catch (err) {
    console.warn("Could not store seat layout", err);
  }
}

function seatLayoutOf(show, locationId) {
  const id = locationId ?? seatHalls.get(show.screen);
  if (id == null) return null;
  return seatLayouts[`${partnerOf(show)}:${id}`]?.layout || null;
}

export function seatsAlwaysOpen() {
  return SEATS_OPEN_MQ.matches;
}

export function seatChartExpanded(show) {
  return seatsAlwaysOpen() || opened.has(show.id);
}

/**
 * Is a seat chart worth offering? Any numbered hall with a DX event —
 * including when nothing has sold yet — but never a hall DX said has no
 * numbered seats, nor a showing whose event DX has deleted.
 */
export function seatChartOffered(show) {
  if (!show.eventId || show.eventStatus === "unavailable" || show.eventStatus === "gone") {
    return false;
  }
  if (!scanVisible()) return false;
  return charts.get(String(show.eventId))?.status !== "empty";
}

/** Seats a guest could still buy: the hall less what reservations hold. */
function seatsOnSale(chart) {
  return Math.max((chart.capacity || 0) - (chart.reserved || 0), 0);
}

/** Sold seats read as plain sales until the doors open and scanning starts. */
function seatPhaseOf(show, chart, now = new Date()) {
  if (chart?.scanned > 0) return "door";
  return statusOf(show, now) === "upcoming" ? "sales" : "door";
}

/** Pull one hall from the bridge. */
export async function loadSeatChart(show, { force = false, retry = true, quiet = false } = {}) {
  const key = String(show.eventId);
  const previous = charts.get(key);
  if (previous?.status === "loading") return;
  if (!force && previous?.status === "ready" && Date.now() - previous.at < doorFreshMs(show)) {
    return;
  }

  if (PREVIEW_SCANNED) {
    charts.set(key, previewSeatChart(show));
    paintSeatChart(show);
    return;
  }

  const wasReady = previous?.status === "ready";
  charts.set(key, { ...previous, status: "loading", wasReady });
  // A chart that already has seats keeps showing them while it refreshes.
  if (!wasReady) paintSeatChart(show);

  const partnerId = partnerOf(show);
  let cardChanged = false;
  let skipPaint = false;
  try {
    const payload = { action: "seats", partnerId, eventId: key, withLayout: !seatLayoutOf(show) };
    if (dxToken()) payload.token = dxToken();
    const { status, ok, data } = await callDxProxy(payload);

    if (status === 401 || status === 403) {
      if (retry) {
        clearDxToken();
        charts.delete(key);
        return loadSeatChart(show, { force: true, retry: false, quiet });
      }
      throw dxError(data.error || "DX session expired", "auth");
    }
    if (!ok) throw bridgeFailure(status, data);

    if (data.token) rememberDxToken(data.token);
    const applied = applySeatAnswer(show, data, previous);
    cardChanged = applied.card;
    skipPaint = !applied.chart;
  } catch (err) {
    if (err?.code === "auth") {
      console.warn("DX bridge session failed", err);
      clearDxToken();
      S.dxScanStatus.error = String(err?.message || "auth");
      charts.set(key, { status: "error", at: Date.now(), error: String(err?.message || err) });
      paintSeatChart(show);
      return;
    }
    // An outage is the whole bridge, not this one chart.
    if (err?.code === "down" || err?.code === "network") {
      S.dxScanStatus.error = String(err?.message || err);
    }
    if (previous?.status === "ready") {
      // A background refresh that hiccuped must not wipe a good chart.
      charts.set(key, previous);
      skipPaint = true;
    } else {
      charts.set(key, {
        status: "error",
        at: Date.now(),
        code: err?.code || "",
        error: String(err?.message || err),
      });
    }
  }

  if (cardChanged) hooks.render();
  else if (!skipPaint) paintSeatChart(show);
}

/**
 * One hall's answer, from the bridge or from the server's bulk feed, onto
 * the chart and the card above it. `previous` is the chart as it was
 * before this read began. Says whether the card's figures moved and
 * whether the chart itself did.
 */
function applySeatAnswer(show, data, previous) {
  const key = String(show.eventId);
  if (data.locationId != null) seatHalls.set(show.screen, data.locationId);
  if (data.layout) rememberSeatLayout(partnerOf(show), data.locationId, data.layout);

  const layout = seatLayoutOf(show, data.locationId);
  const empty = Boolean(data.freeSeating) || !layout;
  const capacity = Number(data.capacity) || 0;
  const fresh = {
    status: empty ? "empty" : "ready",
    reason: data.freeSeating ? "free" : layout ? "" : "noMap",
    at: Date.now(),
    locationId: data.locationId,
    capacity: capacity || show.capacity || 0,
    reserved: capacity ? Number(data.reserved) || 0 : 0,
    sold: Number(data.sold) || 0,
    scanned: Number(data.scanned) || 0,
    unseated: Number(data.unseated) || 0,
    seats: data.seats || {},
  };
  charts.set(key, fresh);
  if (S.dxScanStatus.error) S.dxScanStatus.error = "";

  const same =
    previous?.status === "ready" &&
    fresh.status === "ready" &&
    previous.sold === fresh.sold &&
    previous.scanned === fresh.scanned &&
    previous.capacity === fresh.capacity &&
    previous.reserved === fresh.reserved &&
    JSON.stringify(previous.seats) === JSON.stringify(fresh.seats);

  // The same answer carries the freshest sold/scanned/reserved, so the
  // card above the chart stays in step with the squares below it.
  let card = false;
  if (typeof data.sold === "number" && show.sold !== data.sold) {
    show.sold = data.sold;
    card = true;
  }
  if (typeof data.scanned === "number" && show.scanned !== data.scanned) {
    show.scanned = data.scanned;
    card = true;
  }
  if (typeof data.scanned === "number") show.scannedAt = Date.now();
  if (typeof data.reserved === "number" && show.reserved !== data.reserved) {
    show.reserved = data.reserved;
    card = true;
  }
  if (card) persistHistory([show]);
  return { card, chart: !same };
}

/** Halls this device already has drawn, so the server can leave them out. */
export function knownHallKeys() {
  return Object.keys(seatLayouts);
}

/**
 * The seat half of the server's bulk answer: new hall layouts, then every
 * chart it sent. A chart this device is reading itself right now is left
 * to that read. True when a card's figures moved and the day needs a redraw.
 */
export function applyServerSeats(body) {
  if (PREVIEW_SCANNED || !S.state?.shows) return false;
  const halls = Object.entries(body.layouts || {});
  halls.forEach(([hall, layout], i) => {
    const [partnerId, locationId] = hall.split(":");
    rememberSeatLayout(partnerId, locationId, layout, { persist: i === halls.length - 1 });
  });

  const answers = body.seats || {};
  if (!Object.keys(answers).length) return false;
  let cardChanged = false;
  for (const show of S.state.shows) {
    const data = show.eventId ? answers[String(show.eventId)] : null;
    if (!data) continue;
    const previous = charts.get(String(show.eventId));
    if (previous?.status === "loading") continue;
    const applied = applySeatAnswer(show, data, previous);
    // A hall with no chart says so again every beat; nothing to redraw.
    const stillEmpty =
      previous?.status === "empty" && charts.get(String(show.eventId))?.status === "empty";
    if (applied.card) cardChanged = true;
    else if (applied.chart && !stillEmpty) paintSeatChart(show);
  }
  S.dxScanStatus.at = Date.now();
  S.dxScanStatus.source = "t3lluz.com";
  S.dxScanStatus.error = "";
  return cardChanged;
}

/** Replace just this show's chart, so opening one never reflows the day. */
export function paintSeatChart(show) {
  const open = seatChartExpanded(show);
  for (const host of document.querySelectorAll(`[data-seat-show="${cssEscape(show.id)}"]`)) {
    host.innerHTML = renderSeatChart(show);
    host.closest(".show")?.classList.toggle("seats-open", open);
  }
  for (const btn of document.querySelectorAll(`[data-seat-toggle="${cssEscape(show.id)}"]`)) {
    btn.setAttribute("aria-expanded", String(open));
  }
}

export async function toggleSeatChart(showId) {
  const show = showById(showId);
  if (!show || seatsAlwaysOpen()) return;

  if (opened.has(showId)) {
    opened.delete(showId);
    const card = document
      .querySelector(`[data-seat-toggle="${cssEscape(showId)}"]`)
      ?.closest(".show");
    card?.classList.remove("seats-open");
    for (const btn of document.querySelectorAll(`[data-seat-toggle="${cssEscape(showId)}"]`)) {
      btn.setAttribute("aria-expanded", "false");
    }
    if (!reducedMotion()) await new Promise((r) => setTimeout(r, 300));
    if (!opened.has(showId)) paintSeatChart(show);
    return;
  }
  opened.add(showId);
  paintSeatChart(show);
  await loadSeatChart(show);
}

/* Charts unfolded by width are fetched as they scroll into view, so a
 * wide day list costs one lookup per chart the visitor actually reaches. */
let autoObserver = null;

export function observeAutoSeatCharts(root = document) {
  if (!seatsAlwaysOpen() || typeof IntersectionObserver !== "function") return;
  if (!autoObserver) {
    autoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          autoObserver.unobserve(entry.target);
          const show = showById(entry.target.dataset.seatShow);
          if (show) loadSeatChart(show).catch((err) => console.warn("Seat chart load failed", err));
        }
      },
      { rootMargin: "300px 0px" }
    );
  }
  for (const host of root.querySelectorAll("[data-seat-show]")) {
    const show = showById(host.dataset.seatShow);
    if (!show) continue;
    const chart = charts.get(String(show.eventId));
    if (chart && chart.status !== "error") continue;
    autoObserver.observe(host);
  }
}

/** Keep unfolded charts current with the beat. */
export async function refreshOpenSeatCharts({ quiet = false } = {}) {
  if (!S.state?.shows) return;
  if (!opened.size && !seatsAlwaysOpen()) return;
  const visible = seatsAlwaysOpen() ? idsOnScreen("[data-seat-show]", "seatShow") : null;
  for (const show of S.state.shows) {
    if (!seatChartExpanded(show) || show.scanDone) continue;
    if (!opened.has(show.id) && !visible?.has(show.id)) continue;
    await loadSeatChart(show, { quiet }).catch((err) =>
      console.warn("Seat chart refresh failed", err)
    );
  }
}

/** Name the seat under the pointer in its chart's caption. */
export function describeSeat(seat) {
  const chart = seat.closest(".seat-chart");
  const caption = chart?.querySelector(".seat-picked");
  if (!caption) return;
  const state = seat.dataset.state;
  const sales = chart.classList.contains("phase-sales");
  const label =
    state === "2"
      ? t("seatIn")
      : state === "1"
        ? t(sales ? "seatSold" : "seatWaiting")
        : state === "3"
          ? t("seatReserved")
          : state === "4"
            ? t("seatBlocked")
            : t("seatFree");
  caption.textContent = t("seatPicked", { row: seat.dataset.row, seat: seat.dataset.seat, state: label });
  caption.classList.add("is-set");
  chart.querySelectorAll(".seat.is-picked").forEach((el) => el.classList.remove("is-picked"));
  seat.classList.add("is-picked");
}

/** The strip under a show card: fold-out button on phones, heading on wide. */
export function seatToggleHtml(show) {
  const open = seatChartExpanded(show);
  const hint = show.sold != null ? `${show.sold} ${t("sold")}` : "";
  const head = `
      <span class="seat-strip-icon">${icon("seats", "icon icon-sm")}</span>
      <span class="seat-strip-label">${escapeHtml(t("seatMapLabel"))}</span>
      ${hint ? `<span class="seat-strip-hint">${escapeHtml(hint)}</span>` : ""}`;

  const strip = seatsAlwaysOpen()
    ? `<div class="seat-strip is-static">${head}</div>`
    : `<button class="seat-strip" type="button" data-seat-toggle="${escapeHtml(show.id)}"
          aria-expanded="${open}" aria-controls="seatchart-${escapeHtml(show.id)}"
          aria-label="${escapeHtml(t("seatMapOpen", { title: show.title, time: formatClock(show.start) }))}">
        ${head}
        ${icon("chevronDown", "icon icon-sm seat-chevron")}
      </button>`;

  return `
    ${strip}
    <div class="seat-panel" id="seatchart-${escapeHtml(show.id)}">
      <div class="seat-panel-inner">
        <div class="seat-wrap" data-seat-show="${escapeHtml(show.id)}">${open ? renderSeatChart(show) : ""}</div>
      </div>
    </div>`;
}

export function renderSeatChart(show) {
  if (!seatChartExpanded(show)) return "";
  const chart = charts.get(String(show.eventId));

  if (!chart || (chart.status === "loading" && !chart.wasReady)) {
    return `<div class="seat-note"><span class="spinner spinner-sm" aria-hidden="true"></span>${escapeHtml(
      t("seatMapLoading")
    )}</div>`;
  }
  if (chart.status === "error") {
    return `<div class="seat-note is-error">
      <span>${escapeHtml(t(chart.code === "down" || chart.code === "network" ? "seatMapBridgeDown" : "seatMapError"))}</span>
      <button class="btn btn-sm" type="button" data-seat-retry="${escapeHtml(show.id)}">${escapeHtml(
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
  const states = Object.values(chart.seats);
  const taken = states.filter((s) => s === 1 || s === 2).length;
  const scannedSeats = states.filter((s) => s === 2).length;
  const reservedSeats = states.filter((s) => s === 3).length;
  const free = Math.max(seatsOnSale(chart) - taken, 0);

  let blockedSeats = 0;
  for (const row of layout.rows) {
    for (const seat of row.seats) {
      const state = chart.seats[seat.i];
      if (state === 4 || (seat.b && !state)) blockedSeats++;
    }
  }

  const legend =
    phase === "sales"
      ? [
          ["free", t("seatFree"), free],
          ["sold", t("seatSold"), taken],
        ]
      : [
          ["free", t("seatFree"), free],
          ["waiting", t("seatWaiting"), taken - scannedSeats],
          ["in", t("seatIn"), scannedSeats],
        ];
  if (reservedSeats) legend.push(["reserved", t("seatReserved"), reservedSeats]);
  if (blockedSeats) legend.push(["blocked", t("seatBlocked"), blockedSeats]);

  return `
    <div class="seat-chart phase-${phase}">
      ${seatChartSvg(layout, chart.seats, show)}
      <div class="seat-legend">
        ${legend
          .map(
            ([key, label, n]) => `<span class="seat-key key-${key}">
              <span class="seat-swatch" aria-hidden="true"></span>${escapeHtml(label)}<strong>${n}</strong>
            </span>`
          )
          .join("")}
      </div>
      <p class="seat-picked" aria-live="polite">${escapeHtml(t("seatTapHint"))}</p>
      ${chart.unseated ? `<p class="seat-notes">${escapeHtml(t("seatUnseated", { n: chart.unseated }))}</p>` : ""}
    </div>`;
}

/**
 * The hall itself, drawn in DX's coordinates so it matches the chart
 * staff see in DX: screen at the top, row 1 nearest it, row numbers at
 * both ends the way they are painted on a cinema's walls.
 */
function seatChartSvg(layout, seats, show) {
  const { box, pitch } = layout;
  const w = pitch.x * 0.8;
  const h = pitch.y * 0.74;
  const gutter = pitch.x * 1.5;
  const pad = pitch.x * 0.4;

  const arcY = box.y - pitch.y / 2 - pitch.y * 0.9;
  const arcRise = pitch.y * 0.55;
  const labelSize = pitch.y * 0.5;
  const labelY = arcY - arcRise - pitch.y * 0.35;
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

  const rowLabel = (row, x) =>
    `<text class="seat-row-label" x="${x.toFixed(1)}" y="${row.y}" dy="0.35em" font-size="${(
      pitch.y * 0.55
    ).toFixed(1)}">${escapeHtml(row.name)}</text>`;

  const classOf = { 1: "sold", 2: "in", 3: "reserved", 4: "blocked" };
  const numSize = S.showSeatNumbers ? Math.min(h * 0.66, w * 0.52) : 0;
  const rows = layout.rows
    .map((row) => {
      const seatEls = row.seats
        .map((seat) => {
          const state = seats[seat.i] || (seat.b ? 4 : 0);
          const cls = classOf[state] || "free";
          const x = seat.x - w / 2;
          const y = row.y - h / 2;
          const strike =
            state === 4
              ? `<line class="seat-strike" x1="${(x + w * 0.2).toFixed(1)}" y1="${(y + h * 0.8).toFixed(
                  1
                )}" x2="${(x + w * 0.8).toFixed(1)}" y2="${(y + h * 0.2).toFixed(1)}" />`
              : "";
          const num =
            numSize && state !== 4
              ? `<text class="seat-num" x="${seat.x.toFixed(1)}" y="${row.y.toFixed(
                  1
                )}" dy="0.36em" font-size="${numSize.toFixed(1)}">${seat.n}</text>`
              : "";
          return `<g class="seat-g"><rect class="seat ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(
            1
          )}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(w * 0.24).toFixed(
            1
          )}" data-row="${escapeHtml(row.name)}" data-seat="${seat.n}" data-state="${state}" />${num}${strike}</g>`;
        })
        .join("");
      return `<g class="seat-row">${rowLabel(row, left)}${seatEls}${rowLabel(row, right)}</g>`;
    })
    .join("");

  const screenX1 = box.x - pitch.x / 2;
  const screenX2 = box.x + box.w + pitch.x / 2;
  const screenMid = (screenX1 + screenX2) / 2;
  const sold = Object.values(seats).filter((s) => s === 1 || s === 2).length;
  const scanned = Object.values(seats).filter((s) => s === 2).length;

  return `
    <svg class="seat-svg" viewBox="${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(
      1
    )}" role="img" aria-label="${escapeHtml(
      t("seatAria", { screen: show.screen, sold, capacity: layout.seats, scanned })
    )}">
      <path class="seat-screen" d="M${screenX1.toFixed(1)} ${arcY.toFixed(1)} Q ${screenMid.toFixed(
        1
      )} ${(arcY - arcRise * 2).toFixed(1)} ${screenX2.toFixed(1)} ${arcY.toFixed(1)}" />
      <text class="seat-screen-label" x="${screenMid.toFixed(1)}" y="${labelY.toFixed(
        1
      )}" font-size="${labelSize.toFixed(1)}" letter-spacing="${(pitch.y * 0.12).toFixed(2)}">${escapeHtml(
        t("seatScreen")
      ).toUpperCase()}</text>
      ${rows}
    </svg>`;
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
      seats: Array.from({ length: n }, (_, i) => ({ i: id++, n: i + 1, x: pitch.x * (i + 1) + inset })),
    });
  }

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

  const seats = {};
  const backRow = rows[rows.length - 1];
  if (backRow && backRow.seats.length > 6) {
    seats[backRow.seats[0].i] = 4;
    seats[backRow.seats[backRow.seats.length - 1].i] = 4;
  }
  const open = all.filter((seat) => !seats[seat.id]);
  const sold = Math.min(Number(show.sold) || 0, open.length);
  const scanned = Math.min(Number(show.scanned) || 0, sold);
  const reserved = Math.min(Number(show.reserved) || 0, open.length - sold);
  open.slice(0, sold).forEach((seat, i) => {
    seats[seat.id] = i < scanned ? 2 : 1;
  });
  open.slice(sold, sold + reserved).forEach((seat) => {
    seats[seat.id] = 3;
  });

  const locationId = `preview-${show.screen}`;
  rememberSeatLayout(
    partnerOf(show),
    locationId,
    {
      locationId,
      rows,
      seats: placed,
      box: { x: pitch.x, y: pitch.y, w: pitch.x * (perRow - 1), h: pitch.y * (rowCount - 1) },
      pitch,
    },
    { persist: false }
  );
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

/** Wire the chart's own controls (toggle, retry, seat picking). */
export function setupSeatCharts() {
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest?.("[data-seat-toggle]");
    if (toggle) {
      toggleSeatChart(toggle.dataset.seatToggle);
      return;
    }
    const retry = e.target.closest?.("[data-seat-retry]");
    if (retry) {
      const show = showById(retry.dataset.seatRetry);
      if (show) loadSeatChart(show, { force: true });
      return;
    }
    const seat = e.target.closest?.(".seat-g");
    if (seat) describeSeat(seat.querySelector(".seat"));
  });
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const seat = e.target.closest?.(".seat-g");
    if (seat) describeSeat(seat.querySelector(".seat"));
  });
}
