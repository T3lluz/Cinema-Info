/**
 * The film sheet — what opens when anything in the app names a film.
 *
 * It draws straight away from what the programme already knows (poster,
 * age, runtime, ratings, every showing at Buen with its sold count), then
 * fills in plot, cast and facts from IMDb when the film has an id.
 *
 * On a phone it is a bottom sheet you can drag shut; on a wide screen a
 * dialog. The browser's back gesture closes it, so the Android back
 * button never throws you out of the installed app.
 */
import {
  S,
  els,
  hooks,
  WIDE_MQ,
  t,
  icon,
  escapeHtml,
  formatClock,
  formatCount,
  formatRunning,
  shortDayLabel,
  reducedMotion,
} from "./core.js?v=dev";
import {
  movieByTitle,
  movieByImdb,
  fetchTitle,
  isDone,
  statusOf,
  formatAge,
  mergeRatingSources,
  admissionOf,
} from "./data.js?v=dev";
import {
  paint,
  forgetPaint,
  posterHtml,
  ratingBadges,
  specialBadges,
  genreLine,
  statusChip,
  admissionIcon,
  hscroll,
  syncHScroll,
} from "./ui.js?v=dev";

/** Headshots shown before "Full cast". */
const CAST_PREVIEW = 6;
const SHEET_FLICK = 0.5;
const SHEET_COMMIT_FRAC = 0.22;

let current = null;
let opener = null;
let closeTimer = 0;

export function isSheetOpen() {
  return Boolean(current) && !els.sheet?.hidden;
}

/**
 * Open the sheet for a film: `{ title }` for one in the programme,
 * `{ imdbID, row }` for one that is not (row = a search or IMDb list
 * entry, shown while the details load). `showId` marks the showing the
 * visitor came from.
 */
export function openMovie({ title = "", imdbID = "", showId = "", row = null } = {}) {
  const local = title ? movieByTitle(title) : imdbID ? movieByImdb(imdbID) : null;
  const id = String(imdbID || local?.imdbID || row?.imdbID || "").trim();
  const wasOpen = isSheetOpen();
  current = {
    title: local?.title || title || row?.title || "",
    imdbID: id,
    showId,
    row,
    omdb: null,
    omdbStatus: id ? "loading" : "",
    castOpen: false,
    doneOpen: false,
  };
  if (!wasOpen) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      history.pushState({ sheet: true }, "");
    } catch {
      /* some embedded browsers refuse; Esc and the X still close */
    }
  }
  reveal();
  // A different film starts from a clean page rather than morphing the
  // last one into it.
  els.sheetBody.replaceChildren();
  forgetPaint(els.sheetBody);
  render();
  els.sheetBody.scrollTop = 0;

  if (id) {
    const token = current;
    fetchTitle(id)
      .then((movie) => {
        if (current !== token) return;
        token.omdb = movie;
        token.omdbStatus = movie ? "ok" : "error";
        render();
      })
      .catch(() => {
        if (current !== token) return;
        token.omdbStatus = "error";
        render();
      });
  }
}

/** Close from the UI: go back in history if the sheet pushed an entry. */
export function requestCloseSheet() {
  if (!isSheetOpen()) return;
  if (history.state?.sheet) history.back();
  else closeSheet();
}

export function closeSheet({ fromY = 0, velocity = 0 } = {}) {
  const sheet = els.sheet;
  if (!sheet || sheet.hidden || sheet.classList.contains("is-leaving")) return;
  els.app?.removeAttribute("inert");
  document.documentElement.classList.remove("sheet-open");
  const finish = () => {
    sheet.hidden = true;
    sheet.classList.remove("is-open", "is-leaving", "is-dragging");
    sheet.style.removeProperty("--sheet-drag");
    sheet.style.removeProperty("--sheet-leave-ms");
    els.sheetBody.innerHTML = "";
    forgetPaint(els.sheetBody);
    current = null;
    opener?.focus?.({ preventScroll: true });
    opener = null;
  };
  if (reducedMotion() || !sheet.classList.contains("is-open")) {
    finish();
    return;
  }
  const height = els.sheetPanel?.offsetHeight || 600;
  const remain = Math.max(80, height - Math.max(0, fromY));
  const ms = Math.round(Math.min(320, Math.max(160, remain / Math.max(1.4, velocity * 2.2))));
  sheet.style.setProperty("--sheet-leave-ms", `${ms}ms`);
  sheet.classList.remove("is-dragging");
  void sheet.offsetWidth;
  sheet.classList.remove("is-open");
  sheet.classList.add("is-leaving");
  clearTimeout(closeTimer);
  closeTimer = setTimeout(finish, ms + 40);
}

function reveal() {
  const sheet = els.sheet;
  clearTimeout(closeTimer);
  sheet.classList.remove("is-leaving");
  sheet.style.removeProperty("--sheet-drag");
  document.documentElement.classList.add("sheet-open");
  els.app?.setAttribute("inert", "");
  if (!sheet.hidden && sheet.classList.contains("is-open")) return;
  sheet.hidden = false;
  if (reducedMotion()) {
    sheet.classList.add("is-open");
  } else {
    void sheet.offsetWidth;
    requestAnimationFrame(() => sheet.classList.add("is-open"));
  }
  requestAnimationFrame(() => els.sheet.querySelector(".sheet-close")?.focus({ preventScroll: true }));
}

/** Re-draw an open sheet (language change, a beat that moved a number). */
export function refreshSheet() {
  if (isSheetOpen() && !els.sheet.classList.contains("is-dragging")) render();
}

/* —— Content ——————————————————————————————————————————————————————— */

function render() {
  if (!current || !els.sheetBody) return;
  const local = current.title ? movieByTitle(current.title) : null;
  const omdb = current.omdb;
  const row = current.row;
  const now = new Date();

  const title = local?.title || omdb?.title || row?.title || current.title;
  const poster =
    local?.posterUrl || (omdb?.poster && omdb.poster !== "N/A" ? omdb.poster : "") || row?.poster || "";
  const year = omdb?.year || row?.year || "";
  const runtime = local
    ? formatRunning(local.runningLabel, local.runningMinutes)
    : omdb?.runtime || row?.runtime || "";
  const age = local?.age ? formatAge(local.age) : omdb?.rated || row?.rated || "";
  const genres = local?.genres?.length ? genreLine(local.genres) : genreLine(omdb?.genre || row?.genre || "");
  const sub = [year, age, runtime, genres].filter(Boolean).join(" · ");
  const ratings = mergeRatingSources(ratingsFromOmdb(omdb || row), local?.ratings);
  const tags = local
    ? specialBadges({ showType: local.showType, kinoklubb: local.kinoklubb })
    : `<span class="tag tag-special">${escapeHtml(t("upcomingComingSoon"))}</span>`;
  const kicker = omdb?.type === "series" ? t("sheetTypeSeries") : t("sheetTypeMovie");

  // Morphed, not rewritten: the beat redraws an open sheet every few
  // seconds, and the cast list must keep where it was scrolled to.
  paint(
    els.sheetBody,
    `<div class="sh-hero" data-key="hero">
      ${poster ? `<div class="sh-backdrop" style="background-image:url('${escapeHtml(poster)}')"></div>` : ""}
      <div class="sh-hero-inner">
        ${posterHtml({ title, posterUrl: poster }, { w: 112, h: 168, cls: "sh-poster", eager: true })}
        <div class="sh-head">
          <p class="eyebrow">${escapeHtml(kicker)}</p>
          <h2 class="sh-title" id="sheetTitle">${escapeHtml(title)}</h2>
          ${sub ? `<p class="sh-sub">${escapeHtml(sub)}</p>` : ""}
          ${ratingBadges(ratings)}
          ${tags ? `<div class="tags">${tags}</div>` : ""}
        </div>
      </div>
    </div>
    ${local ? showingsHtml(local, now) : `<section class="sh-section" data-key="none"><p class="sh-muted">${escapeHtml(t("sheetNoShowings"))}</p></section>`}
    ${detailsHtml(local, omdb)}`
  );
  syncHScroll(els.sheetBody);
}

function showingsHtml(movie, now) {
  const upcoming = movie.shows.filter((s) => !isDone(s, now));
  const done = movie.shows.filter((s) => isDone(s, now)).reverse();
  const sold = movie.shows.reduce((n, s) => n + (Number(s.sold) || 0), 0);
  const doneOpen = current.doneOpen || !upcoming.length;
  return `<section class="sh-section" data-key="shows">
    <div class="sh-sec-head">
      <h3>${escapeHtml(t("sheetShowings"))}</h3>
      <span class="sh-sec-meta">${escapeHtml(t("sheetTotals", { sold: formatCount(sold) }))}</span>
    </div>
    ${
      upcoming.length
        ? `<div class="sh-shows">${upcoming.map((s) => showRow(s, now)).join("")}</div>`
        : ""
    }
    ${
      done.length && upcoming.length
        ? `<button type="button" class="sh-more" data-sheet-done aria-expanded="${doneOpen}">
            <span>${escapeHtml(t("sheetDoneShows"))} (${done.length})</span>${icon("chevronDown", "icon icon-sm")}
          </button>`
        : ""
    }
    ${
      done.length && doneOpen
        ? `<div class="sh-shows is-done">${done.map((s) => showRow(s, now)).join("")}</div>`
        : ""
    }
  </section>`;
}

function showRow(show, now) {
  const status = statusOf(show, now);
  const a = admissionOf(show, now);
  const admit =
    a && a.state !== "unknown"
      ? `<span class="sh-admit admit-${a.state}" title="${escapeHtml(t("admitInside", { n: a.scanned }))}">${admissionIcon(
          a.state
        )}${a.scanned}</span>`
      : "";
  const when = `${shortDayLabel(show.dayKey)} ${formatClock(show.start)}`;
  return `<button type="button" class="sh-show is-${status}${
    show.id === current.showId ? " is-current" : ""
  }" data-goto-show="${escapeHtml(show.id)}" aria-label="${escapeHtml(t("sheetGoTo", { when }))}">
      <span class="sh-show-when">
        <span class="sh-show-day">${escapeHtml(shortDayLabel(show.dayKey))}</span>
        <strong class="sh-show-time">${formatClock(show.start)}</strong>
      </span>
      <span class="sh-show-hall">${escapeHtml(show.screen)}${status === "live" || status === "soon" ? ` ${statusChip(show, now)}` : ""}</span>
      <span class="sh-show-nums">
        ${
          show.sold != null
            ? `<span class="sh-show-sold"><strong>${formatCount(show.sold)}</strong><small> ${escapeHtml(t("sold"))}</small></span>`
            : ""
        }
      </span>
      ${admit}
      ${icon("chevronRight", "icon icon-sm sh-show-go")}
    </button>`;
}

function ratingsFromOmdb(movie) {
  if (!movie) return null;
  const out = {};
  const imdb = Number.parseFloat(movie.imdbRating);
  if (Number.isFinite(imdb)) out.imdb = { value: imdb, url: movie.imdbUrl || "" };
  const meta = Number.parseInt(movie.metascore, 10);
  if (Number.isFinite(meta)) out.metacritic = { value: meta };
  for (const r of movie.ratings || []) {
    const source = String(r.source || "");
    const raw = String(r.value || "");
    if (/rotten/i.test(source)) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) out.tomatoes = { value: n };
    } else if (/metacritic/i.test(source)) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) out.metacritic = { value: n };
    }
  }
  return Object.keys(out).length ? out : null;
}

function people(list, fallback) {
  if (Array.isArray(list) && list.length) {
    return list
      .map((p) => ({
        name: String(p?.name || "").trim(),
        photo: String(p?.photo || "").trim(),
        character: String(p?.character || "").trim(),
      }))
      .filter((p) => p.name);
  }
  return String(fallback || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, photo: "", character: "" }));
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function detailsHtml(local, omdb) {
  if (current.omdbStatus === "loading") {
    return `<section class="sh-section" data-key="loading"><div class="sh-loading">
      <span class="spinner spinner-sm" aria-hidden="true"></span>${escapeHtml(t("sheetLoadingMore"))}
    </div><div class="skeleton-lines" aria-hidden="true"><i></i><i></i><i></i></div></section>`;
  }

  const facts = [];
  const directors = people(omdb?.directors, omdb?.director);
  const directorNames = directors.map((p) => p.name).join(", ") || local?.director || "";
  if (directorNames) facts.push([t("sheetDirector"), directorNames]);
  if (omdb?.writer) facts.push([t("sheetWriter"), omdb.writer]);
  if (omdb?.released) facts.push([t("sheetReleased"), omdb.released]);
  if (omdb?.language) facts.push([t("sheetLanguage"), omdb.language]);
  if (omdb?.country) facts.push([t("sheetCountry"), omdb.country]);
  if (omdb?.awards && omdb.awards !== "N/A") facts.push([t("sheetAwards"), omdb.awards]);
  if (omdb?.boxOffice && omdb.boxOffice !== "N/A") facts.push([t("sheetBoxOffice"), omdb.boxOffice]);

  const cast = people(omdb?.cast, omdb?.actors);
  const plot = omdb?.plot && omdb.plot !== "N/A" ? omdb.plot : "";
  const votes = omdb?.imdbVotes ? t("sheetVotes", { n: omdb.imdbVotes }) : "";
  const imdbUrl = omdb?.imdbUrl || (current.imdbID ? `https://www.imdb.com/title/${current.imdbID}/` : "");

  const castHtml = cast.length
    ? `<section class="sh-section" data-key="cast">
        <div class="sh-sec-head"><h3>${escapeHtml(t("sheetCast"))}</h3>${
          cast.length > CAST_PREVIEW
            ? `<button type="button" class="link-btn" data-sheet-cast aria-expanded="${current.castOpen}">${escapeHtml(
                current.castOpen ? t("sheetCastLess") : t("sheetFullCast", { n: cast.length - CAST_PREVIEW })
              )}</button>`
            : ""
        }</div>
        ${hscroll(
          `<ul class="cast${current.castOpen ? " is-open" : ""}" data-hs-track>
          ${cast
            .map(
              (p, i) => `<li class="person${i >= CAST_PREVIEW ? " is-more" : ""}">
                ${
                  p.photo
                    ? `<img src="${escapeHtml(p.photo)}" alt="" width="72" height="72" loading="lazy" decoding="async">`
                    : `<span class="person-fallback">${escapeHtml(initials(p.name))}</span>`
                }
                <span class="person-name">${escapeHtml(p.name)}</span>
                ${p.character ? `<span class="person-role">${escapeHtml(p.character)}</span>` : ""}
              </li>`
            )
            .join("")}
        </ul>`,
          "hs-cast"
        )}
      </section>`
    : "";

  return `
    ${
      plot
        ? `<section class="sh-section" data-key="plot"><h3>${escapeHtml(t("sheetPlot"))}</h3><p class="sh-plot">${escapeHtml(plot)}</p></section>`
        : ""
    }
    ${castHtml}
    ${
      facts.length
        ? `<section class="sh-section" data-key="facts"><h3>${escapeHtml(t("sheetFacts"))}</h3><dl class="facts">${facts
            .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
            .join("")}</dl></section>`
        : ""
    }
    ${
      current.omdbStatus === "error" && !local
        ? `<section class="sh-section" data-key="error"><p class="sh-muted">${escapeHtml(t("sheetError"))}</p></section>`
        : ""
    }
    ${
      imdbUrl
        ? `<div class="sh-actions" data-key="actions">
            <a class="btn btn-block" href="${escapeHtml(imdbUrl)}" target="_blank" rel="noopener">${icon(
              "external",
              "icon icon-sm"
            )}${escapeHtml(t("sheetOpenImdb"))}</a>
            ${votes ? `<span class="sh-muted">${escapeHtml(votes)}</span>` : ""}
          </div>`
        : ""
    }`;
}

/* —— Wiring ———————————————————————————————————————————————————————— */

export function setupSheet() {
  const sheet = els.sheet;
  if (!sheet) return;

  window.addEventListener("popstate", () => {
    if (isSheetOpen()) closeSheet();
  });

  sheet.addEventListener("click", (e) => {
    if (e.target.closest("[data-sheet-close]")) {
      requestCloseSheet();
      return;
    }
    const goto = e.target.closest("[data-goto-show]");
    if (goto) {
      const id = goto.dataset.gotoShow;
      requestCloseSheet();
      // Let the sheet start leaving before the page scrolls under it.
      setTimeout(() => hooks.goToShow(id), reducedMotion() ? 0 : 140);
      return;
    }
    if (e.target.closest("[data-sheet-done]")) {
      current.doneOpen = !current.doneOpen;
      render();
      return;
    }
    if (e.target.closest("[data-sheet-cast]")) {
      current.castOpen = !current.castOpen;
      render();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isSheetOpen()) {
      e.preventDefault();
      requestCloseSheet();
    }
  });

  setupDrag();
}

/**
 * The sheet follows a downward finger and either settles back or slides
 * out. The handle always starts a drag; the body only when it is already
 * scrolled to the top, so a long cast list can still be read.
 */
function setupDrag() {
  const sheet = els.sheet;
  const panel = els.sheetPanel;
  let mode = "idle";
  let pointerId = null;
  let fromHandle = false;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let vy = 0;
  let curY = 0;

  const setDrag = (y) => sheet.style.setProperty("--sheet-drag", `${y}px`);

  const release = (e, cancelled) => {
    if (e.pointerId !== pointerId) return;
    const wasDrag = mode === "drag";
    const handle = fromHandle;
    pointerId = null;
    mode = "idle";
    fromHandle = false;
    if (!wasDrag || !isSheetOpen()) return;
    const height = panel.offsetHeight || 1;
    const need = height * (handle ? SHEET_COMMIT_FRAC * 0.6 : SHEET_COMMIT_FRAC);
    if (!cancelled && vy > -SHEET_FLICK && (vy > SHEET_FLICK || curY > need)) {
      // Close without waiting for history so the slide starts from here.
      if (history.state?.sheet) {
        closeSheet({ fromY: curY, velocity: vy });
        history.back();
      } else {
        closeSheet({ fromY: curY, velocity: vy });
      }
      return;
    }
    sheet.classList.remove("is-dragging");
    void panel.offsetWidth;
    setDrag(0);
  };

  panel.addEventListener("pointerdown", (e) => {
    if (!isSheetOpen() || WIDE_MQ.matches) return;
    if (!e.isPrimary || pointerId !== null || e.pointerType === "mouse") return;
    if (e.target.closest("a, input, textarea, select, .cast")) return;
    pointerId = e.pointerId;
    fromHandle = Boolean(e.target.closest(".sheet-grab"));
    startX = e.clientX;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    vy = 0;
    curY = 0;
    mode = "pending";
  });

  panel.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId || (mode !== "pending" && mode !== "drag")) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (mode === "pending") {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        mode = "ignore";
        return;
      }
      if (dy < 8) {
        if (dy < -8) mode = "ignore";
        return;
      }
      if (!fromHandle && els.sheetBody.scrollTop > 1) {
        mode = "ignore";
        return;
      }
      mode = "drag";
      startY = lastY = e.clientY;
      lastT = e.timeStamp;
      sheet.classList.add("is-dragging");
      try {
        panel.setPointerCapture(pointerId);
      } catch {
        /* best effort */
      }
    }
    const raw = e.clientY - startY;
    curY = raw > 0 ? raw : raw * 0.15;
    const dt = e.timeStamp - lastT;
    if (dt > 0) vy = dt < 64 ? ((e.clientY - lastY) / dt) * 0.6 + vy * 0.4 : (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
    setDrag(curY);
  });

  // Keep the body from scrolling while the sheet itself is being dragged.
  panel.addEventListener(
    "touchmove",
    (e) => {
      if (mode === "drag") {
        e.preventDefault();
        return;
      }
      if (mode !== "pending") return;
      // A downward pull at the top would otherwise become the browser's
      // overscroll and cancel the pointer before the drag can start.
      const touch = e.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      if (dy > 0 && (fromHandle || els.sheetBody.scrollTop <= 1)) e.preventDefault();
    },
    { passive: false }
  );

  panel.addEventListener("pointerup", (e) => release(e, false));
  panel.addEventListener("pointercancel", (e) => release(e, true));
}
