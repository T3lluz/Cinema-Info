/**
 * Settings: language and theme, the seat map's numbers, the device
 * (haptics, keeping the screen on), the DX admissions bridge with a
 * one-tap diagnosis, and the app itself — install, version, updates.
 */
import {
  S,
  els,
  hooks,
  APP_VERSION,
  t,
  icon,
  escapeHtml,
  formatClock,
  shortDayLabel,
  toDayKey,
  savePrefs,
} from "./core.js?v=dev";
import { syncScanned, runDxScanDiagnostics, resetScanDone } from "./data.js?v=dev";
import { paint, viewHead, hapticTick, toast, SEG_IND, syncSegs } from "./ui.js?v=dev";
import { paintSeatChart, seatChartExpanded } from "./seats.js?v=dev";

/** The last DX test, kept so a redraw does not wipe the verdict. */
let dxTest = null;
let dxBusy = "";

function row(iconName, title, hint, control, { stack = false, attrs = "" } = {}) {
  return `<div class="row${stack ? " is-stack" : ""}" ${attrs}>
    <span class="row-icon">${icon(iconName)}</span>
    <span class="row-text">
      <span class="row-title">${escapeHtml(title)}</span>
      ${hint ? `<span class="row-hint">${escapeHtml(hint)}</span>` : ""}
    </span>
    ${control ? `<span class="row-control">${control}</span>` : ""}
  </div>`;
}

function seg(name, options, value) {
  return `<span class="seg" role="radiogroup" aria-label="${escapeHtml(t(name))}">${SEG_IND}${options
    .map(
      ([v, label]) =>
        `<button type="button" class="seg-btn" role="radio" aria-checked="${v === value}" data-set="${name}" data-value="${v}">${escapeHtml(
          label
        )}</button>`
    )
    .join("")}</span>`;
}

function toggle(name, on, label) {
  return `<button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(
    label
  )}" data-toggle="${name}"><span class="switch-knob"></span></button>`;
}

function dxFacts() {
  const shows = (S.state?.shows || []).filter((s) => s.eventId);
  const withScan = shows.filter((s) => s.scanned != null).length;
  const synced = S.dxScanStatus.at ? formatClock(new Date(S.dxScanStatus.at)) : t("dxNeverSynced");
  return [
    [t("dxSourceLabel"), S.dxScanStatus.source || "app.dx.no"],
    [t("dxSyncedLabel"), synced],
    [t("dxCoverageLabel"), t("dxCoverageValue", { n: withScan, total: shows.length })],
  ];
}

function programFetched() {
  const at = S.state?.updatedAt ? new Date(S.state.updatedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return "–";
  return `${shortDayLabel(toDayKey(at))} ${formatClock(at)}`;
}

export function renderSettings() {
  const host = els.settingsContent;
  if (!host) return;
  const bridgeDown = Boolean(S.dxScanStatus.error);
  const install = hooks.installState();
  const wakeSupported = "wakeLock" in navigator;

  const installRow =
    install === "available"
      ? row("download", t("installApp"), t("installHint"), `<button type="button" class="btn btn-sm btn-primary" data-action="install">${escapeHtml(t("installApp"))}</button>`)
      : install === "ios"
        ? row("download", t("installApp"), t("installIos"))
        : install === "installed"
          ? row("check", t("installed"), "")
          : "";

  const testMsg = dxTest
    ? `<p class="dx-msg ${dxTest.ok ? "is-ok" : "is-err"}">${escapeHtml(dxTest.text)}</p>${
        dxTest.details
          ? `<details class="dx-details"><summary>${escapeHtml(t("dxDetails"))}</summary><pre>${escapeHtml(
              dxTest.details
            )}</pre></details>`
          : ""
      }`
    : "";

  paint(
    host,
    `${viewHead(t("settingsTitle"), t("settingsSub"))}
    <div class="settings-grid">
      <div class="settings-col">
        <section class="group">
          <h2 class="group-label">${escapeHtml(t("groupLook"))}</h2>
          <div class="card list">
            ${row("language", t("language"), "", seg("language", [["nb", t("langNb")], ["en", t("langEn")]], S.lang))}
            ${row(
              "theme",
              t("theme"),
              "",
              seg("theme", [["light", t("themeLight")], ["dark", t("themeDark")], ["system", t("themeSystem")]], S.theme)
            )}
          </div>
        </section>

        <section class="group">
          <h2 class="group-label">${escapeHtml(t("groupSeats"))}</h2>
          <div class="card list">
            ${row("seats", t("seatNumbers"), t("seatNumbersHint"), toggle("seatNumbers", S.showSeatNumbers, t("seatNumbers")), {
              attrs: 'data-row-toggle="seatNumbers"',
            })}
          </div>
        </section>

        <section class="group">
          <h2 class="group-label">${escapeHtml(t("groupDevice"))}</h2>
          <div class="card list">
            ${row("haptics", t("haptics"), t("hapticsHint"), toggle("haptics", S.hapticsOn, t("haptics")), {
              attrs: 'data-row-toggle="haptics"',
            })}
            ${
              wakeSupported
                ? row("sun", t("keepAwake"), t("keepAwakeHint"), toggle("keepAwake", S.keepAwake, t("keepAwake")), {
                    attrs: 'data-row-toggle="keepAwake"',
                  })
                : ""
            }
          </div>
        </section>
      </div>

      <div class="settings-col">
        <section class="group">
          <div class="group-head">
            <h2 class="group-label">${escapeHtml(t("dxTitle"))}</h2>
            <span class="pill ${bridgeDown ? "pill-bad" : "pill-ok"}"><span class="dot"></span>${escapeHtml(
              t(bridgeDown ? "dxChipOff" : "dxChipOn")
            )}</span>
          </div>
          <div class="card dx-card">
            <p class="dx-sub">${escapeHtml(t("dxSubtitle"))}</p>
            <dl class="facts compact">${dxFacts()
              .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`)
              .join("")}</dl>
            ${testMsg}
            <div class="btn-row">
              <button type="button" class="btn" data-action="dx-refresh" ${dxBusy ? "disabled" : ""}>${icon("refresh", "icon icon-sm")}${escapeHtml(
                dxBusy === "refresh" ? t("dxRefreshing") : t("dxRefreshScans")
              )}</button>
              <button type="button" class="btn" data-action="dx-test" ${dxBusy ? "disabled" : ""}>${icon("link", "icon icon-sm")}${escapeHtml(
                dxBusy === "test" ? t("dxTesting") : t("dxTest")
              )}</button>
            </div>
          </div>
        </section>

        <section class="group">
          <h2 class="group-label">${escapeHtml(t("groupApp"))}</h2>
          <div class="card list">
            ${installRow}
            ${row(
              "info",
              t("version"),
              APP_VERSION,
              `<button type="button" class="btn btn-sm" data-action="update">${escapeHtml(t("checkUpdate"))}</button>`
            )}
            ${row("day", t("programUpdated"), programFetched())}
          </div>
          <p class="group-foot hide-touch">${escapeHtml(t("shortcutsHint"))}</p>
        </section>
      </div>
    </div>`
  );
  syncSegs(host);
}

async function runDxTest() {
  dxBusy = "test";
  renderSettings();
  let result;
  try {
    result = await runDxScanDiagnostics();
  } catch (err) {
    result = { code: "empty", details: String(err?.message || err) };
  }
  const title = result.show ? `${result.show.title} ${formatClock(result.show.start)}` : "";
  dxTest = {
    ok: result.code === "ok",
    text:
      result.code === "ok"
        ? t("dxTestOk", { n: result.scanned, show: title })
        : result.code === "noShows"
          ? t("dxTestNoShows")
          : result.code === "auth"
            ? t("dxTestAuth")
            : t("dxTestEmpty", { show: title }),
    details: result.details || "",
  };
  dxBusy = "";
  renderSettings();
}

function setToggle(name) {
  if (name === "seatNumbers") {
    S.showSeatNumbers = !S.showSeatNumbers;
    for (const show of S.state?.shows || []) if (seatChartExpanded(show)) paintSeatChart(show);
  } else if (name === "haptics") {
    S.hapticsOn = !S.hapticsOn;
    if (S.hapticsOn) hapticTick();
  } else if (name === "keepAwake") {
    S.keepAwake = !S.keepAwake;
    hooks.applyWakeLock();
  }
  savePrefs();
  renderSettings();
}

export function setupSettings() {
  const host = els.settingsContent;
  host?.addEventListener("click", async (e) => {
    const setBtn = e.target.closest("[data-set]");
    if (setBtn) {
      const value = setBtn.dataset.value;
      if (setBtn.dataset.set === "language" && value !== S.lang) {
        S.lang = value === "en" ? "en" : "nb";
        savePrefs();
        hooks.languageChanged();
      } else if (setBtn.dataset.set === "theme" && value !== S.theme) {
        hooks.applyTheme(value);
        savePrefs();
        renderSettings();
      }
      return;
    }
    const sw = e.target.closest("[data-toggle]");
    if (sw) {
      setToggle(sw.dataset.toggle);
      return;
    }
    const rowToggle = e.target.closest("[data-row-toggle]");
    if (rowToggle && !e.target.closest("button, a")) {
      setToggle(rowToggle.dataset.rowToggle);
      return;
    }
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "dx-test") runDxTest();
    else if (action === "dx-refresh") {
      dxBusy = "refresh";
      renderSettings();
      resetScanDone();
      try {
        await syncScanned({ force: true });
      } finally {
        dxBusy = "";
        renderSettings();
      }
    } else if (action === "install") {
      hooks.install();
    } else if (action === "update") {
      const btn = e.target.closest("[data-action]");
      btn.disabled = true;
      btn.textContent = t("checkingUpdate");
      const found = await hooks.checkUpdate();
      if (!found) toast(t("upToDate"));
      renderSettings();
    }
  });
}
