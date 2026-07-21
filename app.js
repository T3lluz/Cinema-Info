const DATA_URL = "./data/program.json";
const PREFS_KEY = "cinemaInfoPrefs";
const HISTORY_KEY = "cinemaInfoHistory";
const HISTORY_KEEP_DAYS = 120;

const I18N = {
  nb: {
    "nav.day": "Dager",
    "nav.movies": "Filmer",
    "nav.stats": "Statistikk",
    "nav.settings": "Innstillinger",
    screen: "Sal",
    allScreens: "Alle saler",
    loading: "Henter program…",
    refresh: "Oppdater",
    emptyDay: "Ingen forestillinger for valgt dag/sal.",
    gap: "{n} min pause",
    now: "Nå",
    soon: "Snart",
    done: "Ferdig",
    sold: "solgt",
    error: "Feil",
    retry: "Prøv igjen",
    loadError: "Kunne ikke hente programmet.",
    updated: "Oppdatert {time}",
    liveAt: "Live {time}",
    moviesOne: "1 film",
    moviesMany: "{n} filmer",
    showsOne: "1 forestilling",
    showsMany: "{n} forestillinger",
    ongoing: "pågår",
    soldLabel: "solgt",
    today: "I dag",
    yesterday: "I går",
    tomorrow: "I morgen",
    dayTab: "{weekday} {d}.{m}",
    dayFull: "{weekday} {d}. {month}",
    moviesTitle: "Filmer",
    moviesSubtitle: "Alle tider gruppert per film",
    noMovies: "Ingen filmer i programmet.",
    statsTitle: "Statistikk",
    soldByDay: "Solgt per dag",
    soldByWeek: "Solgt per uke",
    topSold: "Mest solgte filmer",
    weekLabel: "Uke {n}",
    noSoldData: "Ingen solgtdata ennå — trykk oppdater.",
    settingsTitle: "Innstillinger",
    settingsSubtitle: "Språk og utseende",
    language: "Språk",
    languageHint: "Velg språk for appen",
    theme: "Tema",
    themeHint: "Lys eller mørk modus",
    themeLight: "Lys",
    themeDark: "Mørk",
    langNb: "Norsk",
    langEn: "English",
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
    screen: "Screen",
    allScreens: "All screens",
    loading: "Loading program…",
    refresh: "Refresh",
    emptyDay: "No movies for selected day/screen.",
    gap: "{n} min break",
    now: "Now",
    soon: "Soon",
    done: "Done",
    sold: "sold",
    error: "Error",
    retry: "Try again",
    loadError: "Could not load the program.",
    updated: "Updated {time}",
    liveAt: "Live {time}",
    moviesOne: "1 movie",
    moviesMany: "{n} movies",
    showsOne: "1 showtime",
    showsMany: "{n} showtimes",
    ongoing: "playing",
    soldLabel: "sold",
    today: "Today",
    yesterday: "Yesterday",
    tomorrow: "Tomorrow",
    dayTab: "{weekday} {d}.{m}",
    dayFull: "{weekday} {d} {month}",
    moviesTitle: "Movies",
    moviesSubtitle: "All times grouped by movie",
    noMovies: "No movies in the program.",
    statsTitle: "Statistics",
    soldByDay: "Sold by day",
    soldByWeek: "Sold by week",
    topSold: "Top sold movies",
    weekLabel: "Week {n}",
    noSoldData: "No sales data yet — tap refresh.",
    settingsTitle: "Settings",
    settingsSubtitle: "Language and appearance",
    language: "Language",
    languageHint: "Choose app language",
    theme: "Theme",
    themeHint: "Light or dark mode",
    themeLight: "Light",
    themeDark: "Dark",
    langNb: "Norsk",
    langEn: "English",
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
  moviesContent: document.getElementById("moviesContent"),
  statsContent: document.getElementById("statsContent"),
  settingsContent: document.getElementById("settingsContent"),
  dayTabs: document.getElementById("dayTabs"),
  dayControls: document.getElementById("dayControls"),
  screenSelect: document.getElementById("screenSelect"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusText: document.getElementById("statusText"),
  summary: document.getElementById("summary"),
  views: {
    day: document.getElementById("view-day"),
    movies: document.getElementById("view-movies"),
    stats: document.getElementById("view-stats"),
    settings: document.getElementById("view-settings"),
  },
};

/** @type {{ shows: any[], updatedAt?: string } | null} */
let state = null;
let selectedDay = "";
let enrichToken = 0;
let activeTab = "day";
let lang = "nb";
let theme = "light";
let enrichedAll = false;

init();

async function init() {
  const prefs = loadPrefs();
  selectedDay = prefs.selectedDay || "";
  activeTab = prefs.activeTab || "day";
  lang = prefs.lang === "en" ? "en" : "nb";
  theme = prefs.theme === "dark" ? "dark" : "light";
  if (prefs.selectedScreen) els.screenSelect.value = prefs.selectedScreen;

  applyTheme(theme);
  applyLanguage();
  setActiveTab(activeTab, { skipRender: true });

  els.screenSelect.addEventListener("change", onFilterChange);
  els.refreshBtn.addEventListener("click", () => load({ forceLive: true }));
  document.querySelectorAll(".pill-tab").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  await load({ forceLive: true });
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

function moviesLabel(n) {
  return n === 1 ? t("moviesOne") : t("moviesMany", { n });
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

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      selectedDay,
      selectedScreen: els.screenSelect.value,
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
      if (!next.end && prev.end) next.end = prev.end;
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
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#1a1816" : "#c41e2a";
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
  els.screenSelect.setAttribute(
    "aria-label",
    lang === "en" ? "Filter screen" : "Filtrer sal"
  );
  els.dayTabs.setAttribute(
    "aria-label",
    lang === "en" ? "Choose day" : "Velg dag"
  );
  document.querySelector(".pill-nav")?.setAttribute(
    "aria-label",
    lang === "en" ? "Main menu" : "Hovedmeny"
  );
}

async function setActiveTab(tab, { skipRender = false } = {}) {
  if (!els.views[tab]) return;
  activeTab = tab;
  savePrefs();
  document.body.dataset.tab = tab;

  Object.entries(els.views).forEach(([key, el]) => {
    el.hidden = key !== tab;
  });

  document.querySelectorAll(".pill-tab").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
  });

  els.dayControls.hidden = tab !== "day";
  els.refreshBtn.hidden = tab === "settings";

  if (skipRender || !state?.shows) return;

  if (tab === "day") renderDay();
  else if (tab === "movies") {
    await ensureAllEnriched();
    renderMovies();
  } else if (tab === "stats") {
    await ensureAllEnriched();
    renderStats();
  } else if (tab === "settings") renderSettings();
}

async function onFilterChange() {
  savePrefs();
  renderDay();
  await enrichVisibleDay();
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
      if (activeTab === "day") await enrichVisibleDay();
      else if (activeTab === "movies" || activeTab === "stats") {
        await enrichAllShows({ force: true });
      }
    }

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
}

async function loadProgramSnapshot() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${t("loadError")} (${res.status})`);
  return res.json();
}

function normalizeCachedShow(show) {
  return {
    ...show,
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
  const screens = [...new Set(state.shows.map((s) => s.screen))].sort((a, b) =>
    a.localeCompare(b, lang === "en" ? "en" : "nb")
  );

  const today = toDayKey(new Date());
  if (!selectedDay || !days.includes(selectedDay)) {
    selectedDay = days.includes(today)
      ? today
      : days.find((d) => d >= today) || days[days.length - 1] || today;
  }

  els.dayTabs.innerHTML = days
    .map((day) => {
      const past = day < today;
      const selected = day === selectedDay;
      return `<button type="button" class="day-tab${past ? " past" : ""}" role="tab" data-day="${day}" aria-selected="${selected}">${escapeHtml(
        shortDayLabel(day)
      )}</button>`;
    })
    .join("");

  els.dayTabs.querySelectorAll(".day-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      selectedDay = btn.dataset.day;
      savePrefs();
      populateFilters();
      renderDay();
      await enrichVisibleDay();
      btn.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    });
  });

  const currentScreen = els.screenSelect.value || "all";
  els.screenSelect.innerHTML =
    `<option value="all">${escapeHtml(t("allScreens"))}</option>` +
    screens
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("");
  els.screenSelect.value = screens.includes(currentScreen)
    ? currentScreen
    : "all";

  els.dayTabs
    .querySelector('.day-tab[aria-selected="true"]')
    ?.scrollIntoView({ inline: "center", block: "nearest" });
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

function visibleShows() {
  const screen = els.screenSelect.value;
  return state.shows
    .filter(
      (s) =>
        s.dayKey === selectedDay && (screen === "all" || s.screen === screen)
    )
    .sort((a, b) => a.start - b.start);
}

function renderDay() {
  if (!state?.shows) return;
  const shows = visibleShows();
  const now = new Date();
  renderSummary(shows, now);

  if (!shows.length) {
    els.content.innerHTML = `<div class="empty-note">${escapeHtml(
      t("emptyDay")
    )}</div>`;
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
        parts.push(
          `<div class="gap-row">${escapeHtml(t("gap", { n: gapMin }))}</div>`
        );
      }
    }
    parts.push(renderShowCard(show, now));
  }

  els.content.innerHTML = `
    <div class="day-block">
      <div class="section-label">${escapeHtml(formatDayLabel(selectedDay))}</div>
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

  const movieCount = new Set(shows.map((s) => s.title)).size;
  const live = shows.filter((s) => statusOf(s, now) === "live").length;
  const soldSum = shows.reduce((n, s) => n + soldOf(s), 0);
  const hasSold = shows.some((s) => s.sold != null);

  els.summary.hidden = false;
  els.summary.innerHTML = `
    <span class="chip">${escapeHtml(moviesLabel(movieCount))}</span>
    ${
      live
        ? `<span class="chip live"><strong>${live}</strong> ${escapeHtml(t("ongoing"))}</span>`
        : ""
    }
    ${
      hasSold
        ? `<span class="chip"><strong>${soldSum}</strong> ${escapeHtml(t("soldLabel"))}</span>`
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
      ? `<span class="badge live">${escapeHtml(t("now"))}</span>`
      : status === "soon"
        ? `<span class="badge soon">${escapeHtml(t("soon"))}</span>`
        : status === "done"
          ? `<span class="badge done">${escapeHtml(t("done"))}</span>`
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

  return `
    <article class="show-card ${status}">
      ${renderPoster(show, 52, 74)}
      <div class="show-main">
        <div class="time-range">${formatClock(show.start)}<span class="sep">–</span>${endLabel}</div>
        <h2 class="show-title">${escapeHtml(show.title)}</h2>
        <div class="meta-line">${metaBits}</div>
      </div>
      ${renderTicketCol(show)}
    </article>
  `;
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
  return `
    <div class="ticket-col">
      <div class="ticket-ratio">${show.sold}</div>
      <div class="ticket-sub">${escapeHtml(t("sold"))}</div>
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
      ${movies.map((m) => renderMovieTile(m, now)).join("")}
    </div>
  `;
}

function renderMovieTile(movie, now) {
  const duration = movie.runningLabel
    ? movie.runningLabel.replace(" t. ", "t ").replace(" min.", "m")
    : formatDuration(movie.runningMinutes);

  const meta = [movie.age, duration, movie.tags?.[0], showsLabel(movie.shows.length)]
    .filter(Boolean)
    .map((x) => escapeHtml(String(x)))
    .join(" · ");

  const times = movie.shows
    .map((show) => {
      const status = statusOf(show, now);
      const sold =
        show.sold != null
          ? `<span class="tile-sold">${show.sold}</span>`
          : "";
      return `
        <div class="tile-show ${status}">
          <span class="tile-day">${escapeHtml(shortShowDay(show.dayKey))}</span>
          <span class="tile-time">${formatClock(show.start)}</span>
          <span class="tile-screen">${escapeHtml(show.screen)}</span>
          ${sold}
        </div>
      `;
    })
    .join("");

  return `
    <article class="movie-tile">
      ${renderPoster(movie, 72, 104, "movie-poster")}
      <div class="movie-tile-body">
        <h3 class="movie-tile-title">${escapeHtml(movie.title)}</h3>
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
  const byDay = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));
  const maxDaySold = Math.max(...byDay.map((d) => d.sold), 1);

  const weekMap = new Map();
  for (const row of byDay) {
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

  els.statsContent.innerHTML = `
    <div class="view-intro">
      <h2>${escapeHtml(t("statsTitle"))}</h2>
    </div>

    <section class="stats-panel">
      <div class="stats-panel-head">
        <h3>${escapeHtml(t("soldByDay"))}</h3>
      </div>
      <div class="day-sold-list">
        ${byDay
          .map((row, i) => {
            const pct = Math.max((row.sold / maxDaySold) * 100, row.sold ? 4 : 0);
            return `
              <div class="stat-row" style="--i:${i}">
                <span class="stat-row-label">${escapeHtml(shortShowDay(row.day))}</span>
                <div class="stat-track"><div class="stat-fill" style="width:${pct}%"></div></div>
                <span class="stat-row-value">${row.sold}</span>
              </div>`;
          })
          .join("")}
      </div>
    </section>

    <section class="stats-panel">
      <div class="stats-panel-head">
        <h3>${escapeHtml(t("soldByWeek"))}</h3>
      </div>
      <div class="week-list">
        ${byWeek
          .map((row, i) => {
            const pct = Math.max(
              (row.sold / maxWeekSold) * 100,
              row.sold ? 4 : 0
            );
            return `
              <div class="stat-row" style="--i:${i}">
                <div class="stat-row-stack">
                  <span class="stat-row-label">${escapeHtml(
                    t("weekLabel", { n: row.week })
                  )}</span>
                  <span class="stat-row-sub">${escapeHtml(
                    weekRangeLabel(row.days)
                  )}</span>
                </div>
                <div class="stat-track"><div class="stat-fill" style="width:${pct}%"></div></div>
                <span class="stat-row-value">${row.sold}</span>
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
                <div class="top-row" style="--i:${i}">
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
        <button type="button" class="seg-btn" data-theme-opt="light" aria-pressed="${theme === "light"}">${escapeHtml(t("themeLight"))}</button>
        <button type="button" class="seg-btn" data-theme-opt="dark" aria-pressed="${theme === "dark"}">${escapeHtml(t("themeDark"))}</button>
      </div>
    </section>
  `;

  els.settingsContent.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      lang = btn.dataset.lang === "en" ? "en" : "nb";
      savePrefs();
      applyLanguage();
      if (state?.shows) populateFilters();
      renderSettings();
      renderActiveView();
    });
  });

  els.settingsContent.querySelectorAll("[data-theme-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.themeOpt === "dark" ? "dark" : "light");
      savePrefs();
      renderSettings();
    });
  });
}

async function enrichVisibleDay() {
  if (!state?.shows || !selectedDay) return;
  const dayShows = state.shows.filter(
    (s) => s.dayKey === selectedDay && s.eventId
  );
  if (!dayShows.length) return;

  const token = ++enrichToken;
  els.refreshBtn.classList.add("spinning");
  await Promise.all(dayShows.map((show) => enrichOne(show)));
  if (token !== enrichToken) return;

  persistHistory(dayShows);
  if (activeTab === "day") renderDay();
  els.statusText.textContent = t("liveAt", { time: formatClock(new Date()) });
  els.refreshBtn.classList.remove("spinning");
}

async function ensureAllEnriched() {
  if (enrichedAll || !state?.shows) return;
  await enrichAllShows();
}

async function enrichAllShows({ force = false } = {}) {
  if (!state?.shows) return;
  const targets = state.shows.filter(
    (s) =>
      s.eventId &&
      (force || s.sold == null || s.eventStatus === "pending")
  );
  if (!targets.length) {
    enrichedAll = true;
    return;
  }

  const token = ++enrichToken;
  els.refreshBtn.classList.add("spinning");

  const batchSize = 8;
  for (let i = 0; i < targets.length; i += batchSize) {
    if (token !== enrichToken) return;
    await Promise.all(targets.slice(i, i + batchSize).map((s) => enrichOne(s)));
  }

  if (token !== enrichToken) return;
  persistHistory(targets);
  enrichedAll = true;
  els.statusText.textContent = t("liveAt", { time: formatClock(new Date()) });
  els.refreshBtn.classList.remove("spinning");
}

async function enrichOne(show) {
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

function setLoading(isLoading) {
  els.refreshBtn.disabled = isLoading;
  els.refreshBtn.classList.toggle("spinning", isLoading);
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
