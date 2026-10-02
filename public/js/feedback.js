/**
 * Feedback: a short note from whoever is using the app, sent to the
 * server on t3lluz.com and read in the feedback hub there.
 *
 * The form lives in its own <dialog>, outside the Settings page. Settings
 * is repainted on every beat, and a textarea inside it would lose what
 * someone was halfway through typing. What they wrote is kept if they
 * close the dialog without sending, and cleared once it has gone.
 */
import {
  S,
  APP_VERSION_LABEL,
  FEEDBACK_URL,
  t,
  icon,
  escapeHtml,
} from "./core.js?v=dev";
import { toast, hapticTick } from "./ui.js?v=dev";

const NAME_KEY = "cinemaInfoFeedbackName";
const KINDS = ["bug", "idea", "other"];

let dialog = null;
let draft = { kind: "bug", message: "" };
let sending = false;

export function feedbackAvailable() {
  return Boolean(FEEDBACK_URL);
}

function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}

function siteOf() {
  if (location.hostname === "t3lluz.com") return "t3lluz";
  if (location.hostname.endsWith("github.io")) return "pages";
  return "local";
}

/** What helps place a bug report, and nothing that names anyone. */
function context() {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  return {
    version: APP_VERSION_LABEL,
    site: siteOf(),
    tab: S.activeTab,
    day: S.selectedDay,
    lang: S.lang,
    theme: S.theme,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    standalone: standalone ? "yes" : "no",
    ua: navigator.userAgent,
  };
}

function markup() {
  const kinds = {
    bug: t("feedbackKindBug"),
    idea: t("feedbackKindIdea"),
    other: t("feedbackKindOther"),
  };
  return `<form class="fb-panel" novalidate>
    <header class="fb-head">
      <span class="fb-icon">${icon("chat")}</span>
      <div class="fb-titles">
        <h2 class="fb-title" id="fbTitle">${escapeHtml(t("feedbackTitle"))}</h2>
        <p class="fb-sub">${escapeHtml(t("feedbackSub"))}</p>
      </div>
      <button type="button" class="fb-close" data-fb="close" aria-label="${escapeHtml(t("sheetClose"))}">${icon("close")}</button>
    </header>
    <div class="fb-kinds" role="radiogroup" aria-label="${escapeHtml(t("feedbackKindLabel"))}">
      ${KINDS.map(
        (k) =>
          `<button type="button" class="fb-kind" role="radio" data-kind="${k}" aria-checked="${draft.kind === k}">${escapeHtml(
            kinds[k]
          )}</button>`
      ).join("")}
    </div>
    <textarea class="fb-text" name="message" rows="5" maxlength="4000" required
      aria-label="${escapeHtml(t("feedbackTitle"))}"
      placeholder="${escapeHtml(t("feedbackPlaceholder"))}"></textarea>
    <input class="fb-name" name="name" type="text" maxlength="80" autocomplete="name"
      aria-label="${escapeHtml(t("feedbackName"))}" placeholder="${escapeHtml(t("feedbackName"))}">
    <input class="fb-hp" name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
    <p class="fb-note">${escapeHtml(t("feedbackNote"))}</p>
    <p class="fb-msg" role="status" aria-live="polite"></p>
    <div class="fb-actions">
      <button type="button" class="btn" data-fb="close">${escapeHtml(t("feedbackCancel"))}</button>
      <button type="submit" class="btn btn-primary" data-fb="send">${escapeHtml(t("feedbackSend"))}</button>
    </div>
  </form>`;
}

function setMessage(text, kind = "") {
  const el = dialog?.querySelector(".fb-msg");
  if (!el) return;
  el.textContent = text;
  el.className = `fb-msg${kind ? ` is-${kind}` : ""}`;
}

function setSending(on) {
  sending = on;
  const btn = dialog?.querySelector('[data-fb="send"]');
  if (!btn) return;
  btn.disabled = on;
  btn.textContent = t(on ? "feedbackSending" : "feedbackSend");
}

function closeDialog() {
  if (!dialog?.open) return;
  draft.message = dialog.querySelector(".fb-text")?.value || "";
  dialog.classList.add("is-leaving");
  setTimeout(() => {
    dialog.classList.remove("is-leaving");
    dialog.close();
  }, 180);
}

async function send() {
  if (sending) return;
  const form = dialog.querySelector("form");
  const message = form.message.value.trim();
  if (message.length < 3) {
    setMessage(t("feedbackEmpty"), "err");
    form.message.focus();
    return;
  }
  const name = form.name.value.trim();
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode: the name is just not remembered.
  }

  setSending(true);
  setMessage("");
  let res;
  try {
    res = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: draft.kind,
        message,
        name,
        website: form.website.value,
        context: context(),
      }),
    });
  } catch {
    res = null;
  }
  setSending(false);

  if (res?.ok) {
    draft = { kind: draft.kind, message: "" };
    form.message.value = "";
    hapticTick("medium");
    closeDialog();
    toast(t("feedbackThanks"));
    return;
  }
  setMessage(t(res?.status === 429 ? "feedbackRate" : "feedbackError"), "err");
}

/** Open the form, rebuilt in the current language with the draft back in. */
export function openFeedback() {
  if (!feedbackAvailable()) return;
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "fb";
    dialog.setAttribute("aria-labelledby", "fbTitle");
    document.body.append(dialog);
    wire(dialog);
  }
  dialog.innerHTML = markup();
  dialog.querySelector(".fb-text").value = draft.message;
  dialog.querySelector(".fb-name").value = savedName();
  setSending(false);
  dialog.showModal();
  // Phones: let the keyboard come up on purpose, not on open.
  if (window.matchMedia("(hover: hover)").matches) dialog.querySelector(".fb-text").focus();
}

function wire(el) {
  el.addEventListener("click", (e) => {
    // A tap on the backdrop lands on the dialog element itself.
    if (e.target === el) {
      closeDialog();
      return;
    }
    const kind = e.target.closest("[data-kind]");
    if (kind) {
      draft.kind = kind.dataset.kind;
      for (const b of el.querySelectorAll("[data-kind]")) {
        b.setAttribute("aria-checked", String(b === kind));
      }
      hapticTick("light");
      return;
    }
    if (e.target.closest('[data-fb="close"]')) closeDialog();
  });
  el.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
  el.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialog();
  });
  el.addEventListener("input", (e) => {
    if (e.target.classList?.contains("fb-text")) {
      draft.message = e.target.value;
      if (e.target.value.trim().length >= 3) setMessage("");
    }
  });
}
