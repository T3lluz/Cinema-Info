/**
 * The liquid ripple: the wave that runs through the page when the app
 * opens and every time it is refreshed — the same one DailyDash and the
 * t3lluz dashboard run.
 *
 * It is the AGSL shader from sameerasw/essentials
 * (`LiquidRippleModifier.kt`), as DailyDash uses it, ported to GLSL line
 * for line with its numbers untouched, the way the dashboard's
 * `site/js/ripple.js` does. A browser will not hand a live DOM to a
 * shader, so the page is photographed first (cloned into an SVG
 * foreignObject, drawn into a canvas) and the shader runs over that still:
 * one quad, one texture, one pass, a damped wave pushing every pixel out
 * along the line from the header.
 *
 * The header (and whatever bar is docked under it) and the tab bar are
 * not in the picture: the canvas starts under the header and sits beneath
 * the tab bar, so both stay live and still while everything else ripples.
 *
 * Because it works off a still, the page is frozen for the 2.8 s; the
 * first tap, scroll or key ends it early with the same short fade it ends
 * on. Buen's poster CDN refuses cross-origin reads, so posters come from
 * the same-origin copies the deploy makes (scripts/mirror-posters.mjs);
 * an image that cannot be read is left out, which the fade at each end
 * hides.
 */
import { S, els, reducedMotion } from "./core.js?v=dev";

const RIP = {
  amp: 34, // amplitudeDp
  freq: 12, // frequency
  decay: 4.5, // decay
  speed: 1400, // speedDp
  dur: 2800, // durationMillis
  fade: 140, // ms of cross-fade at each end
  wait: 4000, // ms to let the page settle before going anyway
  passthrough: 262144, // bytes: bigger images are redrawn at shown size
  bleed: 48, // px captured past the edges, so the wave samples real content
};

/* The shader as it is on the phone; only the last line differs, reading
 * the photographed page instead of AGSL's `inputShader`. */
const RIP_FRAG = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform sampler2D uPage;
  uniform vec2 uRes, uTexOrigin, uTexSize, uOrigin;
  uniform float uTime, uAmplitude, uFrequency, uDecay, uSpeed;
  varying vec2 vUV;

  void main() {
    vec2 pos = vec2(vUV.x, 1.0 - vUV.y) * uRes;
    float dist = length(pos - uOrigin);
    float delay = dist / uSpeed;
    float time = max(0.0, uTime - delay);

    float wave1 = uAmplitude * sin(uFrequency * time) * exp(-uDecay * time);

    float subTime = max(0.0, time - 0.22);
    float wave2 = (uAmplitude * 0.55) * sin(uFrequency * 1.15 * subTime) * exp(-(uDecay * 0.8) * subTime);

    float totalWave = wave1 + wave2;
    vec2 n = normalize(pos - uOrigin + vec2(0.0001));
    vec2 newPos = pos + totalWave * n;

    float highlight = 0.16 * (totalWave / max(1.0, uAmplitude));

    gl_FragColor = texture2D(uPage, (newPos - uTexOrigin) / uTexSize)
                 + vec4(highlight, highlight, highlight, 0.0);
  }`;

const RIP_VERT = `
  attribute vec2 aPos;
  varying vec2 vUV;
  void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Pinned and floating chrome that stays live above (or out of) the wave. */
const CHROME_REMOVE = "script, .rip-canvas, .header-glass, .tabbar, .toasts, .sheet, .edge-blur";
const CHROME_HIDE = ".appbar";
/** Bars that stick; in the clone they go where they are on screen. */
const STICKY = ".day-dock, .period-bar";
/** Sideways lists; a clone does not keep where they were scrolled to. */
const SCROLLERS = "[data-hs-track]";

const rest = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 1) =>
  new Promise((r) => {
    const step = (i) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1)));
    step(n);
  });

/** The part of the screen that ripples: everything under the header panel. */
function rippleArea() {
  const top = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--glass-h")) || els.appbar?.offsetHeight || 0);
  const w = document.documentElement.clientWidth;
  const h = Math.max(1, document.documentElement.clientHeight - top);
  return { top, w, h };
}

/** What the capture covers, in viewport coordinates, bleed included. */
function captureBox(area) {
  return {
    x: -RIP.bleed,
    y: area.top - RIP.bleed,
    w: area.w + RIP.bleed * 2,
    h: area.h + RIP.bleed * 2,
  };
}

function inBox(r, box) {
  return r.width > 0 && r.height > 0 && r.right > box.x && r.left < box.x + box.w && r.bottom > box.y && r.top < box.y + box.h;
}

/** Where the wave starts: the middle of the header's row. */
function origin() {
  const row = els.appbar?.querySelector(".appbar-row");
  const r = (row || els.appbar)?.getBoundingClientRect();
  if (!r) return { x: document.documentElement.clientWidth / 2, y: 0 };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/* —— Waiting for a page worth photographing ——————————————————————— */

async function settled(box, deadline) {
  const left = () => Math.max(0, deadline - performance.now());
  if (document.readyState !== "complete") {
    await Promise.race([new Promise((r) => addEventListener("load", r, { once: true })), rest(left())]);
  }
  await Promise.race([document.fonts?.ready?.catch(() => {}) || Promise.resolve(), rest(left())]);
  const pending = [...document.body.querySelectorAll("img")].filter(
    (img) => !img.complete && inBox(img.getBoundingClientRect(), box)
  );
  if (pending.length) {
    await Promise.race([Promise.allSettled(pending.map((img) => img.decode())), rest(left())]);
  }
  await frames(2);
  await new Promise((r) =>
    window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 100)
  );
}

/* —— Photographing the page ——————————————————————————————————————— */

/** Every stylesheet, flattened, with media queries answered by the real
 * window. `:root` and `body` do not exist inside a foreignObject, so they
 * become the capture's root class; animations are switched off so every
 * element is photographed as it rests, not at frame zero of its entrance. */
function captureCss() {
  let out = "";
  const walk = (rules) => {
    for (const r of rules) {
      try {
        if (r.type === CSSRule.MEDIA_RULE) {
          if (matchMedia(r.conditionText).matches) walk(r.cssRules);
        } else if (r.type === CSSRule.SUPPORTS_RULE) {
          if (CSS.supports(r.conditionText)) walk(r.cssRules);
        } else if (r.type !== CSSRule.KEYFRAMES_RULE) {
          out += `${r.cssText}\n`;
        }
      } catch {
        /* one odd rule must not cost the whole capture */
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      /* cross-origin sheet: none here, but never fatal */
    }
  }
  out = out.replace(/:root\b/g, ".rip-root").replace(/([\s,{(])body\b/g, "$1.rip-root").replace(/^body\b/gm, ".rip-root");
  return `${out}
.rip-root *, .rip-root *::before, .rip-root *::after { animation: none !important; transition: none !important; }`;
}

/** Buen's posters, as the same-origin copy the deploy makes of them. */
export function mirroredPoster(url) {
  try {
    const u = new URL(url, location.href);
    if (u.hostname !== "cdn.sanity.io") return "";
    const name = decodeURIComponent(u.pathname.split("/").pop() || "");
    return /^[\w.-]+$/.test(name) ? new URL(`posters/${name}`, location.href).href : "";
  } catch {
    return "";
  }
}

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", gif: "image/gif" };

/** One data URI per distinct image, fetched from the cache as the bytes it is. */
function dataUriCache() {
  const seen = new Map();
  return (url) => {
    if (!seen.has(url)) {
      seen.set(
        url,
        (async () => {
          try {
            const res = await fetch(url, { cache: "force-cache" });
            if (!res.ok) return null;
            let blob = await res.blob();
            if (!blob.type.includes("svg") && blob.size > RIP.passthrough) return null;
            if (!blob.type.startsWith("image/")) {
              const ext = new URL(url).pathname.split(".").pop().toLowerCase();
              if (!TYPES[ext]) return null;
              blob = new Blob([blob], { type: TYPES[ext] });
            }
            return await new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(fr.result);
              fr.onerror = reject;
              fr.readAsDataURL(blob);
            });
          } catch {
            return null;
          }
        })()
      );
    }
    return seen.get(url);
  };
}

async function inlineImages(clone, box, dpr) {
  const live = [...document.body.querySelectorAll("img")];
  const copies = [...clone.querySelectorAll("img")];
  const rects = live.map((img) => img.getBoundingClientRect());
  const asIs = dataUriCache();

  // A big same-origin image, redrawn at the size it is shown.
  const asPhoto = (img, r) => {
    try {
      if (!img.complete || !img.naturalWidth) return null;
      const w = Math.min(img.naturalWidth, Math.max(1, Math.ceil((r.width || img.naturalWidth) * dpr)));
      const h = Math.min(img.naturalHeight, Math.max(1, Math.ceil((r.height || img.naturalHeight) * dpr)));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/webp", 0.82);
    } catch {
      return null;
    }
  };

  await Promise.all(
    copies.map(async (copy, i) => {
      const img = live[i];
      const src = img && (img.currentSrc || img.src);
      copy.removeAttribute("loading");
      copy.removeAttribute("decoding");
      copy.removeAttribute("srcset");
      if (!src || src.startsWith("data:")) return;
      if (!inBox(rects[i], box)) {
        copy.removeAttribute("src");
        copy.style.visibility = "hidden";
        return;
      }
      const mirror = mirroredPoster(src);
      const uri = (mirror && (await asIs(mirror))) || (await asIs(src)) || asPhoto(img, rects[i]);
      if (uri) copy.setAttribute("src", uri);
      else {
        copy.removeAttribute("src");
        copy.style.visibility = "hidden";
      }
    })
  );
}

/** Sticky bars sit where they are on screen, not where the flow puts them:
 * how far each one is from its place in the flow, in document order. */
function stickyOffsets() {
  return [...document.body.querySelectorAll(STICKY)].map((el) => {
    if (getComputedStyle(el).position !== "sticky" || !el.offsetHeight) return null;
    const stuck = el.getBoundingClientRect().top;
    const prev = el.style.position;
    el.style.position = "static";
    const flow = el.getBoundingClientRect().top;
    el.style.position = prev;
    return Math.round(stuck - flow);
  });
}

async function capture(box, dpr) {
  const offsets = stickyOffsets();
  const scrolled = [...document.body.querySelectorAll(SCROLLERS)].map((el) => el.scrollLeft);
  const clone = document.body.cloneNode(true);
  // Scrolled lists: their contents shifted by as much, inside the clipped list.
  [...clone.querySelectorAll(SCROLLERS)].forEach((copy, i) => {
    const x = Math.round(scrolled[i] || 0);
    if (!x) return;
    for (const child of copy.children) child.style.translate = `${-x}px 0`;
  });
  // Same element order in both, so each measurement finds its copy.
  [...clone.querySelectorAll(STICKY)].forEach((copy, i) => {
    if (offsets[i] == null) return;
    copy.style.position = "relative";
    copy.style.top = `${offsets[i]}px`;
  });
  for (const n of clone.querySelectorAll(CHROME_REMOVE)) n.remove();
  for (const n of clone.querySelectorAll(CHROME_HIDE)) n.style.visibility = "hidden";
  await inlineImages(clone, box, dpr);

  const root = document.createElement("div");
  for (const { name, value } of document.body.attributes) {
    if (name !== "class" && name !== "style") root.setAttribute(name, value);
  }
  root.setAttribute("data-theme", document.documentElement.dataset.theme || "light");
  root.setAttribute("class", `rip-root ${document.body.className}`);
  const width = document.documentElement.clientWidth;
  root.setAttribute(
    "style",
    `position:absolute;left:${-scrollX - box.x}px;top:${-scrollY - box.y}px;width:${width}px;` +
      `${document.documentElement.getAttribute("style") || ""};--pull-y:0px;margin:0;`
  );
  const style = document.createElement("style");
  style.textContent = captureCss();
  root.append(style, ...clone.childNodes);

  const frame = document.createElement("div");
  frame.setAttribute(
    "style",
    `position:relative;overflow:hidden;width:${box.w}px;height:${box.h}px;background:${getComputedStyle(document.body).backgroundColor}`
  );
  frame.append(root);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">` +
    `<foreignObject x="0" y="0" width="${box.w}" height="${box.h}">` +
    new XMLSerializer().serializeToString(frame) +
    "</foreignObject></svg>";
  // A data URI, not a blob URL: a foreignObject drawn from a blob taints
  // the canvas, from a data URI (an opaque origin) it does not.
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${svg.replace(/%/g, "%25").replace(/#/g, "%23")}`;
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = Math.round(box.w * dpr);
  cv.height = Math.round(box.h * dpr);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

/** A capture the browser declined to draw comes back as one flat colour. */
function isBlank(page) {
  try {
    const t = document.createElement("canvas");
    t.width = t.height = 32;
    const c = t.getContext("2d", { willReadFrequently: true });
    c.drawImage(page, 0, 0, 32, 32);
    const d = c.getImageData(0, 0, 32, 32).data;
    for (let i = 4; i < d.length; i += 4) {
      if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function program(gl) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    console.warn("ripple:", gl.getShaderInfoLog(s));
    return null;
  };
  const vs = compile(gl.VERTEX_SHADER, RIP_VERT);
  const fs = compile(gl.FRAGMENT_SHADER, RIP_FRAG);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

/* —— The ripple ———————————————————————————————————————————————————— */

let running = false;

function wanted() {
  return !reducedMotion() && S.rippleOn !== false && document.visibilityState === "visible";
}

/* The canvas, its WebGL context and the compiled shader are made once and
 * kept: a context and a compile cost the first ripple a tenth of a second
 * or more, which mid-drag would be a visible stutter. Between ripples the
 * canvas simply is not in the page. */
let kit = null;

function glKit() {
  if (kit && !kit.gl.isContextLost()) return kit;
  kit = null;
  const cv = document.createElement("canvas");
  cv.className = "rip-canvas";
  cv.setAttribute("aria-hidden", "true");
  const gl = cv.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  const prog = program(gl);
  if (!prog) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const u = {};
  for (const n of ["uPage", "uRes", "uTexOrigin", "uTexSize", "uOrigin", "uTime", "uAmplitude", "uFrequency", "uDecay", "uSpeed"]) {
    u[n] = gl.getUniformLocation(prog, n);
  }
  gl.uniform1i(u.uPage, 0);
  gl.uniform1f(u.uAmplitude, RIP.amp);
  gl.uniform1f(u.uFrequency, RIP.freq);
  gl.uniform1f(u.uDecay, RIP.decay);
  gl.uniform1f(u.uSpeed, RIP.speed);
  kit = { cv, gl, u };
  return kit;
}

/** Make the canvas and compile the shader ahead, while the app is idle. */
export function warmRipple() {
  if (!reducedMotion()) glKit();
}

/**
 * Photograph the page and run one wave out from the header over it.
 * `settle` waits for the page to finish loading first (the opening one);
 * `follow` makes the picture move with the page while a pull drags it
 * down and springs it back, so the wave can start under the finger.
 * Nothing here can leave the page worse than it found it: any failure —
 * no WebGL, a capture the browser would not draw — just means no ripple.
 */
export async function playRipple({ settle = false, intro = false, follow = false } = {}) {
  if (running || !wanted()) return;
  // The opening ripple is a greeting, not something to wait for: once
  // someone has started using the app it stays out of their way rather
  // than photographing the page under their finger.
  if (intro && touchedSinceOpen) return;
  running = true;
  let cv = null;
  const quitEvents = ["wheel", "touchstart", "keydown", "pointerdown", "resize"];
  let quit = null;
  try {
    if (settle) await settled(captureBox(rippleArea()), performance.now() + RIP.wait);
    if (!wanted() || (intro && touchedSinceOpen)) return;

    const k = glKit();
    if (!k) return;
    const { gl, u } = k;
    cv = k.cv;
    const area = rippleArea();
    const box = captureBox(area);
    const o = origin();

    const cap = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let dpr = Math.min(devicePixelRatio || 1, 2);
    while (dpr > 0.5 && (box.w * dpr > cap || box.h * dpr > cap)) dpr /= 2;

    const scrollAt = scrollY;
    const page = await capture(box, dpr);
    // The page moved or changed size while it was being photographed.
    if (Math.abs(scrollY - scrollAt) > 2 || document.documentElement.clientWidth !== area.w) return;
    if (isBlank(page)) {
      console.warn("ripple: the capture came back empty");
      return;
    }

    cv.width = Math.round(area.w * dpr);
    cv.height = Math.round(area.h * dpr);
    cv.style.top = `${area.top}px`;
    cv.style.height = `${area.h}px`;
    cv.classList.toggle("pull-follow", follow);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, page);
    gl.viewport(0, 0, cv.width, cv.height);
    // Everything in the canvas's own space: its top left is (0, area.top).
    gl.uniform2f(u.uRes, area.w, area.h);
    gl.uniform2f(u.uTexOrigin, box.x, box.y - area.top);
    gl.uniform2f(u.uTexSize, box.w, box.h);
    gl.uniform2f(u.uOrigin, o.x, o.y - area.top);
    gl.uniform1f(u.uTime, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    document.body.append(cv);
    await frames(1);
    cv.classList.add("on");

    const t0 = performance.now();
    let endAt = t0 + RIP.dur;
    quit = () => {
      endAt = Math.min(endAt, performance.now() + RIP.fade);
    };
    for (const e of quitEvents) addEventListener(e, quit, { passive: true, once: true });
    await new Promise((done) => {
      const frame = (now) => {
        if (now >= endAt) return done();
        gl.uniform1f(u.uTime, (now - t0) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (now > endAt - RIP.fade) cv.classList.remove("on");
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  } catch (err) {
    console.warn("ripple:", err);
  } finally {
    if (quit) for (const e of quitEvents) removeEventListener(e, quit);
    if (cv) {
      cv.remove();
      cv.classList.remove("on", "pull-follow");
    }
    running = false;
  }
}

/** Set by the first tap, scroll or key after opening. */
let touchedSinceOpen = false;

/** The opening ripple, once the first real page is drawn; again when the
 * browser restores the app from its back/forward cache. Skipped if the
 * app is already being used by the time the page has settled. */
export function armRipple(ready) {
  const touched = () => (touchedSinceOpen = true);
  const listen = () => {
    touchedSinceOpen = false;
    for (const e of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      addEventListener(e, touched, { passive: true, once: true, capture: true });
    }
  };
  listen();
  Promise.resolve(ready)
    .then(() => frames(2))
    .then(() => playRipple({ settle: true, intro: true }));
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    listen();
    frames(2).then(() => playRipple({ settle: true, intro: true }));
  });
}
