import { DateTime } from "luxon";
export interface Card {
  id: string;
  name: string;
  image: string;
  back: string;
  colors: string[];
  cmc: number;
  type: string;
  text: string;
  custom: boolean;
}
export interface Settings {
  poolSize: number;
  picksPerPlayer: number;
  order: "snake" | "linear";
  seconds: number;
  timezone: string;
  quietStart: string;
  quietEnd: string;
}
export interface Player {
  uid: string;
  name: string;
}
export interface Pick {
  card: string;
  uid: string;
  at: number;
  auto: boolean;
}
export interface Event {
  kind: "timeout" | "pause" | "resume" | "undo" | "cancel";
  uid: string;
  at: number;
}
export interface Draft {
  name: string;
  host: string;
  cubeName: string;
  cubeUrl: string;
  settings: Settings;
  players: Player[];
  status: "lobby" | "active" | "paused" | "complete" | "cancelled";
  order: string[];
  cursor: number;
  owed: Record<string, number>;
  remaining: number;
  deadline: number;
  picks: Pick[];
  events: Event[];
  cardIds: string[];
  revision: number;
  createdAt: number;
}
export const count = (d: Draft, uid: string) =>
  d.picks.filter((p) => p.uid === uid).length;
export const current = (d: Draft) => seat(d.order, d.cursor, d.settings.order);
export function seat(
  order: string[],
  cursor: number,
  mode: Settings["order"],
): string {
  const round = Math.floor(cursor / order.length),
    i = cursor % order.length;
  return order[mode === "snake" && round % 2 === 1 ? order.length - 1 - i : i];
}
function minutes(s: string) {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
export function quiet(at: number, s: Settings) {
  if (!s.quietStart || s.quietStart === s.quietEnd) return false;
  const dt = DateTime.fromMillis(at, { zone: s.timezone });
  const m = dt.hour * 60 + dt.minute,
    a = minutes(s.quietStart),
    b = minutes(s.quietEnd);
  return a < b ? m >= a && m < b : m >= a || m < b;
}
// Walk real minute boundaries, so DST gaps/repeated hours follow the actual local clock.
export function deadline(at: number, ms: number, s: Settings): number {
  if (!s.quietStart || s.quietStart === s.quietEnd) return at + ms;
  let t = at;
  for (let i = 0; i < 600000; i++) {
    if (ms <= 0 && !quiet(t, s)) return t;
    const step = 60000 - (t % 60000);
    if (!quiet(t, s)) {
      if (ms <= step) return t + ms;
      ms -= step;
    }
    t += step;
  }
  throw new Error("Clock exceeds supported horizon");
}
export function activeRemaining(from: number, to: number, s: Settings): number {
  let t = from,
    total = 0;
  while (t < to) {
    const step = Math.min(to - t, 60000 - (t % 60000));
    if (!quiet(t, s)) total += step;
    t += step;
  }
  return total;
}
export function next(d: Draft, at: number) {
  if (d.players.every((p) => count(d, p.uid) >= d.settings.picksPerPlayer)) {
    d.status = "complete";
    d.deadline = 0;
    return;
  }
  do {
    d.cursor++;
  } while (count(d, current(d)) >= d.settings.picksPerPlayer);
  const uid = current(d),
    base = d.cursor < d.order.length * d.settings.picksPerPlayer ? 1 : 0;
  d.remaining = Math.min(
    d.settings.picksPerPlayer - count(d, uid),
    base + (d.owed[uid] || 0),
  );
  // Catch-up rounds repeat until outstanding picks have been made.
  if (d.remaining === 0) {
    next(d, at);
    return;
  }
  d.owed[uid] = 0;
  d.deadline = deadline(at, d.settings.seconds * 1000, d.settings);
}
export function choose(
  d: Draft,
  uid: string,
  card: string,
  at: number,
  auto = false,
) {
  if (d.status !== "active" || current(d) !== uid || quiet(at, d.settings))
    throw new Error("It is not an active pick window for you");
  if (at >= d.deadline) throw new Error("This turn has expired");
  if (!d.cardIds.includes(card) || d.picks.some((p) => p.card === card))
    throw new Error("That card is unavailable");
  d.picks.push({ uid, card, at, auto });
  d.remaining--;
  if (d.remaining === 0) next(d, at);
  else d.deadline = deadline(at, d.settings.seconds * 1000, d.settings);
}
export function expire(d: Draft, at: number) {
  if (d.status !== "active" || d.deadline > at) return false;
  const uid = current(d);
  d.owed[uid] = (d.owed[uid] || 0) + d.remaining;
  d.events.push({ kind: "timeout", uid, at });
  if (d.events.length > 100) d.events.shift();
  next(d, at);
  return true;
}
export function drain(d: Draft, queues: Record<string, string[]>, at: number) {
  // Queues act at the start of a turn, rather than waiting for timeout.
  let changed = false;
  for (
    let i = 0;
    i < 1600 && d.status === "active" && !quiet(at, d.settings);
    i++
  ) {
    const uid = current(d),
      q = queues[uid] || [],
      available = q.find(
        (id) => d.cardIds.includes(id) && !d.picks.some((p) => p.card === id),
      );
    if (!available) break;
    choose(d, uid, available, at, true);
    changed = true;
  }
  return changed;
}
export function validateSettings(input: Settings): Settings {
  const s: Settings = {
    poolSize: Number(input.poolSize),
    picksPerPlayer: Number(input.picksPerPlayer),
    order: input.order,
    seconds: Number(input.seconds),
    timezone: String(input.timezone),
    quietStart: String(input.quietStart || ""),
    quietEnd: String(input.quietEnd || ""),
  };
  if (!Number.isInteger(s.poolSize) || s.poolSize < 2 || s.poolSize > 1000)
    throw new Error("Pool must contain 2–1,000 cards");
  if (
    !Number.isInteger(s.picksPerPlayer) ||
    s.picksPerPlayer < 1 ||
    s.picksPerPlayer > 100
  )
    throw new Error("Choose 1–100 picks per player");
  if (
    !["snake", "linear"].includes(s.order) ||
    !Number.isInteger(s.seconds) ||
    s.seconds < 60 ||
    s.seconds > 259200
  )
    throw new Error("Clock must be 1 minute–72 hours");
  if (!DateTime.now().setZone(s.timezone).isValid)
    throw new Error("Invalid timezone");
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (
    (s.quietStart || s.quietEnd) &&
    (!time.test(s.quietStart) ||
      !time.test(s.quietEnd) ||
      s.quietStart === s.quietEnd)
  )
    throw new Error(
      "Set distinct quiet-hour start and end times, or leave both empty",
    );
  return s;
}
