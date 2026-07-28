import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * DX bridge for Cinema Info.
 *
 * Check-in state lives in one place: app.dx.no's purchase list, where
 * every ticket carries `used` / `usedDateTime` once it has been scanned
 * at the door, plus the `seatId` / `rowName` / `seatNumber` it was sold
 * for. app.dx.no sends no CORS headers at all, so a browser cannot read
 * it — this function holds the session and returns counts (`scanned`)
 * or a whole hall (`seats`).
 *
 * Sessions are short (the app.dx.no cookie lasts about a day) but the
 * Auth0 SSO cookie behind it lasts about three, and replaying the
 * authorize step with it mints a fresh session without a password. When
 * that happens the refreshed token is handed back so the caller can
 * store it.
 */

const AUTH0 = "https://login.dx.no";
const APP = "https://app.dx.no";
const CLIENT_ID = "3y0iSEXBv8kI91Y5a2UiwEjfh2miWClo";
const REALM = "Username-Password-Authentication";
const PARTNER_ID = "202";
const AUTH0_CLIENT = "eyJuYW1lIjoiYXV0aDAuanMiLCJ2ZXJzaW9uIjoiOS4yMy4xIn0=";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** Cookies worth carrying between calls: the session plus its SSO root. */
const KEEP_COOKIES = [
  "dxweb_session",
  "XSRF-TOKEN",
  "DXWEB_AFFINITY",
  "auth0",
  "did",
];

/** Events fetched at once; each purchase list is a sizeable payload. */
const CONCURRENCY = 4;
const MAX_EVENTS = 24;

/**
 * Seat maps are hall geometry: they change when someone rebuilds an
 * auditorium, not between showings, so an isolate can hold on to one.
 */
const SEATMAP_TTL_MS = 6 * 60 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Jar = Map<string, string>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function absorbSetCookie(res: Response, jar: Jar) {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const single = res.headers.get("set-cookie");
          return single ? [single] : [];
        })();
  for (const raw of list) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

function cookieHeader(jar: Jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchManual(
  url: string,
  init: RequestInit & { jar?: Jar } = {},
) {
  const jar = init.jar;
  const headers = new Headers(init.headers || {});
  if (jar) {
    const cookie = cookieHeader(jar);
    if (cookie) headers.set("Cookie", cookie);
  }
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  if (jar) absorbSetCookie(res, jar);
  return res;
}

function dxError(message: string, code: string) {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

function packToken(jar: Jar) {
  const out: Record<string, string> = {};
  for (const name of KEEP_COOKIES) {
    const value = jar.get(name);
    if (value) out[name] = value;
  }
  return JSON.stringify(out);
}

function unpackToken(token: string): Jar | null {
  try {
    const parsed = JSON.parse(token) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") return null;
    const jar: Jar = new Map();
    for (const name of KEEP_COOKIES) {
      if (parsed[name]) jar.set(name, parsed[name]);
    }
    // Only the SSO cookie is strictly required — a session can be reminted.
    return jar.has("dxweb_session") || jar.has("auth0") ? jar : null;
  } catch {
    return null;
  }
}

/**
 * Walk the app.dx.no login: it starts an Auth0 authorize, Auth0 turns
 * email + password into a login ticket, and the callback exchanges the
 * resulting code for a session cookie. `credentials` may be omitted to
 * renew silently off the SSO cookie already in the jar.
 */
async function authorize(
  jar: Jar,
  credentials?: { email: string; password: string },
) {
  const start = await fetchManual(`${APP}/apiweb/login`, {
    method: "GET",
    jar,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const authUrl = start.headers.get("location") || "";
  if (!authUrl.includes("login.dx.no/authorize")) {
    throw dxError("DX Web login start failed", "auth0");
  }

  let target = authUrl;
  if (credentials) {
    const coRes = await fetchManual(`${AUTH0}/co/authenticate`, {
      method: "POST",
      jar,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: APP,
        Referer: `${APP}/`,
        "Auth0-Client": AUTH0_CLIENT,
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        credential_type: "http://auth0.com/oauth/grant-type/password-realm",
        username: credentials.email,
        password: credentials.password,
        realm: REALM,
      }),
    });
    const coText = await coRes.text();
    let co: Record<string, unknown> = {};
    try {
      co = coText ? JSON.parse(coText) : {};
    } catch {
      co = {};
    }
    if (!coRes.ok) {
      const desc = String(co.error_description || co.description || "");
      throw dxError(
        desc || "Wrong email or password.",
        /wrong email or password|invalid/i.test(desc) ? "login" : "auth0",
      );
    }
    const ticket = co.login_ticket || co.loginTicket;
    if (!ticket) throw dxError("Auth0 login ticket missing", "auth0");

    const u = new URL(authUrl);
    u.searchParams.set("login_ticket", String(ticket));
    u.searchParams.set("realm", REALM);
    target = u.toString();
  }

  const authRes = await fetchManual(target, {
    method: "GET",
    jar,
    headers: { Accept: "text/html", Referer: `${APP}/` },
  });
  const callback = authRes.headers.get("location") || "";
  if (!callback.includes("/apiweb/callback") || !callback.includes("code=")) {
    throw dxError("Auth0 authorization code missing", "auth0");
  }

  const cbRes = await fetchManual(callback, {
    method: "GET",
    jar,
    headers: { Accept: "text/html,application/xhtml+xml", Referer: `${AUTH0}/` },
  });
  if (cbRes.status >= 400) throw dxError("DX Web callback failed", "auth0");
  if (!jar.get("dxweb_session")) {
    throw dxError("DX Web session cookie missing", "auth0");
  }
}

async function login(email: string, password: string) {
  const jar: Jar = new Map();
  await authorize(jar, { email, password });

  const meRes = await fetch(`${APP}/api/v1/auth/`, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      Referer: `${APP}/`,
      Cookie: cookieHeader(jar),
    },
  });
  const me = meRes.ok
    ? ((await meRes.json()) as Record<string, unknown>)
    : {};
  if (!me.authenticated) throw dxError("DX Web session not authenticated", "auth0");

  const auth = (me.auth || {}) as Record<string, unknown>;
  const partners = (me.partners || []) as Array<Record<string, unknown>>;

  return {
    type: "dxweb" as const,
    token: packToken(jar),
    email: String(auth.email || email),
    partnerId: String(partners[0]?.partnerID || PARTNER_ID),
    source: "app.dx.no",
  };
}

/** GET as the signed-in user, returning 401 verbatim so callers can renew. */
async function apiGet(jar: Jar, path: string) {
  const res = await fetch(APP + path, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      Referer: `${APP}/`,
      Cookie: cookieHeader(jar),
    },
  });
  return res;
}

type Session = {
  jar: Jar;
  log: string[];
  renewed: boolean;
  get(path: string): Promise<Response>;
};

/**
 * A signed-in DX session that heals itself once. The first request to
 * come back 401 mints a new session off the SSO cookie and retries; if
 * that fails too the token is genuinely dead and the caller must ask
 * for a password again.
 */
function openSession(token: string, log: string[]): Session | null {
  const jar = unpackToken(token);
  if (!jar) return null;

  const session: Session = {
    jar,
    log,
    renewed: false,
    async get(path: string) {
      let res = await apiGet(jar, path);
      if (res.status !== 401 && res.status !== 403) return res;

      if (!session.renewed) {
        session.renewed = true;
        try {
          await authorize(jar);
          log.push("session renewed from SSO cookie");
        } catch (e) {
          log.push(`renew failed: ${(e as Error).message}`);
          throw dxError("DX session expired", "auth");
        }
      }
      res = await apiGet(jar, path);
      if (res.status === 401 || res.status === 403) {
        throw dxError("DX session expired", "auth");
      }
      return res;
    },
  };
  return session;
}

/** Wrap a handler so an expired session always reads the same to callers. */
async function respond(
  session: Session,
  build: () => Promise<Record<string, unknown>>,
  debug: boolean,
) {
  try {
    const body = await build();
    return json({
      ...body,
      ...(session.renewed ? { token: packToken(session.jar) } : {}),
      ...(debug ? { log: session.log } : {}),
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "auth") {
      return json({ error: err.message, code: "auth", log: session.log }, 401);
    }
    return json({ error: err.message, log: session.log }, 502);
  }
}

type Count = { scanned: number; sold: number };
type Ticket = Record<string, unknown>;

const purchasesPath = (partnerId: string, eventId: string) =>
  `/api/v1/partners/${partnerId}/purchases?eventId=${eventId}`;

/**
 * Every live ticket in a purchase list. Annulled tickets are refunds —
 * they are gone from the sold figure DX reports, so they must not count
 * on either side of "is everyone in?", nor hold a seat.
 */
function eachTicket(payload: unknown, visit: (ticket: Ticket) => void) {
  const purchases = (payload as { data?: { purchases?: unknown } })?.data
    ?.purchases;
  if (!Array.isArray(purchases)) return false;

  for (const purchase of purchases) {
    const items = (purchase as { purchaseItems?: unknown[] })?.purchaseItems;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const tickets = (item as { tickets?: unknown[] })?.tickets;
      if (!Array.isArray(tickets)) continue;
      for (const raw of tickets) {
        const ticket = raw as Ticket;
        if (!ticket.annulled) visit(ticket);
      }
    }
  }
  return true;
}

/** Tally one event from its purchase list. */
function countUsedTickets(payload: unknown): Count | null {
  let scanned = 0;
  let sold = 0;
  const found = eachTicket(payload, (ticket) => {
    const n = Number(ticket.count) || 1;
    sold += n;
    if (ticket.used) scanned += n;
  });
  return found ? { scanned, sold } : null;
}

async function fetchScanned(body: {
  token?: string;
  partnerId?: string;
  eventIds?: unknown;
  debug?: boolean;
}) {
  if (!body.token) return json({ error: "token required" }, 400);
  const partnerId = String(body.partnerId || PARTNER_ID);
  const eventIds = (Array.isArray(body.eventIds) ? body.eventIds : [])
    .map((id) => String(id))
    .filter((id) => /^\d+$/.test(id))
    .slice(0, MAX_EVENTS);
  if (!eventIds.length) return json({ error: "eventIds required" }, 400);

  const log: string[] = [];
  const session = openSession(body.token, log);
  if (!session) return json({ error: "Unreadable token", code: "auth" }, 401);

  const load = async (eventId: string): Promise<Count | null> => {
    const res = await session.get(purchasesPath(partnerId, eventId));
    if (!res.ok) {
      log.push(`${eventId} → HTTP ${res.status}`);
      return null;
    }
    const count = countUsedTickets(await res.json());
    log.push(
      count
        ? `${eventId} → ${count.scanned}/${count.sold} used`
        : `${eventId} → no purchase list in response`,
    );
    return count;
  };

  return await respond(
    session,
    async () => {
      const counts: Record<string, Count> = {};
      for (let i = 0; i < eventIds.length; i += CONCURRENCY) {
        const slice = eventIds.slice(i, i + CONCURRENCY);
        const results = await Promise.all(slice.map(load));
        slice.forEach((id, n) => {
          const count = results[n];
          if (count) counts[id] = count;
        });
      }
      return { counts, source: "app.dx.no/purchases" };
    },
    Boolean(body.debug),
  );
}

/* —— Seat maps ——————————————————————————————————————————————
 *
 * A hall is `/seatMaps` (geometry: rows of seats at x/y, some blocked)
 * crossed with the event's purchase list (which of those seat ids were
 * sold, and which of those were scanned at the door).
 *
 * DX numbers a seat one higher in the map than on the printed ticket —
 * every row starts at 2 — so the offset is derived from the map itself
 * and applied before the numbers ever leave here.
 */

type MapSeat = { i: number; n: number; x: number; y: number; blocked: boolean };
type MapRow = { name: string; seats: MapSeat[] };
type HallMap = { locationId: number; offset: number; rows: MapRow[] };

const seatMapCache = new Map<string, { at: number; hall: HallMap }>();

function slimSeatMaps(payload: unknown): HallMap[] {
  const maps = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(maps)) return [];

  const halls: HallMap[] = [];
  for (const raw of maps) {
    const map = raw as Record<string, unknown>;
    const rows: MapRow[] = [];
    let lowest = Infinity;

    const sections = Array.isArray(map.seatSections) ? map.seatSections : [];
    for (const section of sections) {
      const groups = (section as { seatGroups?: unknown[] })?.seatGroups;
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const g = group as Record<string, unknown>;
        const list = Array.isArray(g.seats) ? g.seats : [];
        const seats: MapSeat[] = [];
        for (const item of list) {
          const seat = item as Record<string, unknown>;
          const n = Number(seat.number);
          const x = Number(seat.x);
          const y = Number(seat.y);
          if (!Number.isFinite(n) || !Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
          }
          lowest = Math.min(lowest, n);
          seats.push({
            i: Number(seat.id),
            n,
            x,
            y,
            blocked: seat.type === "blocked",
          });
        }
        if (!seats.length) continue;
        seats.sort((a, b) => a.n - b.n);
        rows.push({ name: String(g.name ?? ""), seats });
      }
    }
    if (!rows.length) continue;

    // Rows arrive in creation order; screen-to-back is what a reader
    // expects, and that is simply top-to-bottom in the hall's geometry.
    rows.sort((a, b) => a.seats[0].y - b.seats[0].y);
    halls.push({
      locationId: Number(map.locationId),
      offset: Number.isFinite(lowest) ? lowest - 1 : 0,
      rows,
    });
  }
  return halls;
}

/**
 * The geometry for one auditorium. DX keys a seat map by its location,
 * so the single-hall route usually answers; the full list is the
 * fallback for a partner whose maps are numbered some other way.
 */
async function loadSeatMap(
  session: Session,
  partnerId: string,
  locationId: number,
) {
  const cached = seatMapCache.get(`${partnerId}:${locationId}`);
  if (cached && Date.now() - cached.at < SEATMAP_TTL_MS) {
    session.log.push(`seat map ${locationId} from cache`);
    return cached.hall;
  }

  const one = await session.get(
    `/api/v1/partners/${partnerId}/seatMaps/${locationId}`,
  );
  if (one.ok) {
    const [hall] = slimSeatMaps({ data: [await one.json()] });
    if (hall?.locationId === locationId) {
      session.log.push(`seat map ${locationId} fetched`);
      return cacheHall(partnerId, hall);
    }
  }
  session.log.push(`seatMaps/${locationId} → HTTP ${one.status}, listing all`);

  const all = await session.get(`/api/v1/partners/${partnerId}/seatMaps`);
  if (!all.ok) {
    session.log.push(`seatMaps → HTTP ${all.status}`);
    return null;
  }
  let match: HallMap | null = null;
  for (const hall of slimSeatMaps(await all.json())) {
    cacheHall(partnerId, hall);
    if (hall.locationId === locationId) match = hall;
  }
  return match;
}

function cacheHall(partnerId: string, hall: HallMap) {
  seatMapCache.set(`${partnerId}:${hall.locationId}`, { at: Date.now(), hall });
  return hall;
}

/**
 * The hall as the client should draw it: printed seat numbers, blocked
 * seats left out unless somebody is sitting in one anyway, and the
 * bounding box plus seat pitch so the drawing scales without measuring.
 */
function buildLayout(hall: HallMap, occupied: Set<number>) {
  const rows = [];
  const xs: number[] = [];
  const ys: number[] = [];

  for (const row of hall.rows) {
    const seats = row.seats
      .filter((seat) => !seat.blocked || occupied.has(seat.i))
      .map((seat) => ({ i: seat.i, n: seat.n - hall.offset, x: seat.x }));
    if (!seats.length) continue;
    const y = row.seats[0].y;
    for (const seat of seats) xs.push(seat.x);
    ys.push(y);
    rows.push({ name: row.name, y, seats });
  }
  if (!rows.length) return null;

  return {
    locationId: hall.locationId,
    rows,
    seats: rows.reduce((n, row) => n + row.seats.length, 0),
    box: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    },
    pitch: { x: pitchOf(xs), y: pitchOf(ys) },
  };
}

/** Smallest gap between neighbouring coordinates — one seat's footprint. */
function pitchOf(values: number[]) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  let pitch = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    pitch = Math.min(pitch, sorted[i] - sorted[i - 1]);
  }
  return Number.isFinite(pitch) && pitch > 0 ? pitch : 20;
}

/** Seat states the client paints: 1 sold, 2 sold and scanned in. */
type SeatState = 1 | 2;

async function fetchSeats(body: {
  token?: string;
  partnerId?: string;
  eventId?: unknown;
  withLayout?: boolean;
  debug?: boolean;
}) {
  if (!body.token) return json({ error: "token required" }, 400);
  const partnerId = String(body.partnerId || PARTNER_ID);
  const eventId = String(body.eventId ?? "");
  if (!/^\d+$/.test(eventId)) return json({ error: "eventId required" }, 400);

  const log: string[] = [];
  const session = openSession(body.token, log);
  if (!session) return json({ error: "Unreadable token", code: "auth" }, 401);

  return await respond(
    session,
    async () => {
      const eventRes = await session.get(
        `/api/v1/partners/${partnerId}/events/${eventId}`,
      );
      if (!eventRes.ok) {
        log.push(`event ${eventId} → HTTP ${eventRes.status}`);
        throw new Error(`DX event ${eventRes.status}`);
      }
      const event = (await eventRes.json()) as Record<string, unknown>;
      const sales = (Array.isArray(event.ticketSales) ? event.ticketSales : [])
        .map((s) => s as Record<string, unknown>);
      const sale =
        sales.find((s) => String(s.eventId) === eventId) || sales[0] || {};
      const location = (event.location || {}) as Record<string, unknown>;
      const locationId = Number(event.locationId ?? location.id);
      const freeSeating = Boolean(sale.freeSeating ?? location.freeSeating);

      const purchaseRes = await session.get(purchasesPath(partnerId, eventId));
      if (!purchaseRes.ok) {
        log.push(`purchases ${eventId} → HTTP ${purchaseRes.status}`);
        throw new Error(`DX purchases ${purchaseRes.status}`);
      }

      const seats: Record<string, SeatState> = {};
      let sold = 0;
      let scanned = 0;
      let unseated = 0;
      eachTicket(await purchaseRes.json(), (ticket) => {
        const n = Number(ticket.count) || 1;
        sold += n;
        if (ticket.used) scanned += n;
        const seatId = Number(ticket.seatId);
        if (!seatId) {
          unseated += n;
          return;
        }
        // Two tickets can share a seat when one is a companion pass;
        // a scanned one always wins over an unscanned one.
        const state: SeatState = ticket.used ? 2 : 1;
        if ((seats[seatId] || 0) < state) seats[seatId] = state;
      });
      log.push(
        `${eventId} → ${scanned}/${sold} used, ${Object.keys(seats).length} seats`,
      );

      const result: Record<string, unknown> = {
        eventId,
        locationId,
        locationName: String(event.locationName || location.name || ""),
        freeSeating,
        capacity: Number(sale.capacity ?? location.capacity) || null,
        reserved: Number(sale.reserved) || 0,
        sold,
        scanned,
        unseated,
        seats,
        source: "app.dx.no/purchases",
      };

      if (freeSeating) {
        log.push(`${eventId} → free seating, no chart`);
        return result;
      }
      if (!body.withLayout) return result;

      const hall = await loadSeatMap(session, partnerId, locationId);
      if (!hall) {
        log.push(`no seat map for location ${locationId}`);
        return result;
      }
      result.layout = buildLayout(hall, new Set(Object.keys(seats).map(Number)));
      return result;
    },
    Boolean(body.debug),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (body.action === "scanned") {
    return await fetchScanned({
      token: body.token ? String(body.token) : undefined,
      partnerId: body.partnerId ? String(body.partnerId) : undefined,
      eventIds: body.eventIds,
      debug: Boolean(body.debug),
    });
  }

  if (body.action === "seats") {
    return await fetchSeats({
      token: body.token ? String(body.token) : undefined,
      partnerId: body.partnerId ? String(body.partnerId) : undefined,
      eventId: body.eventId,
      withLayout: body.withLayout !== false,
      debug: Boolean(body.debug),
    });
  }

  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) {
    return json({ error: "Email and password required", code: "login" }, 400);
  }

  try {
    return json(await login(email, password));
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code || "login";
    return json(
      { error: err.message || "Login failed", code },
      code === "login" ? 403 : 502,
    );
  }
});
