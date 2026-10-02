/**
 * Feedback from the people using the app, kept on the server for the
 * feedback hub (`server/hub.html`, served on the admin port only).
 *
 * One JSON file is plenty: a handful of notes a week, read by one person.
 * Writes go through a queue and land with a rename, so a crash mid-write
 * never leaves half a file.
 */

export type FeedbackKind = "bug" | "idea" | "other";
export type FeedbackStatus = "new" | "done";

export type Feedback = {
  id: string;
  at: string;
  kind: FeedbackKind;
  message: string;
  name: string;
  status: FeedbackStatus;
  context: Record<string, string>;
  /** Salted hash of the sender's address: spots a flood, names nobody. */
  sender: string;
  doneAt?: string;
};

const KINDS = new Set<FeedbackKind>(["bug", "idea", "other"]);
const MAX_MESSAGE = 4000;
const MAX_NAME = 80;
const CONTEXT_KEYS = [
  "version",
  "site",
  "tab",
  "day",
  "lang",
  "theme",
  "viewport",
  "standalone",
  "ua",
] as const;

let file = "";
let items: Feedback[] = [];
let writing: Promise<void> = Promise.resolve();
let salt = "";

export async function startFeedback(dataDir: string) {
  file = `${dataDir}/feedback.json`;
  try {
    const raw = JSON.parse(await Deno.readTextFile(file));
    items = Array.isArray(raw) ? raw : [];
  } catch {
    items = [];
  }
  try {
    salt = (await Deno.readTextFile(`${dataDir}/feedback.salt`)).trim();
  } catch {
    salt = crypto.randomUUID();
    await Deno.writeTextFile(`${dataDir}/feedback.salt`, salt);
  }
  console.log(`feedback: ${items.length} stored`);
}

function save() {
  const snapshot = JSON.stringify(items, null, 2);
  writing = writing.then(async () => {
    const tmp = `${file}.tmp`;
    await Deno.writeTextFile(tmp, snapshot);
    await Deno.rename(tmp, file);
  }).catch((err) => console.error("feedback save failed", err));
  return writing;
}

async function senderHash(ip: string) {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 5)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clip(value: unknown, max: number) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/** Validate and store one note. Returns the stored note or an error. */
export async function addFeedback(body: Record<string, unknown>, ip: string) {
  const message = clip(body.message, MAX_MESSAGE);
  if (message.length < 3) return { error: "message required" as const };
  const kind = KINDS.has(body.kind as FeedbackKind)
    ? body.kind as FeedbackKind
    : "other";

  const rawContext = (body.context && typeof body.context === "object")
    ? body.context as Record<string, unknown>
    : {};
  const context: Record<string, string> = {};
  for (const key of CONTEXT_KEYS) {
    const v = clip(rawContext[key], key === "ua" ? 300 : 80);
    if (v) context[key] = v;
  }

  const note: Feedback = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind,
    message,
    name: clip(body.name, MAX_NAME),
    status: "new",
    context,
    sender: await senderHash(ip),
  };
  items.push(note);
  await save();
  return { note };
}

export function listFeedback() {
  return [...items].sort((a, b) => b.at.localeCompare(a.at));
}

export function feedbackCounts() {
  return {
    total: items.length,
    open: items.filter((f) => f.status === "new").length,
  };
}

export async function updateFeedback(id: string, patch: Record<string, unknown>) {
  const note = items.find((f) => f.id === id);
  if (!note) return null;
  if (patch.status === "new" || patch.status === "done") {
    note.status = patch.status;
    if (patch.status === "done") note.doneAt = new Date().toISOString();
    else delete note.doneAt;
  }
  await save();
  return note;
}

export async function deleteFeedback(id: string) {
  const before = items.length;
  items = items.filter((f) => f.id !== id);
  if (items.length === before) return false;
  await save();
  return true;
}
