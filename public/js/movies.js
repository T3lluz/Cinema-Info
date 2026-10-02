/**
 * The Movies tab: what is coming (Buen premieres, then the best-known
 * titles from IMDb), every film in the programme as a poster grid, the
 * finished runs underneath — and a search that understands titles, days
 * and clock times. Every film opens the film sheet.
 */
import {
  S,
  els,
  hooks,
  t,
  escapeHtml,
  formatClock,
  formatCount,
  shortDayLabel,
  todayKey,
  toDayKey,
  weekdays,
  showsLabel,
} from "./core.js?v=dev";
import {
  groupMovies,
  isDone,
  statusOf,
  formatAge,
  callOmdbProxy,
  ensureAllEnriched,
} from "./data.js?v=dev";
import {
  paint,
  posterHtml,
  emptyState,
  viewHead,
  hscroll,
  imdbBadge,
} from "./ui.js?v=dev";

/** Finished films shown before "Show all". */
const DONE_PREVIEW = 6;
let doneExpanded = false;

/* —— Upcoming feed ———————————————————————————————————————————————— */

let upcomingRemote = [];
let upcomingRemoteStatus = "";

function releaseDayKey(value) {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? toDayKey(new Date(ms)) : "";
}

function parseCount(value) {
  const n = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Keep the IMDb filler to titles people actually know. */
function curateRemoteUpcoming(rows, today) {
  const scored = [];
  for (const row of rows || []) {
    if (!row?.title || !row.poster) continue;
    const day = releaseDayKey(row.released || row.year);
    if (!day || day < today) continue;
    const votes = parseCount(row.votes ?? row.imdbVotes);
    const rating = Number.parseFloat(row.imdbRating);
    scored.push({
      row,
      day,
      known: votes >= 400 || (Number.isFinite(rating) && rating >= 6.5),
      pop: votes * 10 + (Number.isFinite(rating) ? rating * 800 : 0),
    });
  }
  const known = scored.filter((x) => x.known).sort((a, b) => b.pop - a.pop);
  const rest = scored
    .filter((x) => !x.known)
    .sort((a, b) => a.day.localeCompare(b.day) || b.pop - a.pop);
  const picked = known.length >= 3 ? known : [...known, ...rest.slice(0, Math.max(0, 6 - known.length))];
  return picked.slice(0, 12).map((x) => x.row);
}

/** Buen films that have not started yet, then popular titles from IMDb. */
function buildUpcomingFeed(movies, now) {
  const today = toDayKey(now);
  const ids = new Set(movies.map((m) => m.imdbID).filter(Boolean));
  const titles = new Set(movies.map((m) => m.title.toLowerCase()));

  const local = movies
    .filter((m) => m.next && !m.started && m.next.start > now)
    .sort((a, b) => a.next.start - b.next.start)
    .map((movie) => ({ source: "buen", movie, day: movie.next.dayKey }));

  const remote = curateRemoteUpcoming(upcomingRemote, today)
    .filter((row) => !ids.has(String(row.imdbID || "")) && !titles.has(String(row.title || "").toLowerCase()))
    .map((row) => ({ source: "imdb", row, day: releaseDayKey(row.released || row.year) }));

  return [...local, ...remote];
}

function ensureUpcomingRemote() {
  if (upcomingRemoteStatus === "ok" || upcomingRemoteStatus === "loading") return;
  upcomingRemoteStatus = "loading";
  callOmdbProxy({ action: "upcoming" })
    .catch(() => callOmdbProxy({ action: "popular" }))
    .then((data) => {
      upcomingRemote = Array.isArray(data?.movies) ? data.movies : [];
      upcomingRemoteStatus = "ok";
      if (S.activeTab === "movies") renderMovies();
    })
    .catch(() => {
      upcomingRemoteStatus = "error";
      if (S.activeTab === "movies") renderMovies();
    });
}

/** "I dag 20:00", "Fre 2.10 16:50". */
function whenLabel(show) {
  return `${shortDayLabel(show.dayKey)} ${formatClock(show.start)}`;
}

function shortReleaseLabel(dayKey) {
  if (!dayKey) return "";
  const [, m, d] = dayKey.split("-").map(Number);
  return dayKey === todayKey() ? t("today") : `${d}.${m}`;
}

function upcomingCard(item) {
  if (item.source === "buen") {
    const movie = item.movie;
    return `<button type="button" class="up-card" data-key="b:${escapeHtml(movie.title)}" data-open-movie="${escapeHtml(movie.title)}">
      <span class="up-poster">${posterHtml(movie, { w: 120, h: 180 })}
        <span class="up-chip is-buen">${escapeHtml(t("upcomingOnBuen"))}</span>
        ${imdbBadge(movie.ratings?.imdb?.value)}
      </span>
      <span class="up-title">${escapeHtml(movie.title)}</span>
      <span class="up-when">${escapeHtml(whenLabel(movie.next))}</span>
    </button>`;
  }
  const row = item.row;
  return `<button type="button" class="up-card" data-key="i:${escapeHtml(row.imdbID || row.title)}" data-omdb-id="${escapeHtml(row.imdbID || "")}">
    <span class="up-poster">${posterHtml({ title: row.title, posterUrl: row.poster }, { w: 120, h: 180 })}
      <span class="up-chip">${escapeHtml(t("upcomingComingSoon"))}</span>
      ${imdbBadge(row.imdbRating)}
    </span>
    <span class="up-title">${escapeHtml(row.title)}</span>
    <span class="up-when">${escapeHtml(shortReleaseLabel(item.day) || row.year || "")}</span>
  </button>`;
}

/* —— Movie grid —————————————————————————————————————————————————— */

function movieCard(movie, now) {
  const live = movie.shows.find((s) => statusOf(s, now) === "live");
  // Flag a premiere only while the next showing is that premiere night.
  const premiere = movie.next?.showType && /premiere/i.test(movie.next.showType) ? movie.next.showType : "";
  let next;
  if (live) {
    next = `<span class="mc-next is-live"><span class="pulse" aria-hidden="true"></span>${escapeHtml(
      t("now")
    )} · ${escapeHtml(live.screen)}</span>`;
  } else if (movie.next) {
    next = `<span class="mc-next">${escapeHtml(whenLabel(movie.next))}</span>`;
  } else {
    next = `<span class="mc-next is-done">${escapeHtml(
      t("lastShown", { when: shortDayLabel(movie.last.dayKey) })
    )}</span>`;
  }
  const meta = [
    movie.upcomingCount
      ? movie.upcomingCount === 1
        ? t("showsLeftOne")
        : t("showsLeftMany", { n: movie.upcomingCount })
      : showsLabel(movie.shows.length),
    movie.soldSum ? t("soldTotal", { n: formatCount(movie.soldSum) }) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<button type="button" class="movie-card${movie.allDone ? " is-done" : ""}" data-key="${escapeHtml(movie.title)}" data-open-movie="${escapeHtml(
    movie.title
  )}" aria-label="${escapeHtml(t("openMovie", { title: movie.title }))}">
    <span class="mc-poster">
      ${posterHtml(movie, { w: 160, h: 240 })}
      ${imdbBadge(movie.ratings?.imdb?.value)}
      ${premiere ? `<span class="mc-flag">${escapeHtml(t(`showType.${premiere}`))}</span>` : ""}
    </span>
    <span class="mc-title">${escapeHtml(movie.title)}</span>
    ${next}
    <span class="mc-meta">${escapeHtml(meta)}</span>
  </button>`;
}

export function renderMovies() {
  if (!S.state?.shows || !els.moviesBody) return;
  ensureUpcomingRemote();
  ensureAllEnriched();
  const now = new Date();
  const movies = groupMovies();
  const playing = movies.filter((m) => !m.allDone);
  const finished = movies.filter((m) => m.allDone);
  const feed = buildUpcomingFeed(movies, now);

  paint(els.moviesHead, viewHead(t("moviesTitle"), t("moviesSub", { n: playing.length })));

  const upcoming =
    feed.length || upcomingRemoteStatus === "loading"
      ? `<section class="section" data-key="upcoming">
          <div class="section-head">
            <div><h2>${escapeHtml(t("upcomingTitle"))}</h2><p>${escapeHtml(t("upcomingSub"))}</p></div>
          </div>
          ${hscroll(
            feed.length
              ? `<div class="carousel" data-hs-track data-keep-scroll="up">${feed.map(upcomingCard).join("")}</div>`
              : `<div class="carousel is-loading" data-hs-track aria-hidden="true">${[1, 2, 3, 4, 5, 6]
                  .map((i) => `<span class="up-card skeleton" data-key="sk${i}"></span>`)
                  .join("")}</div>`,
            "hs-posters"
          )}
        </section>`
      : "";

  const playingHtml = playing.length
    ? `<section class="section" data-key="playing">
        <div class="section-head">
          <div><h2>${escapeHtml(t("onProgram"))}</h2><p>${escapeHtml(t("onProgramSub"))}</p></div>
          <span class="count">${playing.length}</span>
        </div>
        <div class="movie-grid">${playing.map((m) => movieCard(m, now)).join("")}</div>
      </section>`
    : "";

  const shownDone = doneExpanded ? finished : finished.slice(0, DONE_PREVIEW);
  const finishedHtml = finished.length
    ? `<section class="section" data-key="finished">
        <div class="section-head">
          <div><h2>${escapeHtml(t("doneRun"))}</h2><p>${escapeHtml(t("doneRunSub"))}</p></div>
          <span class="count">${finished.length}</span>
        </div>
        <div class="movie-grid is-done">${shownDone.map((m) => movieCard(m, now)).join("")}</div>
        ${
          finished.length > DONE_PREVIEW
            ? `<button type="button" class="btn btn-ghost btn-block" data-done-more>${escapeHtml(
                doneExpanded ? t("showLessDone") : t("showMoreDone", { n: finished.length })
              )}</button>`
            : ""
        }
      </section>`
    : "";

  const body =
    !playing.length && !finished.length && !upcoming
      ? `<div data-key="empty">${emptyState("movie", t("noMovies"))}</div>`
      : `${upcoming}${playingHtml}${finishedHtml}`;

  paint(els.moviesBody, body);
  if (search.query.trim().length >= 2) renderSearch();
}

/* —— Search ————————————————————————————————————————————————————————
 * Titles, directors and genres, plus "fredag", "i morgen 18", "kl 20",
 * "sal 2". Results stay on the page after the field loses focus; the
 * IMDb part comes from the omdb-lookup bridge.
 */
const search = {
  query: "",
  movies: [],
  shows: [],
  remote: [],
  status: "",
  active: -1,
  timer: 0,
  abort: null,
};

function foldText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a");
}

function searchTokens(value) {
  return foldText(value)
    .replace(/[^\p{L}\p{N}:.]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const SEARCH_STOP = new Set([
  "kl", "sal", "i", "dag", "gar", "gaar", "morgen", "today", "tomorrow", "yesterday", "at", "the", "on",
]);

function weekdayNameMap() {
  const map = new Map();
  const add = (name, dow) => {
    const folded = foldText(name);
    if (folded.length < 3) return;
    map.set(folded, dow);
    map.set(folded.slice(0, 3), dow);
  };
  weekdays().forEach((name, i) => add(name, i));
  ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].forEach(add);
  ["sondag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lordag"].forEach(add);
  return map;
}

function parseSearchIntent(q) {
  const folded = foldText(q);
  const tokens = searchTokens(q);
  const now = new Date();
  const dayKeys = new Set();
  const dows = new Set();
  const addOffset = (n) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    dayKeys.add(toDayKey(d));
  };
  if (/(^|\s)(i\s*dag|idag|today)(\s|$)/.test(folded)) addOffset(0);
  if (/(^|\s)(i\s*morgen|imorgen|tomorrow)(\s|$)/.test(folded)) addOffset(1);
  if (/(^|\s)(i\s*gar|igar|igaar|yesterday)(\s|$)/.test(folded)) addOffset(-1);

  const names = weekdayNameMap();
  for (const tok of tokens) if (names.has(tok)) dows.add(names.get(tok));

  let hour = null;
  let minute = null;
  const time = folded.match(/\b(?:kl\s*)?(\d{1,2})(?:[:.](\d{2}))?\b/);
  if (time) {
    const h = Number(time[1]);
    const m = time[2] != null ? Number(time[2]) : null;
    const explicit = /[:.]/.test(time[0]) || /\bkl\b/.test(time[0]);
    if (h <= 23 && (m == null || m <= 59) && (explicit || (h >= 10 && tokens.length <= 3))) {
      hour = h;
      minute = m;
    }
  }

  const screenMatch = folded.match(/\bsal\s*(\d+)\b/);
  const screen = screenMatch ? `sal ${screenMatch[1]}` : "";

  const leftover = tokens.filter((tok) => {
    if (SEARCH_STOP.has(tok) || names.has(tok)) return false;
    if (/^\d{1,2}([:.]\d{2})?$/.test(tok)) return false;
    return /[\p{L}]/u.test(tok);
  });
  return { leftover, dayKeys, dows, hour, minute, screen };
}

function showMatchesIntent(show, intent) {
  if (intent.dayKeys.size && !intent.dayKeys.has(show.dayKey)) return false;
  if (intent.dows.size && !intent.dows.has(show.start.getDay())) return false;
  if (intent.screen && !foldText(show.screen).includes(intent.screen)) return false;
  if (intent.hour != null) {
    if (show.start.getHours() !== intent.hour) return false;
    if (intent.minute != null && show.start.getMinutes() !== intent.minute) return false;
  }
  return true;
}

function refreshLocalSearch(q) {
  search.movies = [];
  search.shows = [];
  if (!S.state?.shows || q.trim().length < 2) return;
  const intent = parseSearchIntent(q);
  const hasWhen = Boolean(intent.dayKeys.size || intent.dows.size || intent.hour != null || intent.screen);
  const now = new Date();
  const hits = [];

  for (const movie of groupMovies()) {
    const hay = foldText(
      [movie.title, movie.director, ...(movie.genres || []), movie.age, formatAge(movie.age)].filter(Boolean).join(" ")
    );
    const titleMatch = intent.leftover.length > 0 && intent.leftover.every((tok) => hay.includes(tok));
    if (!titleMatch && intent.leftover.length) continue;
    if (!titleMatch && !hasWhen) continue;
    const shows = movie.shows.filter((s) => showMatchesIntent(s, intent));
    if (!shows.length && hasWhen) continue;
    const pool = shows.length ? shows : movie.shows;
    const upcoming = pool.filter((s) => !isDone(s, now));
    hits.push({ movie, shows: (upcoming.length ? upcoming : pool).slice(0, 3), next: upcoming[0] || null, score: titleMatch ? 2 : 1 });
  }
  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const an = a.next?.start?.getTime() ?? Infinity;
    const bn = b.next?.start?.getTime() ?? Infinity;
    return an - bn || a.movie.title.localeCompare(b.movie.title, "nb");
  });
  if (intent.leftover.length || !hasWhen) search.movies = hits.slice(0, 6);

  const pool = hasWhen ? S.state.shows.filter((s) => showMatchesIntent(s, intent)) : hits.flatMap((h) => h.shows);
  const seen = new Set();
  search.shows = pool
    .filter((s) => (seen.has(s.id) ? false : seen.add(s.id)))
    .sort((a, b) => {
      const ad = isDone(a, now);
      const bd = isDone(b, now);
      if (ad !== bd) return ad ? 1 : -1;
      return a.start - b.start;
    })
    .slice(0, 8);
}

function searchHits() {
  const hits = [];
  for (const h of search.movies) hits.push({ kind: "movie", key: `m:${h.movie.title}`, h });
  for (const s of search.shows) hits.push({ kind: "show", key: `s:${s.id}`, s });
  const local = new Set(search.movies.map((h) => h.movie.title.toLowerCase()));
  for (const r of search.remote) {
    if (!local.has(String(r.title || "").toLowerCase())) hits.push({ kind: "omdb", key: `o:${r.imdbID}`, r });
  }
  return hits;
}

function hitPoster(url, title) {
  return posterHtml({ title, posterUrl: url }, { w: 40, h: 60, cls: "hit-poster" });
}

function hitHtml(hit, active) {
  const cls = `hit${active ? " is-active" : ""}`;
  if (hit.kind === "movie") {
    const movie = hit.h.movie;
    const meta = [
      hit.h.shows.map((s) => whenLabel(s)).join(" · "),
      showsLabel(movie.shows.length),
    ]
      .filter(Boolean)
      .join(" · ");
    return `<button type="button" class="${cls}" role="option" aria-selected="${active}" data-fk="${escapeHtml(
      hit.key
    )}" data-open-movie="${escapeHtml(movie.title)}">
      ${hitPoster(movie.posterUrl, movie.title)}
      <span class="hit-text"><span class="hit-title">${escapeHtml(movie.title)}</span><span class="hit-meta">${escapeHtml(meta)}</span></span>
      <span class="chip chip-quiet">${escapeHtml(t("searchAtBuen"))}</span>
    </button>`;
  }
  if (hit.kind === "show") {
    const show = hit.s;
    const when = whenLabel(show);
    const sold = show.sold != null ? `${show.sold} ${t("sold")}` : "";
    return `<button type="button" class="${cls}" role="option" aria-selected="${active}" data-fk="${escapeHtml(
      hit.key
    )}" data-goto-show="${escapeHtml(show.id)}" aria-label="${escapeHtml(
      t("searchOpenShow", { title: show.title, time: when })
    )}">
      ${hitPoster(show.posterUrl, show.title)}
      <span class="hit-text"><span class="hit-title">${escapeHtml(when)}</span><span class="hit-meta">${escapeHtml(
        [show.title, show.screen].join(" · ")
      )}</span></span>
      ${sold ? `<span class="hit-num">${escapeHtml(sold)}</span>` : ""}
    </button>`;
  }
  const r = hit.r;
  const meta = [r.year, r.type === "series" ? t("sheetTypeSeries") : t("sheetTypeMovie")].filter(Boolean).join(" · ");
  return `<button type="button" class="${cls}" role="option" aria-selected="${active}" data-fk="${escapeHtml(
    hit.key
  )}" data-omdb-id="${escapeHtml(r.imdbID)}">
    ${hitPoster(r.poster, r.title)}
    <span class="hit-text"><span class="hit-title">${escapeHtml(r.title)}</span><span class="hit-meta">${escapeHtml(meta)}</span></span>
  </button>`;
}

function renderSearch({ pin = false } = {}) {
  const host = els.searchResults;
  if (!host) return;
  const q = search.query.trim();
  const active = q.length >= 2;
  host.hidden = !active;
  els.moviesBody.hidden = active;
  els.searchInput?.setAttribute("aria-expanded", String(active));
  if (!active) {
    paint(host, "");
    return;
  }
  const hits = searchHits();
  if (search.active >= hits.length) search.active = hits.length ? 0 : -1;
  const activeKey = hits[search.active]?.key || "";
  const group = (label, list) =>
    list.length
      ? `<p class="hits-label">${escapeHtml(label)}</p>${list.map((h) => hitHtml(h, h.key === activeKey)).join("")}`
      : "";

  let html;
  if (!hits.length) {
    html =
      search.status === "loading"
        ? `<p class="hits-status"><span class="spinner spinner-sm" aria-hidden="true"></span>${escapeHtml(t("searchLoading"))}</p>`
        : emptyState(
            "search",
            search.status === "error" ? t("searchError") : t("searchNoResults", { q }),
            t("searchTip")
          );
  } else {
    html =
      group(t("searchAtBuen"), hits.filter((h) => h.kind === "movie")) +
      group(t("searchTimes"), hits.filter((h) => h.kind === "show")) +
      group(t("searchMoreFilms"), hits.filter((h) => h.kind === "omdb")) +
      (search.status === "loading"
        ? `<p class="hits-status"><span class="spinner spinner-sm" aria-hidden="true"></span>${escapeHtml(t("searchLoading"))}</p>`
        : "");
  }
  paint(host, `<div class="hits" role="listbox" aria-label="${escapeHtml(t("searchResults"))}">${html}</div>`, { animate: false });
  if (pin) host.querySelector(".hit.is-active")?.scrollIntoView({ block: "nearest" });
}

function remoteQuery(q) {
  return parseSearchIntent(q).leftover.filter((tok) => tok.length >= 2).join(" ").trim();
}

function scheduleSearch() {
  clearTimeout(search.timer);
  const q = search.query.trim();
  if (q.length < 2) {
    clearSearch({ keepInput: true });
    return;
  }
  refreshLocalSearch(q);
  search.active = searchHits().length ? 0 : -1;
  const remote = remoteQuery(q);
  if (!remote) {
    search.abort?.abort();
    search.remote = [];
    search.status = "ok";
    renderSearch();
    return;
  }
  search.status = "loading";
  renderSearch();
  search.timer = setTimeout(() => runRemoteSearch(remote), 280);
}

async function runRemoteSearch(q) {
  search.abort?.abort();
  const ac = new AbortController();
  search.abort = ac;
  try {
    const data = await callOmdbProxy({ action: "search", q }, ac.signal);
    if (ac.signal.aborted) return;
    search.remote = Array.isArray(data?.results) ? data.results : [];
    search.status = "ok";
  } catch (err) {
    if (err?.name === "AbortError" || ac.signal.aborted) return;
    search.remote = [];
    search.status = search.movies.length || search.shows.length ? "ok" : "error";
  }
  if (search.active < 0 && searchHits().length) search.active = 0;
  renderSearch();
}

function clearSearch({ keepInput = false } = {}) {
  clearTimeout(search.timer);
  search.abort?.abort();
  search.abort = null;
  search.remote = [];
  search.movies = [];
  search.shows = [];
  search.active = -1;
  search.status = "";
  if (!keepInput) {
    search.query = "";
    if (els.searchInput) els.searchInput.value = "";
  }
  if (els.searchClear) els.searchClear.hidden = !search.query.trim();
  renderSearch();
}

function activateHit(hit) {
  if (!hit) return;
  if (hit.kind === "show") hooks.goToShow(hit.s.id);
  else if (hit.kind === "movie") hooks.openMovie({ title: hit.h.movie.title });
  else hooks.openMovie({ imdbID: hit.r.imdbID, row: hit.r });
}

export function focusSearch() {
  els.searchInput?.focus();
  els.searchInput?.select();
}

/** Re-read the result labels after a language change. */
export function refreshSearchLanguage() {
  if (search.query.trim().length >= 2) {
    refreshLocalSearch(search.query);
    renderSearch();
  }
}

export function setupMovies() {
  const input = els.searchInput;
  input?.addEventListener("input", () => {
    search.query = input.value;
    els.searchClear.hidden = !search.query.trim();
    scheduleSearch();
  });
  input?.addEventListener("keydown", (e) => {
    const hits = searchHits();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      search.active = (search.active + d + hits.length) % hits.length;
      renderSearch({ pin: true });
    } else if (e.key === "Enter") {
      const hit = hits[search.active] || hits[0];
      if (!hit) return;
      e.preventDefault();
      input.blur();
      activateHit(hit);
    } else if (e.key === "Escape" && search.query) {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    }
  });
  els.searchClear?.addEventListener("click", () => {
    clearSearch();
    input?.focus();
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".sheet")) return;
    const more = e.target.closest("[data-done-more]");
    if (more) {
      doneExpanded = !doneExpanded;
      renderMovies();
      return;
    }
    const movie = e.target.closest("[data-open-movie]");
    if (movie) {
      hooks.openMovie({ title: movie.dataset.openMovie });
      return;
    }
    const omdb = e.target.closest("[data-omdb-id]");
    if (omdb) {
      const id = omdb.dataset.omdbId;
      const row =
        search.remote.find((r) => r.imdbID === id) || upcomingRemote.find((r) => r.imdbID === id) || null;
      if (id) hooks.openMovie({ imdbID: id, row });
    }
  });
}

