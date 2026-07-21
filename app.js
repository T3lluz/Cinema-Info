const DATA_URL = "./data/program.json";
const PREFS_KEY = "cinemaInfoPrefs";

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
    snapshot: "Snapshot {time}",
    liveAt: "Live {time}",
    shows: "visninger",
    ongoing: "pågår",
    soldTotal: "solgt totalt",
    today: "I dag {d}.{m}",
    tomorrow: "I morgen {d}.{m}",
    dayShort: "{weekday} {d}.{m}",
    dayFull: "{weekday} {d}. {month}",
    footerSold: "Sluttid + solgt fra eBillett",
    moviesTitle: "Filmer",
    moviesSubtitle: "Alle forestillinger gruppert per film",
    noMovies: "Ingen filmer i programmet.",
    showtimes: "Forestillinger",
    statsTitle: "Statistikk",
    statsSubtitle: "Oversikt over programmet",
    statShows: "Forestillinger",
    statMovies: "Filmer",
    statDays: "Dager",
    statScreens: "Saler",
    statSold: "Solgte billetter",
    statLive: "Pågår nå",
    statSoon: "Snart",
    byDay: "Per dag",
    byScreen: "Per sal",
    topSold: "Mest solgte",
    noSoldData: "Ingen solgtdata ennå — oppdater for live tall.",
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
    emptyDay: "No showtimes for selected day/screen.",
    gap: "{n} min break",
    now: "Now",
    soon: "Soon",
    done: "Done",
    sold: "sold",
    error: "Error",
    retry: "Try again",
    loadError: "Could not load the program.",
    snapshot: "Snapshot {time}",
    liveAt: "Live {time}",
    shows: "showtimes",
    ongoing: "playing",
    soldTotal: "sold total",
    today: "Today {d}.{m}",
    tomorrow: "Tomorrow {d}.{m}",
    dayShort: "{weekday} {d}.{m}",
    dayFull: "{weekday} {d} {month}",
    footerSold: "End time + sold from eBillett",
    moviesTitle: "Movies",
    moviesSubtitle: "All showtimes grouped by film",
    noMovies: "No movies in the program.",
    showtimes: "Showtimes",
    statsTitle: "Statistics",
    statsSubtitle: "Program overview",
    statShows: "Showtimes",
    statMovies: "Movies",
    statDays: "Days",
    statScreens: "Screens",
    statSold: "Tickets sold",
    statLive: "Playing now",
    statSoon: "Starting soon",
    byDay: "By day",
    byScreen: "By screen",
    topSold: "Top sold",
    noSoldData: "No sales data yet — refresh for live numbers.",
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

  Object.entries(els.views).forEach(([key, el]) => {
    el.hidden = key !== tab;
  });

  document.querySelectorAll(".pill-tab").forEach((btn) => {
    const selected = btn.dataset.tab === tab;
    btn.setAttribute("aria-selected", String(selected));
  });

  els.dayControls.hidden = tab !== "day";
  els.refreshBtn.hidden = tab === "settings";

  if (skipRender || !state?.shows) return;

  if (tab === "day") {
    renderDay();
  } else if (tab === "movies") {
    await ensureAllEnriched();
    renderMovies();
  } else if (tab === "stats") {
    await ensureAllEnriched();
    renderStats();
  } else if (tab === "settings") {
    renderSettings();
  }
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

    state = {
      updatedAt: data.updatedAt,
      shows: (data.shows || []).map(normalizeCachedShow),
    };

    populateFilters();
    els.statusText.textContent = state.updatedAt
      ? t("snapshot", { time: formatClock(new Date(state.updatedAt)) })
      : lang === "en"
        ? "Program loaded"
        : "Program lastet";

    if (forceLive && activeTab === "day") {
      await enrichVisibleDay();
    } else if (forceLive && (activeTab === "movies" || activeTab === "stats")) {
      await enrichAllShows();
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
    start: parseLocalDateTime(show.start),
    end: show.end ? parseLocalDateTime(show.end) : null,
  };
}

function populateFilters() {
  const days = [...new Set(state.shows.map((s) => s.dayKey))].sort();
  const screens = [...new Set(state.shows.map((s) => s.screen))].sort((a, b) =>
    a.localeCompare(b, lang === "en" ? "en" : "nb")
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

  const active = els.dayTabs.querySelector('.day-tab[aria-selected="true"]');
  active?.scrollIntoView({ inline: "center", block: "nearest" });
}

function shortDayLabel(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = capitalize(weekdays()[date.getDay()]).slice(0, 3);
  if (dayKey === toDayKey(new Date())) return t("today", { d, m });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey === toDayKey(tomorrow)) return t("tomorrow", { d, m });
  return t("dayShort", { weekday, d, m });
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
  return state.shows.filter(
    (s) => s.dayKey === selectedDay && (screen === "all" || s.screen === screen)
  );
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

  const live = shows.filter((s) => statusOf(s, now) === "live").length;
  const withSold = shows.filter((s) => s.eventStatus === "ok" && s.sold != null);
  const soldSum = withSold.reduce((n, s) => n + (s.sold || 0), 0);

  els.summary.hidden = false;
  els.summary.innerHTML = `
    <span class="chip"><strong>${shows.length}</strong> ${escapeHtml(t("shows"))}</span>
    ${
      live
        ? `<span class="chip live"><strong>${live}</strong> ${escapeHtml(t("ongoing"))}</span>`
        : ""
    }
    ${
      withSold.length
        ? `<span class="chip"><strong>${soldSum}</strong> ${escapeHtml(t("soldTotal"))}</span>`
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

  const poster = renderPoster(show, 56, 80);

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
      m.soldSum = m.shows.reduce(
        (n, s) => n + (s.sold != null ? s.sold : 0),
        0
      );
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

  const meta = [
    movie.age,
    duration,
    movie.tags?.[0],
    `${movie.shows.length}×`,
  ]
    .filter(Boolean)
    .map((x) => escapeHtml(String(x)))
    .join(" · ");

  const times = movie.shows
    .map((show) => {
      const status = statusOf(show, now);
      const day = shortShowDay(show.dayKey);
      const sold =
        show.sold != null
          ? `<span class="tile-sold">${show.sold}</span>`
          : "";
      return `
        <div class="tile-show ${status}">
          <span class="tile-day">${escapeHtml(day)}</span>
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
  if (dayKey === toDayKey(new Date())) {
    return lang === "en" ? "Today" : "I dag";
  }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey === toDayKey(tomorrow)) {
    return lang === "en" ? "Tmrw" : "Imorg.";
  }
  const date = new Date(y, m - 1, d);
  const wd = capitalize(weekdays()[date.getDay()]).slice(0, 3);
  return `${wd} ${d}.${m}`;
}

function renderStats() {
  if (!state?.shows) return;
  const now = new Date();
  const shows = state.shows;
  const movies = groupMovies();
  const days = [...new Set(shows.map((s) => s.dayKey))].sort();
  const screens = [...new Set(shows.map((s) => s.screen))];
  const live = shows.filter((s) => statusOf(s, now) === "live").length;
  const soon = shows.filter((s) => statusOf(s, now) === "soon").length;
  const withSold = shows.filter((s) => s.eventStatus === "ok" && s.sold != null);
  const soldSum = withSold.reduce((n, s) => n + (s.sold || 0), 0);

  const byDay = days
    .map((day) => {
      const count = shows.filter((s) => s.dayKey === day).length;
      return { day, count };
    })
    .filter((x) => x.count > 0);

  const maxDay = Math.max(...byDay.map((x) => x.count), 1);

  const byScreen = screens
    .map((screen) => ({
      screen,
      count: shows.filter((s) => s.screen === screen).length,
    }))
    .sort((a, b) => b.count - a.count);

  const maxScreen = Math.max(...byScreen.map((x) => x.count), 1);

  const topSold = movies
    .filter((m) => m.soldSum > 0)
    .sort((a, b) => b.soldSum - a.soldSum)
    .slice(0, 8);

  els.statsContent.innerHTML = `
    <div class="view-intro">
      <h2>${escapeHtml(t("statsTitle"))}</h2>
      <p>${escapeHtml(t("statsSubtitle"))}</p>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${shows.length}</div><div class="stat-label">${escapeHtml(t("statShows"))}</div></div>
      <div class="stat-card"><div class="stat-value">${movies.length}</div><div class="stat-label">${escapeHtml(t("statMovies"))}</div></div>
      <div class="stat-card"><div class="stat-value">${days.length}</div><div class="stat-label">${escapeHtml(t("statDays"))}</div></div>
      <div class="stat-card"><div class="stat-value">${screens.length}</div><div class="stat-label">${escapeHtml(t("statScreens"))}</div></div>
      <div class="stat-card accent"><div class="stat-value">${withSold.length ? soldSum : "—"}</div><div class="stat-label">${escapeHtml(t("statSold"))}</div></div>
      <div class="stat-card live"><div class="stat-value">${live}</div><div class="stat-label">${escapeHtml(t("statLive"))}</div></div>
      <div class="stat-card warn"><div class="stat-value">${soon}</div><div class="stat-label">${escapeHtml(t("statSoon"))}</div></div>
    </div>

    <section class="stats-section">
      <h3>${escapeHtml(t("byDay"))}</h3>
      <div class="bar-list">
        ${byDay
          .map(
            (row) => `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(shortShowDay(row.day))}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${(row.count / maxDay) * 100}%"></div></div>
            <span class="bar-count">${row.count}</span>
          </div>`
          )
          .join("")}
      </div>
    </section>

    <section class="stats-section">
      <h3>${escapeHtml(t("byScreen"))}</h3>
      <div class="bar-list">
        ${byScreen
          .map(
            (row) => `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(row.screen)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${(row.count / maxScreen) * 100}%"></div></div>
            <span class="bar-count">${row.count}</span>
          </div>`
          )
          .join("")}
      </div>
    </section>

    <section class="stats-section">
      <h3>${escapeHtml(t("topSold"))}</h3>
      ${
        topSold.length
          ? `<div class="top-list">
              ${topSold
                .map(
                  (m, i) => `
                <div class="top-row">
                  <span class="top-rank">${i + 1}</span>
                  <span class="top-title">${escapeHtml(m.title)}</span>
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
      if (state?.shows) {
        if (activeTab === "day") renderDay();
        else if (activeTab === "movies") renderMovies();
        else if (activeTab === "stats") renderStats();
      }
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

/** Live-refresh sold + end times from DX (CORS-friendly). */
async function enrichVisibleDay() {
  if (!state?.shows || !selectedDay) return;

  const dayShows = state.shows.filter((s) => s.dayKey === selectedDay && s.eventId);
  if (!dayShows.length) return;

  const token = ++enrichToken;
  els.refreshBtn.classList.add("spinning");

  await Promise.all(dayShows.map((show) => enrichOne(show)));

  if (token !== enrichToken) return;
  if (activeTab === "day") renderDay();
  els.statusText.textContent = t("liveAt", { time: formatClock(new Date()) });
  els.refreshBtn.classList.remove("spinning");
}

async function ensureAllEnriched() {
  if (enrichedAll || !state?.shows) return;
  await enrichAllShows();
}

async function enrichAllShows() {
  if (!state?.shows) return;
  const pending = state.shows.filter(
    (s) => s.eventId && (s.sold == null || s.eventStatus === "pending")
  );
  if (!pending.length) {
    enrichedAll = true;
    return;
  }

  const token = ++enrichToken;
  els.refreshBtn.classList.add("spinning");

  const batchSize = 8;
  for (let i = 0; i < pending.length; i += batchSize) {
    if (token !== enrichToken) return;
    await Promise.all(pending.slice(i, i + batchSize).map((s) => enrichOne(s)));
  }

  if (token !== enrichToken) return;
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
