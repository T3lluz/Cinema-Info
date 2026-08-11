const DATA_URL = "./data/program.json";
const PREFS_KEY = "cinemaInfoPrefs";
const HISTORY_KEY = "cinemaInfoHistory";
const DX_AUTH_KEY = "cinemaInfoDxAuth";
const SEAT_MAP_KEY = "cinemaInfoSeatMaps";
const HISTORY_KEEP_DAYS = 120;
const DX_PARTNER_ID = "202";
const DX_API = "https://api.dx.no/v3";
const DX_LOGIN_PROXY =
  "https://kypeegsbfaivyqeidnqp.supabase.co/functions/v1/dx-web-login";
const DX_LOGIN_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5cGVlZ3NiZmFpdnlxZWlkbnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxODczMzQsImV4cCI6MjEwMDc2MzMzNH0.xUuL6dC8u_Nm6DqxS0y4KyjpMNlVn6IrxcvivSHeaaM";

/** How many events one check-in lookup asks the bridge about at a time. */
const SCAN_BATCH = 12;

/**
 * The app's heartbeat. Every few seconds it redraws whatever the clock
 * has moved and re-reads every figure that has come due, so a screen
 * left open at the box office is never more than a beat behind the till
 * and nobody has to reach for the refresh button.
 */
const BEAT_MS = 5 * 1000;
/**
 * Freshness for anything that rides the beat — a shade under it, so a
 * timer firing a millisecond early does not make a figure sit out a
 * whole beat waiting to be a full five seconds old.
 */
const BEAT_FRESH_MS = 4 * 1000;
/**
 * At most this many event lookups leave on one beat, which puts a hard
 * ceiling on what the app asks of DX however much is on screen: a
 * Movies tab listing every showtime in the programme must not turn into
 * a request a second forever. It comfortably covers a day — Buen rarely
 * programmes more than six showings — and beyond that the urgent ones
 * go first and the rest come round on the following beats.
 */
const BEAT_MAX_EVENTS = 8;

/**
 * Doors are busiest around the showing itself: from this long before it
 * starts until this long after it ends, guests are arriving and tickets
 * are being scanned, so check-in counts and seat charts ride the beat.
 */
const DOOR_BEFORE_MS = 15 * 60 * 1000;
const DOOR_AFTER_MS = 15 * 60 * 1000;

/**
 * A showing further off than this has nothing moving worth a beat: no
 * one is at its door, and its sold count creeps rather than runs.
 * Inside it, both ride the beat whether or not it is on screen — the
 * day totals and the statistics are built from those numbers too.
 */
const ACTIVE_LEAD_MS = 4 * 60 * 60 * 1000;

/** After this long past the end time a showing's numbers are final. */
const FINAL_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * A sold count off screen and hours from its doors is still live, just
 * on a calmer cycle: a showing next week gains a ticket every few
 * hours, not every few seconds, and there are a lot of them.
 */
const LIVE_CALM_MS = 2 * 60 * 1000;

/**
 * Check-in counts and seat charts once the doors are shut. Nobody is
 * being scanned, but seats do keep selling, so a chart left open on a
 * showing later in the week still keeps up — just not beat by beat.
 */
const DOOR_CALM_MS = 45 * 1000;

/**
 * How long the program snapshot is trusted before it is read again. It
 * is the whole schedule in one file and a twice-daily job writes it, so
 * it is worth a look now and then rather than every beat.
 */
const PROGRAM_RECHECK_MS = 2 * 60 * 1000;
/** Hall geometry only changes when someone rebuilds an auditorium. */
const SEAT_LAYOUT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Bumped when the layout shape changes, so cached halls are refetched
 * (v2: blocked seats are included and flagged instead of dropped). */
const SEAT_LAYOUT_VERSION = 2;

/** Example scanned counts for UI preview (`?previewScanned=1`). */
const PREVIEW_SCANNED = new URLSearchParams(location.search).has(
  "previewScanned"
);

const I18N = {
  nb: {
    "nav.day": "Dager",
    "nav.movies": "Filmer",
    "nav.stats": "Statistikk",
    "nav.settings": "Innstillinger",
    loading: "Henter program…",
    refresh: "Oppdater",
    emptyDay: "Ingen filmer for valgt dag.",
    gap: "{n} min pause",
    now: "Nå",
    soon: "Snart",
    done: "Ferdig",
    doneCount: "{n}/{total} ferdig",
    dayAllDone: "Dagen er ferdig",
    sold: "solgt",
    error: "Feil",
    retry: "Prøv igjen",
    loadError: "Kunne ikke hente programmet.",
    updated: "Oppdatert {time}",
    liveAt: "Live {time}",
    showsOne: "1 forestilling",
    showsMany: "{n} forestillinger",
    ongoing: "pågår",
    soldOut: "Utsolgt",
    fewLeft: "{n} igjen",
    reservedShort: "{n} res.",
    admitAllIn: "Alle inne",
    admitMissing: "{n} mangler",
    admitNoShow: "{n} møtte ikke",
    admitNone: "Ingen inne ennå",
    admitNobodyCame: "Ingen skannet",
    admitUnknown: "Ingen skann-data",
    admitAria: "Innslipp: {n} av {total} billetter skannet",
    seatMapLabel: "Salkart",
    seatMapOpen: "Vis salkart for {title} {time}",
    seatMapHint: "{sold} av {capacity} plasser",
    seatMapLoading: "Henter salkart…",
    seatMapError: "Kunne ikke hente salkartet.",
    seatMapNone: "Ingen salkart for denne salen.",
    seatMapFree: "Fri plassering — ingen nummererte plasser.",
    seatMapRetry: "Prøv igjen",
    seatScreen: "Lerret",
    seatFree: "Ledig",
    seatSold: "Solgt",
    seatWaiting: "Ikke skannet",
    seatIn: "Inne",
    seatReserved: "Reservert",
    seatBlocked: "Stengt",
    seatUnseated: "{n} uten fast plass",
    seatPicked: "Rad {row} · Plass {seat} — {state}",
    seatAria:
      "Salkart for {screen}: {sold} av {capacity} plasser solgt, {scanned} skannet inn.",
    today: "I dag",
    jumpTodayAria: "Gå til i dag",
    tlExpand: "Vis detaljer",
    tlCollapse: "Skjul detaljer",
    yesterday: "I går",
    tomorrow: "I morgen",
    dayTab: "{weekday} {d}.{m}",
    dayFull: "{weekday} {d}. {month}",
    moviesTitle: "Filmer",
    moviesSubtitle: "Alle tider, neste visning først",
    moviesCount: "{n} filmer",
    moviesMore: "+{n} flere",
    moviesDoneMore: "{n} ferdig",
    moviesNoDone: "Ingen tidligere visninger",
    moviesDonePanel: "Ferdig",
    moviesUpcomingPanel: "Kommende",
    moviesBack: "Tilbake",
    noMovies: "Ingen filmer i programmet.",
    statsTitle: "Statistikk",
    statsSubtitle: "Solgte billetter, live",
    soldWeekLabel: "Solgt denne uken",
    periodTotal: "{n} totalt i perioden",
    soldAvgDay: "Snitt per dag",
    soldBestDay: "Beste dag",
    soldByDay: "Denne uken",
    soldByWeek: "Solgt per uke",
    topSold: "Mest solgte filmer",
    weekLabel: "Uke {n}",
    tickets: "billetter",
    noSoldData: "Ingen salgsdata ennå — trykk oppdater.",
    statsOpenMovie: "Vis {title} under Filmer",
    statsOpenDay: "Vis {day} under Dager",
    settingsTitle: "Innstillinger",
    settingsSubtitle: "Språk, utseende og innslipp",
    prefsSection: "Preferanser",
    language: "Språk",
    languageHint: "Appens språk",
    theme: "Tema",
    themeHint: "Lys, mørk eller Auto",
    themeLight: "Lys",
    themeDark: "Mørk",
    themeSystem: "Auto",
    directorLabel: "Regi",
    ratingImdbAria: "IMDb-vurdering {n} av 10",
    ratingLetterboxdAria: "Letterboxd-vurdering {n} av 5",
    ratingTomatoesAria: "Publikumsscore {n} prosent",
    "showType.Norgespremiere": "Norgespremiere",
    "showType.Dagkino": "Dagkino",
    "showType.Seniorkino": "Seniorkino",
    kinoklubb: "Kinoklubb",
    seatNumbers: "Setenumre",
    seatNumbersHint: "I salkartet",
    seatNumbersOn: "Vis",
    seatNumbersOff: "Skjul",
    tlAlways: "Utvidet tidslinje",
    tlAlwaysHint: "Alltid vis plakat og tittel — uten utvid-knapp",
    langNb: "Norsk",
    langEn: "English",
    spokenNorwegian: "Norsk tale",
    spokenEnglish: "Engelsk tale",
    ageAll: "Tillatt for alle",
    dxTitle: "Innslipp fra DX",
    dxSubtitle:
      "Skannede billetter og setekart hentes automatisk via kinoens felles DX-konto.",
    dxChipOn: "Aktiv",
    dxChipOff: "Utilgjengelig",
    dxConnectedAs: "Koblet via felles konto",
    dxConnectedPat: "Koblet via felles konto",
    dxConnectedHint:
      "Hentes automatisk via kinoens felles konto — ingen egen innlogging.",
    dxNetworkFail: "Fikk ikke kontakt med DX. Sjekk nettforbindelsen.",
    dxSourceLabel: "Kilde",
    dxSyncedLabel: "Sist oppdatert",
    dxCoverageLabel: "Skann-data",
    dxCoverageValue: "{n} av {total} forestillinger",
    dxNeverSynced: "Ikke hentet ennå",
    dxTest: "Test innslipp",
    dxTesting: "Tester…",
    dxRefreshScans: "Hent på nytt",
    dxRefreshing: "Henter…",
    dxTestOk: "OK — DX svarte med {n} skannede billetter for {show}.",
    dxTestEmpty:
      "DX er tilkoblet, men ga ingen skann-tall for {show}. Detaljene under kan sendes videre.",
    dxTestNoShows: "Ingen forestillinger med DX-ID å teste mot ennå.",
    dxTestAuth: "DX-broen klarte ikke å hente økt. Prøv igjen om litt.",
    dxDetails: "Detaljer",
    previewScannedBanner:
      "Forhåndsvisning: skannet-tall er eksempeldata (ikke live fra DX).",
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
    loading: "Loading program…",
    refresh: "Refresh",
    emptyDay: "No movies for the selected day.",
    gap: "{n} min break",
    now: "Now",
    soon: "Soon",
    done: "Done",
    doneCount: "{n}/{total} done",
    dayAllDone: "Day is done",
    sold: "sold",
    error: "Error",
    retry: "Try again",
    loadError: "Could not load the program.",
    updated: "Updated {time}",
    liveAt: "Live {time}",
    showsOne: "1 showing",
    showsMany: "{n} showings",
    ongoing: "playing",
    soldOut: "Sold out",
    fewLeft: "{n} left",
    reservedShort: "{n} res.",
    admitAllIn: "All in",
    admitMissing: "{n} to go",
    admitNoShow: "{n} no-shows",
    admitNone: "None in yet",
    admitNobodyCame: "None scanned",
    admitUnknown: "No scan data",
    admitAria: "Admission: {n} of {total} tickets scanned",
    seatMapLabel: "Seat map",
    seatMapOpen: "Show the seat map for {title} {time}",
    seatMapHint: "{sold} of {capacity} seats",
    seatMapLoading: "Loading seat map…",
    seatMapError: "Could not load the seat map.",
    seatMapNone: "No seat map for this auditorium.",
    seatMapFree: "Free seating — no numbered seats.",
    seatMapRetry: "Try again",
    seatScreen: "Screen",
    seatFree: "Free",
    seatSold: "Sold",
    seatWaiting: "Not scanned",
    seatIn: "Inside",
    seatReserved: "Reserved",
    seatBlocked: "Blocked",
    seatUnseated: "{n} without a seat",
    seatPicked: "Row {row} · Seat {seat} — {state}",
    seatAria:
      "Seat map for {screen}: {sold} of {capacity} seats sold, {scanned} scanned in.",
    today: "Today",
    jumpTodayAria: "Go to today",
    tlExpand: "Show details",
    tlCollapse: "Hide details",
    yesterday: "Yesterday",
    tomorrow: "Tomorrow",
    dayTab: "{weekday} {d}.{m}",
    dayFull: "{weekday} {d} {month}",
    moviesTitle: "Movies",
    moviesSubtitle: "All times, next showing first",
    moviesCount: "{n} movies",
    moviesMore: "+{n} more",
    moviesDoneMore: "{n} done",
    moviesNoDone: "No previous showings",
    moviesDonePanel: "Done",
    moviesUpcomingPanel: "Upcoming",
    moviesBack: "Back",
    noMovies: "No movies in the program.",
    statsTitle: "Stats",
    statsSubtitle: "Tickets sold, live",
    soldWeekLabel: "Sold this week",
    periodTotal: "{n} total for the period",
    soldAvgDay: "Avg per day",
    soldBestDay: "Best day",
    soldByDay: "This week",
    soldByWeek: "Sold by week",
    topSold: "Top sold movies",
    weekLabel: "Week {n}",
    tickets: "tickets",
    noSoldData: "No sales data yet — tap refresh.",
    statsOpenMovie: "Show {title} under Movies",
    statsOpenDay: "Show {day} under Days",
    settingsTitle: "Settings",
    settingsSubtitle: "Language, appearance, and admissions",
    prefsSection: "Preferences",
    language: "Language",
    languageHint: "App language",
    theme: "Theme",
    themeHint: "Light, dark, or Auto",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "Auto",
    directorLabel: "Director",
    ratingImdbAria: "IMDb rating {n} out of 10",
    ratingLetterboxdAria: "Letterboxd rating {n} out of 5",
    ratingTomatoesAria: "Audience score {n} percent",
    "showType.Norgespremiere": "Norway premiere",
    "showType.Dagkino": "Daytime cinema",
    "showType.Seniorkino": "Senior cinema",
    kinoklubb: "Film club",
    seatNumbers: "Seat numbers",
    seatNumbersHint: "On the seat map",
    seatNumbersOn: "Show",
    seatNumbersOff: "Hide",
    tlAlways: "Expanded timeline",
    tlAlwaysHint: "Always show poster and title — no expand button",
    langNb: "Norsk",
    langEn: "English",
    spokenNorwegian: "Norwegian",
    spokenEnglish: "English",
    ageAll: "All ages",
    dxTitle: "Admissions from DX",
    dxSubtitle:
      "Scanned tickets and seat maps are fetched automatically through the cinema’s shared DX account.",
    dxChipOn: "Active",
    dxChipOff: "Unavailable",
    dxConnectedAs: "Connected via shared account",
    dxConnectedPat: "Connected via shared account",
    dxConnectedHint:
      "Fetched automatically through the cinema’s shared account — no personal login.",
    dxNetworkFail: "Could not reach DX. Check your connection.",
    dxSourceLabel: "Source",
    dxSyncedLabel: "Last updated",
    dxCoverageLabel: "Scan data",
    dxCoverageValue: "{n} of {total} showings",
    dxNeverSynced: "Not fetched yet",
    dxTest: "Test admissions",
    dxTesting: "Testing…",
    dxRefreshScans: "Fetch again",
    dxRefreshing: "Fetching…",
    dxTestOk: "OK — DX returned {n} scanned tickets for {show}.",
    dxTestEmpty:
      "DX is connected, but returned no scan numbers for {show}. The details below can be passed on.",
    dxTestNoShows: "No showings with a DX id to test against yet.",
    dxTestAuth: "The DX bridge could not open a session. Try again in a moment.",
    dxDetails: "Details",
    previewScannedBanner:
      "Preview: scanned counts are sample data (not live from DX).",
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

/**
 * The app's glyph set, in one place so the same idea is always drawn the
 * same way: a film is a clapperboard wherever it appears, a hall is a
 * seat plan, a week is a date range. Paths are 24×24 and filled with
 * `currentColor`, matching the tab bar in index.html.
 */
const ICONS = {
  day: "M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 16H5V10h14v10Zm0-12H5V6h14v2ZM7 12h5v5H7v-5Z",
  movie:
    "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4Z",
  stats: "M5 9.2h3V19H5V9.2ZM10.6 5h2.8v14h-2.8V5Zm5.6 8H19v6h-2.8v-6Z",
  settings:
    "M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54A.49.49 0 0 0 13.9 2h-3.8a.49.49 0 0 0-.48.41l-.36 2.54c-.6.24-1.14.55-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L2.73 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.24.24.41.48.41h3.8c.24 0 .44-.17.49-.41l.36-2.54c.6-.24 1.14-.55 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z",
  week: "M9 11H7v2h2v-2Zm4 0h-2v2h2v-2Zm4 0h-2v2h2v-2Zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 16H5V9h14v11Z",
  trophy:
    "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1a5 5 0 0 0 4.39 4.94A5.01 5.01 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1a5.01 5.01 0 0 0 3.61-3.96A5 5 0 0 0 21 8V7c0-1.1-.9-2-2-2ZM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8Zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1Z",
  language:
    "m12.87 15.07-2.54-2.51.03-.03A17.5 17.5 0 0 0 14.07 6H17V4h-7V2H8v2H1v1.99h11.17A15.4 15.4 0 0 1 9 11.35 15.6 15.6 0 0 1 6.69 8h-2a17.6 17.6 0 0 0 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04ZM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12Zm-2.62 7 1.62-4.33L19.12 17h-3.24Z",
  theme:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 18V4a8 8 0 0 1 0 16Z",
  account:
    "M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65ZM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z",
  // A hall seen from above: the screen, then rows of seats.
  seats:
    "M4 3.6h16a1.1 1.1 0 0 1 0 2.2H4a1.1 1.1 0 0 1 0-2.2ZM3.4 8.6h3.8a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-.9.9H3.4a.9.9 0 0 1-.9-.9V9.5a.9.9 0 0 1 .9-.9Zm6.7 0h3.8a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-.9.9h-3.8a.9.9 0 0 1-.9-.9V9.5a.9.9 0 0 1 .9-.9Zm6.7 0h3.8a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-.9.9h-3.8a.9.9 0 0 1-.9-.9V9.5a.9.9 0 0 1 .9-.9ZM3.4 15h3.8a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-.9.9H3.4a.9.9 0 0 1-.9-.9v-2.2a.9.9 0 0 1 .9-.9Zm6.7 0h3.8a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-.9.9h-3.8a.9.9 0 0 1-.9-.9v-2.2a.9.9 0 0 1 .9-.9Zm6.7 0h3.8a.9.9 0 0 1 .9.9v2.2a.9.9 0 0 1-.9.9h-3.8a.9.9 0 0 1-.9-.9v-2.2a.9.9 0 0 1 .9-.9Z",
  timeline: "M3 5h18v2.4H3V5Zm0 5.8h12v2.4H3v-2.4Zm0 5.8h16v2.4H3v-2.4Z",
};

/** "Nothing here" said the same way everywhere: a faded glyph and a line. */
function emptyNote(iconName, key, className = "empty-note") {
  return `<div class="${className}">${icon(
    iconName,
    "empty-icon"
  )}<p>${escapeHtml(t(key))}</p></div>`;
}

function icon(name, className = "ui-icon") {
  const path = ICONS[name];
  if (!path) return "";
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}" /></svg>`;
}

/** The heading every non-day view opens with: the tab's own icon, the
 * tab's own word, and a line saying what the page holds. */
function viewIntro(iconName, titleKey, subtitleKey, meta = "") {
  return `
    <div class="view-intro">
      <span class="view-intro-icon" aria-hidden="true">${icon(iconName)}</span>
      <div class="view-intro-text">
        <h2>${escapeHtml(t(titleKey))}</h2>
        <p>${escapeHtml(t(subtitleKey))}</p>
      </div>
      ${meta ? `<span class="view-intro-meta">${escapeHtml(meta)}</span>` : ""}
    </div>
  `;
}

const els = {
  content: document.getElementById("content"),
  daySwipe: document.getElementById("daySwipe"),
  dayPanePrev: document.getElementById("dayPanePrev"),
  dayPaneNext: document.getElementById("dayPaneNext"),
  moviesContent: document.getElementById("moviesContent"),
  statsContent: document.getElementById("statsContent"),
  settingsContent: document.getElementById("settingsContent"),
  dayTabs: document.getElementById("dayTabs"),
  dayControls: document.getElementById("dayControls"),
  dayControlsBody: document.querySelector(".day-controls-body"),
  jumpTodayBtn: document.getElementById("jumpTodayBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusText: document.getElementById("statusText"),
  topActions: document.querySelector(".top-actions"),
  timeline: document.getElementById("timeline"),
  timelineMain: document.getElementById("timelineMain"),
  timelineExpandBtn: document.getElementById("timelineExpandBtn"),
  views: {
    day: document.getElementById("view-day"),
    movies: document.getElementById("view-movies"),
    stats: document.getElementById("view-stats"),
    settings: document.getElementById("view-settings"),
  },
};

const TAB_ORDER = ["day", "movies", "stats", "settings"];

const TAB_ANIM_CLASSES = [
  "tab-in-right",
  "tab-in-left",
  "tab-ghost",
  "tab-out-right",
  "tab-out-left",
];

/** Undo hook for an in-flight tab slide, so a new switch can start clean. */
let tabAnimCleanup = null;

/** @type {{ shows: any[], updatedAt?: string } | null} */
let state = null;
let selectedDay = "";
let enrichToken = 0;
let activeTab = "day";
let lang = "nb";
/** "light" | "dark" | "system" — "system" follows the device. */
let theme = "system";
const DARK_MQ = window.matchMedia("(prefers-color-scheme: dark)");
/** Digits painted on each seat square in the hall chart. */
let showSeatNumbers = true;
/** When on, the header timeline stays in the rich expanded layout. */
let timelineAlwaysExpanded = false;
let enrichedAll = false;
let lastLiveAt = 0;
/** When the program snapshot was last read, so a long-open tab re-reads it. */
let lastProgramAt = 0;
/** @type {null | { type: 'dxapi'|'pat'|'session'|'auth0'|'dxweb', token: string, scheme?: string, email?: string, partnerId?: string, connectedAt?: string, refreshToken?: string }} */
let dxAuth = loadDxAuth();
/** Last outcome of syncing check-in counts, surfaced under Settings → DX. */
let dxScanStatus = { at: 0, source: "", error: "" };
/** Guards against two check-in syncs racing over the same shows. */
let scanSyncRunning = false;
/** Hall geometry by `partnerId:locationId`, kept between visits. */
let seatLayouts = loadSeatLayouts();
/** Which hall a screen name turned out to be, so repeat looks skip the layout. */
const seatHalls = new Map();
/** Per-event seat state: `{ status, at, error, ...bridge payload }`. */
const seatCharts = new Map();
/** Shows whose seat chart the visitor unfolded by hand. */
const openSeatCharts = new Set();
/** Movie titles with the finished-showings dropdown open. */
const expandedMovieDone = new Set();
/** Movie titles with the extra-upcoming dropdown open. */
const expandedMovieUpcoming = new Set();
/** Collapsed movie tiles show this many showings before "+N more". */
const MOVIE_SHOWS_PREVIEW = 3;
/** Tablet and desktop have room for every hall at once, so charts there
 * are unfolded from the start instead of hiding behind a button. */
const SEATS_OPEN_MQ = window.matchMedia("(min-width: 700px)");
/** Wider viewports get half-hour ticks on the header timeline. */
const TL_WIDE_MQ = window.matchMedia("(min-width: 700px)");
/** Narrow viewports scroll the timeline sideways so hours stay readable. */
const TL_SCROLL_MQ = window.matchMedia("(max-width: 859px)");
/** Desktop with a real hover pointer expands the timeline on hover. */
const TL_HOVER_MQ = window.matchMedia("(min-width: 860px) and (hover: hover)");
const HALF_HOUR = 1_800_000;
/**
 * Phone/tablet scroll density is derived from the day's shortest show so
 * that bar still fits expanded content (poster + title + both clocks).
 * Longer bars scale from the same px-per-hour. Floor keeps compact clocks
 * readable on long-only days; the content target beats the CSS cutoffs
 * that hide poster (<148px content-box ≈ 162px bar) / title (<96px).
 */
const TL_MIN_BAR_PX = 170;
const TL_PX_PER_HOUR_FLOOR = 72;
/** Extra canvas width past the last hour so edge labels/bars aren't clipped. */
const TL_EDGE_PAD_PX = 14;
/** Loads auto-unfolded halls as they scroll into view. */
let seatAutoObserver = null;
/** How many fetches are in flight; the refresh button spins while any are. */
let busyCount = 0;

/** Set by setupDaySwipe: play the swipe slide for a day change that did not
 * come from a gesture. Returns false when it cannot run and the caller
 * should switch day without animating. */
let slideToDay = null;

/**
 * The markup last written into each view.
 *
 * The whole app redraws on every beat, and almost every one of those
 * redraws produces exactly what is already on screen. Writing it anyway
 * would tear the list down and build it again twelve times a minute,
 * taking the visitor's focus, whatever they were hovering and the seat
 * caption with it. So the markup is compared first, and the DOM is only
 * touched when it really has something new to say.
 */
const painted = new WeakMap();

/**
 * Write `html` into `host` if it differs; true when the DOM changed.
 *
 * Rebuilding a view takes the keyboard's place in it along with it, and
 * a redraw arriving every few seconds would make the page impossible to
 * tab through. So whatever was focused is looked up again afterwards, by
 * the attribute that names it.
 */
function paint(host, html) {
  if (painted.get(host) === html) return false;
  painted.set(host, html);
  const focused = focusSelectorWithin(host);
  host.innerHTML = html;
  if (focused) host.querySelector(focused)?.focus({ preventScroll: true });
  return true;
}

/** A selector for the focused element inside `host`, if it names itself. */
function focusSelectorWithin(host) {
  const el = document.activeElement;
  if (!el || el === document.body || !host.contains(el)) return "";
  if (el.id) return `[id="${cssEscape(el.id)}"]`;
  if (el.dataset?.movieExpand != null && el.dataset?.expandKind != null) {
    return `[data-movie-expand="${cssEscape(
      el.dataset.movieExpand
    )}"][data-expand-kind="${cssEscape(el.dataset.expandKind)}"]`;
  }
  if (el.dataset?.movieClose != null) {
    return `[data-movie-close="${cssEscape(el.dataset.movieClose)}"]`;
  }
  for (const [key, attr] of [
    ["seatToggle", "data-seat-toggle"],
    ["seatRetry", "data-seat-retry"],
    ["show", "data-show"],
  ]) {
    const value = el.dataset?.[key];
    if (value) return `[${attr}="${cssEscape(value)}"]`;
  }
  return "";
}

/** Forget what a host holds, for the places that write inside it by
 * hand — a seat chart repaints on its own, within the day list. */
function repaintNext(host) {
  painted.delete(host);
}

/** Beat jobs already in flight, by name. */
const beatJobs = new Set();

init();

async function init() {
  const prefs = loadPrefs();
  selectedDay = prefs.selectedDay || "";
  // A home-screen shortcut names the tab it wants; otherwise the app
  // reopens wherever it was left.
  const wanted = new URLSearchParams(location.search).get("tab");
  activeTab = TAB_ORDER.includes(wanted) ? wanted : prefs.activeTab || "day";
  lang = prefs.lang === "en" ? "en" : "nb";
  theme = ["light", "dark", "system"].includes(prefs.theme)
    ? prefs.theme
    : "system";
  showSeatNumbers = prefs.showSeatNumbers !== false;
  timelineAlwaysExpanded = prefs.timelineAlwaysExpanded === true;

  applyTheme(theme);
  // A device flipping between light and dark mid-session should carry
  // the app with it while the theme is on auto.
  DARK_MQ.addEventListener?.("change", () => {
    if (theme === "system") applyTheme(theme);
  });
  applyLanguage();
  setActiveTab(activeTab, { skipRender: true });

  els.refreshBtn.addEventListener("click", () => load({ forceLive: true }));
  document.querySelectorAll(".pill-tab").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  setupSeatCharts();

  // Let mouse users scroll the day strip with the wheel.
  els.dayTabs.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        els.dayTabs.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );

  els.jumpTodayBtn?.addEventListener("click", () => {
    const today = toDayKey(new Date());
    if (!state?.shows?.some((s) => s.dayKey === today)) return;
    selectDay(today);
  });

  setupTimelineExpand();

  setInterval(liveBeat, BEAT_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    rollToTodayIfStale();
    // A phone in a pocket runs no beats. Pick straight up again rather
    // than showing however old the last one left the screen.
    liveBeat();
  });

  setupPullToRefresh();
  setupDaySwipe();

  // Keep liquid indicators aligned after layout changes.
  window.addEventListener("resize", () => {
    movePillIndicator(activeTab, { instant: true });
    moveDayIndicator({ instant: true });
    updateLiquidLenses();
  });

  // Crossing phone/desktop changes whether the timeline shows :30 ticks
  // and whether the strip scrolls sideways with a fixed px-per-hour.
  const rerenderTimeline = () => {
    if (state?.shows) renderTimeline();
  };
  TL_WIDE_MQ.addEventListener?.("change", rerenderTimeline);
  TL_SCROLL_MQ.addEventListener?.("change", rerenderTimeline);

  // Draw the refraction lenses once the chrome has its real size, and
  // redraw when it changes — the header grows and shrinks with the tab.
  requestAnimationFrame(() => {
    updateLiquidLenses();
    updateNavContrast();
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(() => updateLiquidLenses());
      for (const [, selector] of LENS_TARGETS) {
        const el = document.querySelector(selector);
        if (el) ro.observe(el);
      }
    }
  });

  // What sits under the navbar changes as the page scrolls.
  window.addEventListener("scroll", scheduleNavContrast, { passive: true });

  // Crossing the tablet threshold changes whether seat charts are folded
  // away. Only the day list draws them, so only it needs redrawing.
  SEATS_OPEN_MQ.addEventListener("change", () => {
    if (activeTab === "day") renderDay();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  await load({ forceLive: true });

  // Backfill check-in counts for every day in the background — not only
  // the visible one — so flipping back to yesterday already has numbers.
  if (isDxConnected()) {
    syncScanned().catch((err) => console.warn("Scan backfill failed", err));
  } else if (PREVIEW_SCANNED) {
    ensureAllEnriched()
      .then(() => {
        applyPreviewScanned();
        renderActiveView();
      })
      .catch((err) => console.warn("Background enrich failed", err));
  }
}

function setupPullToRefresh() {
  let startY = 0;
  let pulling = false;

  document.addEventListener(
    "touchstart",
    (e) => {
      if (window.scrollY <= 0 && !els.refreshBtn.disabled) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 90 && window.scrollY <= 0) {
        pulling = false;
        load({ forceLive: true });
      }
    },
    { passive: true }
  );

  document.addEventListener("touchend", () => {
    pulling = false;
  });
}

/**
 * One set of listeners for every seat chart: the day list is rebuilt
 * wholesale on each refresh, so nothing can hold onto its own elements.
 */
function setupSeatCharts() {
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest?.("[data-seat-toggle]");
    if (toggle) {
      toggleSeatChart(toggle.dataset.seatToggle);
      return;
    }

    const retry = e.target.closest?.("[data-seat-retry]");
    if (retry) {
      const show = state?.shows?.find((s) => s.id === retry.dataset.seatRetry);
      if (show) loadSeatChart(show, { force: true });
      return;
    }

    const movieClose = e.target.closest?.("[data-movie-close]");
    if (movieClose) {
      closeMovieShows(movieClose.dataset.movieClose);
      return;
    }

    const movieExpand = e.target.closest?.("[data-movie-expand]");
    if (movieExpand) {
      toggleMovieShows(
        movieExpand.dataset.movieExpand,
        movieExpand.dataset.expandKind
      );
      return;
    }

    const statsMovie = e.target.closest?.("[data-stats-movie]");
    if (statsMovie) {
      openMovieFromStats(statsMovie.dataset.statsMovie);
      return;
    }

    const statsDay = e.target.closest?.("[data-stats-day]");
    if (statsDay) {
      openDayFromStats(statsDay.dataset.statsDay);
      return;
    }

    const tlShow = e.target.closest?.("[data-tl-show]");
    if (tlShow) {
      focusShowFromTimeline(tlShow.dataset.tlShow);
      return;
    }

    const seat = e.target.closest?.(".seat");
    if (seat) describeSeat(seat);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const statsMovie = e.target.closest?.("[data-stats-movie]");
    if (!statsMovie || e.target !== statsMovie) return;
    e.preventDefault();
    openMovieFromStats(statsMovie.dataset.statsMovie);
  });

  // Hovering reads out seats too, for anyone on a desktop box-office screen.
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const seat = e.target.closest?.(".seat");
    if (seat) describeSeat(seat);
  });
}

/** Name the seat under the pointer in its chart's legend row. */
function describeSeat(seat) {
  const caption = seat.closest(".seat-chart")?.querySelector(".seat-picked");
  if (!caption) return;
  const state = seat.dataset.state;
  const phase = seat.closest(".seat-chart")?.classList.contains("phase-sales");
  const label =
    state === "2"
      ? t("seatIn")
      : state === "1"
        ? t(phase ? "seatSold" : "seatWaiting")
        : state === "3"
          ? t("seatReserved")
          : state === "4"
            ? t("seatBlocked")
            : t("seatFree");
  caption.textContent = t("seatPicked", {
    row: seat.dataset.row,
    seat: seat.dataset.seat,
    state: label,
  });
}

/** While a swipe gesture is in progress, live refreshes must not replace
 * the day list under the finger (that used to kill the touch stream and
 * leave the page frozen between days). renderDay checks this flag and
 * queues itself; the swipe code replays the render once the gesture ends. */
let holdDayRender = false;
let queuedDayRender = false;

function releaseDayRender({ discardQueued = false } = {}) {
  holdDayRender = false;
  const replay = queuedDayRender && !discardQueued;
  queuedDayRender = false;
  if (replay) renderDay();
}

/**
 * Interactive swipe between days: the page follows the finger while the
 * neighbouring day peeks in from the side, then a spring animation
 * carries it to the new day (or back) using the release velocity.
 *
 * Built for robustness against every "stuck between days" failure mode:
 * - Pointer events with capture on the (stable) day view, so the gesture
 *   survives DOM re-renders that would silently end a touch-event stream.
 * - The settle animation runs on requestAnimationFrame instead of a CSS
 *   transition, so it can never be left hanging by a missed transitionend.
 * - A new touch can grab the page mid-flight and keep dragging from
 *   exactly where it is; if the grabbed animation was already committing,
 *   the day is committed on the spot so quick repeated swipes flow
 *   naturally from day to day.
 *
 * The header (day pills and timeline) travels with the page rather than
 * after it: it moves onto the incoming day as soon as the drag is clearly
 * heading there, and at the latest when the settle animation starts, so
 * both land together. Day-pill taps run the same slide via slideToDay.
 */
function setupDaySwipe() {
  const view = els.views.day;
  const track = els.daySwipe;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /** @type {"idle"|"pending"|"drag"|"ignore"|"animating"} */
  let mode = "idle";
  /** Pointer that owns the gesture; extra fingers are ignored so a stray
   * second touch can't end the drag early. */
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  /** Track offset at gesture start (non-zero when grabbing an animation). */
  let baseX = 0;
  let curX = 0;
  let width = 0;
  let days = [];
  let idx = -1;
  let lastX = 0;
  let lastT = 0;
  let vx = 0;
  let raf = 0;
  /** Direction of the currently running snap animation (−1/0/1). */
  let animDir = 0;
  /** Day that animation commits to on arrival ("" while springing back). */
  let animDay = "";
  /** Ends the running snap animation right now, or null when idle. */
  let finishAnim = null;
  /** Side the header is previewing mid-drag (−1/0/1). */
  let previewDir = 0;

  const setX = (x) => {
    curX = x;
    track.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
  };

  /** Land on `day`: the peek pane already showed it, so the list swaps in
   * without replaying the card entrance animation. */
  const commitDay = (day) => {
    els.content.dataset.key = day;
    setSelectedDay(day);
    renderDay();
    enrichVisibleDay();
  };

  /** Move the header onto the day the drag is heading for once it is past
   * halfway, so the pills and timeline animate alongside the page instead
   * of starting over once it has landed. The wider entry threshold keeps a
   * drag that hovers around the middle from flip-flopping. */
  const previewHeader = () => {
    const frac = -curX / width;
    const enter = previewDir !== 0 && Math.sign(frac) === previewDir ? 0.3 : 0.45;
    let dir = Math.abs(frac) > enter ? Math.sign(frac) : 0;
    if ((dir > 0 && idx >= days.length - 1) || (dir < 0 && idx <= 0)) dir = 0;
    if (dir === previewDir) return;
    previewDir = dir;
    setSelectedDay(days[idx + dir]);
  };

  view.addEventListener("pointerdown", (e) => {
    // Touch/pen only: mouse users scroll and click, they don't swipe.
    if (e.pointerType === "mouse" || !e.isPrimary || pointerId !== null) return;
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startY = e.clientY;
    lastT = e.timeStamp;
    vx = 0;
    if (mode === "animating") {
      // Catch the page mid-flight and let the finger take over from
      // exactly where it is — no jump, no waiting. If the animation
      // was already committing to a neighbour day, commit it now and
      // rebase the track so a follow-up swipe moves on from the new day.
      cancelAnimationFrame(raf);
      finishAnim = null;
      if (animDir !== 0) {
        const newDay = animDay;
        releaseDayRender({ discardQueued: true });
        commitDay(newDay);
        holdDayRender = true;
        setX(curX + width * animDir);
        // A tapped pill can slide in a day that is not the neighbour, so
        // re-find where we landed instead of stepping the index.
        idx = days.indexOf(newDay);
        els.dayPanePrev.innerHTML =
          idx > 0 ? buildDayListHTML(days[idx - 1]) : "";
        els.dayPaneNext.innerHTML =
          idx < days.length - 1 ? buildDayListHTML(days[idx + 1]) : "";
        animDir = 0;
        animDay = "";
      }
      baseX = curX;
      previewDir = 0;
      mode = "drag";
      try {
        view.setPointerCapture(pointerId);
      } catch {}
    } else {
      baseX = 0;
      mode = "pending";
    }
  });

  view.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    if (mode !== "pending" && mode !== "drag") return;
    const x = e.clientX;
    const y = e.clientY;

    if (mode === "pending") {
      const dx = x - startX;
      const dy = y - startY;
      // Wait until the gesture direction is clear; vertical wins so
      // normal scrolling is never hijacked (touch-action: pan-y keeps
      // vertical panning with the browser).
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        mode = "ignore";
        return;
      }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (!state?.shows) {
        mode = "ignore";
        return;
      }
      days = [...new Set(state.shows.map((s) => s.dayKey))].sort();
      idx = days.indexOf(selectedDay);
      if (idx === -1) {
        mode = "ignore";
        return;
      }
      width = track.offsetWidth || view.offsetWidth || 1;
      els.dayPanePrev.innerHTML = idx > 0 ? buildDayListHTML(days[idx - 1]) : "";
      els.dayPaneNext.innerHTML =
        idx < days.length - 1 ? buildDayListHTML(days[idx + 1]) : "";
      // Re-base on the engage point so the page starts moving from
      // right under the finger instead of jumping the 10px dead zone.
      startX = x;
      lastX = x;
      lastT = e.timeStamp;
      mode = "drag";
      holdDayRender = true;
      // Route the rest of the gesture to this (permanent) element, so a
      // background re-render of the list can't cut the swipe short.
      try {
        view.setPointerCapture(pointerId);
      } catch {}
    }

    const dt = e.timeStamp - lastT;
    if (dt > 0) {
      const inst = (x - lastX) / dt;
      // Low-pass the velocity so one noisy sample can't fake a flick.
      vx = vx === 0 ? inst : inst * 0.6 + vx * 0.4;
      lastX = x;
      lastT = e.timeStamp;
    }

    const target = baseX + (x - startX);
    // Rubber-band past the first/last day instead of moving freely.
    const blocked =
      (target > 0 && idx <= 0) || (target < 0 && idx >= days.length - 1);
    let next = blocked ? target * 0.3 : target;
    // Only one neighbour is rendered on each side; resist dragging
    // past it instead of exposing blank space.
    if (next > width) next = width + (next - width) * 0.2;
    else if (next < -width) next = -width + (next + width) * 0.2;
    setX(next);
    previewHeader();
  });

  const settle = () => {
    if (mode === "drag") {
      const canPrev = idx > 0;
      const canNext = idx < days.length - 1;
      // Where would the page coast to? Position plus a bit of momentum
      // decides, so slow far drags and quick short flicks both commit.
      const projected = curX + vx * 140;
      const dragDX = curX - baseX;
      let dir = 0;
      if (canNext && dragDX < -8 && (projected < -width * 0.3 || vx < -0.25)) {
        dir = 1;
      } else if (canPrev && dragDX > 8 && (projected > width * 0.3 || vx > 0.25)) {
        dir = -1;
      }
      snapTo(dir);
    } else if (mode !== "animating") {
      mode = "idle";
    }
  };

  view.addEventListener("pointerup", (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    settle();
  });

  view.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (mode === "drag") snapTo(0);
    else if (mode !== "animating") mode = "idle";
  });

  // Last-resort recovery: if the view's own capture is ever lost without
  // a pointerup or pointercancel, spring back instead of freezing
  // mid-swipe. (Bubbled events from a child losing its implicit capture
  // when ours kicks in must not end the gesture, hence the target check.)
  view.addEventListener("lostpointercapture", (e) => {
    if (e.target !== view || e.pointerId !== pointerId) return;
    pointerId = null;
    if (mode === "drag") snapTo(0);
    else if (mode !== "animating") mode = "idle";
  });

  /** Spring the track to its resting spot; dir −1/1 slides to the
   * previous/next side, 0 springs back to the current day. `day` is the
   * day to land on ("" for a spring-back) and `v0` the launch velocity. */
  function snapTo(dir, { day = dir === 0 ? "" : days[idx + dir], v0 = vx } = {}) {
    // Never leave an earlier spring running: two loops would fight over
    // the transform and neither could be stopped.
    cancelAnimationFrame(raf);
    mode = "animating";
    animDir = dir;
    animDay = day;
    const target = dir === 0 ? 0 : dir === 1 ? -width : width;

    // Send the header off now so the pills and timeline animate while the
    // page glides, and both arrive at roughly the same moment. A gesture
    // that gave up goes back to the day the list still shows.
    if (day) setSelectedDay(day);
    else if (previewDir !== 0) setSelectedDay(days[idx]);
    previewDir = 0;

    const finish = () => {
      cancelAnimationFrame(raf);
      finishAnim = null;
      animDir = 0;
      animDay = "";
      // Commits re-render anyway; a queued refresh is only replayed
      // when the gesture ends back on the same day.
      releaseDayRender({ discardQueued: dir !== 0 });
      if (day) commitDay(day);
      setX(0);
      els.dayPanePrev.innerHTML = "";
      els.dayPaneNext.innerHTML = "";
      mode = "idle";
    };
    finishAnim = finish;

    if (curX === target || reduceMotion.matches) {
      finish();
      return;
    }

    // Critically damped spring driven by the release velocity: fast
    // flicks land fast, gentle releases glide, and it never oscillates.
    // The frequency is picked so even a full-width slide is done in about
    // 350ms — in step with the header's morph, so the two land together.
    const omega = 0.024; // rad/ms
    let x = curX;
    let v = Math.max(-3, Math.min(3, v0));
    const side = Math.sign(x - target);
    let prevTs = performance.now();

    const stepFrame = (ts) => {
      const dt = Math.min(Math.max(ts - prevTs, 0.001), 64);
      prevTs = ts;
      // Exact closed-form step of x'' = -ω²(x-target) - 2ωx'.
      const A = x - target;
      const B = v + omega * A;
      const decay = Math.exp(-omega * dt);
      x = target + (A + B * dt) * decay;
      v = (B - omega * (A + B * dt)) * decay;
      const done =
        (Math.abs(x - target) < 0.5 && Math.abs(v) < 0.02) ||
        Math.sign(x - target) !== side;
      if (done) {
        finish();
        return;
      }
      setX(x);
      raf = requestAnimationFrame(stepFrame);
    };
    raf = requestAnimationFrame(stepFrame);
  }

  /** Slide to `day` without a gesture (day-pill taps), reusing the swipe
   * animation so the page and the header always move as one. Returns false
   * when no slide is possible and the caller should just switch day. */
  slideToDay = (day) => {
    if (!state?.shows || els.views.day.hidden) return false;
    // A gesture owns the track; let it finish and win.
    if (mode === "pending" || mode === "drag" || pointerId !== null) return false;
    // Tapped during a slide: land that one first, then start from there.
    if (mode === "animating") finishAnim?.();
    if (day === selectedDay) return true;

    const all = [...new Set(state.shows.map((s) => s.dayKey))].sort();
    const from = all.indexOf(selectedDay);
    const to = all.indexOf(day);
    if (from === -1 || to === -1) return false;
    width = track.offsetWidth || view.offsetWidth || 0;
    if (!width) return false;

    days = all;
    idx = from;
    baseX = 0;
    setX(0);
    const dir = to > from ? 1 : -1;
    // A far-away day slides in from the near side, so every tap gets the
    // same one-screen motion a swipe would give.
    els.dayPanePrev.innerHTML = dir === -1 ? buildDayListHTML(day) : "";
    els.dayPaneNext.innerHTML = dir === 1 ? buildDayListHTML(day) : "";
    holdDayRender = true;
    // A tap brings no release velocity, so launch it with a gentle flick's
    // worth — a full screen from a standstill otherwise starts sluggishly.
    snapTo(dir, { day, v0: -dir * 2 });
    return true;
  };
}

let sessionDay = toDayKey(new Date());

/** If the device slept past midnight, move selection to the new "today". */
function rollToTodayIfStale() {
  const today = toDayKey(new Date());
  if (today === sessionDay || !state?.shows) return;
  sessionDay = today;
  const days = new Set(state.shows.map((s) => s.dayKey));
  if (days.has(today)) {
    selectedDay = today;
    savePrefs();
    populateFilters();
    if (activeTab === "day") renderDay();
  }
}

/**
 * Start one of the beat's jobs unless the previous beat's copy of it is
 * still going. A lookup that takes longer than a beat then delays only
 * itself: the cheap sold counts keep arriving while a heavy purchase
 * list is still being read.
 */
function beatJob(name, run) {
  if (beatJobs.has(name)) return;
  beatJobs.add(name);
  Promise.resolve()
    .then(run)
    .catch((err) => console.warn(`Live beat (${name}) failed`, err))
    .finally(() => beatJobs.delete(name));
}

/**
 * One beat of the app.
 *
 * First redraw: a minute passing moves progress bars, the timeline's
 * now-marker and the line through a showing that has just finished, all
 * without a single fetch. Then send off whatever has come due — sold
 * counts, check-in counts, open seat charts — and, on its own calmer
 * gate, the programme itself, so a screen left on for days notices a
 * film that was added, moved or taken off.
 *
 * Each render skips the DOM when the markup it built is the markup
 * already on screen, so a beat where nothing moved costs nothing.
 */
function liveBeat() {
  if (document.visibilityState !== "visible" || !state?.shows) return;

  // Settings is a form. Redrawing it under the visitor would eat a
  // half-typed password, and nothing on it moves by itself anyway.
  if (activeTab !== "settings") renderActiveView();
  markDoneDays();
  scheduleNavContrast();

  beatJob("program", async () => {
    if (Date.now() - lastProgramAt < PROGRAM_RECHECK_MS) return;
    await reloadProgramIfChanged();
  });
  beatJob("live", () => refreshLive({ quiet: true }));
  beatJob("scan", () => syncScanned({ quiet: true }));
  beatJob("seats", () => refreshOpenSeatCharts({ quiet: true }));
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

/**
 * Optional opaque session token cached on this device. The bridge can
 * mint sessions on its own from the shared vault credentials, so a
 * missing token is fine — and passwords are never stored in the browser.
 */
function loadDxAuth() {
  try {
    // Drop legacy payloads that kept a password on the device.
    const raw = JSON.parse(localStorage.getItem(DX_AUTH_KEY) || "null");
    if (!raw || typeof raw !== "object") return { type: "dxweb" };
    if (raw.password || raw.email) {
      localStorage.removeItem(DX_AUTH_KEY);
      return { type: "dxweb" };
    }
    if (raw.token && raw.type === "dxweb") {
      return { type: "dxweb", token: String(raw.token), partnerId: raw.partnerId };
    }
    return { type: "dxweb" };
  } catch {
    return { type: "dxweb" };
  }
}

function saveDxAuth(next) {
  dxAuth = next && typeof next === "object" ? next : { type: "dxweb" };
  // Only persist a short-lived opaque token — never credentials.
  if (dxAuth.token) {
    localStorage.setItem(
      DX_AUTH_KEY,
      JSON.stringify({
        type: "dxweb",
        token: dxAuth.token,
        partnerId: dxAuth.partnerId || DX_PARTNER_ID,
      })
    );
  } else {
    localStorage.removeItem(DX_AUTH_KEY);
  }
}

/** Admissions are always on; the bridge signs in with the shared account. */
function isDxConnected() {
  return true;
}

/** True when the UI should make room for check-in numbers at all. */
function scanVisible() {
  return isDxConnected() || PREVIEW_SCANNED;
}

function rememberDxToken(token) {
  if (!token) return;
  saveDxAuth({
    type: "dxweb",
    token: String(token),
    partnerId: dxAuth?.partnerId || DX_PARTNER_ID,
  });
}

function clearDxToken() {
  saveDxAuth({ type: "dxweb" });
}

/**
 * Fill example scanned / reserved counts so the UI can be reviewed
 * without live DX check-in data (`?previewScanned=1`). Skips shows that
 * already have a real scanned value; reserved is only filled when DX
 * left it at zero so the blue hold squares still show up in preview.
 */
function applyPreviewScanned() {
  if (!PREVIEW_SCANNED || !state?.shows) return false;
  const now = new Date();
  let changed = false;
  for (const show of state.shows) {
    if (show.sold == null) continue;
    const sold = Number(show.sold) || 0;
    const status = statusOf(show, now);
    const jitter = (hashStr(show.id) % 13) / 100;
    let ratio = 0.08;
    if (status === "done") ratio = 0.78 + jitter;
    else if (status === "live") ratio = 0.42 + jitter;
    else if (status === "soon") ratio = 0.12 + jitter / 2;
    const next = Math.min(sold, Math.max(0, Math.round(sold * ratio)));
    if (show.scanned !== next) {
      show.scanned = next;
      changed = true;
    }
    // A handful of holds after the sold block, so reserved seats appear
    // on the preview chart even when the program snapshot has none.
    if (!(Number(show.reserved) > 0) && sold > 0) {
      const capacity = Number(show.capacity) || 0;
      const room = Math.max(capacity - sold, 0);
      const holds = Math.min(room, 2 + (hashStr(show.id) % 4));
      if (holds > 0) {
        show.reserved = holds;
        changed = true;
      }
    }
  }
  return changed;
}

function hashStr(s) {
  let h = 0;
  for (const ch of String(s || "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      selectedDay,
      activeTab,
      lang,
      theme,
      showSeatNumbers,
      timelineAlwaysExpanded,
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

/** Forget showings for good, so a removed film cannot come back on reload. */
function forgetShows(ids) {
  const gone = ids instanceof Set ? ids : new Set(ids);
  if (!gone.size) return;
  try {
    const hist = loadHistory();
    for (const id of gone) delete hist[id];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (err) {
    console.warn("Could not forget removed shows", err);
  }
}

/**
 * Has this cached showing been taken off the programme?
 *
 * The snapshot carries every showing Buen has programmed, history
 * included, so anything cached but missing from it is gone — as long as
 * the snapshot actually speaks for that date. A day it says nothing
 * about (older than its window, or a snapshot that came up short) is
 * left alone rather than quietly emptied.
 */
function isOffProgram(show, snapshotDays, now) {
  if (show.start instanceof Date && show.start.getTime() > now) return true;
  return snapshotDays.has(show.dayKey);
}

function mergeShows(snapshotShows) {
  const byId = new Map();
  const snapshotIds = new Set(snapshotShows.map((s) => s.id));
  const snapshotDays = new Set(snapshotShows.map((s) => s.dayKey));
  const now = Date.now();
  const removed = new Set();

  for (const raw of Object.values(loadHistory())) {
    if (!raw?.id) continue;
    const cached = normalizeCachedShow(raw);
    if (
      snapshotIds.size &&
      !snapshotIds.has(cached.id) &&
      isOffProgram(cached, snapshotDays, now)
    ) {
      removed.add(cached.id);
      continue;
    }
    byId.set(cached.id, cached);
  }
  forgetShows(removed);

  for (const show of snapshotShows) {
    const next = normalizeCachedShow(show);
    const prev = byId.get(next.id);
    if (prev) {
      // Keep better live fields when snapshot is stale/empty.
      if (next.sold == null && prev.sold != null) next.sold = prev.sold;
      if (next.capacity == null && prev.capacity != null) {
        next.capacity = prev.capacity;
        next.available = prev.available ?? null;
        next.reserved = prev.reserved ?? null;
      }
      if (next.scanned == null && prev.scanned != null) {
        next.scanned = prev.scanned;
      }
      // Keep the sync bookkeeping so finished days aren't re-fetched.
      if (next.scannedAt == null && prev.scannedAt != null) {
        next.scannedAt = prev.scannedAt;
      }
      if (next.scanDone == null && prev.scanDone != null) {
        next.scanDone = prev.scanDone;
      }
      if (!next.end && prev.end) next.end = prev.end;
      // The program API drops ticket links once a show starts;
      // restore the DX eventId so live updates keep working.
      if (!next.eventId && prev.eventId) {
        next.eventId = prev.eventId;
        next.promoterId = prev.promoterId || next.promoterId;
        if (next.eventStatus === "unavailable") next.eventStatus = "pending";
      }
      if (next.eventStatus === "pending" && prev.eventStatus === "ok") {
        next.eventStatus = "ok";
      }
    }
    byId.set(next.id, next);
  }

  return [...byId.values()].sort((a, b) => a.start - b.start);
}

/** The mode actually painted — "system" resolves against the device. */
function resolvedTheme() {
  if (theme === "system") return DARK_MQ.matches ? "dark" : "light";
  return theme;
}

function applyTheme(next) {
  theme = next;
  // Cross-fade colors while the theme flips, then drop the hook.
  const root = document.documentElement;
  root.classList.add("theme-anim");
  clearTimeout(applyTheme._t);
  applyTheme._t = setTimeout(() => root.classList.remove("theme-anim"), 400);
  root.dataset.theme = resolvedTheme();
  delete root.dataset.material;
  syncThemeChrome();
  scheduleNavContrast();
}

/**
 * Liquid-glass displacement map (restored post wrap-around rim).
 * Soft falloff into the pane; rim layers pull neighbouring page colour
 * around the lip. No painted specular.
 *
 * opts.wrap — outward bevel strength (0–1)
 * opts.rimBias — push the active band toward the outer lip
 */
function liquidLensMap(w, h, r, bend, _disp, opts = {}) {
  const wrap = opts.wrap ?? 0.42;
  const rimBias = opts.rimBias ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hw = w / 2;
  const hh = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r);
      const qy = Math.abs(py) - (hh - r);
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      const corner = Math.hypot(ax, ay);
      const d = corner + Math.min(Math.max(qx, qy), 0) - r;
      let t = Math.min(Math.max(1 + d / bend, 0), 1);
      if (rimBias > 0) t = Math.pow(t, 1 + rimBias * 2.4);
      let ox = 0;
      let oy = 0;
      if (t > 0) {
        let nx = 0;
        let ny = 0;
        if (qx > 0 && qy > 0) {
          const len = corner || 1;
          nx = (ax / len) * Math.sign(px);
          ny = (ay / len) * Math.sign(py);
        } else if (qx > qy) {
          nx = Math.sign(px);
        } else {
          ny = Math.sign(py);
        }
        const e = t * t * t * (t * (t * 6 - 15) + 10);
        const fresnel = Math.pow(t, 0.5);
        const inward = e * (0.72 + 0.28 * fresnel);
        const outward = Math.pow(t, 2.05) * wrap;
        ox = nx * (-inward + outward);
        oy = ny * (-inward + outward);
      }
      const i = (y * w + x) * 4;
      data[i] = Math.round(128 + ox * 127);
      data[i + 1] = Math.round(128 + oy * 127);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/** Bump when the map recipe changes so size-cached filters can't stick. */
const LENS_MAP_REV = 8;

/** Restored: plate + wrap-around rim lip (the v86 look). */
const LENS_TARGETS = [
  ["lens-nav", ".pill-nav-glass", 20, 15, undefined, { wrap: 0.38 }],
  [
    "lens-nav-rim",
    ".pill-nav-rim",
    9,
    30,
    undefined,
    { wrap: 0.7, rimBias: 1.1 },
  ],
  ["lens-chip", ".pill-indicator", 16, 17, undefined, { wrap: 0.4 }],
  [
    "lens-chip-rim",
    ".pill-indicator-rim",
    8,
    32,
    undefined,
    { wrap: 0.75, rimBias: 1.15 },
  ],
  ["lens-header", ".top", 12, 12, 0, { wrap: 0.25 }],
];

function updateLiquidLenses() {
  for (const [id, selector, bend, disp, radius, mapOpts] of LENS_TARGETS) {
    const filter = document.getElementById(id);
    const el = document.querySelector(selector);
    if (!filter || !el) continue;
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (!w || !h) continue;
    const size = `${LENS_MAP_REV}:${w}x${h}`;
    if (filter.dataset.size === size) continue;
    filter.dataset.size = size;
    const r = radius != null ? radius : Math.min(w, h) / 2; // capsule
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(w));
    filter.setAttribute("height", String(h));
    const image = filter.querySelector("feImage");
    image.setAttribute("href", liquidLensMap(w, h, r, bend, disp, mapOpts));
    image.setAttribute("x", "0");
    image.setAttribute("y", "0");
    image.setAttribute("width", String(w));
    image.setAttribute("height", String(h));
    filter
      .querySelector("feDisplacementMap")
      .setAttribute("scale", String(disp * 2));
  }
}

/**
 * Adaptive tab contrast, the way iOS glass does it: each navbar tab
 * looks at what the page is showing underneath it and flips to a light
 * face the moment its patch of backdrop turns dark — a poster, a red
 * accent block — so the icons always read through the clear glass.
 */
function parseCssColor(str) {
  if (!str) return null;
  let m =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
      str
    );
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  }
  m =
    /^color\(srgb\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)(?:\s*\/\s*([\d.]+%?))?\)$/.exec(
      str
    );
  if (m) {
    const a =
      m[4] == null
        ? 1
        : m[4].endsWith("%")
          ? parseFloat(m[4]) / 100
          : +m[4];
    return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a };
  }
  return null;
}

/** Average poster: film one-sheets skew dark, so an image reads as dark. */
const POSTER_GUESS = { r: 70, g: 64, b: 62, a: 1 };

/** The colour the page shows at a point, compositing translucent layers
 * bottom-up and skipping the navbar itself. */
function backdropColorAt(x, y) {
  const layers = [];
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === document.documentElement || el.closest(".pill-nav")) continue;
    if (el.tagName === "IMG") {
      layers.push(POSTER_GUESS);
      break;
    }
    const color = parseCssColor(getComputedStyle(el).backgroundColor);
    if (color && color.a > 0.01) {
      layers.push(color);
      if (color.a >= 0.99) break;
    }
  }
  let base = parseCssColor(
    getComputedStyle(document.documentElement).backgroundColor
  ) || { r: 239, g: 236, b: 232 };
  let { r, g, b } = base;
  for (let i = layers.length - 1; i >= 0; i--) {
    const c = layers[i];
    r = c.r * c.a + r * (1 - c.a);
    g = c.g * c.a + g * (1 - c.a);
    b = c.b * c.a + b * (1 - c.a);
  }
  return { r, g, b };
}

function luminanceOf(c) {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function updateNavContrast() {
  const shell = document.querySelector(".pill-nav-glass");
  if (!shell) return;
  // The shell's own translucent fill sits between the page and the
  // icons, so it takes part in what the eye actually sees.
  const fill = parseCssColor(getComputedStyle(shell).backgroundColor);
  document.querySelectorAll(".pill-tab").forEach((btn) => {
    const rect = btn.getBoundingClientRect();
    if (!rect.width) return;
    let c = backdropColorAt(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
    if (fill && fill.a > 0) {
      c = {
        r: fill.r * fill.a + c.r * (1 - fill.a),
        g: fill.g * fill.a + c.g * (1 - fill.a),
        b: fill.b * fill.a + c.b * (1 - fill.a),
      };
    }
    // Hysteresis keeps a tab from flickering on a boundary colour.
    const wasDark = btn.classList.contains("on-dark");
    btn.classList.toggle(
      "on-dark",
      luminanceOf(c) < (wasDark ? 0.5 : 0.42)
    );
  });
}

function scheduleNavContrast() {
  if (scheduleNavContrast._queued) return;
  scheduleNavContrast._queued = true;
  requestAnimationFrame(() => {
    scheduleNavContrast._queued = false;
    updateNavContrast();
  });
}

/** Keep the browser/PWA chrome the same colour as the page behind it. */
function syncThemeChrome() {
  const dark = resolvedTheme() === "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#121212" : "#efece8";
  const bar = document.querySelector(
    'meta[name="apple-mobile-web-app-status-bar-style"]'
  );
  if (bar) bar.content = dark ? "black-translucent" : "default";
}

function applyLanguage() {
  document.documentElement.lang = lang === "en" ? "en" : "nb";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  els.refreshBtn.setAttribute("aria-label", t("refresh"));
  els.refreshBtn.title = t("refresh");
  els.jumpTodayBtn?.setAttribute("aria-label", t("jumpTodayAria"));
  syncTimelineExpandBtn();
  els.dayTabs.setAttribute(
    "aria-label",
    lang === "en" ? "Choose day" : "Velg dag"
  );
  document.querySelector(".pill-nav")?.setAttribute(
    "aria-label",
    lang === "en" ? "Main menu" : "Hovedmeny"
  );
}

/**
 * Liquid indicator move: the blob glides to the target in one springy
 * motion while squashing flatter and slightly wider — a droplet sliding
 * across — then relaxes back to its resting shape as it lands.
 */
const LIQUID_SETTLE_MS = 170;

function liquidMove(
  indicator,
  target,
  { instant = false, inset = 0, originLeft = 0 } = {}
) {
  if (!indicator || !target) return;
  const newL = target.offsetLeft - originLeft + inset;
  const newW = Math.max(0, target.offsetWidth - inset * 2);
  const usePillX =
    indicator.classList.contains("pill-indicator") ||
    indicator.classList.contains("pill-lens");

  // Hidden targets measure 0×0; bail so we don't park the indicator at
  // width 0 and leave the selected pill unstyled when it shows again.
  if (!newW) {
    delete indicator.dataset.placed;
    return;
  }

  const applyPos = () => {
    if (usePillX) {
      indicator.style.setProperty("--pill-x", `${newL}px`);
      indicator.style.left = "0px";
    } else {
      indicator.style.left = `${newL}px`;
    }
    indicator.style.width = `${newW}px`;
  };

  const readL = () =>
    usePillX
      ? parseFloat(indicator.style.getPropertyValue("--pill-x")) || 0
      : parseFloat(indicator.style.left) || 0;

  const hasPos = indicator.dataset.placed === "1";
  if (instant || !hasPos) {
    clearTimeout(indicator._settle);
    indicator.classList.remove("liquid-travel");
    indicator.classList.add("no-trans");
    applyPos();
    indicator.dataset.placed = "1";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => indicator.classList.remove("no-trans"))
    );
    return;
  }

  const curL = readL();
  const curW = parseFloat(indicator.style.width) || newW;
  if (Math.abs(curL - newL) < 1 && Math.abs(curW - newW) < 1) return;

  clearTimeout(indicator._settle);
  // Navbar selection just slides; day/seg keep the liquid squash.
  if (!usePillX) indicator.classList.add("liquid-travel");
  applyPos();
  indicator._settle = setTimeout(() => {
    indicator.classList.remove("liquid-travel");
  }, LIQUID_SETTLE_MS);
}

/**
 * The header's one-line "how fresh is this" note. Numbers that just came
 * back from DX get a pulsing dot, so a glance says whether the page is
 * live or reading off the nightly snapshot.
 */
function setStatus(text, { live = false, error = false } = {}) {
  els.statusText.textContent = text;
  els.statusText.classList.toggle("live", live && !error);
  els.statusText.classList.toggle("bad", error);
}

function movePillIndicator(tab, opts = {}) {
  const indicator = document.querySelector(".pill-lens");
  const track = indicator?.parentElement;
  const btn = document.querySelector(`.pill-tab[data-tab="${tab}"]`);
  // Fill the tab cell inside the track so the floating selection chip
  // has the same rim gap on every side (set by --pill-pad).
  liquidMove(indicator, btn, {
    ...opts,
    inset: 0,
    originLeft: track?.offsetLeft ?? 0,
  });
  // Rim map is sized to the lens; redraw after width settles.
  requestAnimationFrame(() => updateLiquidLenses());
}

async function setActiveTab(tab, { skipRender = false } = {}) {
  if (!els.views[tab]) return;
  const prevTab = activeTab;
  activeTab = tab;
  savePrefs();
  document.body.dataset.tab = tab;

  if (tabAnimCleanup) tabAnimCleanup();

  Object.entries(els.views).forEach(([key, el]) => {
    el.hidden = key !== tab;
  });

  // Slide the whole page sideways: the old view glides out while the new
  // one comes in from the side it lives on in the tab order.
  if (!skipRender && prevTab !== tab && els.views[prevTab]) {
    const forward = TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(prevTab);
    const view = els.views[tab];
    const prevView = els.views[prevTab];

    // The outgoing view turns into an absolutely-positioned ghost; shift
    // it by the old scroll offset so it doesn't jump when we scroll the
    // new view to the top.
    const scrollY = window.scrollY || 0;
    prevView.hidden = false;
    prevView.style.setProperty("--tab-shift", `${-scrollY}px`);
    prevView.classList.add("tab-ghost", forward ? "tab-out-left" : "tab-out-right");
    window.scrollTo(0, 0);

    const cleanup = () => {
      if (tabAnimCleanup === cleanup) tabAnimCleanup = null;
      clearTimeout(fallback);
      view.removeEventListener("animationend", onEnd);
      view.classList.remove(...TAB_ANIM_CLASSES);
      prevView.classList.remove(...TAB_ANIM_CLASSES);
      prevView.style.removeProperty("--tab-shift");
      prevView.hidden = true;
    };
    // Card entrance animations bubble up from children; only the view's
    // own slide ending should finish the transition.
    const onEnd = (e) => {
      if (e.target === view) cleanup();
    };
    const fallback = setTimeout(cleanup, 450);
    tabAnimCleanup = cleanup;

    // Restart the animation even if the class was just removed.
    void view.offsetWidth;
    view.classList.add(forward ? "tab-in-right" : "tab-in-left");
    view.addEventListener("animationend", onEnd);
  }

  document.querySelectorAll(".pill-tab").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
  });
  movePillIndicator(tab, { instant: skipRender });
  if (state?.shows) {
    renderTimeline();
  }

  els.dayControls.hidden = tab !== "day";
  els.refreshBtn.hidden = tab === "settings";
  syncTimelineExpandBtn();
  // The day strip was unmeasurable while hidden; re-seat its indicator
  // now that it is visible again so the selected pill keeps its color.
  if (tab === "day") moveDayIndicator({ instant: true });

  if (skipRender || !state?.shows) return;

  if (tab === "day") {
    renderDay();
    // Arriving from a tab that never needed live numbers (e.g. settings)
    // can leave the day without sold counts — top it up, but only when
    // what we already have has gone stale.
    const stale =
      Date.now() - lastLiveAt > 60_000 ||
      state.shows.some(
        (s) => s.dayKey === selectedDay && s.eventId && s.sold == null
      );
    if (stale) await enrichVisibleDay();
  } else if (tab === "movies") {
    await ensureAllEnriched();
    renderMovies();
  } else if (tab === "stats") {
    await ensureAllEnriched();
    renderStats();
  } else if (tab === "settings") renderSettings();

  scheduleNavContrast();
}

async function load({ forceLive = false, silent = false, ifChanged = false } = {}) {
  if (!silent) setLoading(true);
  try {
    const data = await loadProgramSnapshot();
    lastProgramAt = Date.now();
    if (ifChanged && state && data.updatedAt && data.updatedAt === state.updatedAt) {
      return false;
    }

    enrichedAll = false;
    const shows = mergeShows(data.shows || []);
    persistHistory(shows);

    state = {
      updatedAt: data.updatedAt,
      shows,
    };

    populateFilters();
    setStatus(
      t("updated", {
        time: formatClock(
          state.updatedAt ? new Date(state.updatedAt) : new Date()
        ),
      })
    );

    if (forceLive) {
      if (activeTab === "day") await enrichVisibleDay({ force: true });
      else if (activeTab === "movies" || activeTab === "stats") {
        // Both tabs read the whole programme, so a refresh by hand
        // means all of it, cap and freshness set aside.
        await refreshLive({ force: true });
        enrichedAll = true;
        await syncScanned({ force: true });
      } else {
        await syncScanned();
      }
    }

    applyPreviewScanned();
    renderActiveView();
    return true;
  } catch (err) {
    console.error(err);
    // A silent re-read failing changes nothing: the programme on screen
    // is still the last good one, so leave it be.
    if (!silent) showError(err?.message || t("loadError"));
    else console.warn("Program re-check failed", err);
    return false;
  } finally {
    if (!silent) setLoading(false);
  }
}

/**
 * Re-read the snapshot in the background and rebuild the programme when
 * it has changed since the copy on screen. Returns true when it did, so
 * the caller can skip the live pass that came with it.
 */
async function reloadProgramIfChanged() {
  if (!state) return false;
  return load({ forceLive: true, silent: true, ifChanged: true });
}

function renderActiveView() {
  if (activeTab === "day") renderDay();
  else if (activeTab === "movies") renderMovies();
  else if (activeTab === "stats") renderStats();
  else if (activeTab === "settings") renderSettings();
  if (activeTab !== "day") {
    renderTimeline();
  }
}

async function loadProgramSnapshot() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${t("loadError")} (${res.status})`);
  return res.json();
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => {
    const t = String(tag || "").trim().toUpperCase();
    return t && t !== "2D" && t !== "3D";
  });
}

/**
 * Best-effort spoken language from Buen's version tags. Norwegian-dubbed
 * shows are tagged "Norsk tale"; English-language shows never carry an
 * explicit English tag — they run in original version ("Original tale")
 * and/or with Norwegian subtitles ("Norsk tekst").
 * Returns "nb", "en" or "" when unknown.
 */
function spokenLanguage(tags) {
  if (!Array.isArray(tags)) return "";
  const values = tags.map((tag) => String(tag || "").trim().toLowerCase());
  if (values.some((v) => v.includes("norsk tale"))) return "nb";
  if (values.some((v) => v.includes("engelsk"))) return "en";
  if (values.some((v) => v.includes("original tale") || v.includes("norsk tekst"))) {
    return "en";
  }
  return "";
}

/**
 * Buen states age limits in Norwegian — "12 år", "Tillatt for alle".
 * In English the same limit reads as "12+" / "All ages".
 */
function formatAge(age) {
  if (!age) return "";
  if (lang !== "en") return age;
  const years = String(age).match(/\d+/)?.[0];
  if (years) return `${years}+`;
  return /alle/i.test(age) ? t("ageAll") : age;
}

/**
 * Genres are stored in English from IMDb/OMDb. Map them to Norwegian
 * when the app language is nb; unknown labels pass through as-is.
 */
const GENRE_NB = {
  action: "Action",
  adventure: "Eventyr",
  animation: "Animasjon",
  biography: "Biografi",
  comedy: "Komedie",
  crime: "Krim",
  documentary: "Dokumentar",
  drama: "Drama",
  family: "Familie",
  fantasy: "Fantasi",
  "film-noir": "Film noir",
  history: "Historie",
  horror: "Skrekk",
  music: "Musikk",
  musical: "Musikal",
  mystery: "Mysterie",
  romance: "Romantikk",
  "sci-fi": "Sci-fi",
  short: "Kortfilm",
  sport: "Sport",
  thriller: "Thriller",
  war: "Krig",
  western: "Western",
};

function formatGenre(genre) {
  const label = String(genre || "").trim();
  if (!label) return "";
  if (lang !== "nb") return label;
  return GENRE_NB[label.toLowerCase()] || label;
}

function normalizeCachedShow(show) {
  return {
    ...show,
    tags: cleanTags(show.tags),
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

  const today = toDayKey(new Date());
  if (!selectedDay || !days.includes(selectedDay)) {
    selectedDay = days.includes(today)
      ? today
      : days.find((d) => d >= today) || days[days.length - 1] || today;
  }

  els.dayTabs.innerHTML =
    `<span class="day-indicator" aria-hidden="true"></span>` +
    days
      .map((day) => {
        const classes = [
          "day-tab",
          day < today ? "past" : "",
          day === today ? "today" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const selected = day === selectedDay;
        return `<button type="button" class="${classes}" role="tab" data-day="${day}" aria-selected="${selected}" title="${escapeHtml(
          formatDayLabel(day)
        )}">${doneGlyph("day-tab-check")}<span class="day-tab-label">${escapeHtml(
          shortDayLabel(day)
        )}</span></button>`;
      })
      .join("");

  els.dayTabs.querySelectorAll(".day-tab").forEach((btn) => {
    btn.addEventListener("click", () => selectDay(btn.dataset.day));
  });

  markDoneDays();
  updateJumpTodayBtn();
  scrollSelectedDayTabIntoView();
  moveDayIndicator({ instant: true });
}

/**
 * Point the app at `day` and bring the header (pills, timeline, chips)
 * along, without touching the day list. Kept apart from the list so a
 * swipe can start the header moving while the page is still gliding.
 * Returns true when the day actually changed.
 */
function setSelectedDay(day) {
  if (!day || day === selectedDay || !state?.shows) return false;
  selectedDay = day;
  savePrefs();
  // Update selection in place so the liquid indicator can travel.
  els.dayTabs.querySelectorAll(".day-tab").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.day === day));
  });
  // Show/hide the today chip before scrolling so the strip width is final.
  updateJumpTodayBtn();
  moveDayIndicator();
  scrollSelectedDayTabIntoView({ behavior: "smooth" });
  renderTimeline();
  return true;
}

/** Center the active day in the strip without scrolling page ancestors
 * (scrollIntoView was dragging the jump-today chip off-screen). */
function scrollSelectedDayTabIntoView({ behavior = "auto" } = {}) {
  const tabs = els.dayTabs;
  const btn = tabs?.querySelector('.day-tab[aria-selected="true"]');
  if (!tabs || !btn) return;
  const left = btn.offsetLeft - (tabs.clientWidth - btn.offsetWidth) / 2;
  tabs.scrollTo({ left: Math.max(0, left), behavior });
}

/** Show a one-tap "I dag" chip when the selected day is not today. */
function updateJumpTodayBtn() {
  const btn = els.jumpTodayBtn;
  if (!btn) return;
  const today = toDayKey(new Date());
  const hasToday = !!state?.shows?.some((s) => s.dayKey === today);
  const away = hasToday && selectedDay && selectedDay !== today;
  btn.hidden = !away;
  btn.setAttribute("aria-label", t("jumpTodayAria"));
  const back = selectedDay > today;
  btn.dataset.dir = back ? "back" : "forward";
  const arrow = btn.querySelector(".jump-today-arrow");
  if (arrow) arrow.textContent = back ? "‹" : "›";
}

/** Day change from a tap: slides the page like a swipe would, so the list
 * and the header move together whichever way the day was picked. */
async function selectDay(day) {
  if (!day || day === selectedDay || !state?.shows) return;
  if (slideToDay?.(day)) return;
  if (!setSelectedDay(day)) return;
  renderDay();
  await enrichVisibleDay();
}

function moveDayIndicator(opts = {}) {
  const indicator = els.dayTabs.querySelector(".day-indicator");
  const btn = els.dayTabs.querySelector('.day-tab[aria-selected="true"]');
  liquidMove(indicator, btn, opts);
}

/**
 * Tick off the days whose last showing has finished. Re-run on the minute
 * tick as well as after a render, because a day turns done with the clock
 * rather than with new data.
 */
function markDoneDays() {
  if (!state?.shows) return;
  const now = new Date();
  let changed = false;
  for (const btn of els.dayTabs.querySelectorAll(".day-tab")) {
    const done = doneProgress(dayShows(btn.dataset.day), now).all;
    if (btn.classList.contains("done") === done) continue;
    btn.classList.toggle("done", done);
    changed = true;
  }
  // The checkmark widens the pill; keep the indicator sitting on it.
  if (changed) moveDayIndicator({ instant: true });
}

/**
 * The short name for a day, used by the day strip, the movie tiles, and
 * the sales charts alike. Yesterday, today, and tomorrow go by name —
 * their date is spelled out in the heading under the strip — and every
 * other day is a weekday plus its date.
 */
function shortDayLabel(dayKey) {
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
  const weekday = capitalize(weekdays()[date.getDay()]).slice(0, 3);
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

function dayShows(day) {
  return state.shows
    .filter((s) => s.dayKey === day)
    .sort((a, b) => a.start - b.start);
}

/** Full markup for one day's list; used for the visible day and for the
 * peek panes while swiping between days. */
function buildDayListHTML(day) {
  const shows = dayShows(day);
  const now = new Date();

  if (!shows.length) return emptyNote("day", "emptyDay");

  // If DX answered for some of the day's shows, the ones it skipped are
  // worth flagging; if it answered for none, stay quiet about it.
  const gaps = shows.some((s) => s.scanned != null);

  const parts = [];
  for (let i = 0; i < shows.length; i++) {
    const show = shows[i];
    const prev = shows[i - 1];
    // Gaps only make sense between consecutive shows in the same screen.
    if (prev && prev.screen === show.screen && show.end && prev.end) {
      const gapMin = Math.round((show.start - prev.end) / 60_000);
      if (gapMin >= 15) {
        parts.push(
          `<div class="gap-row">${escapeHtml(t("gap", { n: gapMin }))}</div>`
        );
      }
    }
    parts.push(renderShowCard(show, now, i, { gaps }));
  }

  return `
    ${
      PREVIEW_SCANNED
        ? `<p class="preview-banner">${escapeHtml(t("previewScannedBanner"))}</p>`
        : ""
    }
    <div class="day-block">
      <div class="section-label${doneProgress(shows, now).all ? " all-done" : ""}">
        <span class="section-label-text">${escapeHtml(formatDayLabel(day))}</span>
        ${doneTag(shows, { allLabel: "dayAllDone", now })}
      </div>
      ${parts.join("")}
    </div>
  `;
}

function renderDay() {
  if (!state?.shows) return;

  // Never replace the list while a swipe is following the finger —
  // wait for the gesture to finish, then apply the freshest data.
  if (holdDayRender) {
    queuedDayRender = true;
    return;
  }

  // Replay entrance animations only when the visible day changes,
  // not on periodic live refreshes.
  const renderKey = selectedDay;
  const isRefresh = els.content.dataset.key === renderKey;
  els.content.classList.toggle("no-anim", isRefresh);
  els.content.dataset.key = renderKey;

  renderTimeline();
  markDoneDays();

  if (!paint(els.content, buildDayListHTML(selectedDay))) return;
  observeAutoSeatCharts();
}

function showEndOf(show) {
  if (show.end) return show.end;
  const mins = Number(show.runningMinutes) || 120;
  // No confirmed end time: estimate from runtime plus ads/trailers.
  return new Date(show.start.getTime() + (mins + 15) * 60_000);
}

/** How long timeline pieces get to finish their exit transition. */
const TL_EXIT_MS = 500;

/** Everything needed to draw the header timeline for one day, expressed
 * as percentages so the same data drives both a fresh build and a morph. */
function computeTimelineLayout() {
  const now = new Date();
  // Day tab follows the selected day; other tabs always show today.
  const day = activeTab === "day" ? selectedDay : toDayKey(now);
  const shows = state.shows
    .filter((s) => s.dayKey === day)
    .sort((a, b) => a.start - b.start);

  if (!shows.length) return { day, lanes: [] };

  const HOUR = 3_600_000;
  let t0 = Math.min(...shows.map((s) => s.start.getTime()));
  let t1 = Math.max(...shows.map((s) => showEndOf(s).getTime()));
  t0 = Math.floor((t0 - 20 * 60_000) / HOUR) * HOUR;
  t1 = Math.ceil((t1 + 15 * 60_000) / HOUR) * HOUR;
  const span = t1 - t0;
  // Phone/tablet: stretch the hour scale from the shortest show so every
  // bar can hold its content, then scroll sideways. Desktop fills the column.
  const pxPerHour = timelineScrollPxPerHour(shows);
  const minWidthPx = pxPerHour
    ? Math.round((span / HOUR) * pxPerHour + TL_EDGE_PAD_PX * 2)
    : 0;
  const pctOf = (ms) => ((ms - t0) / span) * 100;

  const screens = [...new Set(shows.map((s) => s.screen))].sort((a, b) =>
    a.localeCompare(b, "nb")
  );

  const lanes = screens.map((screen) => ({
    screen,
    blocks: shows
      .filter((s) => s.screen === screen)
      .map((s) => {
        const start = s.start.getTime();
        const end = showEndOf(s).getTime();
        const left = pctOf(start);
        const startClock = formatClock(s.start);
        const endClock = s.end
          ? formatClock(s.end)
          : "~" + formatClock(showEndOf(s));
        const range = `${startClock}–${endClock}`;
        return {
          id: s.id,
          dayKey: s.dayKey,
          screen,
          title: s.title || "",
          posterUrl: s.posterUrl || "",
          startMs: start,
          left,
          width: Math.max(pctOf(end) - left, 1.5),
          status: statusOf(s, now),
          estimated: !s.end,
          startLabel: startClock,
          endLabel: endClock,
          tip: `${s.title} · ${range}`,
        };
      }),
  }));

  // Tick marks double as gridlines; keyed by timestamp so a morph can
  // slide marks for the same instant and cross-fade the rest. Step size
  // follows the real pixel density once the strip has a min-width.
  const step = timelineMarkStep(span, minWidthPx);
  const trackWidthPx = minWidthPx > 0 ? Math.max(0, minWidthPx - TL_EDGE_PAD_PX * 2) : 0;
  const pxPerHourLaid = trackWidthPx > 0 ? trackWidthPx / (span / HOUR) : 0;
  // Half-hour clock text needs room ("12:30" ≈ 28px); below ~88px/hour
  // keep the tick/gridline but drop the label so it doesn't collide.
  const labelMinors = pxPerHourLaid >= 88;
  const marks = [];
  for (let ts = t0; ts <= t1; ts += step) {
    const d = new Date(ts);
    const minor = d.getMinutes() !== 0;
    marks.push({
      ts,
      pct: pctOf(ts),
      label: minor
        ? labelMinors
          ? formatClock(d)
          : ""
        : String(d.getHours()),
      minor,
    });
  }

  const nowTs = now.getTime();
  const showNow = day === toDayKey(now) && nowTs >= t0 && nowTs <= t1;
  return {
    day,
    lanes,
    marks,
    nowPct: showNow ? pctOf(nowTs) : null,
    minWidthPx,
    spanMs: span,
  };
}

/**
 * Pixels per hour on a scrollable timeline: wide enough that the shortest
 * show of the day still fits poster, title, and start/end clocks. All
 * other bars share that scale. Desktop returns 0 (fill the column).
 */
function timelineScrollPxPerHour(shows) {
  if (!TL_SCROLL_MQ.matches || !shows?.length) return 0;
  const HOUR = 3_600_000;
  let shortestMs = Infinity;
  for (const s of shows) {
    const ms = showEndOf(s).getTime() - s.start.getTime();
    if (ms > 0 && ms < shortestMs) shortestMs = ms;
  }
  if (!Number.isFinite(shortestMs) || shortestMs <= 0) return TL_PX_PER_HOUR_FLOOR;
  const needed = TL_MIN_BAR_PX / (shortestMs / HOUR);
  return Math.max(TL_PX_PER_HOUR_FLOOR, Math.ceil(needed));
}

/** How fine the timeline axis is — half hours when space allows. */
function timelineMarkStep(span, minWidthPx = 0) {
  const HOUR = 3_600_000;
  // Prefer the track (canvas) density: subtract edge pad so ticks match
  // the same px-per-hour used to size bars.
  const trackPx = minWidthPx > 0 ? Math.max(0, minWidthPx - TL_EDGE_PAD_PX * 2) : 0;
  const widthPx =
    trackPx ||
    els.timelineMain?.querySelector(".tl-scroller")?.clientWidth ||
    0;
  const pxPerHour = widthPx > 0 ? widthPx / (span / HOUR) : 0;
  if (pxPerHour >= 52) return HALF_HOUR;
  if (pxPerHour >= 36) return HOUR;

  const wide = TL_WIDE_MQ.matches;
  if (wide) {
    // Desktop without a forced min-width: :30 unless the day is long.
    return span > 12 * HOUR ? HOUR : HALF_HOUR;
  }
  // Fallback when we don't know width yet (first paint).
  if (span > 10 * HOUR) return 2 * HOUR;
  if (span > 6.5 * HOUR) return HOUR;
  return HALF_HOUR;
}

function clearTimelineMain() {
  if (els.timelineMain) els.timelineMain.innerHTML = "";
}

function timelineHoverExpands() {
  return TL_HOVER_MQ.matches;
}

function syncTimelineExpandBtn() {
  const btn = els.timelineExpandBtn;
  if (!btn || !els.timeline) return;
  const open = els.timeline.classList.contains("is-expanded");
  const label = t(open ? "tlCollapse" : "tlExpand");
  btn.setAttribute("aria-expanded", String(open));
  btn.setAttribute("aria-label", label);
  btn.title = label;

  // Day tab: far right of the day pills. Other tabs (no pill row): sit in
  // the header actions beside refresh so the chevron never overlays bars.
  const onDay = activeTab === "day";
  btn.classList.toggle("tl-expand--docked", onDay);
  btn.classList.toggle("tl-expand--header", !onDay);

  if (onDay) {
    const host = els.dayControlsBody;
    if (host && btn.parentElement !== host) host.appendChild(btn);
  } else {
    const host = els.topActions;
    if (host && els.refreshBtn) {
      if (btn.parentElement !== host || btn.nextElementSibling !== els.refreshBtn) {
        host.insertBefore(btn, els.refreshBtn);
      }
    }
  }

  // Desktop hover / always-expanded own the layout; hide the chevron then.
  btn.hidden =
    !!els.timeline.hidden ||
    timelineHoverExpands() ||
    timelineAlwaysExpanded;
}

function setTimelineExpanded(open) {
  if (!els.timeline) return;
  if (timelineAlwaysExpanded) open = true;
  els.timeline.classList.toggle("is-expanded", !!open);
  syncTimelineExpandBtn();
  if (open && !timelineHoverExpands() && !timelineAlwaysExpanded) {
    // Let the height/morph settle a beat before scrolling — otherwise the
    // smooth horizontal scroll fights the expand animation.
    window.setTimeout(() => scrollTimelineToFocus({ smooth: true }), 220);
  }
}

/** Horizontal-only scroll so the focused bar / now-line sits in view
 * without dragging the page (scrollIntoView was shifting the sticky header). */
function scrollTimelineToFocus({ smooth = false } = {}) {
  const scroller = els.timelineMain?.querySelector(".tl-scroller");
  if (!scroller) return;
  // Only meaningful when the canvas is wider than the viewport.
  if (scroller.scrollWidth <= scroller.clientWidth + 2) return;

  const target =
    scroller.querySelector(".tl-now") ||
    scroller.querySelector(".tl-block.live") ||
    scroller.querySelector(".tl-block.soon") ||
    scroller.querySelector(".tl-block:not(.done)");
  if (!target) return;

  const sRect = scroller.getBoundingClientRect();
  const tRect = target.getBoundingClientRect();
  const targetCenter = tRect.left + tRect.width / 2;
  const viewCenter = sRect.left + sRect.width / 2;
  const next = Math.max(
    0,
    Math.min(
      scroller.scrollWidth - scroller.clientWidth,
      scroller.scrollLeft + (targetCenter - viewCenter)
    )
  );
  scroller.scrollTo({
    left: next,
    behavior: smooth ? "smooth" : "auto",
  });
}

/** Size the track canvas and keep "now" in view after a build/morph. */
function applyTimelineChrome(layout, { scroll = true, smooth = false } = {}) {
  const area = els.timelineMain?.querySelector(".tl-area");
  const scroller = els.timelineMain?.querySelector(".tl-scroller");
  if (!area || !scroller) return;

  const minPx = layout.minWidthPx || 0;
  if (minPx > 0) {
    area.style.minWidth = `${minPx}px`;
    scroller.classList.add("is-scrollable");
  } else {
    area.style.minWidth = "";
    scroller.classList.remove("is-scrollable");
  }

  if (scroll) {
    // Double rAF: wait until layout has the new min-width before measuring.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollTimelineToFocus({ smooth }));
    });
  }
}

/** Phone/tablet: chevron control (or double-tap). Desktop: hover/focus. */
function setupTimelineExpand() {
  const tl = els.timeline;
  const btn = els.timelineExpandBtn;
  if (!tl || !btn) return;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTimelineExpanded(!tl.classList.contains("is-expanded"));
  });

  tl.addEventListener("pointerenter", (e) => {
    if (!timelineHoverExpands()) return;
    if (e.pointerType === "touch") return;
    setTimelineExpanded(true);
  });
  tl.addEventListener("pointerleave", () => {
    if (!timelineHoverExpands()) return;
    setTimelineExpanded(false);
  });
  tl.addEventListener("focusin", () => {
    if (!timelineHoverExpands()) return;
    setTimelineExpanded(true);
  });
  tl.addEventListener("focusout", (e) => {
    if (!timelineHoverExpands()) return;
    if (e.relatedTarget && tl.contains(e.relatedTarget)) return;
    setTimelineExpanded(false);
  });

  // Double-tap the compact strip to toggle when a pointer isn't hovering.
  let lastTap = 0;
  tl.addEventListener(
    "pointerup",
    (e) => {
      if (timelineHoverExpands()) return;
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      if (e.target.closest?.("button, a")) return;
      const now = Date.now();
      if (now - lastTap < 320) {
        lastTap = 0;
        setTimelineExpanded(!tl.classList.contains("is-expanded"));
      } else {
        lastTap = now;
      }
    },
    { passive: true }
  );

  TL_HOVER_MQ.addEventListener?.("change", () => {
    // Leaving desktop hover mode: collapse so the button starts from closed.
    if (!timelineHoverExpands()) setTimelineExpanded(false);
    else syncTimelineExpandBtn();
  });

  syncTimelineExpandBtn();
}

function hideTimeline() {
  els.timeline.hidden = true;
  els.timeline.classList.remove("is-expanded");
  clearTimelineMain();
  syncTimelineExpandBtn();
}

function renderTimeline() {
  if (!state?.shows) return;

  // Settings is about the app, not about tonight's programme; the strip
  // has nothing to say there and only crowds the header.
  if (activeTab === "settings") {
    hideTimeline();
    return;
  }

  const layout = computeTimelineLayout();

  if (!layout.lanes.length) {
    hideTimeline();
    return;
  }

  // Morph the existing bars into the new day's layout when possible;
  // build from scratch only when there is nothing on screen yet.
  const hadTracks = !els.timeline.hidden && els.timelineMain?.querySelector(".tl-tracks");
  if (hadTracks) {
    morphTimeline(layout);
  } else {
    buildTimeline(layout);
  }
  if (timelineAlwaysExpanded) els.timeline.classList.add("is-expanded");
  syncTimelineExpandBtn();
  // Fresh build: jump to now. Day morph: ease there so the strip doesn't jump.
  applyTimelineChrome(layout, { scroll: true, smooth: hadTracks });
}

function tlBlockArtHTML(b) {
  if (b.posterUrl) {
    return `<img class="tl-block-poster" src="${escapeHtml(
      b.posterUrl
    )}" alt="" loading="lazy" width="28" height="40" draggable="false" />`;
  }
  const initial = escapeHtml((b.title || "?").slice(0, 1));
  return `<span class="tl-block-poster-fallback" aria-hidden="true">${initial}</span>`;
}

function tlBlockInnerHTML(b) {
  return `${tlBlockArtHTML(b)}
    <span class="tl-block-meta">
      <span class="tl-block-title">${escapeHtml(b.title)}</span>
      <span class="tl-block-times">
        <span class="tl-block-start">${escapeHtml(b.startLabel)}</span>
        <span class="tl-block-end">${escapeHtml(b.endLabel)}</span>
      </span>
    </span>`;
}

/** Compact hall label for the timeline gutter — "Kinosal"→"Kino", etc. */
function shortScreenLabel(screen) {
  const name = String(screen || "").trim();
  if (/sal$/i.test(name) && name.length > 4) return name.slice(0, -3);
  return name;
}

function tlLaneNameHTML(screen) {
  const full = escapeHtml(screen);
  const short = escapeHtml(shortScreenLabel(screen));
  return `<span class="tl-lane-full">${full}</span><span class="tl-lane-short">${short}</span>`;
}

function fillTlLaneName(el, screen) {
  el.dataset.screen = screen;
  el.title = screen;
  el.innerHTML = tlLaneNameHTML(screen);
}

function buildTimeline(layout) {
  const blockHTML = (b) => `<button type="button" class="tl-block ${b.status}${
    b.estimated ? " estimated" : ""
  }"
      style="left:${b.left}%;width:${b.width}%"
      data-tl-show="${escapeHtml(b.id)}"
      title="${escapeHtml(b.tip)}"
      aria-label="${escapeHtml(b.tip)}">
      ${tlBlockInnerHTML(b)}
    </button>`;

  els.timeline.hidden = false;
  els.timelineMain.innerHTML = `
    <div class="tl-names">${layout.lanes
      .map(
        (l) =>
          `<span class="tl-lane-name" data-screen="${escapeHtml(l.screen)}" title="${escapeHtml(l.screen)}">${tlLaneNameHTML(l.screen)}</span>`
      )
      .join("")}</div>
    <div class="tl-scroller">
      <div class="tl-area">
        <div class="tl-canvas">
          <div class="tl-gridlines">${layout.marks
            .map(
              (m) =>
                `<span class="tl-gridline${m.minor ? " minor" : ""}" data-ts="${m.ts}" style="left:${m.pct}%"></span>`
            )
            .join("")}</div>
          <div class="tl-tracks">${layout.lanes
            .map(
              (l) =>
                `<div class="tl-track" data-screen="${escapeHtml(l.screen)}">${l.blocks
                  .map(blockHTML)
                  .join("")}</div>`
            )
            .join("")}</div>
          ${
            layout.nowPct != null
              ? `<div class="tl-now" style="left:${layout.nowPct}%"><span class="tl-now-dot"></span></div>`
              : ""
          }
          <div class="tl-hours">${layout.marks
            .map(
              (m) =>
                `<span class="tl-hour${m.minor ? " minor" : ""}" data-ts="${m.ts}" style="left:${m.pct}%">${m.label}</span>`
            )
            .join("")}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Update the timeline in place so CSS transitions carry every piece to
 * its new spot: bars stretch/shrink and slide to the new day's shows,
 * leftover bars collapse away, new ones grow in, and hour marks slide
 * or cross-fade. Also used by the minute refresh, where only statuses
 * and the "now" line move.
 */
function morphTimeline(layout) {
  const root = els.timelineMain || els.timeline;
  const namesBox = root.querySelector(".tl-names");
  const gridsBox = root.querySelector(".tl-gridlines");
  const tracksBox = root.querySelector(".tl-tracks");
  const hoursBox = root.querySelector(".tl-hours");
  const area = root.querySelector(".tl-area");
  // Prefer the inset canvas; fall back to the area for older markup mid-session.
  const canvas = root.querySelector(".tl-canvas") || area;
  if (!namesBox || !gridsBox || !tracksBox || !hoursBox || !canvas) {
    buildTimeline(layout);
    return;
  }
  // Upgrade a pre-canvas timeline in place once, so inset padding applies.
  if (!root.querySelector(".tl-canvas") && area) {
    buildTimeline(layout);
    return;
  }

  /** Finishing touches for entering nodes, applied one frame after they
   * are inserted with their start styles so the transition can play. */
  const entered = [];

  const applyBlock = (el, b) => {
    el.className = `tl-block ${b.status}${b.estimated ? " estimated" : ""}`;
    el.style.left = `${b.left}%`;
    el.style.width = `${b.width}%`;
    el.style.opacity = "";
    el.dataset.tlShow = b.id;
    el.title = b.tip;
    el.setAttribute("aria-label", b.tip);
    const titleEl = el.querySelector(".tl-block-title");
    const startEl = el.querySelector(".tl-block-start");
    const endEl = el.querySelector(".tl-block-end");
    const posterEl = el.querySelector(".tl-block-poster");
    const fallbackEl = el.querySelector(".tl-block-poster-fallback");
    if (titleEl && startEl && endEl && (posterEl || fallbackEl)) {
      titleEl.textContent = b.title;
      startEl.textContent = b.startLabel;
      endEl.textContent = b.endLabel;
      if (b.posterUrl) {
        if (posterEl) {
          if (posterEl.getAttribute("src") !== b.posterUrl) {
            posterEl.setAttribute("src", b.posterUrl);
          }
        } else {
          el.innerHTML = tlBlockInnerHTML(b);
        }
      } else if (fallbackEl) {
        fallbackEl.textContent = (b.title || "?").slice(0, 1);
      } else {
        el.innerHTML = tlBlockInnerHTML(b);
      }
    } else {
      el.innerHTML = tlBlockInnerHTML(b);
    }
  };

  const exitEl = (el, style) => {
    el.classList.add("tl-exit");
    Object.assign(el.style, style, { opacity: "0" });
    setTimeout(() => el.remove(), TL_EXIT_MS);
  };

  // Lanes (screen names + their tracks), keyed by screen name.
  const oldNames = new Map(
    [...namesBox.querySelectorAll(".tl-lane-name:not(.tl-exit)")].map((el) => [
      el.dataset.screen,
      el,
    ])
  );
  const oldTracks = new Map(
    [...tracksBox.querySelectorAll(".tl-track:not(.tl-exit)")].map((el) => [
      el.dataset.screen,
      el,
    ])
  );

  let prevName = null;
  let prevTrack = null;
  for (const lane of layout.lanes) {
    let nameEl = oldNames.get(lane.screen);
    let trackEl = oldTracks.get(lane.screen);
    oldNames.delete(lane.screen);
    oldTracks.delete(lane.screen);

    if (!nameEl) {
      nameEl = document.createElement("span");
      nameEl.className = "tl-lane-name";
      fillTlLaneName(nameEl, lane.screen);
      nameEl.style.height = "0px";
      nameEl.style.opacity = "0";
      entered.push(() => {
        // Clear the inline height so the stylesheet (incl. breakpoints) wins.
        nameEl.style.height = "";
        nameEl.style.opacity = "1";
      });
    } else if (
      !nameEl.querySelector(".tl-lane-full") ||
      nameEl.dataset.screen !== lane.screen
    ) {
      fillTlLaneName(nameEl, lane.screen);
    }
    if (!trackEl) {
      trackEl = document.createElement("div");
      trackEl.className = "tl-track";
      trackEl.dataset.screen = lane.screen;
      trackEl.style.height = "0px";
      trackEl.style.opacity = "0";
      entered.push(() => {
        trackEl.style.height = "";
        trackEl.style.opacity = "1";
      });
    }
    // Keep names and tracks in the same (sorted) order.
    namesBox.insertBefore(nameEl, prevName ? prevName.nextSibling : namesBox.firstChild);
    tracksBox.insertBefore(
      trackEl,
      prevTrack ? prevTrack.nextSibling : tracksBox.firstChild
    );
    prevName = nameEl;
    prevTrack = trackEl;

    // Pair old and new bars in time order: paired bars glide and stretch
    // into place, extras collapse into their midpoint, new ones grow out.
    const oldBlocks = [...trackEl.querySelectorAll(".tl-block:not(.tl-exit)")];
    lane.blocks.forEach((b, i) => {
      if (i < oldBlocks.length) {
        applyBlock(oldBlocks[i], b);
        return;
      }
      const el = document.createElement("button");
      el.type = "button";
      el.className = `tl-block ${b.status}${b.estimated ? " estimated" : ""}`;
      el.style.left = `${b.left + b.width / 2}%`;
      el.style.width = "0%";
      el.style.opacity = "0";
      el.innerHTML = tlBlockInnerHTML(b);
      trackEl.appendChild(el);
      entered.push(() => applyBlock(el, b));
    });
    for (let i = lane.blocks.length; i < oldBlocks.length; i++) {
      const el = oldBlocks[i];
      const mid =
        (parseFloat(el.style.left) || 0) + (parseFloat(el.style.width) || 0) / 2;
      exitEl(el, { left: `${mid}%`, width: "0%" });
    }
  }
  for (const el of oldNames.values()) exitEl(el, { height: "0px" });
  for (const el of oldTracks.values()) exitEl(el, { height: "0px" });

  // Hour gridlines and labels, keyed by timestamp.
  const patchMarks = (box, cls, withLabel) => {
    const old = new Map(
      [...box.querySelectorAll(`.${cls}:not(.tl-exit)`)].map((el) => [
        el.dataset.ts,
        el,
      ])
    );
    for (const m of layout.marks) {
      const className = m.minor ? `${cls} minor` : cls;
      let el = old.get(String(m.ts));
      if (el) {
        old.delete(String(m.ts));
        el.className = className;
        el.style.left = `${m.pct}%`;
        if (withLabel) el.textContent = m.label;
      } else {
        el = document.createElement("span");
        el.className = className;
        el.dataset.ts = m.ts;
        el.style.left = `${m.pct}%`;
        el.style.opacity = "0";
        if (withLabel) el.textContent = m.label;
        box.appendChild(el);
        entered.push(() => {
          el.style.opacity = "1";
        });
      }
    }
    for (const el of old.values()) exitEl(el, {});
  };
  patchMarks(gridsBox, "tl-gridline", false);
  patchMarks(hoursBox, "tl-hour", true);

  // "Now" line: slide when it stays, fade when it appears or leaves.
  let nowEl = canvas.querySelector(".tl-now:not(.tl-exit)");
  if (layout.nowPct != null) {
    if (nowEl) {
      nowEl.style.left = `${layout.nowPct}%`;
    } else {
      nowEl = document.createElement("div");
      nowEl.className = "tl-now";
      nowEl.style.left = `${layout.nowPct}%`;
      nowEl.style.opacity = "0";
      nowEl.appendChild(document.createElement("span")).className = "tl-now-dot";
      canvas.insertBefore(nowEl, hoursBox);
      entered.push(() => {
        nowEl.style.opacity = "1";
      });
    }
  } else if (nowEl) {
    exitEl(nowEl, {});
  }

  // Flush start styles, then let entering pieces transition into place.
  if (entered.length) {
    void canvas.offsetWidth;
    for (const fn of entered) fn();
  }
}

/** Jump from a timeline bar to that showing's card in the day list. */
async function focusShowFromTimeline(showId) {
  if (!showId || !state?.shows) return;
  const show = state.shows.find((s) => s.id === showId);
  if (!show) return;

  const dayChanged = !!(show.dayKey && show.dayKey !== selectedDay);
  if (dayChanged) setSelectedDay(show.dayKey);

  if (activeTab !== "day") {
    await setActiveTab("day");
  } else if (dayChanged) {
    renderDay();
  }

  // Let the day list paint before scrolling — tab/day switches rebuild it.
  requestAnimationFrame(() => {
    const card = els.content?.querySelector(
      `[data-show="${cssEscape(showId)}"]`
    );
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("tl-target");
    void card.offsetWidth;
    card.classList.add("tl-target");
    window.setTimeout(() => card.classList.remove("tl-target"), 1100);
  });
}

/**
 * Finished showings are struck through everywhere they appear — the
 * timeline, the day list, the day strip, the movie tiles — so "done" is
 * something you see rather than something you infer from a faint card.
 * These helpers keep that judgement in one place.
 */
function isDone(show, now = new Date()) {
  return statusOf(show, now) === "done";
}

/** How much of a set of showings is behind us. */
function doneProgress(shows, now = new Date()) {
  const total = shows.length;
  const done = shows.reduce((n, s) => n + (isDone(s, now) ? 1 : 0), 0);
  return { done, total, all: total > 0 && done === total };
}

function doneGlyph(className = "done-glyph") {
  return `<svg class="${className}" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.6 8.5l3.6 3.6 7.2-8" /></svg>`;
}

/** The "3/5 ferdig" / "Dagen er ferdig" tag used by day and movie headers. */
function doneTag(shows, { allLabel, className = "done-tag", now = new Date() } = {}) {
  const { done, total, all } = doneProgress(shows, now);
  if (!total || !done) return "";
  const label = all ? t(allLabel) : t("doneCount", { n: done, total });
  return `<span class="${className}${all ? " all" : ""}">${
    all ? doneGlyph() : ""
  }${escapeHtml(label)}</span>`;
}

/** Thin left rail with vertical NOW / DONE — replaces the old colour stripe. */
function renderShowStatusRail(status) {
  if (status !== "live" && status !== "done") return "";
  const label = status === "live" ? t("now") : t("done");
  return `<div class="show-status" aria-label="${escapeHtml(label)}"><span>${escapeHtml(
    label
  )}</span></div>`;
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

/**
 * The check-in picture for one show: how many of the sold tickets have
 * been scanned, and what someone working the door needs to read off it.
 *
 *  complete — every sold ticket is scanned, the room is full
 *  partial  — people are still coming in, `missing` are outstanding
 *  none     — doors are open but nobody has scanned yet
 *  unknown  — DX is connected but hasn't given a number for this show
 *
 * Returns null when there is simply nothing to say (no DX account, show
 * still hours away, nothing sold).
 */
function admissionOf(show, now = new Date(), { gaps = false } = {}) {
  if (!scanVisible() || show.sold == null) return null;

  const sold = Number(show.sold) || 0;
  const scanned =
    show.scanned == null ? null : Math.max(0, Number(show.scanned) || 0);
  const status = statusOf(show, now);
  // Before the doors open there is nothing to let in yet.
  const open = status !== "upcoming";
  const over = status === "done";

  if (scanned == null) {
    if (!open || !sold) return null;
    // A blank slot is only worth pointing out while people are actually
    // coming in, or when the rest of the day did report numbers.
    if (!gaps && status !== "live" && status !== "soon") return null;
    return { state: "unknown", scanned: null, sold, missing: null, pct: 0, over };
  }
  if (!sold) {
    if (!scanned) return null;
    return { state: "complete", scanned, sold: scanned, missing: 0, pct: 100, over };
  }

  const missing = Math.max(sold - scanned, 0);
  const pct = Math.min(Math.round((scanned / sold) * 100), 100);
  const state = scanned >= sold ? "complete" : scanned > 0 ? "partial" : "none";
  if (state === "none" && !open) return null;
  return { state, scanned, sold, missing, pct, over };
}

function admissionLabel(admission) {
  if (admission.state === "unknown") return t("admitUnknown");
  if (admission.state === "complete") return t("admitAllIn");
  // Once the film is over the gap is no-shows, not people still queueing.
  if (admission.state === "none") {
    return admission.over ? t("admitNobodyCame") : t("admitNone");
  }
  const key = admission.over ? "admitNoShow" : "admitMissing";
  return t(key, { n: admission.missing });
}

function admissionIcon(state) {
  if (state === "complete") {
    return `<svg class="admit-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.4l3.6 3.6 7.4-8" /></svg>`;
  }
  if (state === "unknown") {
    return `<svg class="admit-glyph dashed" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /></svg>`;
  }
  // Someone stepping through the door.
  return `<svg class="admit-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.6 2.6h3.1v10.8H9.6" /><path d="M2.2 8h6.2M6.1 5.6 8.5 8l-2.4 2.4" /></svg>`;
}

/** The admission strip under a show card — the door-side answer at a glance. */
function renderAdmission(show, now, opts) {
  const admission = admissionOf(show, now, opts);
  if (!admission) return "";

  const count =
    admission.state === "unknown"
      ? `<span class="admit-count unknown">–<span class="admit-total">/${admission.sold}</span></span>`
      : `<span class="admit-count"><strong>${admission.scanned}</strong><span class="admit-total">/${admission.sold}</span></span>`;

  return `
      <div class="admit ${admission.state}" role="group" aria-label="${escapeHtml(
        t("admitAria", { n: admission.scanned ?? 0, total: admission.sold })
      )}">
        ${admissionIcon(admission.state)}
        ${count}
        <span class="admit-track" aria-hidden="true"><span class="admit-fill" style="width:${admission.pct}%"></span></span>
        <span class="admit-state">${escapeHtml(admissionLabel(admission))}</span>
      </div>
  `;
}

/* —— Seat chart ——————————————————————————————————————————————
 *
 * The admission strip answers "how many are in?"; the seat chart
 * answers "where are they sitting?". It stays folded away behind one
 * button per show so the day list keeps its shape, and the hall is only
 * fetched when someone actually asks to see it.
 */

function loadSeatLayouts() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEAT_MAP_KEY) || "{}");
    if (!raw || typeof raw !== "object") return {};
    const fresh = {};
    for (const [key, entry] of Object.entries(raw)) {
      if (
        entry?.layout &&
        entry.v === SEAT_LAYOUT_VERSION &&
        Date.now() - (entry.at || 0) < SEAT_LAYOUT_TTL_MS
      ) {
        fresh[key] = entry;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function seatLayoutKey(partnerId, locationId) {
  return `${partnerId}:${locationId}`;
}

function rememberSeatLayout(partnerId, locationId, layout) {
  if (!layout || locationId == null) return;
  seatLayouts[seatLayoutKey(partnerId, locationId)] = {
    at: Date.now(),
    v: SEAT_LAYOUT_VERSION,
    layout,
  };
  try {
    localStorage.setItem(SEAT_MAP_KEY, JSON.stringify(seatLayouts));
  } catch (err) {
    console.warn("Could not store seat layout", err);
  }
}

function seatPartnerOf(show) {
  return String(show.promoterId || dxAuth?.partnerId || DX_PARTNER_ID);
}

/** The hall drawing for a show, from whichever cache already knows it. */
function seatLayoutOf(show, locationId) {
  const id = locationId ?? seatHalls.get(show.screen);
  if (id == null) return null;
  return seatLayouts[seatLayoutKey(seatPartnerOf(show), id)]?.layout || null;
}

/**
 * Is a seat chart worth offering for this show? Any numbered hall with
 * a DX event — including when nothing has sold yet — and never for
 * halls DX has already said have no numbered seats, nor for a showing
 * whose event DX has deleted.
 */
function seatChartOffered(show) {
  if (!show.eventId || show.eventStatus === "unavailable") return false;
  if (show.eventStatus === "gone") return false;
  if (!scanVisible()) return false;
  const chart = seatCharts.get(String(show.eventId));
  if (chart?.status === "empty") return false;
  return true;
}

/**
 * Seats a guest could still buy: the hall DX opened for this show, less
 * the ones held by reservations. That is the capacity the show card
 * already counts against, so both places agree.
 */
function seatsOnSale(chart) {
  return Math.max((chart.capacity || 0) - (chart.reserved || 0), 0);
}

/** Sold seats read as plain sales until the doors open and scanning starts. */
function seatPhaseOf(show, chart, now = new Date()) {
  if (chart?.scanned > 0) return "door";
  return statusOf(show, now) === "upcoming" ? "sales" : "door";
}

/**
 * Pull one hall from the bridge. The layout only travels when this
 * device has never seen that auditorium; after that a refresh is just
 * the occupied seat ids.
 */
async function loadSeatChart(
  show,
  { force = false, retry = true, quiet = false } = {}
) {
  const key = String(show.eventId);
  const previous = seatCharts.get(key);
  if (previous?.status === "loading") return;
  // While the doors are open every scan moves a seat from amber to
  // green, so the chart is allowed to go stale for a beat rather than
  // most of a minute.
  if (
    !force &&
    previous?.status === "ready" &&
    Date.now() - previous.at < doorFreshMs(show)
  ) {
    return;
  }

  // `?previewScanned=1` still paints sample halls so the UI can be
  // reviewed without waiting on the bridge.
  if (PREVIEW_SCANNED) {
    seatCharts.set(key, previewSeatChart(show));
    paintSeatChart(show);
    return;
  }

  const wasReady = previous?.status === "ready";
  seatCharts.set(key, { ...previous, status: "loading", wasReady });
  // A chart that already has seats keeps showing them while the refresh
  // runs; flashing a spinner every few seconds would make it unreadable.
  if (!wasReady) paintSeatChart(show);

  const partnerId = seatPartnerOf(show);
  let cardChanged = false;
  let skipPaint = false;
  if (!quiet) setBusy(true);
  try {
    const seatPayload = {
      action: "seats",
      partnerId,
      eventId: key,
      withLayout: !seatLayoutOf(show),
    };
    if (dxAuth?.token) seatPayload.token = dxAuth.token;
    const { status, ok, data } = await callDxProxy(seatPayload);

    if (status === 401 || status === 403) {
      if (retry) {
        clearDxToken();
        seatCharts.delete(key);
        return loadSeatChart(show, { force: true, retry: false, quiet });
      }
      throw dxError(data.error || "DX session expired", "auth");
    }
    if (!ok) throw new Error(data.error || `bridge ${status}`);

    if (data.token) rememberDxToken(data.token);
    if (data.locationId != null) seatHalls.set(show.screen, data.locationId);
    if (data.layout) {
      rememberSeatLayout(partnerId, data.locationId, data.layout);
    }

    const layout = seatLayoutOf(show, data.locationId);
    const empty = Boolean(data.freeSeating) || !layout;
    const capacity = Number(data.capacity) || 0;
    const fresh = {
      status: empty ? "empty" : "ready",
      reason: data.freeSeating ? "free" : layout ? "" : "noMap",
      at: Date.now(),
      locationId: data.locationId,
      // DX counts held seats inside the hall's capacity; the show card
      // counts against what is left to sell. Without a capacity from DX
      // the card's own figure is already the second kind.
      capacity: capacity || show.capacity || 0,
      reserved: capacity ? Number(data.reserved) || 0 : 0,
      sold: Number(data.sold) || 0,
      scanned: Number(data.scanned) || 0,
      unseated: Number(data.unseated) || 0,
      seats: data.seats || {},
    };
    seatCharts.set(key, fresh);

    // A refresh that brought back the same picture has nothing to redraw.
    skipPaint =
      previous?.status === "ready" &&
      fresh.status === "ready" &&
      previous.sold === fresh.sold &&
      previous.scanned === fresh.scanned &&
      previous.capacity === fresh.capacity &&
      previous.reserved === fresh.reserved &&
      JSON.stringify(previous.seats) === JSON.stringify(fresh.seats);

    // The same call DX answers with seats also carries the freshest
    // sold/scanned/reserved figures, so the card above the chart stays
    // in step — "6 res." under the ticket count and six blue squares
    // below it come from the same response.
    if (typeof data.sold === "number" && show.sold !== data.sold) {
      show.sold = data.sold;
      cardChanged = true;
    }
    if (typeof data.scanned === "number" && show.scanned !== data.scanned) {
      show.scanned = data.scanned;
      show.scannedAt = Date.now();
      cardChanged = true;
    }
    if (typeof data.reserved === "number" && show.reserved !== data.reserved) {
      show.reserved = data.reserved;
      cardChanged = true;
    }
    if (cardChanged) persistHistory([show]);
  } catch (err) {
    if (err?.code === "auth") {
      console.warn("DX bridge session failed", err);
      clearDxToken();
      dxScanStatus.error = String(err?.message || "auth");
      seatCharts.set(key, {
        status: "error",
        at: Date.now(),
        error: String(err?.message || err),
      });
      paintSeatChart(show);
      return;
    }
    if (previous?.status === "ready") {
      // A background refresh that hiccuped must not wipe a chart that
      // was fine seconds ago; keep the old picture and retry next pass.
      seatCharts.set(key, previous);
      skipPaint = true;
    } else {
      seatCharts.set(key, {
        status: "error",
        at: Date.now(),
        error: String(err?.message || err),
      });
    }
  } finally {
    if (!quiet) setBusy(false);
  }

  // Fresher numbers redraw the card and, with it, every chart below one;
  // otherwise only this chart needs repainting.
  if (cardChanged) renderActiveView();
  else if (!skipPaint) paintSeatChart(show);
}

/** Replace just this show's chart, so opening one never reflows the day. */
function paintSeatChart(show) {
  const open = seatChartExpanded(show);
  // The day list now holds markup the last full render did not write.
  repaintNext(els.content);
  for (const host of document.querySelectorAll(
    `[data-seat-show="${cssEscape(show.id)}"]`
  )) {
    host.innerHTML = renderSeatChart(show);
    host.closest(".show-row")?.classList.toggle("seats-open", open);
  }
  for (const btn of document.querySelectorAll(
    `[data-seat-toggle="${cssEscape(show.id)}"]`
  )) {
    btn.setAttribute("aria-expanded", String(open));
  }
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

async function toggleSeatChart(showId) {
  const show = state?.shows?.find((s) => s.id === showId);
  if (!show || seatsAlwaysOpen()) return;

  if (openSeatCharts.has(showId)) {
    openSeatCharts.delete(showId);
    const row = document
      .querySelector(`[data-seat-toggle="${cssEscape(showId)}"]`)
      ?.closest(".show-row");
    const panel = row?.querySelector(".seat-panel");
    row?.classList.remove("seats-open");
    for (const btn of document.querySelectorAll(
      `[data-seat-toggle="${cssEscape(showId)}"]`
    )) {
      btn.setAttribute("aria-expanded", "false");
    }
    // Collapse with the same grid-rows transition as open, then sync markup.
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (panel && !reduceMotion) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        panel.addEventListener(
          "transitionend",
          (e) => {
            if (e.target === panel) finish();
          },
          { once: true }
        );
        // grid-template-rows transitionend is flaky in some engines.
        setTimeout(finish, 340);
      });
    }
    paintSeatChart(show);
    return;
  }
  openSeatCharts.add(showId);
  paintSeatChart(show);
  await loadSeatChart(show);
}

/**
 * Fetch the halls that are unfolded by width as they come into view, so a
 * wide day list costs one lookup per chart the visitor actually reaches
 * instead of one per show the moment the day opens.
 */
function observeAutoSeatCharts() {
  if (!seatsAlwaysOpen() || typeof IntersectionObserver !== "function") {
    seatAutoObserver?.disconnect();
    return;
  }

  if (!seatAutoObserver) {
    seatAutoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          seatAutoObserver.unobserve(entry.target);
          const show = state?.shows?.find(
            (s) => s.id === entry.target.dataset.seatShow
          );
          if (!show) continue;
          loadSeatChart(show).catch((err) =>
            console.warn("Seat chart load failed", err)
          );
        }
      },
      { rootMargin: "300px 0px" }
    );
  } else {
    seatAutoObserver.disconnect();
  }

  for (const host of document.querySelectorAll("[data-seat-show]")) {
    const show = state?.shows?.find((s) => s.id === host.dataset.seatShow);
    if (!show) continue;
    // Halls this device already knows are kept current by the live
    // refresh; only the ones with nothing to draw need fetching here.
    const chart = seatCharts.get(String(show.eventId));
    if (chart && chart.status !== "error") continue;
    seatAutoObserver.observe(host);
  }
}

/**
 * Which of the elements carrying `data-<key>` are inside the viewport
 * right now. A hidden tab measures as nothing, so only the view the
 * visitor is actually on counts.
 */
function idsOnScreen(selector, key) {
  const ids = new Set();
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  for (const el of document.querySelectorAll(selector)) {
    const box = el.getBoundingClientRect();
    if (!box.width && !box.height) continue;
    if (box.bottom > 0 && box.top < vh && box.right > 0 && box.left < vw) {
      ids.add(el.dataset[key]);
    }
  }
  return ids;
}

/** The shows whose chart is somewhere the visitor can actually see it. */
function seatChartsOnScreen() {
  return idsOnScreen("[data-seat-show]", "seatShow");
}

/**
 * The shows drawn where the visitor can read them right now — cards in
 * the day list, showtimes inside a movie tile. Their figures ride the
 * beat; the rest of the programme keeps to the calm cycle.
 */
function showsOnScreen() {
  return idsOnScreen("[data-show]", "show");
}

/** Keep unfolded charts current with the beat. */
async function refreshOpenSeatCharts({ quiet = false } = {}) {
  if (!state?.shows) return;
  if (!openSeatCharts.size && !seatsAlwaysOpen()) return;
  // Charts nobody asked for are only worth refreshing while on screen.
  const visible = seatsAlwaysOpen() ? seatChartsOnScreen() : null;

  for (const show of state.shows) {
    if (!seatChartExpanded(show)) continue;
    // A show that ended hours ago cannot gain another guest.
    if (show.scanDone) continue;
    if (!openSeatCharts.has(show.id) && !visible?.has(show.id)) continue;
    await loadSeatChart(show, { quiet }).catch((err) =>
      console.warn("Seat chart refresh failed", err)
    );
  }
}

function seatsAlwaysOpen() {
  return SEATS_OPEN_MQ.matches;
}

/** Is this show's hall on screen right now — unfolded by hand, or by width? */
function seatChartExpanded(show) {
  return seatsAlwaysOpen() || openSeatCharts.has(show.id);
}

/** The strip under a show card: a fold-out button on phones, a plain
 * heading for the chart that is already open on wider screens. */
function renderSeatToggle(show) {
  const open = seatChartExpanded(show);
  const chart = seatCharts.get(String(show.eventId));
  const capacity = show.capacity || (chart ? seatsOnSale(chart) : 0);
  const hint = capacity
    ? t("seatMapHint", { sold: show.sold ?? 0, capacity })
    : "";

  const head = `
      ${icon("seats", "seat-strip-glyph")}
      <span class="seat-strip-label">${escapeHtml(t("seatMapLabel"))}</span>
      ${hint ? `<span class="seat-strip-hint">${escapeHtml(hint)}</span>` : ""}`;

  const strip = seatsAlwaysOpen()
    ? `<div class="seat-strip static">${head}</div>`
    : `<button class="seat-strip" type="button" data-seat-toggle="${escapeHtml(show.id)}"
            aria-expanded="${open}" aria-controls="seatchart-${escapeHtml(show.id)}"
            aria-label="${escapeHtml(
              t("seatMapOpen", {
                title: show.title,
                time: formatClock(show.start),
              })
            )}">
      ${head}
      <svg class="seat-chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4.4 6.2 3.6 3.6 3.6-3.6" />
      </svg>
    </button>`;

  return `
    ${strip}
    <div class="seat-panel" id="seatchart-${escapeHtml(show.id)}">
      <div class="seat-wrap" data-seat-show="${escapeHtml(show.id)}">${
        open ? renderSeatChart(show) : ""
      }</div>
    </div>
  `;
}

function renderSeatChart(show) {
  if (!seatChartExpanded(show)) return "";
  const chart = seatCharts.get(String(show.eventId));

  // A chart being refreshed still carries its previous seats; keep
  // drawing those and only fall back to the spinner on the first load.
  if (!chart || (chart.status === "loading" && !chart.wasReady)) {
    return `<div class="seat-note">
      <span class="seat-spinner" aria-hidden="true"></span>${escapeHtml(t("seatMapLoading"))}
    </div>`;
  }
  if (chart.status === "error") {
    return `<div class="seat-note error">
      <span>${escapeHtml(t("seatMapError"))}</span>
      <button class="seat-retry" type="button" data-seat-retry="${escapeHtml(show.id)}">${escapeHtml(
        t("seatMapRetry")
      )}</button>
    </div>`;
  }
  if (chart.status === "empty") {
    return `<div class="seat-note">${escapeHtml(
      t(chart.reason === "free" ? "seatMapFree" : "seatMapNone")
    )}</div>`;
  }

  const layout = seatLayoutOf(show, chart.locationId);
  if (!layout) return `<div class="seat-note">${escapeHtml(t("seatMapNone"))}</div>`;

  const phase = seatPhaseOf(show, chart);
  const states = Object.values(chart.seats);
  const taken = states.filter((s) => s === 1 || s === 2).length;
  const scannedSeats = states.filter((s) => s === 2).length;
  const reservedSeats = states.filter((s) => s === 3).length;
  const free = Math.max(seatsOnSale(chart) - taken, 0);

  // Closed-off seats: struck by this showing's statuses, or closed in
  // the hall map itself — each seat counted once, however DX says it.
  let blockedSeats = 0;
  for (const row of layout.rows) {
    for (const seat of row.seats) {
      const state = chart.seats[seat.i];
      if (state === 4 || (seat.b && !state)) blockedSeats++;
    }
  }

  // Tickets without a seatId (free seating leftovers, companion passes)
  // have nowhere to draw — say so under the chart. Holds — staff
  // reservations and seats sitting in a customer's checkout — are
  // painted as blue squares from seatStatuses + /reservations.
  const notes = [
    chart.unseated ? t("seatUnseated", { n: chart.unseated }) : "",
  ].filter(Boolean);

  const legend =
    phase === "sales"
      ? [
          ["free", t("seatFree"), free],
          ["sold", t("seatSold"), taken],
        ]
      : [
          ["free", t("seatFree"), free],
          ["sold", t("seatWaiting"), taken - scannedSeats],
          ["in", t("seatIn"), scannedSeats],
        ];
  if (reservedSeats) legend.push(["reserved", t("seatReserved"), reservedSeats]);
  if (blockedSeats) legend.push(["blocked", t("seatBlocked"), blockedSeats]);

  return `
    <div class="seat-chart phase-${phase}">
      ${seatChartSvg(layout, chart.seats, show)}
      <div class="seat-legend">
        ${legend
          .map(
            ([key, label, n]) => `<span class="seat-key ${key}">
              <span class="seat-swatch" aria-hidden="true"></span>${escapeHtml(label)}
              <strong>${n}</strong>
            </span>`
          )
          .join("")}
        <span class="seat-picked" data-seat-picked="${escapeHtml(show.id)}"></span>
      </div>
      ${
        notes.length
          ? `<p class="seat-notes">${escapeHtml(notes.join(" · "))}</p>`
          : ""
      }
    </div>
  `;
}

/**
 * The hall itself, drawn in DX's own coordinates so it matches the chart
 * staff see in DX: screen at the top, row 1 nearest it.
 */
function seatChartSvg(layout, seats, show) {
  const { box, pitch } = layout;
  const w = pitch.x * 0.78;
  const h = pitch.y * 0.72;
  const gutter = pitch.x * 1.7;
  const pad = pitch.x * 0.5;

  // The screen sits above row 1: an arc, with its caption clear of the apex.
  const arcY = box.y - pitch.y / 2 - pitch.y * 0.9;
  const arcRise = pitch.y * 0.55;
  const labelSize = pitch.y * 0.58;
  const labelY = arcY - arcRise - pitch.y * 0.4;

  const top = labelY - labelSize;
  const bottom = box.y + box.h + pitch.y / 2 + pad;
  const vb = {
    x: box.x - pitch.x / 2 - gutter - pad,
    y: top,
    w: box.w + pitch.x + (gutter + pad) * 2,
    h: bottom - top,
  };
  const left = box.x - pitch.x / 2 - gutter / 2;
  const right = box.x + box.w + pitch.x / 2 + gutter / 2;

  // A row's number is repeated at both ends, the way it is painted on
  // the walls of a cinema, so a seat is easy to find from either aisle.
  const rowLabel = (row, x) =>
    `<text class="seat-row-label" x="${x.toFixed(1)}" y="${row.y}" dy="0.34em"
       font-size="${(pitch.y * 0.62).toFixed(1)}">${escapeHtml(row.name)}</text>`;

  const classOf = { 1: "sold", 2: "in", 3: "reserved", 4: "blocked" };
  // One bold size for every seat — sized to fill most of the square,
  // capped so two-digit numbers still fit the same as single digits.
  const numSize = showSeatNumbers ? Math.min(h * 0.72, w * 0.55) : 0;
  const rows = layout.rows
    .map((row) => {
      const seatEls = row.seats
        .map((seat) => {
          // A seat the hall map itself closes off is blocked even when
          // this showing's statuses never mention it.
          const state = seats[seat.i] || (seat.b ? 4 : 0);
          const cls = classOf[state] || "free";
          const x = seat.x - w / 2;
          const y = row.y - h / 2;
          // Closed seats carry a strike through the square, so colour is
          // not the only thing separating them from sold ones.
          const strike =
            state === 4
              ? `<line class="seat-strike" x1="${(x + w * 0.18).toFixed(
                  1
                )}" y1="${(y + h * 0.82).toFixed(1)}" x2="${(
                  x + w * 0.82
                ).toFixed(1)}" y2="${(y + h * 0.18).toFixed(1)}" />`
              : "";
          // Printed ticket number (DX map number minus the hall offset
          // applied in dx-web-login). One shared bold size for every
          // seat; colour comes from CSS so it matches the square.
          // Off by preference: the square still carries data-seat for
          // hover/pick, just without the digit painted on top.
          const num =
            showSeatNumbers && numSize
              ? `<text class="seat-num ${cls}" x="${seat.x.toFixed(
                  1
                )}" y="${row.y.toFixed(1)}" dy="0.35em" font-size="${numSize.toFixed(
                  1
                )}">${escapeHtml(String(seat.n))}</text>`
              : "";
          return `<rect class="seat ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(
            1
          )}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(
            w * 0.22
          ).toFixed(1)}" data-row="${escapeHtml(row.name)}" data-seat="${
            seat.n
          }" data-state="${state}" />${num}${strike}`;
        })
        .join("");
      return `<g class="seat-row">
        ${rowLabel(row, left)}${seatEls}${rowLabel(row, right)}
      </g>`;
    })
    .join("");

  const screenX1 = box.x - pitch.x / 2;
  const screenX2 = box.x + box.w + pitch.x / 2;
  const screenMid = (screenX1 + screenX2) / 2;

  return `
    <svg class="seat-svg" viewBox="${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(
      1
    )} ${vb.h.toFixed(1)}" role="img" aria-label="${escapeHtml(
      t("seatAria", {
        screen: show.screen,
        sold: Object.values(seats).filter((s) => s === 1 || s === 2).length,
        capacity: layout.seats,
        scanned: Object.values(seats).filter((s) => s === 2).length,
      })
    )}">
      <path class="seat-screen" d="M${screenX1.toFixed(1)} ${arcY.toFixed(
        1
      )} Q ${screenMid.toFixed(1)} ${(arcY - arcRise * 2).toFixed(
        1
      )} ${screenX2.toFixed(1)} ${arcY.toFixed(1)}" />
      <text class="seat-screen-label" x="${screenMid.toFixed(1)}" y="${labelY.toFixed(
        1
      )}" font-size="${labelSize.toFixed(1)}" letter-spacing="${(
        pitch.y * 0.08
      ).toFixed(2)}">${escapeHtml(t("seatScreen")).toUpperCase()}</text>
      ${rows}
    </svg>
  `;
}

/** A believable hall for `?previewScanned=1`, so the chart can be reviewed. */
function previewSeatChart(show) {
  const capacity = Number(show.capacity) || 110;
  const perRow = Math.max(8, Math.min(26, Math.round(Math.sqrt(capacity * 2.2))));
  const rowCount = Math.ceil(capacity / perRow);
  const pitch = { x: 20, y: 20 };

  const rows = [];
  let id = 1;
  let placed = 0;
  for (let r = 0; r < rowCount; r++) {
    const n = Math.min(perRow, capacity - placed);
    placed += n;
    const inset = ((perRow - n) / 2) * pitch.x;
    rows.push({
      name: String(r + 1),
      y: pitch.y * (r + 1),
      seats: Array.from({ length: n }, (_, i) => ({
        i: id++,
        n: i + 1,
        x: pitch.x * (i + 1) + inset,
      })),
    });
  }

  // Fill from the middle outwards, the way a hall actually fills up.
  const all = rows.flatMap((row) =>
    row.seats.map((seat) => ({
      id: seat.i,
      weight:
        Math.abs(seat.x - pitch.x * (perRow / 2 + 1)) / pitch.x +
        Math.abs(Number(row.name) - rowCount * 0.62) * 1.4 +
        (hashStr(`${show.id}:${seat.i}`) % 100) / 42,
    }))
  );
  all.sort((a, b) => a.weight - b.weight);

  // The back row's corner seats are closed off, so the preview also
  // shows how blocked seats read; holds go in after the sold block.
  const seats = {};
  const backRow = rows[rows.length - 1];
  if (backRow && backRow.seats.length > 6) {
    seats[backRow.seats[0].i] = 4;
    seats[backRow.seats[backRow.seats.length - 1].i] = 4;
  }

  const open = all.filter((seat) => !seats[seat.id]);
  const sold = Math.min(Number(show.sold) || 0, open.length);
  const scanned = Math.min(Number(show.scanned) || 0, sold);
  const reserved = Math.min(Number(show.reserved) || 0, open.length - sold);
  open.slice(0, sold).forEach((seat, i) => {
    seats[seat.id] = i < scanned ? 2 : 1;
  });
  open.slice(sold, sold + reserved).forEach((seat) => {
    seats[seat.id] = 3;
  });

  const locationId = `preview-${show.screen}`;
  rememberSeatLayout(seatPartnerOf(show), locationId, {
    locationId,
    rows,
    seats: placed,
    box: { x: pitch.x, y: pitch.y, w: pitch.x * (perRow - 1), h: pitch.y * (rowCount - 1) },
    pitch,
  });
  seatHalls.set(show.screen, locationId);

  return {
    status: "ready",
    at: Date.now(),
    locationId,
    capacity,
    sold,
    scanned,
    reserved: Number(show.reserved) || 0,
    unseated: 0,
    seats,
  };
}

/**
 * Badges for special programming — premiere nights, daytime and senior
 * screenings, Kinoklubb — read straight out of Buen's feed.
 */
function specialBadges(show) {
  const bits = [];
  if (show.showType) {
    const key = `showType.${show.showType}`;
    const label = t(key);
    const cls = /premiere/i.test(show.showType) ? "premiere" : "special";
    bits.push(
      `<span class="badge ${cls}">${escapeHtml(
        label === key ? show.showType : label
      )}</span>`
    );
  }
  if (show.kinoklubb) {
    bits.push(
      `<span class="badge special">${escapeHtml(t("kinoklubb"))}</span>`
    );
  }
  return bits.join("");
}

/** Merge rating sources; later parts win only for keys they carry. */
function mergeRatingSources(...parts) {
  const out = {};
  for (const ratings of parts) {
    if (!ratings || typeof ratings !== "object") continue;
    for (const key of ["imdb", "letterboxd", "tomatoes"]) {
      if (ratings[key] != null) out[key] = ratings[key];
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Compact IMDb / Letterboxd / Tomatometer marks (SVG Repo brand icons). */
function ratingLogo(kind) {
  // https://www.svgrepo.com/svg/333553/imdb — yellow #F5C518 on black letters
  if (kind === "imdb") {
    return `<svg class="rating-logo imdb" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="1" fill="#1a1a1a"/><path fill="#F5C518" d="M13.646 10.237c-.057-.032-.16-.048-.313-.048v3.542c.201 0 .324-.041.371-.122s.07-.301.07-.66v-2.092c0-.244-.008-.4-.023-.469a.223.223 0 0 0-.105-.151zm3.499 1.182c-.082 0-.137.031-.162.091-.025.061-.037.214-.037.46v1.426c0 .237.014.389.041.456.029.066.086.1.168.1.086 0 .199-.035.225-.103.027-.069.039-.234.039-.495V11.97c0-.228-.014-.377-.043-.447-.032-.069-.147-.104-.231-.104z"/><path fill="#F5C518" d="M20 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM6.631 14.663H5.229V9.266h1.402v5.397zm4.822 0H10.23l-.006-3.643-.49 3.643h-.875L8.342 11.1l-.004 3.563H7.111V9.266H8.93c.051.327.107.71.166 1.15l.201 1.371.324-2.521h1.832v5.397zm3.664-1.601c0 .484-.027.808-.072.97a.728.728 0 0 1-.238.383.996.996 0 0 1-.422.193c-.166.037-.418.055-.754.055h-1.699V9.266h1.047c.678 0 1.07.031 1.309.093.24.062.422.164.545.306.125.142.203.3.234.475.031.174.051.516.051 1.026v1.896zm3.654.362c0 .324-.023.565-.066.723a.757.757 0 0 1-.309.413.947.947 0 0 1-.572.174c-.158 0-.365-.035-.502-.104a1.144 1.144 0 0 1-.377-.312l-.088.344h-1.262V9.266h1.35v1.755a1.09 1.09 0 0 1 .375-.289c.137-.064.344-.096.504-.096.186 0 .348.029.484.087a.716.716 0 0 1 .44.549c.016.1.023.313.023.638v1.514z"/></svg>`;
  }
  // https://www.svgrepo.com/svg/341990/letterboxd — green #00D735 on black L
  if (kind === "letterboxd") {
    return `<svg class="rating-logo letterboxd" viewBox="0 0 32 32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#14181c"/><path fill="#00D735" fill-rule="evenodd" d="M11.052 22.339v-12.74h-2.323v-3.198h8.438v3.198h-2.328v12.766h5.234v-3.49h3.781v6.724h-15.125v-3.26zM0 16c0 8.839 7.161 16 16 16s16-7.161 16-16c0-8.839-7.161-16-16-16s-16 7.161-16 16z"/></svg>`;
  }
  // https://www.svgrepo.com/svg/473773/rottentomatoes — fresh #FA320A / rotten via CSS
  return `<svg class="rating-logo tomatoes" viewBox="0 0 32 32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="18" r="13" fill="#1a1a1a"/><path fill="currentColor" d="M10.299 12.882l0.030 0.422c0.018 0.232 0.030 0.911 0.030 1.507v1.083l0.727-0.031c0.379-0.013 0.738-0.048 1.090-0.104l-0.049 0.007c0.867-0.182 1.31-0.597 1.358-1.272 0.008-0.054 0.013-0.116 0.013-0.179 0-0.357-0.15-0.68-0.391-0.908l-0.001-0.001c-0.397-0.386-0.951-0.52-2.166-0.522zM6.53 10.023h3.097c0.425-0.045 0.917-0.070 1.416-0.070 1.070 0 2.113 0.118 3.116 0.34l-0.095-0.018c1.282 0.347 2.315 1.213 2.879 2.353l0.012 0.026c0.062 0.132 0.115 0.257 0.162 0.381l9.526 0.010 0.034 3.639-3.43-0.030v9.434l-3.726-0.020v-9.4l-2.658 0.020c-0.312 0.589-0.76 1.068-1.304 1.408l-0.015 0.009c-0.359 0.22-0.375 0.237-0.317 0.33 0.159 0.25 2.655 4.551 2.655 4.572l-4.236 0.024-2.515-4.219c-0.042-0.059-0.152-0.085-0.43-0.105l-0.371-0.025 0.046 4.349-3.843-0.047zM8.335 1.004l-1.913 1.577 2.602 2.249c-0.462-0.152-0.993-0.24-1.545-0.24-2.118 0-3.934 1.29-4.705 3.128l-0.013 0.034c0.992-0.285 2.131-0.449 3.308-0.449 0.306 0 0.61 0.011 0.911 0.033l-0.040-0.002c-3.546 2.315-5.857 6.265-5.857 10.755 0 3.689 1.561 7.014 4.058 9.351l0.007 0.007c2.805 2.208 6.389 3.541 10.284 3.541 4.757 0 9.049-1.988 12.091-5.179l0.006-0.007c7.542-8.098 2.209-23.984-12.953-21.34 0.134-1.462 0.791-1.878 1.553-2.002-1.112-1.866-4.586-0.917-5.693 1.717-0.034 0.080-2.101-3.172-2.101-3.172z"/></svg>`;
}

function formatRatingValue(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Number(n.toFixed(digits));
  return rounded.toLocaleString(lang === "en" ? "en-GB" : "nb-NO", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: digits,
  });
}

function renderRatingBadges(ratings) {
  if (!ratings || typeof ratings !== "object") return "";
  const bits = [];

  if (ratings.imdb?.value != null) {
    const label = formatRatingValue(ratings.imdb.value, 1);
    const body = `${ratingLogo("imdb")}<span class="rating-value">${escapeHtml(label)}</span>`;
    const aria = t("ratingImdbAria", { n: label });
    bits.push(
      ratings.imdb.url
        ? `<a class="rating-badge imdb" href="${escapeHtml(ratings.imdb.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(aria)}">${body}</a>`
        : `<span class="rating-badge imdb" role="img" aria-label="${escapeHtml(aria)}">${body}</span>`
    );
  }

  if (ratings.letterboxd?.value != null) {
    const label = formatRatingValue(ratings.letterboxd.value, 2);
    const body = `${ratingLogo("letterboxd")}<span class="rating-value">${escapeHtml(label)}</span>`;
    const aria = t("ratingLetterboxdAria", { n: label });
    bits.push(
      ratings.letterboxd.url
        ? `<a class="rating-badge letterboxd" href="${escapeHtml(ratings.letterboxd.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(aria)}">${body}</a>`
        : `<span class="rating-badge letterboxd" role="img" aria-label="${escapeHtml(aria)}">${body}</span>`
    );
  }

  if (ratings.tomatoes?.value != null) {
    const score = Math.round(Number(ratings.tomatoes.value));
    if (Number.isFinite(score)) {
      const rotten = score < 60 ? " rotten" : "";
      const label = `${score}%`;
      const body = `${ratingLogo("tomatoes")}<span class="rating-value">${escapeHtml(label)}</span>`;
      const aria = t("ratingTomatoesAria", { n: String(score) });
      bits.push(
        ratings.tomatoes.url
          ? `<a class="rating-badge tomatoes${rotten}" href="${escapeHtml(ratings.tomatoes.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(aria)}">${body}</a>`
          : `<span class="rating-badge tomatoes${rotten}" role="img" aria-label="${escapeHtml(aria)}">${body}</span>`
      );
    }
  }

  return bits.length ? `<div class="movie-ratings">${bits.join("")}</div>` : "";
}

function renderShowCard(show, now, index = 0, opts = {}) {
  const status = statusOf(show, now);
  // Soon keeps a small pill in the meta line; live/done read from the
  // left rail instead of another badge next to the runtime.
  const badge =
    status === "soon"
      ? `<span class="badge soon">${escapeHtml(t("soon"))}</span>`
      : "";

  const endLabel = show.end ? formatClock(show.end) : "…";
  const duration = formatRunning(show.runningLabel, show.runningMinutes);

  const metaBits = [
    `<span class="screen">${escapeHtml(show.screen)}</span>`,
    show.age ? `<span class="dot">${escapeHtml(formatAge(show.age))}</span>` : "",
    `<span class="dot">${escapeHtml(duration)}</span>`,
    badge,
    specialBadges(show),
  ]
    .filter(Boolean)
    .join("");

  const spoken = spokenLanguage(show.tags);
  const langLine = spoken
    ? `<div class="meta-line lang-line"><span>${escapeHtml(
        t(spoken === "nb" ? "spokenNorwegian" : "spokenEnglish")
      )}</span></div>`
    : "";

  let progress = "";
  if (status === "live" && show.end) {
    const pct = Math.min(
      Math.round(((now - show.start) / (show.end - show.start)) * 100),
      100
    );
    const left = Math.max(Math.round((show.end - now) / 60_000), 0);
    progress = `
      <div class="live-progress">
        <div class="live-track">
          <div class="live-fill" style="width:${pct}%"></div>
          <span class="live-dot" style="left:${pct}%"></span>
        </div>
        <span class="live-left">${left} min</span>
      </div>
    `;
  }

  const admissionRow = renderAdmission(show, now, opts);
  const admissionState = admissionOf(show, now, opts)?.state || "";
  const statusRail = renderShowStatusRail(status);
  const cardClass = [
    "show-card",
    status,
    statusRail ? "has-status" : "",
    admissionState ? `has-admit admit-${admissionState}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = `
      ${statusRail}
      ${renderPoster(show, 52, 74)}
      <div class="show-main">
        <h2 class="show-title">${escapeHtml(show.title)}</h2>
        <div class="time-range">${formatClock(show.start)}<span class="sep">–</span>${endLabel}</div>
        <div class="meta-line">${metaBits}</div>
        ${langLine}
        ${progress}
      </div>
      ${renderTicketCol(show)}
      ${admissionRow}
  `;

  // Named so the beat can tell which showings are actually on screen and
  // read their figures more eagerly than the rest of the programme.
  const tag = `data-show="${escapeHtml(show.id)}"`;

  // Link to the eBillett page so staff can jump straight to ticket sales.
  const card = show.ticketUrl
    ? `<a class="${cardClass} linked" ${tag} style="--i:${index}" href="${escapeHtml(
        show.ticketUrl
      )}" target="_blank" rel="noopener">${inner}</a>`
    : `<article class="${cardClass}" ${tag} style="--i:${index}">${inner}</article>`;

  // The seat chart button has to sit outside that link, so the card and
  // its fold-out share one wrapper instead of being one element.
  if (!seatChartOffered(show)) return card;
  const rowClass = ["show-row", status, seatChartExpanded(show) ? "seats-open" : ""]
    .filter(Boolean)
    .join(" ");
  return `<div class="${rowClass}" style="--i:${index}">${card}${renderSeatToggle(
    show
  )}</div>`;
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
  // A deleted event with numbers behind it is a show that played and was
  // tidied away in DX; with nothing behind it there is nothing to show.
  if (
    show.eventStatus === "error" ||
    (show.eventStatus === "gone" && show.sold == null)
  ) {
    return `<div class="ticket-col"><span class="ticket-missing">${escapeHtml(
      t("error")
    )}</span></div>`;
  }
  if (show.sold == null) {
    return `<div class="ticket-col"><span class="ticket-loading">…</span></div>`;
  }

  const cap = show.capacity || 0;
  const pct = cap ? Math.min(Math.round((show.sold / cap) * 100), 100) : null;
  // Zero sold renders an empty track; any sales get a visible sliver.
  const fillPct = pct == null ? null : show.sold ? Math.max(pct, 6) : 0;
  const level = pct == null ? "" : pct >= 100 ? "full" : pct >= 75 ? "high" : pct >= 40 ? "mid" : "low";

  const flag =
    cap && show.available === 0
      ? `<span class="ticket-flag full">${escapeHtml(t("soldOut"))}</span>`
      : cap && show.available != null && show.available <= 10
        ? `<span class="ticket-flag few">${escapeHtml(t("fewLeft", { n: show.available }))}</span>`
        : "";

  return `
    <div class="ticket-col">
      <div class="ticket-ratio">${show.sold}${
        cap ? `<span class="ticket-cap">/${cap}</span>` : ""
      }</div>
      ${
        pct != null
          ? `<div class="occ-track" title="${pct}%"><div class="occ-fill ${level}" style="width:${fillPct}%"></div></div>`
          : `<div class="ticket-sub">${escapeHtml(t("sold"))}</div>`
      }
      ${flag}
      ${
        show.reserved
          ? `<span class="ticket-res">${escapeHtml(t("reservedShort", { n: show.reserved }))}</span>`
          : ""
      }
    </div>
  `;
}

/**
 * Thousands grouped for reading. nb-NO separates them with a full
 * non-breaking space, which at hero size reads as two numbers side by
 * side; a narrow one keeps "1 274" a single figure.
 */
function formatCount(n) {
  return Number(n)
    .toLocaleString(lang === "en" ? "en-GB" : "nb-NO")
    .replaceAll("\u00A0", "\u202F");
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
        genres: show.genres || null,
        director: show.director || null,
        ratings: show.ratings || null,
        shows: [],
      });
    }
    const movie = map.get(key);
    movie.shows.push(show);
    if (!movie.posterUrl && show.posterUrl) movie.posterUrl = show.posterUrl;
    // Older history entries predate these fields; take them from any
    // showing of the same film that has them.
    if (!movie.genres && show.genres) movie.genres = show.genres;
    if (!movie.director && show.director) movie.director = show.director;
    // Per-source merge across showings of the same film — a history
    // row with only Letterboxd must not block a later row's IMDb.
    if (show.ratings) {
      movie.ratings = mergeRatingSources(movie.ratings, show.ratings);
    }
  }

  const now = new Date();
  return [...map.values()]
    .map((m) => {
      m.shows.sort((a, b) => a.start - b.start);
      m.soldSum = m.shows.reduce((n, s) => n + soldOf(s), 0);
      const next = m.shows.find((s) => !isDone(s, now));
      m.allDone = !next;
      m.anchor = (next || m.shows[m.shows.length - 1])?.start?.getTime() ?? 0;
      return m;
    })
    .sort((a, b) => {
      // Films with something left to play come first, soonest showing at
      // the top; finished runs settle underneath, most recent first.
      if (a.allDone !== b.allDone) return a.allDone ? 1 : -1;
      if (a.anchor !== b.anchor) {
        return a.allDone ? b.anchor - a.anchor : a.anchor - b.anchor;
      }
      return a.title.localeCompare(b.title, lang === "en" ? "en" : "nb");
    });
}

function renderMovies() {
  if (!state?.shows) return;
  const movies = groupMovies();
  const now = new Date();

  els.moviesContent.classList.toggle(
    "no-anim",
    els.moviesContent.dataset.rendered === "1"
  );
  els.moviesContent.dataset.rendered = "1";

  if (!movies.length) {
    paint(els.moviesContent, emptyNote("movie", "noMovies"));
    return;
  }

  paint(
    els.moviesContent,
    `
    ${viewIntro(
      "movie",
      "moviesTitle",
      "moviesSubtitle",
      t("moviesCount", { n: movies.length })
    )}
    <div class="movie-grid">
      ${movies.map((m, i) => renderMovieTile(m, now, i)).join("")}
    </div>
  `
  );
}

function toggleMovieShows(title, kind) {
  if (!title || (kind !== "done" && kind !== "upcoming")) return;
  const set = kind === "done" ? expandedMovieDone : expandedMovieUpcoming;
  const other = kind === "done" ? expandedMovieUpcoming : expandedMovieDone;
  if (set.has(title)) set.delete(title);
  else {
    set.add(title);
    other.delete(title);
  }
  repaintNext(els.moviesContent);
  renderMovies();
}

function closeMovieShows(title) {
  if (!title) return;
  const panel = els.moviesContent.querySelector(
    `.tile-expand-panel[data-movie-panel="${cssEscape(title)}"]`
  );
  // Don't treat .no-anim (live redraws) as reduced motion — that was
  // skipping the slide-down entirely after the first movies paint.
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  if (panel && !reduceMotion && !panel.classList.contains("is-leaving")) {
    // Retrigger so the out animation always starts from the open pose.
    panel.style.animation = "none";
    void panel.offsetWidth;
    panel.style.animation = "";
    panel.classList.add("is-leaving");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      expandedMovieDone.delete(title);
      expandedMovieUpcoming.delete(title);
      repaintNext(els.moviesContent);
      renderMovies();
    };
    panel.addEventListener(
      "animationend",
      (e) => {
        if (e.target === panel) finish();
      },
      { once: true }
    );
    setTimeout(finish, 350);
    return;
  }
  expandedMovieDone.delete(title);
  expandedMovieUpcoming.delete(title);
  repaintNext(els.moviesContent);
  renderMovies();
}

function movieShowSections(shows, now) {
  const done = [];
  const upcoming = [];
  for (const show of shows) {
    if (isDone(show, now)) done.push(show);
    else upcoming.push(show);
  }
  return { done, upcoming };
}

function renderMovieShowRow(show, now, { index = null } = {}) {
  const status = statusOf(show, now);
  const soldOut = show.capacity && show.available === 0;
  const sold =
    show.sold != null
      ? soldOut
        ? `<span class="tile-sold out">${escapeHtml(t("soldOut"))}</span>`
        : `<span class="tile-sold">${show.sold}${
            show.capacity ? `<span class="tile-cap">/${show.capacity}</span>` : ""
          }</span>`
      : "";
  const admission = admissionOf(show, now);
  const admitted =
    admission && admission.state !== "unknown"
      ? `<span class="tile-admit ${admission.state}" title="${escapeHtml(
          admissionLabel(admission)
        )}">${admissionIcon(admission.state)}${admission.scanned}</span>`
      : "";
  const inner = `
          <span class="tile-day">${escapeHtml(shortDayLabel(show.dayKey))}</span>
          <span class="tile-time">${formatClock(show.start)}</span>
          <span class="tile-screen">${escapeHtml(show.screen)}</span>
          <span class="tile-nums">${sold}${admitted}</span>
      `;
  const tag = `data-show="${escapeHtml(show.id)}"`;
  const delay =
    index == null ? "" : ` style="--d:${Math.min(index, 12)}"`;
  const cls = `tile-show ${status}`;
  if (show.ticketUrl) {
    return `<a class="${cls}" ${tag}${delay} href="${escapeHtml(
      show.ticketUrl
    )}" target="_blank" rel="noopener">${inner}</a>`;
  }
  return `<div class="${cls}" ${tag}${delay}>${inner}</div>`;
}

function movieExpandChevron() {
  return `<svg class="tile-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.25L6 7.75l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function movieBackIcon() {
  return `<svg class="tile-back-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.75 2.5L4.25 6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderMovieExpandToggle(title, kind, label) {
  return `<button type="button" class="tile-shows-toggle ${kind}" data-movie-expand="${escapeHtml(
    title
  )}" data-expand-kind="${kind}" aria-expanded="false"><span>${escapeHtml(
    label
  )}</span>${movieExpandChevron()}</button>`;
}

function renderMovieScheduleIdle(kind, label) {
  return `<div class="tile-shows-idle ${kind}"><span>${escapeHtml(
    label
  )}</span><span class="tile-idle-mark" aria-hidden="true">—</span></div>`;
}

function renderMovieExpandPanel(movie, kind, shows, now) {
  const heading =
    kind === "done" ? t("moviesDonePanel") : t("moviesUpcomingPanel");
  return `
    <div class="tile-expand-panel ${kind}" data-movie-panel="${escapeHtml(
      movie.title
    )}" role="region" aria-label="${escapeHtml(`${heading} · ${movie.title}`)}">
      <div class="tile-expand-bar">
        <button type="button" class="tile-expand-back" data-movie-close="${escapeHtml(
          movie.title
        )}">
          ${movieBackIcon()}
          <span>${escapeHtml(t("moviesBack"))}</span>
        </button>
        <div class="tile-expand-heading">
          <span class="tile-expand-title">${escapeHtml(heading)}</span>
          <span class="tile-expand-count">${shows.length}</span>
        </div>
      </div>
      <p class="tile-expand-film">${escapeHtml(movie.title)}</p>
      <div class="tile-expand-list tile-shows">${shows
        .map((show, i) => renderMovieShowRow(show, now, { index: i }))
        .join("")}</div>
    </div>
  `;
}

function renderMovieTile(movie, now, index = 0) {
  const duration = formatRunning(movie.runningLabel, movie.runningMinutes);

  const meta = [
    formatAge(movie.age),
    duration,
    showsLabel(movie.shows.length),
  ]
    .filter(Boolean)
    .map((x) => escapeHtml(String(x)))
    .join(" · ");

  const progress = doneProgress(movie.shows, now);
  const ratingBadges = renderRatingBadges(movie.ratings);

  const credits = (Array.isArray(movie.genres) ? movie.genres.map(formatGenre) : [])
    .filter(Boolean)
    .map((x) => escapeHtml(String(x)))
    .join(" · ");

  const { done, upcoming } = movieShowSections(movie.shows, now);
  const doneOpen = expandedMovieDone.has(movie.title);
  const upcomingOpen = expandedMovieUpcoming.has(movie.title);
  const panelKind = doneOpen ? "done" : upcomingOpen ? "upcoming" : "";
  const panelShows = doneOpen ? done : upcomingOpen ? upcoming : [];

  // Preview is always three row-slots tall; empty toggle slots keep
  // neighbours aligned. Expand replaces the body in-place (same size).
  let preview;
  let doneHidden = [];
  let upcomingHidden = [];

  if (upcoming.length) {
    preview = upcoming.slice(0, MOVIE_SHOWS_PREVIEW);
    upcomingHidden = upcoming.slice(MOVIE_SHOWS_PREVIEW);
    doneHidden = done;
  } else {
    preview = done.slice(-MOVIE_SHOWS_PREVIEW);
    doneHidden = done.slice(0, Math.max(0, done.length - MOVIE_SHOWS_PREVIEW));
  }

  const doneSlot = doneHidden.length
    ? renderMovieExpandToggle(
        movie.title,
        "done",
        t("moviesDoneMore", { n: doneHidden.length })
      )
    : renderMovieScheduleIdle("done", t("moviesNoDone"));
  const upcomingSlot = upcomingHidden.length
    ? renderMovieExpandToggle(
        movie.title,
        "upcoming",
        t("moviesMore", { n: upcomingHidden.length })
      )
    : `<div class="tile-shows-toggle-spacer" aria-hidden="true"></div>`;

  const previewRows = preview
    .map((show) => renderMovieShowRow(show, now))
    .join("");

  const openClass = panelKind ? " is-open" : "";

  return `
    <article class="movie-tile${progress.all ? " all-done" : ""}${openClass}" style="--i:${index}">
      ${renderPoster(movie, 72, 104, "movie-poster")}
      <div class="movie-tile-body">
        <div class="tile-main">
          <div class="movie-tile-head">
            <h3 class="movie-tile-title">${escapeHtml(movie.title)}</h3>
            ${doneTag(movie.shows, { allLabel: "done", now })}
          </div>
          ${ratingBadges}
          <p class="movie-tile-meta">${meta}</p>
          ${credits ? `<p class="movie-tile-credits">${credits}</p>` : ""}
          <div class="tile-schedule">
            <div class="tile-schedule-slot">${doneSlot}</div>
            <div class="tile-shows">${previewRows}</div>
            <div class="tile-schedule-slot">${upcomingSlot}</div>
          </div>
        </div>
      </div>
      ${
        panelKind
          ? renderMovieExpandPanel(movie, panelKind, panelShows, now)
          : ""
      }
    </article>
  `;
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

/**
 * Sold-ticket aggregates for the Stats tab: this week's days, week history,
 * and top films (with ratings from the Movies grouping).
 */
function computeStatsModel(shows) {
  const todayKey = toDayKey(new Date());
  const hasSold = shows.some((s) => s.sold != null);
  const totalSold = shows.reduce((n, s) => n + soldOf(s), 0);

  const dayMap = new Map();
  for (const show of shows) {
    const cur = dayMap.get(show.dayKey) || { day: show.dayKey, sold: 0 };
    cur.sold += soldOf(show);
    dayMap.set(show.dayKey, cur);
  }
  const allDays = [...dayMap.values()].sort((a, b) =>
    a.day.localeCompare(b.day)
  );

  // Weekly focus: hero + day chart follow the current ISO week. If the
  // current week has no program days, fall back to the closest that does.
  let weekInfo = isoWeekInfo(todayKey);
  let weekDays = allDays.filter(
    (d) => isoWeekInfo(d.day).key === weekInfo.key
  );
  if (!weekDays.length && allDays.length) {
    const pastDays = allDays.filter((d) => d.day <= todayKey);
    const anchor = pastDays[pastDays.length - 1] || allDays[0];
    weekInfo = isoWeekInfo(anchor.day);
    weekDays = allDays.filter((d) => isoWeekInfo(d.day).key === weekInfo.key);
  }

  const weekSold = weekDays.reduce((n, d) => n + d.sold, 0);

  const lastRelevant = weekDays.reduce(
    (max, d) => (d.sold > 0 && d.day > max ? d.day : max),
    todayKey
  );
  let byDay = weekDays.filter((d) => d.day <= lastRelevant);
  if (!byDay.length) byDay = weekDays;
  const maxDaySold = Math.max(...byDay.map((d) => d.sold), 1);
  const daysWithSold = byDay.filter((d) => d.sold > 0);
  const avgDay = daysWithSold.length
    ? Math.round(weekSold / daysWithSold.length)
    : 0;
  const bestDay = daysWithSold.length
    ? [...daysWithSold].sort((a, b) => b.sold - a.sold)[0]
    : null;

  const lastSaleDay = allDays.reduce(
    (max, d) => (d.sold > 0 && d.day > max ? d.day : max),
    todayKey
  );
  const weekMap = new Map();
  for (const row of allDays.filter((d) => d.day <= lastSaleDay)) {
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
  const byWeek = [...weekMap.values()].sort((a, b) =>
    a.key.localeCompare(b.key)
  );
  const maxWeekSold = Math.max(...byWeek.map((w) => w.sold), 1);

  const topSold = groupMovies()
    .map((m) => ({
      title: m.title,
      posterUrl: m.posterUrl,
      ratings: m.ratings,
      soldSum: m.soldSum,
      showCount: m.shows.length,
    }))
    .filter((m) => m.soldSum > 0)
    .sort((a, b) => b.soldSum - a.soldSum)
    .slice(0, 10);

  return {
    hasSold,
    totalSold,
    todayKey,
    weekInfo,
    weekDays,
    weekSold,
    byDay,
    maxDaySold,
    avgDay,
    bestDay,
    byWeek,
    maxWeekSold,
    topSold,
  };
}

function openMovieFromStats(title) {
  if (!title || !state?.shows) return;
  const movie = groupMovies().find((m) => m.title === title);
  expandedMovieDone.delete(title);
  expandedMovieUpcoming.delete(title);
  if (movie) {
    const { done, upcoming } = movieShowSections(movie.shows, new Date());
    if (upcoming.length) expandedMovieUpcoming.add(title);
    else if (done.length) expandedMovieDone.add(title);
  }
  setActiveTab("movies");
}

function openDayFromStats(dayKey) {
  if (!dayKey || !state?.shows?.some((s) => s.dayKey === dayKey)) return;
  setSelectedDay(dayKey);
  setActiveTab("day");
}

function statsKpi(valueHtml, label) {
  return `
    <div class="stats-kpi">
      <span class="stats-kpi-value">${valueHtml}</span>
      <span class="stats-kpi-label">${escapeHtml(label)}</span>
    </div>`;
}

/** Horizontal sold-by-day rows — label, bar, count; tap opens that day. */
function renderWeekDays(byDay, maxDaySold, todayKey) {
  const bestSold = Math.max(...byDay.map((d) => d.sold), 0);
  return `
    <div class="bar-list day-bars" role="list">
      ${byDay
        .map((row, i) => {
          const pct = Math.max(
            (row.sold / maxDaySold) * 100,
            row.sold ? 4 : 0
          );
          const label = shortDayLabel(row.day);
          const isToday = row.day === todayKey;
          const isBest = row.sold > 0 && row.sold === bestSold;
          return `
            <button type="button" class="bar-row day-bar${
              isToday ? " today" : ""
            }${isBest ? " best" : ""}${
              row.sold ? "" : " empty"
            }" style="--i:${i}" data-stats-day="${escapeHtml(
              row.day
            )}" role="listitem" aria-label="${escapeHtml(
              t("statsOpenDay", { day: label })
            )}">
              <span class="bar-label">${escapeHtml(label)}</span>
              <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${pct}%"></span></span>
              <span class="bar-value">${row.sold}</span>
            </button>`;
        })
        .join("")}
    </div>`;
}

/** Rating badges without outbound links — safe inside a clickable rank row. */
function ratingsForStats(ratings) {
  if (!ratings || typeof ratings !== "object") return null;
  const out = {};
  for (const [key, value] of Object.entries(ratings)) {
    if (value && typeof value === "object") {
      out[key] = { ...value, url: null };
    }
  }
  return out;
}

function renderTopFilmRows(topSold) {
  if (!topSold.length) {
    return emptyNote("trophy", "noSoldData", "empty-note soft");
  }
  return `<div class="top-list">
    ${topSold
      .map(
        (m, i) => `
          <div class="rank-row${
            i < 3 ? ` medal medal-${i + 1}` : ""
          }" style="--i:${i}" data-stats-movie="${escapeHtml(
            m.title
          )}" role="button" tabindex="0" aria-label="${escapeHtml(
            t("statsOpenMovie", { title: m.title })
          )}">
            <span class="top-rank">${i + 1}</span>
            ${renderPoster(m, 40, 58, "stats-poster")}
            <div class="top-body">
              <span class="top-title">${escapeHtml(m.title)}</span>
              ${renderRatingBadges(ratingsForStats(m.ratings))}
              <span class="top-sub">${escapeHtml(showsLabel(m.showCount))}</span>
            </div>
            <span class="top-sold">${m.soldSum}</span>
          </div>`
      )
      .join("")}
  </div>`;
}

function renderStats() {
  if (!state?.shows) return;
  const model = computeStatsModel(state.shows);

  // Panels rise into place the first time the tab is opened; a beat that
  // moved a number should just move it, not replay that.
  els.statsContent.classList.toggle(
    "no-anim",
    els.statsContent.dataset.rendered === "1"
  );
  els.statsContent.dataset.rendered = "1";

  if (!model.hasSold && model.totalSold === 0) {
    paint(els.statsContent, viewIntro("stats", "statsTitle", "noSoldData"));
    return;
  }

  const {
    totalSold,
    todayKey,
    weekInfo,
    weekDays,
    weekSold,
    byDay,
    maxDaySold,
    avgDay,
    bestDay,
    byWeek,
    maxWeekSold,
    topSold,
  } = model;

  const weekMeta = weekDays.length
    ? `${t("weekLabel", { n: weekInfo.week })} · ${weekRangeLabel(
        weekDays.map((d) => d.day)
      )}`
    : t("weekLabel", { n: weekInfo.week });

  paint(
    els.statsContent,
    `
    ${viewIntro(
      "stats",
      "statsTitle",
      "statsSubtitle",
      t("periodTotal", { n: formatCount(totalSold) })
    )}

    <div class="stats-hero">
      <div class="stats-hero-primary">
        <p class="stats-hero-label">${escapeHtml(t("soldWeekLabel"))}</p>
        <p class="stats-hero-value">${formatCount(weekSold)}</p>
        <p class="stats-hero-sub">${escapeHtml(weekMeta)}</p>
      </div>
      <div class="stats-hero-grid">
        ${statsKpi(String(avgDay), t("soldAvgDay"))}
        ${statsKpi(
          String(bestDay?.sold ?? 0),
          bestDay
            ? `${t("soldBestDay")} · ${shortDayLabel(bestDay.day)}`
            : t("soldBestDay")
        )}
      </div>
    </div>

    <section class="stats-panel">
      <div class="stats-panel-head">
        <h3>${icon("day", "panel-icon")}${escapeHtml(t("soldByDay"))}</h3>
        <span class="stats-panel-meta">${escapeHtml(weekMeta)}</span>
      </div>
      ${renderWeekDays(byDay, maxDaySold, todayKey)}
    </section>

    <section class="stats-panel">
      <div class="stats-panel-head">
        <h3>${icon("trophy", "panel-icon")}${escapeHtml(t("topSold"))}</h3>
      </div>
      ${renderTopFilmRows(topSold)}
    </section>

    <section class="stats-panel stats-panel-muted">
      <div class="stats-panel-head">
        <h3>${icon("week", "panel-icon")}${escapeHtml(t("soldByWeek"))}</h3>
        <span class="stats-panel-meta">${escapeHtml(
          t("periodTotal", { n: formatCount(totalSold) })
        )}</span>
      </div>
      <div class="bar-list">
        ${byWeek
          .map((row, i) => {
            const pct = Math.max(
              (row.sold / maxWeekSold) * 100,
              row.sold ? 4 : 0
            );
            return `
              <div class="bar-row" style="--i:${i}">
                <div class="bar-label-stack">
                  <span class="bar-label">${escapeHtml(
                    t("weekLabel", { n: row.week })
                  )}</span>
                  <span class="bar-sub">${escapeHtml(
                    weekRangeLabel(row.days)
                  )}</span>
                </div>
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                <span class="bar-value">${row.sold}</span>
              </div>`;
          })
          .join("")}
      </div>
    </section>
  `
  );
}

/** One preference row inside a grouped settings list. */
function settingsRow(iconName, titleKey, hintKey, controlHtml, extraClass = "") {
  const inline = extraClass.includes("is-inline");
  return `
    <div class="settings-row ${extraClass}">
      <div class="settings-row-text">
        <h3>${icon(iconName, "panel-icon")}${escapeHtml(t(titleKey))}</h3>
        <p>${escapeHtml(t(hintKey))}</p>
      </div>
      ${
        inline
          ? controlHtml
          : `<div class="settings-row-control">${controlHtml}</div>`
      }
    </div>
  `;
}

function settingsSeg(ariaKey, buttonsHtml) {
  return `
    <div class="segmented settings-seg" role="group" aria-label="${escapeHtml(t(ariaKey))}">
      <span class="seg-indicator" aria-hidden="true">
        <span class="seg-indicator-rim"></span>
      </span>
      ${buttonsHtml}
    </div>
  `;
}

function settingsSwitch(ariaKey, checked, dataAttr) {
  return `
    <button
      type="button"
      class="settings-switch"
      role="switch"
      aria-checked="${checked}"
      aria-label="${escapeHtml(t(ariaKey))}"
      ${dataAttr}
    >
      <span class="settings-switch-knob" aria-hidden="true"></span>
    </button>
  `;
}

function placeSettingsSegs({ instant = true } = {}) {
  els.settingsContent.querySelectorAll(".segmented").forEach((group) => {
    const indicator = group.querySelector(".seg-indicator");
    const active = group.querySelector('.seg-btn[aria-pressed="true"]');
    liquidMove(indicator, active, { instant });
  });
}

function renderSettings() {
  const bridgeError = Boolean(dxScanStatus.error);

  els.settingsContent.innerHTML = `
    <div class="settings-shell">
      ${viewIntro("settings", "settingsTitle", "settingsSubtitle")}

      <div class="settings-layout">
        <section class="settings-panel" aria-labelledby="settings-prefs-label">
          <h3 class="settings-label" id="settings-prefs-label">${escapeHtml(t("prefsSection"))}</h3>
          <div class="settings-group">
            ${settingsRow(
              "language",
              "language",
              "languageHint",
              settingsSeg(
                "language",
                `
              <button type="button" class="seg-btn" data-lang="nb" aria-pressed="${lang === "nb"}">${escapeHtml(t("langNb"))}</button>
              <button type="button" class="seg-btn" data-lang="en" aria-pressed="${lang === "en"}">${escapeHtml(t("langEn"))}</button>
            `
              )
            )}
            ${settingsRow(
              "theme",
              "theme",
              "themeHint",
              settingsSeg(
                "theme",
                `
              <button type="button" class="seg-btn" data-theme-opt="light" aria-pressed="${theme === "light"}">${escapeHtml(t("themeLight"))}</button>
              <button type="button" class="seg-btn" data-theme-opt="dark" aria-pressed="${theme === "dark"}">${escapeHtml(t("themeDark"))}</button>
              <button type="button" class="seg-btn" data-theme-opt="system" aria-pressed="${theme === "system"}">${escapeHtml(t("themeSystem"))}</button>
            `
              )
            )}
            ${settingsRow(
              "seats",
              "seatNumbers",
              "seatNumbersHint",
              settingsSwitch("seatNumbers", showSeatNumbers, "data-seat-switch"),
              "is-inline"
            )}
            ${settingsRow(
              "timeline",
              "tlAlways",
              "tlAlwaysHint",
              settingsSwitch(
                "tlAlways",
                timelineAlwaysExpanded,
                "data-tl-always-switch"
              ),
              "is-inline"
            )}
          </div>
        </section>

        <section class="settings-panel dx-section" aria-labelledby="settings-dx-label">
          <div class="settings-label-row">
            <h3 class="settings-label" id="settings-dx-label">${escapeHtml(t("dxTitle"))}</h3>
            ${
              bridgeError
                ? `<span class="dx-chip off">${escapeHtml(t("dxChipOff"))}</span>`
                : `<span class="dx-chip on">${escapeHtml(t("dxChipOn"))}</span>`
            }
          </div>
          <div class="settings-group">
            <p class="settings-group-hint">${escapeHtml(t("dxConnectedHint"))}</p>
            <div class="dx-status connected">
              ${renderDxFacts()}
              <p class="dx-msg" id="dxTestMsg" hidden></p>
              <details class="dx-advanced" id="dxDetails" hidden>
                <summary>${escapeHtml(t("dxDetails"))}</summary>
                <pre class="dx-log" id="dxLog"></pre>
              </details>
              <div class="dx-actions">
                <button type="button" class="dx-btn ghost" id="dxRefreshBtn">${escapeHtml(t("dxRefreshScans"))}</button>
                <button type="button" class="dx-btn ghost" id="dxTestBtn">${escapeHtml(t("dxTest"))}</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  placeSettingsSegs({ instant: true });

  els.settingsContent.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if ((btn.dataset.lang === "en") === (lang === "en")) return;
      lang = btn.dataset.lang === "en" ? "en" : "nb";
      savePrefs();
      segSelect(btn);
      // Let the liquid animation play before texts re-render.
      setTimeout(() => {
        applyLanguage();
        if (state?.shows) populateFilters();
        renderSettings();
        renderActiveView();
      }, 340);
    });
  });

  els.settingsContent.querySelectorAll("[data-theme-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.themeOpt;
      if (next === theme) return;
      applyTheme(next);
      savePrefs();
      segSelect(btn);
    });
  });

  const seatSwitch = els.settingsContent.querySelector("[data-seat-switch]");
  if (seatSwitch) {
    seatSwitch.addEventListener("click", () => {
      showSeatNumbers = !showSeatNumbers;
      savePrefs();
      seatSwitch.setAttribute("aria-checked", String(showSeatNumbers));
      for (const show of state?.shows || []) {
        if (seatChartExpanded(show)) paintSeatChart(show);
      }
    });
  }

  const tlAlwaysSwitch = els.settingsContent.querySelector(
    "[data-tl-always-switch]"
  );
  if (tlAlwaysSwitch) {
    tlAlwaysSwitch.addEventListener("click", () => {
      timelineAlwaysExpanded = !timelineAlwaysExpanded;
      savePrefs();
      tlAlwaysSwitch.setAttribute(
        "aria-checked",
        String(timelineAlwaysExpanded)
      );
      if (els.timeline && !els.timeline.hidden) {
        setTimelineExpanded(timelineAlwaysExpanded);
      } else {
        syncTimelineExpandBtn();
      }
    });
  }

  const refreshBtn = els.settingsContent.querySelector("#dxRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = t("dxRefreshing");
      // A manual re-fetch should also revisit days already written off.
      for (const show of state?.shows || []) show.scanDone = false;
      try {
        await syncScanned({ force: true });
      } finally {
        renderSettings();
      }
    });
  }

  const testBtn = els.settingsContent.querySelector("#dxTestBtn");
  if (testBtn) {
    testBtn.addEventListener("click", () => runDxTest(testBtn));
  }
}

/** Connection facts, so a blank admission column is never a mystery. */
function renderDxFacts() {
  const shows = (state?.shows || []).filter((s) => s.eventId);
  const withScan = shows.filter((s) => s.scanned != null).length;
  const source = dxScanStatus.source || "app.dx.no";
  const synced = dxScanStatus.at
    ? formatClock(new Date(dxScanStatus.at))
    : t("dxNeverSynced");

  const facts = [
    [t("dxSourceLabel"), source],
    [t("dxSyncedLabel"), synced],
    [
      t("dxCoverageLabel"),
      t("dxCoverageValue", { n: withScan, total: shows.length }),
    ],
  ];

  return `<ul class="dx-facts">${facts
    .map(
      ([label, value]) =>
        `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(
          String(value)
        )}</strong></li>`
    )
    .join("")}</ul>`;
}

async function runDxTest(btn) {
  btn.disabled = true;
  btn.textContent = t("dxTesting");

  let result;
  try {
    result = await runDxScanDiagnostics();
  } catch (err) {
    result = { code: "empty", details: String(err?.message || err) };
  }

  const title = result.show
    ? `${result.show.title} ${formatClock(result.show.start)}`
    : "";
  const text =
    result.code === "ok"
      ? t("dxTestOk", { n: result.scanned, show: title })
      : result.code === "noShows"
        ? t("dxTestNoShows")
        : result.code === "auth"
          ? t("dxTestAuth")
          : t("dxTestEmpty", { show: title });

  // Rebuild first so the facts above reflect the run, then write the
  // verdict into the fresh markup.
  renderSettings();
  const msg = els.settingsContent.querySelector("#dxTestMsg");
  if (msg) {
    msg.hidden = false;
    msg.textContent = text;
    msg.classList.toggle("ok", result.code === "ok");
    msg.classList.toggle("err", result.code !== "ok");
  }
  const details = els.settingsContent.querySelector("#dxDetails");
  const log = els.settingsContent.querySelector("#dxLog");
  if (details && log && result.details) {
    details.hidden = false;
    log.textContent = result.details;
  }
}

function dxError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** POST to the DX bridge. Never throws on HTTP status — callers decide. */
async function callDxProxy(body) {
  let res;
  try {
    res = await fetch(DX_LOGIN_PROXY, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${DX_LOGIN_ANON_KEY}`,
        apikey: DX_LOGIN_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw dxError("DX bridge unreachable", "network");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, ok: res.ok, data };
}

/**
 * Check-in counts for a batch of events, as `{ eventId: {scanned, sold} }`.
 *
 * The bridge holds the shared DX session. An optional opaque token may be
 * sent to reuse a warm isolate session; if it is gone the bridge signs
 * in again from Vault without the browser ever seeing a password.
 */
async function fetchScannedCounts(partnerId, eventIds, { retry = true } = {}) {
  if (!eventIds.length) return null;

  const payload = {
    action: "scanned",
    partnerId,
    eventIds,
  };
  if (dxAuth?.token) payload.token = dxAuth.token;

  const { status, ok, data } = await callDxProxy(payload);

  if (status === 401 || status === 403) {
    if (retry) {
      clearDxToken();
      return fetchScannedCounts(partnerId, eventIds, { retry: false });
    }
    throw dxError(data.error || "DX session expired", "auth");
  }
  if (!ok) {
    dxScanStatus.error = data.error || `bridge ${status}`;
    return null;
  }

  if (data.token) rememberDxToken(data.token);
  if (data.source) dxScanStatus.source = data.source;
  dxScanStatus.error = "";
  return data.counts || {};
}

function segSelect(btn) {
  const group = btn.closest(".segmented");
  group.querySelectorAll(".seg-btn").forEach((b) => {
    b.setAttribute("aria-pressed", String(b === btn));
  });
  liquidMove(group.querySelector(".seg-indicator"), btn);
}

/**
 * Every showing on the day the visitor just opened, at once and without
 * the beat's cap — switching day should land on real numbers rather
 * than fill them in over the next few seconds.
 */
async function enrichVisibleDay({ force = false } = {}) {
  if (!state?.shows || !selectedDay) return;
  const dayShows = state.shows.filter(
    (s) => s.dayKey === selectedDay && s.eventId
  );
  if (!dayShows.length) return;

  await refreshLive({ shows: dayShows, all: true, force });

  // Check-in numbers are their own pass: the visible day first so it
  // updates immediately, then everything else in the background.
  await syncScanned({ shows: dayShows, force });
  syncScanned().catch((err) => console.warn("Scan sync failed", err));
}

/**
 * The Movies and Statistics tabs read from the whole programme, so the
 * first visit fills in every showing the beat has not reached yet.
 * After that the beat keeps them current.
 */
async function ensureAllEnriched() {
  if (enrichedAll || !state?.shows) return;
  await refreshLive({ all: true });
  enrichedAll = true;
  await syncScanned();
}

/**
 * Should this showing's sold count be read again?
 *
 * A showing that is long over is history and cannot move, so it is left
 * alone; everything else is measured against how fast it can plausibly
 * change — see `liveFreshMs`.
 */
function shouldFetchLive(show, now, onScreen, force) {
  if (!show.eventId) return false;
  // DX has deleted the event; the programme pass takes the showing out.
  if (show.eventStatus === "gone") return false;
  if (force) return true;

  if (show.start && now - showEndOf(show).getTime() > FINAL_AFTER_MS) {
    // Long over: the numbers are history and cannot move again. Only a
    // showing DX never answered for is worth another look, and even
    // that one can wait for the calm cycle.
    if (show.sold != null) return false;
    return !show.liveAt || now - show.liveAt >= LIVE_CALM_MS;
  }

  if (!show.liveAt) return true;
  return now - show.liveAt >= liveFreshMs(show, now, onScreen);
}

/**
 * How stale a sold count may get before the beat reads it again.
 *
 * One small public lookup covers a showing, so anything the visitor can
 * see gets its own beat however far off it is. Off screen, that goes to
 * whatever is near its door time — those numbers feed the day totals
 * and the statistics even when the showing itself is scrolled away.
 */
function liveFreshMs(show, now, onScreen) {
  if (onScreen?.has(show.id)) return BEAT_FRESH_MS;
  if (inActiveWindow(show, now)) return BEAT_FRESH_MS;
  return LIVE_CALM_MS;
}

/**
 * Read the showings whose sold counts have come due, the ones that have
 * waited longest first. A plain beat takes at most `BEAT_MAX_EVENTS` of
 * them; `all` lifts that cap for the passes a visitor is waiting on.
 *
 * Resolves to true when a figure actually moved.
 */
async function refreshLive({
  shows,
  force = false,
  all = false,
  quiet = false,
} = {}) {
  if (!state?.shows) return false;

  const now = Date.now();
  const onScreen = showsOnScreen();
  // The cap goes to what the visitor is watching first. Ordering by
  // staleness alone would let the backlog of a programme still being
  // read for the first time push the showing on screen off the beat.
  const due = (shows || state.shows)
    .filter((s) => shouldFetchLive(s, now, onScreen, force))
    .map((show) => ({ show, freshMs: liveFreshMs(show, now, onScreen) }))
    .sort(
      (a, b) =>
        a.freshMs - b.freshMs || (a.show.liveAt || 0) - (b.show.liveAt || 0)
    )
    .map((row) => row.show);
  if (!due.length) return false;

  const targets = all || force ? due : due.slice(0, BEAT_MAX_EVENTS);
  const token = ++enrichToken;
  if (!quiet) setBusy(true);
  let changed = false;

  try {
    const batchSize = 8;
    for (let i = 0; i < targets.length; i += batchSize) {
      if (token !== enrichToken) return changed;
      const moved = await Promise.all(
        targets.slice(i, i + batchSize).map(enrichOne)
      );
      if (moved.some(Boolean)) changed = true;
    }
    if (token !== enrichToken) return changed;

    const removed = dropRemovedShows();
    if (removed.size) changed = true;
    // Storing the history means reading, parsing and rewriting the lot.
    // On a beat that brought back the same numbers there is nothing in
    // it to write, and doing it anyway would stall the page every few
    // seconds once a few months of showings have piled up.
    if (changed) persistHistory(targets.filter((s) => !removed.has(s.id)));
    lastLiveAt = Date.now();
    applyPreviewScanned();
    setStatus(t("liveAt", { time: formatClock(new Date()) }), { live: true });
  } finally {
    if (!quiet) setBusy(false);
  }

  if (changed && activeTab !== "settings") renderActiveView();
  return changed;
}

/** Read one showing from DX. Resolves to true when a figure moved. */
async function enrichOne(show) {
  const before = liveFigures(show);
  try {
    const event = await fetchDxEvent(show);
    const end = parseLocalDateTime(event.end);
    const begin = parseLocalDateTime(event.begin);
    if (begin) show.start = begin;
    if (end) show.end = end;
    const sale = event.ticketSale || {};
    show.sold = Number(sale.sold) || 0;
    show.reserved = Number(sale.reserved) || 0;
    show.capacity = Number(sale.capacity) || null;
    show.available = sale.available != null ? Number(sale.available) : null;
    if (event.locationName) {
      show.screen = String(event.locationName)
        .replace(/\s*-\s*Kino$/i, "")
        .trim();
    }
    show.eventStatus = "ok";
    return liveFigures(show) !== before;
  } catch (err) {
    // A deleted event means the showing has left the programme; a
    // network hiccup means nothing, so only DX's own 404 counts.
    if (err.status === 404 || err.status === 410) {
      const gone = show.eventStatus !== "gone";
      show.eventStatus = "gone";
      return gone;
    }
    console.warn("Live event fetch failed", show.eventId, err);
    if (show.sold == null) show.eventStatus = "error";
    return false;
  } finally {
    // Stamped whatever DX answered, so an event it cannot answer for
    // backs off with the rest instead of being retried every beat.
    show.liveAt = Date.now();
  }
}

/** Everything about a showing that a re-read could move, as one string. */
function liveFigures(show) {
  return [
    show.sold,
    show.reserved,
    show.capacity,
    show.available,
    show.screen,
    show.eventStatus,
    show.start?.getTime(),
    show.end?.getTime(),
  ].join("|");
}

/**
 * Take showings DX has deleted out of the app. A show that has already
 * started stays — it played, and its numbers are history — but one still
 * to come is simply not happening, so it should not sit in the list
 * until the next nightly snapshot says so.
 */
function dropRemovedShows() {
  const empty = new Set();
  if (!state?.shows) return empty;
  const now = Date.now();
  const removed = state.shows.filter(
    (s) =>
      s.eventStatus === "gone" &&
      s.start instanceof Date &&
      s.start.getTime() > now
  );
  if (!removed.length) return empty;

  const ids = new Set(removed.map((s) => s.id));
  const daysBefore = new Set(state.shows.map((s) => s.dayKey));
  state.shows = state.shows.filter((s) => !ids.has(s.id));
  forgetShows(ids);
  for (const show of removed) {
    seatCharts.delete(String(show.eventId));
    openSeatCharts.delete(show.id);
  }

  // A day can lose its last showing, which changes the day strip.
  const daysAfter = new Set(state.shows.map((s) => s.dayKey));
  if (daysBefore.size !== daysAfter.size) populateFilters();
  return ids;
}

/**
 * Is this showing's door open — guests arriving, tickets being scanned?
 * It stays open until a little after the credits: latecomers are
 * scanned in throughout, and every one of them moves a seat on the
 * chart from amber to green.
 */
function inDoorWindow(show, now = Date.now()) {
  if (!show?.start) return false;
  return (
    now >= show.start.getTime() - DOOR_BEFORE_MS &&
    now <= showEndOf(show).getTime() + DOOR_AFTER_MS
  );
}

/** Is anything about this showing still moving — sales, or the door? */
function inActiveWindow(show, now = Date.now()) {
  if (!show?.start) return false;
  return (
    now >= show.start.getTime() - ACTIVE_LEAD_MS &&
    now <= showEndOf(show).getTime() + DOOR_AFTER_MS
  );
}

/**
 * How stale a check-in count or a seat chart may get before the beat
 * reads it again. Both come off DX's purchase list for the showing — a
 * heavy lookup, and one that can only tell a new story while the doors
 * are open — so those ride the beat around the showing itself and idle
 * the rest of the time, on screen or not.
 */
function doorFreshMs(show, now = Date.now()) {
  return inDoorWindow(show, now) ? BEAT_FRESH_MS : DOOR_CALM_MS;
}

/**
 * Should this show's check-in count be fetched right now?
 *
 * Past days matter as much as today — a worker looks back to see whether
 * everyone got in — so a show whose count was never fetched always
 * qualifies, however old it is. Once it has been fetched and the show is
 * well and truly over the number can no longer change, and the show is
 * marked done so later syncs skip it.
 */
function shouldFetchScan(show, now, force) {
  if (!show.eventId || !show.start) return false;
  // Nothing can be scanned long before the doors open.
  if (show.start.getTime() - now > ACTIVE_LEAD_MS) return false;
  // Nor when the show sold nothing — there is no one to let in.
  if (show.eventStatus === "ok" && show.sold === 0) return false;
  if (force) return true;
  if (show.scanDone) return false;
  if (!show.scannedAt) {
    // A lookup the bridge could not answer waits its turn like the rest
    // rather than going out again on every beat while DX is down.
    return (
      !show.scanTriedAt || now - show.scanTriedAt >= doorFreshMs(show, now)
    );
  }
  if (now - showEndOf(show).getTime() > FINAL_AFTER_MS) {
    return show.scanned == null;
  }
  return now - show.scannedAt >= doorFreshMs(show, now);
}

/**
 * Fetch check-in counts for every show that needs one, across all days.
 * Resolves to true when a number actually changed, so callers know
 * whether a re-render is worth it.
 */
async function syncScanned({ shows, force = false, quiet = false } = {}) {
  if (!isDxConnected() || !state?.shows) return false;
  if (scanSyncRunning && !force) return false;

  const now = Date.now();
  const targets = (shows || state.shows).filter((s) =>
    shouldFetchScan(s, now, force)
  );
  if (!targets.length) return false;

  scanSyncRunning = true;
  // The fast around-showtime poll runs quietly; spinning the refresh
  // button once every five seconds would just read as stuck.
  if (!quiet) setBusy(true);
  let changed = false;
  /** A show whose count has just gone final, worth remembering. */
  let settled = false;
  let fetched = 0;
  let lastError = "";
  let expired = false;

  try {
    // One bridge call covers a batch of events; each DX purchase list is
    // a heavy payload, so asking per show would be needlessly slow.
    for (const [partnerId, list] of groupByPartner(targets)) {
      for (let i = 0; i < list.length && !expired; i += SCAN_BATCH) {
        const chunk = list.slice(i, i + SCAN_BATCH);
        let counts = null;
        try {
          counts = await fetchScannedCounts(
            partnerId,
            chunk.map((s) => String(s.eventId))
          );
        } catch (err) {
          if (err?.code === "auth") {
            expired = true;
            lastError = "auth";
            break;
          }
          lastError = String(err?.message || err);
          for (const show of chunk) show.scanTriedAt = Date.now();
          continue;
        }

        for (const show of chunk) {
          show.scannedAt = Date.now();
          const count = counts?.[String(show.eventId)];
          if (count && typeof count.scanned === "number") {
            fetched += 1;
            if (show.scanned !== count.scanned) {
              show.scanned = count.scanned;
              changed = true;
            }
            // DX counts tickets net of refunds; trust it over a stale sold.
            if (typeof count.sold === "number" && show.sold !== count.sold) {
              show.sold = count.sold;
              changed = true;
            }
          }
          // Nothing more can happen to a show that ended hours ago.
          if (
            !show.scanDone &&
            Date.now() - showEndOf(show).getTime() > FINAL_AFTER_MS
          ) {
            show.scanDone = true;
            settled = true;
          }
        }
      }
    }

    if (expired) {
      console.warn("DX bridge session failed — will retry on next beat");
      clearDxToken();
    }
    dxScanStatus = {
      at: fetched ? Date.now() : dxScanStatus.at,
      source: dxScanStatus.source,
      error: expired ? lastError || "auth" : fetched ? "" : lastError,
    };
    // Only a count that moved, or one that has just gone final, is
    // worth rewriting the stored history for — see refreshLive.
    if (changed || settled) persistHistory(targets);
  } finally {
    scanSyncRunning = false;
    if (!quiet) setBusy(false);
  }

  if (changed && activeTab !== "settings") renderActiveView();
  return changed;
}

/** Shows keyed by the DX partner that owns them (Buen is the only one today). */
function groupByPartner(shows) {
  const byPartner = new Map();
  for (const show of shows) {
    const id = String(show.promoterId || dxAuth?.partnerId || DX_PARTNER_ID);
    if (!byPartner.has(id)) byPartner.set(id, []);
    byPartner.get(id).push(show);
  }
  return byPartner;
}

async function fetchDxEvent(show) {
  const promoterId = show.promoterId || DX_PARTNER_ID;
  const url = `${DX_API}/partners/${promoterId}/events/${show.eventId}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Referer: show.ticketUrl || "https://checkout.ebillett.no/",
    },
  });
  if (!res.ok) {
    const err = new Error(`DX ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Ask the bridge about one event and report exactly what DX said, so a
 * blank admission column can be explained instead of guessed at.
 */
async function runDxScanDiagnostics() {
  const show = diagnosticShow();
  if (!show) return { code: "noShows" };

  const partnerId = show.promoterId || dxAuth?.partnerId || DX_PARTNER_ID;
  const payload = {
    action: "scanned",
    partnerId,
    eventIds: [String(show.eventId)],
    debug: true,
  };
  if (dxAuth?.token) payload.token = dxAuth.token;

  let result;
  try {
    result = await callDxProxy(payload);
  } catch (err) {
    return { code: "empty", show, details: String(err?.message || err) };
  }

  const { status, ok, data } = result;
  const lines = [
    `bridge → HTTP ${status}`,
    ...(Array.isArray(data.log) ? data.log : []),
    ...(data.error ? [`error: ${data.error}`] : []),
  ];

  if (status === 401 || status === 403) {
    clearDxToken();
    return { code: "auth", show, details: lines.join("\n") };
  }
  if (data.token) rememberDxToken(data.token);

  const count = ok && data.counts ? data.counts[String(show.eventId)] : null;
  if (count && typeof count.scanned === "number") {
    show.scanned = count.scanned;
    show.scannedAt = Date.now();
    if (typeof count.sold === "number" && show.sold == null) show.sold = count.sold;
    persistHistory([show]);
    dxScanStatus = {
      at: Date.now(),
      source: data.source || dxScanStatus.source,
      error: "",
    };
    return { code: "ok", scanned: count.scanned, show, details: lines.join("\n") };
  }
  return { code: "empty", show, details: lines.join("\n") };
}

/** Prefer a show that has actually been let in: the most recent past one. */
function diagnosticShow() {
  const shows = (state?.shows || []).filter((s) => s.eventId && (s.sold ?? 0) > 0);
  if (!shows.length) return null;
  const now = Date.now();
  const past = shows
    .filter((s) => s.start.getTime() <= now)
    .sort((a, b) => b.start - a.start);
  return past[0] || shows[0];
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
    hour12: false,
  });
}

function formatDuration(minutes) {
  if (minutes == null) return "?";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = lang === "en" ? "h" : "t";
  if (h && m) return `${h}${hour} ${m}m`;
  if (h) return `${h}${hour}`;
  return `${m}m`;
}

/**
 * Running time in the short form the cards use. Buen sends it spelled
 * out ("2 t. 25 min."); trim it down, and say hours the way the chosen
 * language does.
 */
function formatRunning(label, minutes) {
  if (!label) return formatDuration(minutes);
  const short = String(label).replace(" t. ", "t ").replace(" min.", "m");
  return lang === "en" ? short.replace(/(\d)t(\s|$)/, "$1h$2") : short;
}

/**
 * Reference-counted spinner: the day enrich and the check-in sync overlap
 * constantly, and whichever finished first used to stop the animation
 * while the other was still fetching.
 */
function setBusy(on) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  els.refreshBtn.classList.toggle("spinning", busyCount > 0);
}

function setLoading(isLoading) {
  els.refreshBtn.disabled = isLoading;
  setBusy(isLoading);
  if (isLoading && !state) {
    paint(
      els.content,
      `
      <div class="state loading">
        <div class="spinner" aria-hidden="true"></div>
        <p>${escapeHtml(t("loading"))}</p>
      </div>
    `
    );
  }
}

function showError(message) {
  setStatus(t("error"), { error: true });
  paint(
    els.content,
    `
    <div class="state error">
      <p>${escapeHtml(message)}</p>
      <button type="button" id="retryBtn">${escapeHtml(t("retry"))}</button>
    </div>
  `
  );
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
