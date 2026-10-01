/**
 * Small pieces every view is built from — posters, badges, the sold
 * and check-in strips, toasts, haptics — plus the two ways a view gets
 * onto the page without tearing down what is already there.
 */
import {
  S,
  els,
  t,
  icon,
  escapeHtml,
  formatClock,
  formatUntil,
  formatCount,
  locale,
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

/** Classes JavaScript adds for a moment; a redraw must not strip them. */
const TRANSIENT = ["is-flash", "is-picked", "is-set", "is-new", "is-entering"];

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
  const rounded = Number(n.toFixed(digits));
  return rounded.toLocaleString(locale(), {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: digits,
  });
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
 * `navigator.vibrate` is always full amplitude, so a shorter pulse is a
 * lighter one; 1ms is the lightest tick a motor makes. The lock stops
 * Chrome's synthetic second click from stacking a second pulse.
 */
const HAPTIC_TICK_MS = 1;
const HAPTIC_LOCK_MS = 70;
let hapticLockUntil = 0;

function canHaptic() {
  if (typeof navigator.vibrate !== "function") return false;
  const platform = navigator.userAgentData?.platform;
  if (platform) return platform === "Android";
  return /Android/i.test(navigator.userAgent);
}

export function hapticTick() {
  if (!S.hapticsOn || !canHaptic()) return;
  const now = performance.now();
  if (now < hapticLockUntil) return;
  hapticLockUntil = now + HAPTIC_LOCK_MS;
  try {
    navigator.vibrate(HAPTIC_TICK_MS);
  } catch {
    /* some WebViews throw; a tap must never fail because of this */
  }
}

/** Only controls that mean "I picked this" — not seats, scroll or swipe. */
const HAPTIC_SELECTOR = [
  ".tab",
  ".day-chip",
  ".jump-today",
  ".status-btn",
  ".seg-btn",
  ".switch",
  ".btn",
  ".seat-strip",
  ".movie-card",
  ".show-open",
  "[data-open-show]",
  "[data-open-movie]",
  "[data-goto-show]",
  "[data-stats-day]",
  "[data-period]",
  ".sheet-close",
].join(", ");

function hapticTarget(el) {
  const node = el?.nodeType === 1 ? el : el?.parentElement;
  const hit = node?.closest?.(HAPTIC_SELECTOR);
  if (!hit || hit.disabled || hit.getAttribute("aria-disabled") === "true") return null;
  return hit;
}

export function setupHaptics() {
  // Tick on pointerup of a real tap, not on click: Chrome on Android
  // often synthesizes a second click, which was the extra tick.
  let pointerType = "mouse";
  let downX = 0;
  let downY = 0;
  let downHit = null;
  let ticked = false;

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.isPrimary) return;
      pointerType = e.pointerType;
      downX = e.clientX;
      downY = e.clientY;
      downHit = hapticTarget(e.target);
      ticked = false;
    },
    true
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      if (!e.isPrimary || pointerType === "mouse" || !downHit) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
      if (hapticTarget(e.target) !== downHit) return;
      ticked = true;
      hapticTick();
    },
    true
  );
  document.addEventListener(
    "click",
    (e) => {
      if (ticked) return;
      if (pointerType === "mouse" && e.detail !== 0) return;
      if (hapticTarget(e.target)) hapticTick();
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

/** Wire-safe clock string for a showing's start and end. */
export function timeRange(show) {
  const end = show.end ? formatClock(show.end) : "";
  return `${formatClock(show.start)}${end ? `–${end}` : ""}`;
}
