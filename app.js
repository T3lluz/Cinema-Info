const DATA_URL = "./data/program.json";
const PREFS_KEY = "cinemaInfoPrefs";

const WEEKDAYS = [
  "søndag",
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
];

const MONTHS = [
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
];

const els = {
  content: document.getElementById("content"),
  dayTabs: document.getElementById("dayTabs"),
  screenSelect: document.getElementById("screenSelect"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusText: document.getElementById("statusText"),
  summary: document.getElementById("summary"),
};

/** @type {{ shows: any[], updatedAt?: string } | null} */
let state = null;
let selectedDay = "";
let enrichToken = 0;

init();

async function init() {
  const prefs = loadPrefs();
  selectedDay = prefs.selectedDay || "";
  if (prefs.selectedScreen) els.screenSelect.value = prefs.selectedScreen;

  els.screenSelect.addEventListener("change", onFilterChange);
  els.refreshBtn.addEventListener("click", () => load({ forceLive: true }));

  await load({ forceLive: true });
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      selectedDay,
      selectedScreen: els.screenSelect.value,
    })
  );
}

async function onFilterChange() {
  savePrefs();
  render();
  await enrichVisibleDay();
}

async function load({ forceLive = false } = {}) {
  setLoading(true);
  try {
    const data = await loadProgramSnapshot();

    state = {
      updatedAt: data.updatedAt,
      shows: (data.shows || []).map(normalizeCachedShow),
    };

    populateFilters();
    render();
    els.statusText.textContent = state.updatedAt
      ? `Snapshot ${formatClock(new Date(state.updatedAt))}`
      : "Program lastet";

    if (forceLive) {
      await enrichVisibleDay();
    }
  } catch (err) {
    console.error(err);
    showError(err?.message || "Kunne ikke hente programmet.");
  } finally {
    setLoading(false);
  }
}

async function loadProgramSnapshot() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Kunne ikke lese program (${res.status})`);
  return res.json();
}

function normalizeCachedShow(show) {
  return {
    ...show,
    start: parseLocalDateTime(show.start),
    end: show.end ? parseLocalDateTime(show.end) : null,
  };
}

function populateFilters() {
  const days = [...new Set(state.shows.map((s) => s.dayKey))].sort();
  const screens = [...new Set(state.shows.map((s) => s.screen))].sort((a, b) =>
    a.localeCompare(b, "nb")
  );

  const today = toDayKey(new Date());
  if (!selectedDay || !days.includes(selectedDay)) {
    selectedDay = days.includes(today) ? today : days[0] || today;
  }

  els.dayTabs.innerHTML = days
    .map((day) => {
      const selected = day === selectedDay;
      return `<button type="button" class="day-tab" role="tab" data-day="${day}" aria-selected="${selected}">${escapeHtml(
        shortDayLabel(day)
      )}</button>`;
    })
    .join("");

  els.dayTabs.querySelectorAll(".day-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      selectedDay = btn.dataset.day;
      savePrefs();
      populateFilters();
      render();
      await enrichVisibleDay();
      btn.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    });
  });

  const currentScreen = els.screenSelect.value || "all";
  els.screenSelect.innerHTML =
    `<option value="all">Alle saler</option>` +
    screens
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("");
  els.screenSelect.value = screens.includes(currentScreen)
    ? currentScreen
    : "all";

  const active = els.dayTabs.querySelector('.day-tab[aria-selected="true"]');
  active?.scrollIntoView({ inline: "center", block: "nearest" });
}

function shortDayLabel(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = capitalize(WEEKDAYS[date.getDay()]).slice(0, 3);
  if (dayKey === toDayKey(new Date())) return `I dag ${d}.${m}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey === toDayKey(tomorrow)) return `I morgen ${d}.${m}`;
  return `${weekday} ${d}.${m}`;
}

function formatDayLabel(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${capitalize(WEEKDAYS[date.getDay()])} ${d}. ${MONTHS[m - 1]}`;
}

function visibleShows() {
  const screen = els.screenSelect.value;
  return state.shows.filter(
    (s) => s.dayKey === selectedDay && (screen === "all" || s.screen === screen)
  );
}

function render() {
  if (!state?.shows) return;
  const shows = visibleShows();
  const now = new Date();
  renderSummary(shows, now);

  if (!shows.length) {
    els.content.innerHTML =
      `<div class="empty-note">Ingen forestillinger for valgt dag/sal.</div>`;
    return;
  }

  const screenFilter = els.screenSelect.value;
  const parts = [];
  for (let i = 0; i < shows.length; i++) {
    const show = shows[i];
    const prev = shows[i - 1];
    if (prev && screenFilter !== "all" && show.end && prev.end) {
      const gapMin = Math.round((show.start - prev.end) / 60_000);
      if (gapMin >= 15) {
        parts.push(`<div class="gap-row">${gapMin} min pause</div>`);
      }
    }
    parts.push(renderShowCard(show, now));
  }

  els.content.innerHTML = `
    <div class="day-block">
      <div class="empty-note" style="padding:0 0 6px;text-align:left;font-size:0.85rem;font-weight:700;color:var(--ink)">
        ${escapeHtml(formatDayLabel(selectedDay))}
      </div>
      ${parts.join("")}
    </div>
  `;
}

function renderSummary(shows, now) {
  if (!shows.length) {
    els.summary.hidden = true;
    els.summary.innerHTML = "";
    return;
  }

  const live = shows.filter((s) => statusOf(s, now) === "live").length;
  const withSold = shows.filter((s) => s.eventStatus === "ok" && s.sold != null);
  const soldSum = withSold.reduce((n, s) => n + (s.sold || 0), 0);

  els.summary.hidden = false;
  els.summary.innerHTML = `
    <span class="chip"><strong>${shows.length}</strong> visninger</span>
    ${live ? `<span class="chip live"><strong>${live}</strong> pågår</span>` : ""}
    ${
      withSold.length
        ? `<span class="chip"><strong>${soldSum}</strong> solgt totalt</span>`
        : ""
    }
  `;
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

function renderShowCard(show, now) {
  const status = statusOf(show, now);
  const badge =
    status === "live"
      ? `<span class="badge live">Nå</span>`
      : status === "soon"
        ? `<span class="badge soon">Snart</span>`
        : status === "done"
          ? `<span class="badge done">Ferdig</span>`
          : "";

  const endLabel = show.end ? formatClock(show.end) : "…";
  const duration = show.runningLabel
    ? show.runningLabel.replace(" t. ", "t ").replace(" min.", "m")
    : formatDuration(show.runningMinutes);

  const metaBits = [
    `<span class="screen">${escapeHtml(show.screen)}</span>`,
    show.age ? `<span class="dot">${escapeHtml(show.age)}</span>` : "",
    `<span class="dot">${escapeHtml(duration)}</span>`,
    show.tags?.[0]
      ? `<span class="dot">${escapeHtml(show.tags[0])}</span>`
      : "",
    badge,
  ]
    .filter(Boolean)
    .join("");

  const poster = show.posterUrl
    ? `<img class="poster" src="${escapeHtml(show.posterUrl)}" alt="" loading="lazy" width="56" height="80" />`
    : `<div class="poster-fallback" aria-hidden="true">${escapeHtml(
        (show.title || "?").slice(0, 1)
      )}</div>`;

  return `
    <article class="show-card ${status}">
      ${poster}
      <div class="show-main">
        <div class="time-range">${formatClock(show.start)}<span class="sep">–</span>${endLabel}</div>
        <h2 class="show-title">${escapeHtml(show.title)}</h2>
        <div class="meta-line">${metaBits}</div>
      </div>
      ${renderTicketCol(show)}
    </article>
  `;
}

function renderTicketCol(show) {
  if (show.eventStatus === "unavailable") {
    return `<div class="ticket-col"><span class="ticket-missing">—</span></div>`;
  }
  if (show.eventStatus === "error") {
    return `<div class="ticket-col"><span class="ticket-missing">Feil</span></div>`;
  }
  if (show.sold == null) {
    return `<div class="ticket-col"><span class="ticket-loading">…</span></div>`;
  }
  return `
    <div class="ticket-col">
      <div class="ticket-ratio">${show.sold}</div>
      <div class="ticket-sub">solgt</div>
    </div>
  `;
}

/** Live-refresh sold + end times from DX (CORS-friendly). */
async function enrichVisibleDay() {
  if (!state?.shows || !selectedDay) return;

  const dayShows = state.shows.filter((s) => s.dayKey === selectedDay && s.eventId);
  if (!dayShows.length) return;

  const token = ++enrichToken;
  els.refreshBtn.classList.add("spinning");

  await Promise.all(
    dayShows.map(async (show) => {
      try {
        const event = await fetchDxEvent(show);
        const end = parseLocalDateTime(event.end);
        const begin = parseLocalDateTime(event.begin);
        if (begin) show.start = begin;
        if (end) show.end = end;
        show.sold = Number(event.ticketSale?.sold) || 0;
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
    })
  );

  if (token !== enrichToken) return;
  render();
  els.statusText.textContent = `Live ${formatClock(new Date())}`;
  els.refreshBtn.classList.remove("spinning");
}

async function fetchDxEvent(show) {
  const promoterId = show.promoterId || "202";
  const url = `https://api.dx.no/v3/partners/${promoterId}/events/${show.eventId}`;
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
  return date.toLocaleTimeString("nb-NO", {
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

function setLoading(isLoading) {
  els.refreshBtn.disabled = isLoading;
  els.refreshBtn.classList.toggle("spinning", isLoading);
  if (isLoading && !state) {
    els.content.innerHTML = `
      <div class="state loading">
        <div class="spinner" aria-hidden="true"></div>
        <p>Henter program…</p>
      </div>
    `;
  }
}

function showError(message) {
  els.summary.hidden = true;
  els.statusText.textContent = "Feil";
  els.content.innerHTML = `
    <div class="state error">
      <p>${escapeHtml(message)}</p>
      <button type="button" id="retryBtn">Prøv igjen</button>
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
