/**
 * Small pieces every view is built from — posters, badges, the sold
 * and check-in strips, toasts, haptics — plus the two ways a view gets
 * onto the page without tearing down what is already there.
 */
import {
  S,
  els,
  hooks,
  savePrefs,
  t,
  icon,
  escapeHtml,
  formatClock,
  formatUntil,
  formatCount,
  locale,
  reducedMotion,
  NOTICE_ON,
  NEW_APP_URL,
  OLD_URL_ENDS,
} from "./core.js?v=dev";
import {
  statusOf,
  admissionOf,
  admissionLabel,
  formatGenre,
} from "./data.js?v=dev";

/* —— Painting ——————————————————————————————————————————————————————
 * The whole app redraws on every five-second beat, and almost every one
 * of those redraws produces exactly what is already on screen. So
 * markup is compared first, and when it does differ the new markup is
 * *morphed* into the old: elements stay where they are and only the
 * attributes and text that changed are touched. That keeps scroll,
 * focus and hover, and it is what lets a bar glide to its new height
 * or a number count up instead of the whole card blinking.
 */
const painted = new WeakMap();
const template = document.createElement("template");

/** Classes JavaScript adds (for a moment, or as live state such as a
 * scroller's arrows); a redraw must not strip them. */
const TRANSIENT = ["is-flash", "is-picked", "is-set", "is-new", "is-entering", "can-prev", "can-next", "is-docked"];

function parse(html) {
  template.innerHTML = html.trim();
  return template.content;
}

function morphAttrs(from, to) {
  for (const { name, value } of to.attributes) {
    if (name === "class") {
      const keep = TRANSIENT.filter((c) => from.classList.contains(c) && !to.classList.contains(c));
      const next = keep.length ? `${value} ${keep.join(" ")}` : value;
      if (from.getAttribute("class") !== next) from.setAttribute("class", next);
    } else if (from.getAttribute(name) !== value) {
      from.setAttribute(name, value);
    }
  }
  for (const { name } of [...from.attributes]) {
    if (to.hasAttribute(name) || name === "data-key") continue;
    // Position and size that JavaScript animates (a sliding highlight).
    if (name === "style" && from.hasAttribute("data-js-style")) continue;
    // A <details> the visitor opened stays open.
    if (name === "open" && from.tagName === "DETAILS") continue;
    if (name === "class") {
      const keep = TRANSIENT.filter((c) => from.classList.contains(c));
      if (keep.length) {
        from.setAttribute("class", keep.join(" "));
        continue;
      }
    }
    from.removeAttribute(name);
  }
}

function keyOf(node) {
  return node.nodeType === 1 ? node.getAttribute("data-key") : null;
}

function enter(node, animate) {
  if (animate && node.nodeType === 1) node.classList.add("is-new");
  return node;
}

/** Make `from`'s children match `to`'s, reusing nodes wherever possible. */
function morphChildren(from, to, animate) {
  const next = [...to.childNodes];
  const keyed = next.length > 0 && next.every((n) => n.nodeType !== 1 || keyOf(n) != null) &&
    next.some((n) => n.nodeType === 1);

  if (keyed) {
    const old = new Map();
    for (const n of [...from.childNodes]) {
      const k = keyOf(n);
      if (k != null && !old.has(k)) old.set(k, n);
      else n.remove();
    }
    let prev = null;
    for (const n of next) {
      if (n.nodeType !== 1) continue;
      const k = keyOf(n);
      let el = old.get(k);
      if (el) {
        old.delete(k);
        el = morphNode(el, n, animate);
      } else {
        el = enter(n, animate);
      }
      const want = prev ? prev.nextSibling : from.firstChild;
      if (el !== want) from.insertBefore(el, want);
      prev = el;
    }
    for (const n of old.values()) n.remove();
    return;
  }

  const cur = [...from.childNodes];
  const n = Math.min(cur.length, next.length);
  for (let i = 0; i < n; i++) morphNode(cur[i], next[i], animate);
  for (let i = n; i < cur.length; i++) cur[i].remove();
  for (let i = n; i < next.length; i++) from.appendChild(enter(next[i], animate));
}

function morphNode(from, to, animate) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) {
    from.replaceWith(to);
    return to;
  }
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return from;
  }
  if (from.nodeType !== 1) return from;
  // An image switching source would flash blank; a new <img> is cleaner.
  if (from.tagName === "IMG" && from.getAttribute("src") !== to.getAttribute("src")) {
    from.replaceWith(to);
    return to;
  }
  morphAttrs(from, to);
  morphChildren(from, to, animate);
  return from;
}

/** Remember every counter's current value before a morph changes it. */
function snapshotCounts(root) {
  const prev = new Map();
  for (const el of root.querySelectorAll("[data-count]")) prev.set(el, Number(el.dataset.count));
  return prev;
}

/** Counters whose value moved count from the old figure to the new one. */
function animateCounts(prev) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const [el, from] of prev) {
    if (!el.isConnected) continue;
    const to = Number(el.dataset.count);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) continue;
    const final = el.textContent;
    const start = performance.now();
    const ms = 520;
    cancelAnimationFrame(el._countRaf);
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1 ? formatCount(Math.round(from + (to - from) * e)) : final;
      if (p < 1) el._countRaf = requestAnimationFrame(step);
    };
    el._countRaf = requestAnimationFrame(step);
  }
}

/**
 * Bring `host`'s contents in line with `html`. Returns true when the DOM
 * changed. `animate` marks brand-new elements so they fade in.
 */
export function paint(host, html, { animate = true } = {}) {
  if (!host || painted.get(host) === html) return false;
  const first = !painted.has(host) || !host.firstChild;
  painted.set(host, html);
  const counts = snapshotCounts(host);
  morphChildren(host, parse(html), animate && !first);
  animateCounts(counts);
  return true;
}

export function forgetPaint(host) {
  painted.delete(host);
}

/**
 * Keyed patch: `items` is `[{ key, html }]`, each html one root element.
 * Unchanged items are left alone; changed ones are morphed in place;
 * new ones fade in (unless the whole list is new).
 */
export function patchList(host, items, { animate = true } = {}) {
  if (!host) return false;
  const existing = new Map();
  for (const el of [...host.children]) {
    const key = el.dataset.key;
    if (key != null && !existing.has(key)) existing.set(key, el);
    else el.remove();
  }
  const fresh = existing.size === 0;

  let changed = false;
  let prev = null;
  for (const { key, html } of items) {
    let el = existing.get(key);
    if (el) {
      existing.delete(key);
      if (painted.get(el) !== html) {
        const next = parse(html).firstElementChild;
        next.dataset.key = key;
        const counts = snapshotCounts(el);
        el = morphNode(el, next, animate);
        el.dataset.key = key;
        painted.set(el, html);
        animateCounts(counts);
        changed = true;
      }
    } else {
      el = parse(html).firstElementChild;
      el.dataset.key = key;
      painted.set(el, html);
      if (animate && !fresh) el.classList.add("is-new");
      changed = true;
    }
    const want = prev ? prev.nextElementSibling : host.firstElementChild;
    if (el !== want) {
      host.insertBefore(el, want);
      changed = true;
    }
    prev = el;
  }
  for (const el of existing.values()) {
    el.remove();
    changed = true;
  }
  return changed;
}

/* —— Posters ——————————————————————————————————————————————————————— */

export function posterHtml(item, { w = 60, h = 90, cls = "poster", eager = false } = {}) {
  const url = item?.posterUrl || item?.poster || "";
  if (url) {
    return `<img class="${cls}" src="${escapeHtml(url)}" alt="" width="${w}" height="${h}" ${
      eager ? "" : 'loading="lazy"'
    } decoding="async" />`;
  }
  return `<div class="${cls} poster-fallback" aria-hidden="true"><span>${escapeHtml(
    (item?.title || "?").slice(0, 1)
  )}</span></div>`;
}

/* —— Badges ———————————————————————————————————————————————————————— */

/** Premiere nights, daytime and senior screenings, Kinoklubb. */
export function specialBadges(show) {
  const bits = [];
  if (show.showType) {
    const key = `showType.${show.showType}`;
    const label = t(key);
    const cls = /premiere/i.test(show.showType) ? "tag-premiere" : "tag-special";
    bits.push(
      `<span class="tag ${cls}">${escapeHtml(label === key ? show.showType : label)}</span>`
    );
  }
  if (show.kinoklubb) bits.push(`<span class="tag tag-club">${escapeHtml(t("kinoklubb"))}</span>`);
  return bits.join("");
}

export function genreLine(genres, max = 3) {
  return (Array.isArray(genres) ? genres : String(genres || "").split(", "))
    .map(formatGenre)
    .filter(Boolean)
    .slice(0, max)
    .join(" · ");
}

/* —— Ratings ——————————————————————————————————————————————————————— */

function ratingLogo(kind, score) {
  if (kind === "imdb") {
    return `<svg class="rating-logo" viewBox="0 0 32 16" aria-hidden="true"><rect width="32" height="16" rx="3" fill="#F5C518"/><text x="16" y="12" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="9.5" fill="#000">IMDb</text></svg>`;
  }
  if (kind === "letterboxd") {
    return `<svg class="rating-logo dots" viewBox="0 0 24 16" aria-hidden="true"><circle cx="6" cy="8" r="5.15" fill="#ff8000"/><circle cx="12" cy="8" r="5.15" fill="#00e054"/><circle cx="18" cy="8" r="5.15" fill="#40bcf4"/></svg>`;
  }
  if (kind === "metacritic") {
    const n = Number(score);
    const fill = n >= 61 ? "#66cc33" : n >= 40 ? "#ffcc33" : "#f33";
    return `<svg class="rating-logo square" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="${fill}"/></svg>`;
  }
  // Rotten Tomatoes audience: a tomato, or a green splat when rotten.
  const rotten = Number(score) < 60;
  return rotten
    ? `<svg class="rating-logo square" viewBox="0 0 16 16" aria-hidden="true"><path fill="#0fc755" d="M8 1.5c1.2 1.6 3.4.6 4 2.4.5 1.6 2.8 2.2 2 4.2-.6 1.6.6 3.4-1.3 4.3-1.6.8-2.2 2.8-4.3 2-1.6-.6-3.4.6-4.3-1.3C3.3 11.5 1.3 11 2 8.9c.6-1.6-.6-3.4 1.3-4.3C4.9 3.8 5.5 1.8 8 1.5Z"/></svg>`
    : `<svg class="rating-logo square" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9" r="6.2" fill="#fa320a"/><path fill="#00912d" d="M5.2 2.6c1 .2 1.8.8 2.3 1.5.5-.9 1.4-1.4 2.6-1.4-.4.6-.6 1.2-.6 1.8 1-.3 2-.1 2.7.5-1.4.4-2.9.6-4.4.6S4.9 5.3 3.6 4.9c.6-.6 1.4-.8 2.3-.7-.3-.5-.5-1-.7-1.6Z"/></svg>`;
}

function formatRatingValue(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  // Scores always carry a decimal, as IMDb and Letterboxd print them: 6,0 not 6.
  return Number(n.toFixed(digits)).toLocaleString(locale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: digits,
  });
}

/** The IMDb logo with the score beside it, for laying over a poster. */
export function imdbBadge(value) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  const label = formatRatingValue(n, 1);
  return `<span class="imdb-badge" role="img" aria-label="${escapeHtml(t("ratingImdbAria", { n: label }))}">${ratingLogo(
    "imdb"
  )}<span class="imdb-badge-v">${escapeHtml(label)}</span></span>`;
}

/**
 * IMDb / Letterboxd / Rotten Tomatoes / Metacritic chips. `links: false`
 * when the chips sit inside something tappable already.
 */
export function ratingBadges(ratings, { links = true, compact = false } = {}) {
  if (!ratings || typeof ratings !== "object") return "";
  const bits = [];
  const chip = (kind, label, aria, url) => {
    const body = `${ratingLogo(kind, label)}<span class="rating-value">${escapeHtml(label)}</span>`;
    return links && url
      ? `<a class="rating ${kind}" href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(aria)}">${body}</a>`
      : `<span class="rating ${kind}" role="img" aria-label="${escapeHtml(aria)}">${body}</span>`;
  };

  if (ratings.imdb?.value != null) {
    const label = formatRatingValue(ratings.imdb.value, 1);
    bits.push(chip("imdb", label, t("ratingImdbAria", { n: label }), ratings.imdb.url));
  }
  if (ratings.letterboxd?.value != null) {
    const label = formatRatingValue(ratings.letterboxd.value, 2);
    bits.push(
      chip("letterboxd", label, t("ratingLetterboxdAria", { n: label }), ratings.letterboxd.url)
    );
  }
  if (!compact && ratings.tomatoes?.value != null) {
    const score = Math.round(Number(ratings.tomatoes.value));
    if (Number.isFinite(score)) {
      bits.push(
        chip("tomatoes", `${score}%`, t("ratingTomatoesAria", { n: score }), ratings.tomatoes.url)
      );
    }
  }
  if (!compact && ratings.metacritic?.value != null) {
    const score = Math.round(Number(ratings.metacritic.value));
    if (Number.isFinite(score)) {
      bits.push(
        chip("metacritic", String(score), t("ratingMetacriticAria", { n: score }), ratings.metacritic.url)
      );
    }
  }
  return bits.length ? `<div class="ratings">${bits.join("")}</div>` : "";
}

/* —— Status ———————————————————————————————————————————————————————— */

/** The little chip next to a showing's time: Nå, om 12 min, Ferdig. */
export function statusChip(show, now = new Date(), { countdown = true } = {}) {
  const status = statusOf(show, now);
  if (status === "live") {
    return `<span class="chip chip-live"><span class="pulse" aria-hidden="true"></span>${escapeHtml(
      t("now")
    )}</span>`;
  }
  if (status === "done") {
    return `<span class="chip chip-done">${icon("check", "icon icon-xs")}${escapeHtml(
      t("done")
    )}</span>`;
  }
  const until = show.start - now;
  if (status === "soon") {
    return `<span class="chip chip-soon">${escapeHtml(formatUntil(until))}</span>`;
  }
  if (countdown && until < 12 * 60 * 60_000) {
    return `<span class="chip chip-quiet">${escapeHtml(formatUntil(until))}</span>`;
  }
  return "";
}

/** Tickets sold, with the sold-out / few-left / reserved flags. */
export function ticketBlock(show) {
  if (show.eventStatus === "unavailable") {
    return `<div class="tickets"><span class="tickets-missing">—</span></div>`;
  }
  if (show.eventStatus === "error" || (show.eventStatus === "gone" && show.sold == null)) {
    return `<div class="tickets"><span class="tickets-missing">${escapeHtml(t("error"))}</span></div>`;
  }
  if (show.sold == null) {
    return `<div class="tickets"><span class="tickets-loading" aria-hidden="true"></span></div>`;
  }

  const cap = show.capacity || 0;
  const flag =
    cap && show.available === 0
      ? `<span class="flag flag-full">${escapeHtml(t("soldOut"))}</span>`
      : cap && show.available != null && show.available <= 10
        ? `<span class="flag flag-few">${escapeHtml(t("fewLeft", { n: show.available }))}</span>`
        : "";
  const res = show.reserved
    ? `<span class="flag flag-res">${escapeHtml(t("reservedShort", { n: show.reserved }))}</span>`
    : "";

  return `
    <div class="tickets">
      <div class="tickets-num"><strong>${formatCount(show.sold)}</strong></div>
      <div class="tickets-sub">${escapeHtml(t("sold"))}</div>
      ${flag || res ? `<div class="flags">${flag}${res}</div>` : ""}
    </div>`;
}

export function admissionIcon(state) {
  if (state === "complete") return icon("check", "icon icon-sm");
  if (state === "unknown") {
    return `<svg class="icon icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 2.2" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/></svg>`;
  }
  return icon("enter", "icon icon-sm");
}

/** The door-side answer at a glance: how many of the sold are inside. */
export function admissionStrip(show, now, opts) {
  const a = admissionOf(show, now, opts);
  if (!a) return "";
  const count =
    a.state === "unknown"
      ? `<span class="admit-count">–<small>/${a.sold}</small></span>`
      : `<span class="admit-count"><strong>${a.scanned}</strong><small>/${a.sold}</small></span>`;
  return `
    <div class="admit admit-${a.state}" role="group" aria-label="${escapeHtml(
      t("admitAria", { n: a.scanned ?? 0, total: a.sold })
    )}">
      <span class="admit-icon">${admissionIcon(a.state)}</span>
      ${count}
      <span class="admit-track" aria-hidden="true"><span class="admit-fill" style="width:${a.pct}%"></span></span>
      <span class="admit-label">${escapeHtml(admissionLabel(a))}</span>
    </div>`;
}

/** "Nothing here", said the same way everywhere. */
export function emptyState(iconName, title, text = "", cls = "") {
  return `<div class="empty ${cls}">
    <span class="empty-icon">${icon(iconName)}</span>
    <p class="empty-title">${escapeHtml(title)}</p>
    ${text ? `<p class="empty-text">${escapeHtml(text)}</p>` : ""}
  </div>`;
}

/** Large-title page header used by Movies, Stats and Settings. */
export function viewHead(title, sub = "", aside = "") {
  return `<header class="view-head" data-key="head">
    <div>
      <h1 class="view-title">${escapeHtml(title)}</h1>
      ${sub ? `<p class="view-sub">${escapeHtml(sub)}</p>` : ""}
    </div>
    ${aside}
  </header>`;
}

/* —— Toasts ———————————————————————————————————————————————————————— */

/**
 * A short message near the bottom of the screen. `action` adds a button;
 * `sticky` keeps it until tapped. Same `id` replaces an earlier toast.
 */
export function toast(text, { action = "", onAction = null, timeout = 2800, sticky = false, id = "", kind = "" } = {}) {
  const host = els.toasts;
  if (!host) return;
  if (id) host.querySelector(`[data-toast="${CSS.escape(id)}"]`)?.remove();
  const el = document.createElement("div");
  el.className = `toast${kind ? ` toast-${kind}` : ""}`;
  el.setAttribute("role", "status");
  if (id) el.dataset.toast = id;
  const label = document.createElement("span");
  label.textContent = text;
  el.append(label);
  const close = () => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 260);
  };
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action;
    btn.addEventListener("click", () => {
      close();
      onAction?.();
    });
    el.append(btn);
  }
  host.append(el);
  if (!sticky) setTimeout(close, timeout);
  return close;
}

/* —— Haptics ——————————————————————————————————————————————————————
 * `navigator.vibrate` is always full amplitude, so strength is duration:
 * a 1ms pulse is the lightest tick a motor makes, a few more ms read as a
 * firmer click. Three steps:
 *   light  — picking among options: a day, a period, a switch position,
 *            a scroll arrow, a chart column, a search hit
 *   medium — going somewhere or changing something: a tab, opening a
 *            film, a toggle, a button, a committed day swipe
 *   strong — a deliberate gesture landing: pull-to-refresh firing
 * The lock stops Chrome's synthetic second click from stacking a pulse.
 */
const HAPTIC_MS = { light: 1, medium: 6, strong: 14 };
const HAPTIC_LOCK_MS = 70;
let hapticLockUntil = 0;

function canHaptic() {
  if (typeof navigator.vibrate !== "function") return false;
  const platform = navigator.userAgentData?.platform;
  if (platform) return platform === "Android";
  return /Android/i.test(navigator.userAgent);
}

export function hapticTick(level = "light") {
  if (!S.hapticsOn || !canHaptic()) return;
  const now = performance.now();
  if (now < hapticLockUntil) return;
  hapticLockUntil = now + HAPTIC_LOCK_MS;
  try {
    navigator.vibrate(HAPTIC_MS[level] || HAPTIC_MS.light);
  } catch {
    /* some WebViews throw; a tap must never fail because of this */
  }
}

/** Controls that mean "I picked this" — not seats, scrolling or swiping. */
const HAPTICS = [
  [
    "medium",
    [
      ".tab",
      ".switch",
      "[data-row-toggle]",
      ".btn",
      ".status-btn",
      ".jump-today",
      ".movie-card",
      ".up-card",
      ".show-main",
      ".rank-row",
      ".record",
      ".nn",
      ".sh-show",
      ".sheet-close",
      "[data-open-movie]",
      "[data-goto-show]",
      "[data-omdb-id]",
      "[data-stats-day]",
    ],
  ],
  [
    "light",
    [
      ".day-chip",
      ".seg-btn",
      "[data-period]",
      "[data-period-jump]",
      ".hs-btn",
      ".tl-bar",
      ".hit",
      ".seat-strip",
      ".sh-more",
      ".link-btn",
      ".search-clear",
      "[data-done-more]",
      "[data-seat-retry]",
    ],
  ],
];
const HAPTIC_ANY = HAPTICS.flatMap(([, list]) => list).join(", ");

function hapticTarget(el) {
  const node = el?.nodeType === 1 ? el : el?.parentElement;
  const hit = node?.closest?.(HAPTIC_ANY);
  if (!hit || hit.disabled || hit.getAttribute("aria-disabled") === "true") return null;
  const level = HAPTICS.find(([, list]) => list.some((sel) => hit.matches(sel)))?.[0] || "light";
  return { hit, level };
}

export function setupHaptics() {
  // Tick on pointerup of a real tap, not on click: Chrome on Android
  // often synthesizes a second click, which was the extra tick.
  let pointerType = "mouse";
  let downX = 0;
  let downY = 0;
  let down = null;
  let ticked = false;

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.isPrimary) return;
      pointerType = e.pointerType;
      downX = e.clientX;
      downY = e.clientY;
      down = hapticTarget(e.target);
      ticked = false;
    },
    true
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      if (!e.isPrimary || pointerType === "mouse" || !down) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
      if (hapticTarget(e.target)?.hit !== down.hit) return;
      ticked = true;
      hapticTick(down.level);
    },
    true
  );
  document.addEventListener(
    "click",
    (e) => {
      if (ticked) return;
      if (pointerType === "mouse" && e.detail !== 0) return;
      const target = hapticTarget(e.target);
      if (target) hapticTick(target.level);
    },
    true
  );
}

/* —— Taps that go missing ——————————————————————————————————————————
 * A phone browser only turns a tap into a click when it is sure it was
 * a tap. Chrome on Android drops it now and then — the finger slid a
 * hair, the page was still settling from the day change before, a strip
 * was gliding somewhere — and that is what made the app want a second
 * tap after leaving today. A tap that lifted cleanly on a control and
 * got no click is given its click here, a moment later, as long as the
 * finger is still on that same control; a click the browser sends after
 * all is swallowed, so nothing ever fires twice. A tap that stops a
 * scroll is left alone, the way the browser meant it.
 */
const TAP_SLOP_PX = 12;
const TAP_MAX_MS = 650;
const TAP_RESCUE_MS = 280;
const TAP_LATE_MS = 900;
const SCROLL_QUIET_MS = 120;
const ACTIONABLE = `button, a[href], summary, label, [role="button"], [role="tab"], [role="switch"], [role="radio"], ${HAPTIC_ANY}`;

function actionableAt(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  if (!el || el.closest("input, textarea, select, [contenteditable]")) return null;
  const hit = el.closest(ACTIONABLE);
  if (!hit || hit.disabled || hit.closest("[inert]") || hit.getAttribute("aria-disabled") === "true") return null;
  return hit;
}

export function setupTapRescue() {
  let tap = null; // the finger that is down
  let pending = null; // lifted, waiting for the browser's click
  let rescued = null; // clicked from here; the browser's late one is dropped
  const scrolled = new Map(); // scroller -> when it last moved

  // The bars pinned to the screen do not move with a page that is still
  // coasting, so a tap on them means the tab or the day, not "stop".
  const pinned = (hit) => Boolean(hit.closest(".tabbar, .appbar, .day-dock, .toasts"));
  const scrolling = (hit, now) => {
    for (const [target, at] of scrolled) {
      if (now - at > SCROLL_QUIET_MS) scrolled.delete(target);
      else if (target === document ? !pinned(hit) : target.contains?.(hit)) return true;
    }
    return false;
  };

  document.addEventListener("scroll", (e) => scrolled.set(e.target, performance.now()), {
    capture: true,
    passive: true,
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" || !e.isPrimary) {
        tap = null;
        return;
      }
      const now = performance.now();
      const hit = actionableAt(e.target);
      tap = hit && !scrolling(hit, now) ? { id: e.pointerId, hit, x: e.clientX, y: e.clientY, at: now } : null;
    },
    { capture: true, passive: true }
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (tap && e.pointerId === tap.id && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) tap = null;
    },
    { capture: true, passive: true }
  );
  document.addEventListener("pointercancel", () => (tap = null), { capture: true, passive: true });
  document.addEventListener(
    "pointerup",
    (e) => {
      if (!tap || e.pointerId !== tap.id) return;
      const t0 = tap;
      tap = null;
      if (performance.now() - t0.at > TAP_MAX_MS) return;
      if (Math.hypot(e.clientX - t0.x, e.clientY - t0.y) > TAP_SLOP_PX) return;
      clearTimeout(pending?.timer);
      const p = { hit: t0.hit, x: e.clientX, y: e.clientY };
      p.timer = setTimeout(() => {
        if (pending !== p) return;
        pending = null;
        if (!p.hit.isConnected || actionableAt(document.elementFromPoint(p.x, p.y)) !== p.hit) return;
        rescued = { hit: p.hit, x: p.x, y: p.y, at: performance.now() };
        p.hit.click();
      }, TAP_RESCUE_MS);
      pending = p;
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted) return;
      // Matched by place as well as target: by the time it comes, what the
      // rescued tap opened (a sheet, another day) may be what it would hit.
      const late =
        rescued &&
        performance.now() - rescued.at < TAP_LATE_MS &&
        (rescued.hit.contains(e.target) || Math.hypot(e.clientX - rescued.x, e.clientY - rescued.y) <= TAP_SLOP_PX * 2);
      if (late) {
        rescued = null;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      rescued = null;
      if (pending) {
        clearTimeout(pending.timer);
        pending = null;
      }
    },
    true
  );
}

/** New elements carry `is-new` only for their entrance. */
export function setupMotion() {
  document.addEventListener("animationend", (e) => {
    if (e.target.classList?.contains("is-new")) e.target.classList.remove("is-new");
  });
}

/* —— Sliding selection —————————————————————————————————————————————
 * The selected-tab squircle and the selected-day pill travel the way the
 * DailyDash navbar's bubble does: the edge heading for the new target
 * leads on a stiff spring and the other follows on a softer one, so it
 * stretches a little as it sets off — and flattens a touch while it is
 * long — then gathers up where it lands. Both springs are critically
 * damped: it never overshoots, never bounces.
 */
const SPRING_LEAD = 620;
/** The trailing edge waits on the old target a moment before it follows
 * — that wait is what stretches it — then catches up on a stiffer spring,
 * so the whole move lands as quickly as without the wait. */
const SPRING_TRAIL = 310;
const TRAIL_HOLD_MS = 60;

const sliders = new WeakMap();

function slider(el) {
  let s = sliders.get(el);
  if (s) return s;
  s = { a: null, b: null, ka: SPRING_LEAD, kb: SPRING_LEAD, holdA: 0, holdB: 0, target: null, axis: "x", raf: 0, last: 0 };
  sliders.set(el, s);
  return s;
}

function drawSlider(el, s) {
  const tg = s.target;
  const start = Math.min(s.a.x, s.b.x);
  const len = Math.abs(s.b.x - s.a.x);
  const stretch = Math.max(0, len - tg.len);
  const squash = Math.min(1, stretch / (tg.len || 1)) * 0.12 * tg.crossSize;
  const cross = tg.crossPos + squash / 2;
  const crossSize = tg.crossSize - squash;
  if (s.axis === "x") {
    el.style.transform = `translate3d(${start}px, ${cross}px, 0)`;
    el.style.width = `${len}px`;
    el.style.height = `${crossSize}px`;
  } else {
    el.style.transform = `translate3d(${cross}px, ${start}px, 0)`;
    el.style.width = `${crossSize}px`;
    el.style.height = `${len}px`;
  }
}

function stepSlider(el, s, now) {
  const dt = Math.min(0.032, Math.max(0.001, (now - s.last) / 1000));
  s.last = now;
  let moving = false;
  for (const [edge, goal, k, hold] of [
    [s.a, s.target.a, s.ka, s.holdA],
    [s.b, s.target.b, s.kb, s.holdB],
  ]) {
    if (now < hold) {
      moving = true;
      continue;
    }
    // Critically damped: c = 2·√k with unit mass.
    edge.v += (-k * (edge.x - goal) - 2 * Math.sqrt(k) * edge.v) * dt;
    edge.x += edge.v * dt;
    if (Math.abs(edge.x - goal) < 0.25 && Math.abs(edge.v) < 4) {
      edge.x = goal;
      edge.v = 0;
    } else {
      moving = true;
    }
  }
  drawSlider(el, s);
  s.raf = moving && el.isConnected ? requestAnimationFrame((t) => stepSlider(el, s, t)) : 0;
}

/**
 * Move a selection highlight to `rect` ({ x, y, w, h } in its parent's
 * coordinates) along `axis`. The first placement, a change of axis or
 * `instant` snaps straight there.
 */
export function slideTo(el, rect, { axis = "x", instant = false } = {}) {
  if (!el || !rect.w || !rect.h) return;
  const s = slider(el);
  const along = axis === "x";
  const target = {
    a: along ? rect.x : rect.y,
    len: along ? rect.w : rect.h,
    crossPos: along ? rect.y : rect.x,
    crossSize: along ? rect.h : rect.w,
  };
  target.b = target.a + target.len;
  const snap = !s.a || instant || s.axis !== axis || reducedMotion();
  s.target = target;
  s.axis = axis;
  if (snap) {
    cancelAnimationFrame(s.raf);
    s.raf = 0;
    s.a = { x: target.a, v: 0 };
    s.b = { x: target.b, v: 0 };
    drawSlider(el, s);
    return;
  }
  // Heading right (or down), the far edge leads; heading back, the near
  // one. The other stays put on the old target for a moment first.
  const forward = target.a + target.b > s.a.x + s.b.x;
  const now = performance.now();
  s.ka = forward ? SPRING_TRAIL : SPRING_LEAD;
  s.kb = forward ? SPRING_LEAD : SPRING_TRAIL;
  s.holdA = forward && !s.a.v ? now + TRAIL_HOLD_MS : 0;
  s.holdB = !forward && !s.b.v ? now + TRAIL_HOLD_MS : 0;
  if (!s.raf) {
    s.last = now;
    s.raf = requestAnimationFrame((t) => stepSlider(el, s, t));
  }
}

/** The highlight inside a segmented switch; it slides like the tab bar's. */
export const SEG_IND = '<span class="seg-ind" data-js-style aria-hidden="true"></span>';

/** Move every switch's highlight under its chosen button. */
export function syncSegs(root = document) {
  for (const seg of root.querySelectorAll(".seg")) {
    const ind = seg.querySelector(":scope > .seg-ind");
    const on = seg.querySelector(':scope > .seg-btn[aria-selected="true"], :scope > .seg-btn[aria-checked="true"]');
    if (!ind || !on || !on.offsetWidth) continue;
    slideTo(ind, { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight });
    ind.classList.add("is-placed");
  }
}

/* —— Horizontal scrollers ————————————————————————————————————————————
 * Every sideways list (days, timeline, upcoming films, cast) sits in an
 * `.hs` wrapper with a ‹ and › button. With a mouse they scroll the list
 * by most of a screen, so nobody has to shift-scroll; on touch screens
 * they are hidden and the finger does it. Each arrow only shows while
 * there is something to scroll to on its side.
 */

/** Arrow buttons around `track` (markup with `data-hs-track` on it). */
export function hscroll(track, cls = "") {
  return `<div class="hs${cls ? ` ${cls}` : ""}" data-hs>
    ${hsButtons()}
    ${track}
  </div>`;
}

export function hsButtons() {
  return `<button type="button" class="hs-btn hs-prev" data-hs-dir="-1" aria-label="${escapeHtml(
    t("scrollPrev")
  )}">${icon("chevronLeft", "icon")}</button><button type="button" class="hs-btn hs-next" data-hs-dir="1" aria-label="${escapeHtml(
    t("scrollNext")
  )}">${icon("chevronRight", "icon")}</button>`;
}

function hsTrack(wrap) {
  for (const child of wrap.children) if (child.hasAttribute("data-hs-track")) return child;
  return null;
}

function syncOne(wrap) {
  const track = hsTrack(wrap);
  if (!track) return;
  const max = track.scrollWidth - track.clientWidth;
  const x = Math.abs(track.scrollLeft);
  const prev = max > 2 && x > 2;
  const next = max > 2 && x < max - 2;
  if (wrap.classList.contains("can-prev") !== prev) wrap.classList.toggle("can-prev", prev);
  if (wrap.classList.contains("can-next") !== next) wrap.classList.toggle("can-next", next);
}

/** Show or hide every scroller's arrows for where it is scrolled to now. */
export function syncHScroll(root = document) {
  for (const wrap of root.querySelectorAll("[data-hs]")) syncOne(wrap);
}

export function setupHScroll() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-hs-dir]");
    if (!btn) return;
    const wrap = btn.closest("[data-hs]");
    const track = wrap && hsTrack(wrap);
    if (!track) return;
    const dir = Number(btn.dataset.hsDir) || 1;
    const step = Math.max(track.clientWidth * 0.8, 120);
    track.scrollBy({ left: dir * step, behavior: reducedMotion() ? "auto" : "smooth" });
  });
  // Scroll events do not bubble; catch every scroller's on the way down.
  const queued = new Set();
  let raf = 0;
  document.addEventListener(
    "scroll",
    (e) => {
      const wrap = e.target?.closest?.("[data-hs]");
      if (!wrap || !e.target.hasAttribute?.("data-hs-track")) return;
      queued.add(wrap);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        for (const w of queued) syncOne(w);
        queued.clear();
      });
    },
    { capture: true, passive: true }
  );
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => syncHScroll(), 120);
  });
}

/* —— Note ———————————————————————————————————————————————————————————
 * A GitHub-style note above every tab: blue rule down the left, the info
 * icon and a title, then the message. It cannot be dismissed, since
 * staff need to see it every time, but the title folds it down to one
 * line, and each device remembers that (`noticeOpen` in the prefs). Set
 * NOTICE_ON to false in core.js to take it down.
 *
 * It says different things on the two addresses. On the old one (GitHub
 * Pages) it links to the new one and says the old one closes on
 * 1 November; on t3lluz.com it says this is the new address. Both count
 * down to OLD_URL_ENDS, a second at a time while the page is visible.
 */
const INFO_ICON =
  '<svg class="notice-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>';

let noticeEl = null;
let countdownTimer = 0;

function onNewAddress() {
  return location.hostname === "t3lluz.com";
}

function countdownHtml() {
  const left = OLD_URL_ENDS.getTime() - Date.now();
  if (left <= 0) return `<p class="notice-count">${escapeHtml(t("noticeClosed"))}</p>`;
  const total = Math.floor(left / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const cell = (n, label) =>
    `<span class="cd-cell"><b>${String(n).padStart(2, "0")}</b><small>${escapeHtml(label)}</small></span>`;
  return `<p class="notice-count"><span class="cd-label">${escapeHtml(t("noticeCountdown"))}</span>
    <span class="cd" role="timer">${cell(d, t(d === 1 ? "noticeDay" : "noticeDays"))}${cell(
      h,
      t(h === 1 ? "noticeHour" : "noticeHours")
    )}${cell(m, t("noticeMins"))}${cell(sec, t("noticeSecs"))}</span></p>`;
}

/** "29 d 10 t": what the folded note keeps of the countdown. */
function countdownShort() {
  const left = OLD_URL_ENDS.getTime() - Date.now();
  if (left <= 0) return "";
  const hours = Math.floor(left / 3_600_000);
  return t("noticeShort", { d: Math.floor(hours / 24), h: hours % 24 });
}

function renderNotice() {
  if (!noticeEl) return;
  noticeEl.setAttribute("aria-label", t("noticeAria"));
  const shortUrl = NEW_APP_URL.replace(/^https:\/\//, "").replace(/\/$/, "");
  const body = onNewAddress()
    ? `<p class="notice-body">${escapeHtml(t("noticeHere"))}</p>`
    : `<p class="notice-body">${escapeHtml(t("noticeMoved"))}
        <a class="notice-link" href="${NEW_APP_URL}">${escapeHtml(shortUrl)}</a></p>
      <p class="notice-body">${escapeHtml(t("noticeOldEnds"))}</p>`;
  const open = S.noticeOpen;
  noticeEl.innerHTML = `<div class="notice-box${open ? "" : " is-folded"}">
      <button type="button" class="notice-title" data-notice-toggle aria-expanded="${open}" aria-controls="noticeMore"
        title="${escapeHtml(t(open ? "noticeHide" : "noticeShow"))}">
        ${INFO_ICON}<span class="notice-title-text">${escapeHtml(t("noticeTitle"))}</span>
        <span class="notice-short">${escapeHtml(countdownShort())}</span>
        ${icon("chevronDown", "icon notice-chev")}
      </button>
      <div class="notice-more" id="noticeMore"${open ? "" : " inert"}>
        <div class="notice-inner">
          ${body}
          <div class="notice-cd">${countdownHtml()}</div>
        </div>
      </div>
    </div>`;
}

/** Fold or unfold, remember it on this device, and let the pinned bars re-measure. */
function toggleNotice() {
  S.noticeOpen = !S.noticeOpen;
  savePrefs();
  hapticTick("light");
  const box = noticeEl.querySelector(".notice-box");
  const btn = noticeEl.querySelector("[data-notice-toggle]");
  const more = noticeEl.querySelector(".notice-more");
  box.classList.toggle("is-folded", !S.noticeOpen);
  btn.setAttribute("aria-expanded", String(S.noticeOpen));
  btn.title = t(S.noticeOpen ? "noticeHide" : "noticeShow");
  more.inert = !S.noticeOpen;
  // After the fold has played (older browsers skip the animation, so no
  // transitionend to wait for).
  setTimeout(() => hooks.headerChanged(), 360);
}

function tickCountdown() {
  if (document.visibilityState === "visible") {
    const host = noticeEl?.querySelector(".notice-cd");
    if (host) host.innerHTML = countdownHtml();
    const short = noticeEl?.querySelector(".notice-short");
    if (short) short.textContent = countdownShort();
  }
  if (Date.now() >= OLD_URL_ENDS.getTime()) clearInterval(countdownTimer);
}

/** Drawn at boot, in place from the first frame, so nothing jumps under it. */
export function setupNotice() {
  noticeEl = document.getElementById("notice");
  if (!noticeEl || !NOTICE_ON) return;
  renderNotice();
  noticeEl.hidden = false;
  noticeEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-notice-toggle]")) toggleNotice();
  });
  countdownTimer = setInterval(tickCountdown, 1000);
}

/** Redraw the note's words after a language change. */
export function refreshNotice() {
  if (noticeEl && !noticeEl.hidden) renderNotice();
}

/** Wire-safe clock string for a showing's start and end. */
export function timeRange(show) {
  const end = show.end ? formatClock(show.end) : "";
  return `${formatClock(show.start)}${end ? `–${end}` : ""}`;
}
