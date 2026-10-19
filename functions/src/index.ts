import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { randomInt, randomUUID } from "node:crypto";
import {
  choose,
  count,
  current,
  deadline,
  activeRemaining,
  expire,
  quiet,
  validateSettings,
  type Draft,
  type Card,
} from "./engine";
import { cubeId, fetchCube } from "./cube";
initializeApp();
const db = getFirestore();
setGlobalOptions({
  region: "us-central1",
  maxInstances: 2,
  minInstances: 0,
  memory: "256MiB",
  timeoutSeconds: 60,
});
const fail = (message: string) => {
  throw new HttpsError("failed-precondition", message);
};
const shuffle = <T>(input: T[]) => {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function wake(d: Draft, now: number) {
  return d.status === "active"
    ? quiet(now, d.settings)
      ? Math.min(d.deadline, deadline(now, 0, d.settings))
      : d.deadline
    : 0;
}
async function quota(uid: string, kind: string, max: number, window: number) {
  const ref = db.doc(`limits/${uid}_${kind}`);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref),
      v = s.data(),
      now = Date.now();
    const n = v && v.start + window > now ? v.count : 0;
    if (n >= max)
      throw new HttpsError(
        "resource-exhausted",
        "Please wait before trying again",
      );
    tx.set(ref, { start: n ? v!.start : now, count: n + 1 });
  });
}
async function run(id: string, uid: string, action: string, data: any = {}) {
  const ref = db.doc(`drafts/${id}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("Draft not found");
    let d = snap.data() as Draft;
    const now = Date.now();
    const queueRefs = d.players.map((p) => ref.collection("queues").doc(p.uid));
    const qs = queueRefs.length ? await tx.getAll(...queueRefs) : [];
    const queues: Record<string, string[]> = {};
    qs.forEach((q, i) => (queues[d.players[i].uid] = q.data()?.cards || []));
    const undoRef = ref.collection("private").doc("undo");
    const undo = action === "undo" ? await tx.get(undoRef) : null;
    const requestRef = ref
      .collection("requests")
      .doc(String(data.member || uid || "scheduler"));
    const request = action === "approve" ? await tx.get(requestRef) : null;
    let before: Draft | null = null,
      changed = false;
    const host = () => {
      if (uid !== d.host)
        throw new HttpsError("permission-denied", "Only the host can do that");
    };
    if (
      ["pick", "start", "pause", "resume", "undo", "cancel"].includes(action) &&
      data.revision !== d.revision
    )
      fail("The draft changed. Review the updated board and try again.");
    if (d.status === "cancelled" && action !== "tick")
      fail("This draft has been cancelled");
    if (action === "cancel") {
      host();
      if (!["lobby", "active", "paused"].includes(d.status))
        fail("This draft has already ended");
      d.status = "cancelled";
      d.deadline = 0;
      d.remaining = 0;
      d.events.push({ kind: "cancel", uid, at: now });
      tx.delete(undoRef);
      changed = true;
    } else if (action === "join") {
      if (d.status !== "lobby") fail("This draft has already started");
      if (!d.players.some((p) => p.uid === uid))
        tx.set(requestRef, {
          uid,
          name: String(data.name || "Player").slice(0, 80),
          at: now,
        });
      tx.set(db.doc(`users/${uid}/drafts/${id}`), {
        name: d.name,
        createdAt: d.createdAt,
      });
    } else if (action === "approve") {
      host();
      if (d.status !== "lobby") fail("Players are locked after starting");
      if (!request?.exists) fail("Join request not found");
      if (d.players.length >= 16) fail("Maximum 16 players");
      if (!d.players.some((p) => p.uid === data.member))
        d.players.push({ uid: data.member, name: request!.data()!.name });
      tx.delete(requestRef);
      changed = true;
    } else if (action === "start") {
      host();
      if (d.status !== "lobby" || d.players.length < 2)
        fail("At least two approved players are required");
      if (d.settings.poolSize < d.players.length * d.settings.picksPerPlayer)
        fail("Increase pool size or reduce picks per player");
      d.cardIds = shuffle(d.cardIds).slice(0, d.settings.poolSize);
      d.order = shuffle(d.players.map((p) => p.uid));
      d.status = "active";
      d.cursor = 0;
      d.remaining = 1;
      d.deadline = deadline(now, d.settings.seconds * 1000, d.settings);
      changed = true;
    } else if (action === "pause") {
      host();
      if (d.status !== "active") fail("Draft is not active");
      // If the deadline has passed, bank the missed picks before pausing.
      expire(d, now);
      (d as any).pauseLeft = activeRemaining(now, d.deadline, d.settings);
      d.status = "paused";
      d.deadline = 0;
      d.events.push({ kind: "pause", uid, at: now });
      changed = true;
    } else if (action === "resume") {
      host();
      if (d.status !== "paused") fail("Draft is not paused");
      d.status = "active";
      d.deadline = deadline(
        now,
        (d as any).pauseLeft ?? d.settings.seconds * 1000,
        d.settings,
      );
      d.events.push({ kind: "resume", uid, at: now });
      changed = true;
    } else if (action === "undo") {
      host();
      if (!undo?.exists) fail("No pick is available to undo");
      const revision = d.revision;
      d = undo!.data()!.state;
      d.revision = revision;
      d.status = "paused";
      d.deadline = 0;
      (d as any).pauseLeft = d.settings.seconds * 1000;
      d.events.push({ kind: "undo", uid, at: now });
      tx.delete(undoRef);
      changed = true;
    } else if (action === "queue") {
      if (!d.players.some((p) => p.uid === uid))
        throw new HttpsError(
          "permission-denied",
          "You must be approved to queue cards",
        );
      if (!["active", "paused"].includes(d.status))
        fail("Queues open when the draft starts");
      if (
        !Array.isArray(data.cards) ||
        data.cards.length > 200 ||
        !data.cards.every(
          (x: unknown) => typeof x === "string" && d.cardIds.includes(x),
        )
      )
        fail("Invalid queue");
      queues[uid] = [...new Set<string>(data.cards)];
      tx.set(ref.collection("queues").doc(uid), { cards: queues[uid] });
      changed = true;
    } else if (action !== "tick" && action !== "pick") fail("Unknown action");
    if (action === "pick" && d.status !== "active") fail("Draft is not active");
    if (
      d.status === "active" &&
      ["tick", "pick", "queue", "start", "resume"].includes(action)
    ) {
      changed = expire(d, now) || changed;
      if (action === "pick") {
        // Never reinterpret a stale request as a pick on a later turn after expiry.
        if (snap.data()!.deadline <= now)
          fail("This turn has expired; refresh and try again");
        before = structuredClone(d);
        choose(d, uid, String(data.card), now);
        changed = true;
      }
      for (
        let i = 0;
        i < 1600 && d.status === "active" && !quiet(now, d.settings);
        i++
      ) {
        const who = current(d),
          card = (queues[who] || []).find(
            (c) => d.cardIds.includes(c) && !d.picks.some((p) => p.card === c),
          );
        if (!card) break;
        before = structuredClone(d);
        choose(d, who, card, now, true);
        changed = true;
      }
    }
    if (changed) {
      d.revision++;
      d.events = d.events.slice(-100);
      tx.set(ref, { ...d, wakeAt: wake(d, now) });
      if (before) tx.set(undoRef, { state: before });
    }
    return { id };
  });
}
export const draftAction = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid)
    throw new HttpsError("unauthenticated", "Sign in with Google first");
  const data = request.data || {},
    action = String(data.action || "");
  if (
    ![
      "create",
      "join",
      "approve",
      "start",
      "pause",
      "resume",
      "undo",
      "cancel",
      "queue",
      "pick",
    ].includes(action)
  )
    throw new HttpsError("invalid-argument", "Unknown action");
  try {
    await quota(uid, "action", 120, 60000);
    if (action === "create") {
      await quota(uid, "create", 3, 86400000);
      const settings = validateSettings(data.settings),
        link = String(data.cubeUrl || "");
      const cid = cubeId(link);
      const cacheRef = db.doc(`cubeCache/${cid}`),
        cache = await cacheRef.get();
      let cube: { name: string; cards: Card[] };
      if (cache.exists && cache.data()!.at > Date.now() - 3600000)
        cube = cache.data()!.cube;
      else {
        cube = await fetchCube(link);
        await cacheRef.set({ at: Date.now(), cube });
      }
      if (settings.poolSize > cube.cards.length)
        fail(
          `This cube contains ${cube.cards.length} cards; reduce the pool size`,
        );
      const id = randomUUID(),
        now = Date.now(),
        name =
          String(data.name || "Untitled draft")
            .trim()
            .slice(0, 100) || "Untitled draft";
      const player = {
        uid,
        name: String(request.auth?.token.name || "Host").slice(0, 80),
      };
      const draft: Draft = {
        name,
        host: uid,
        cubeName: cube.name,
        cubeUrl: link,
        settings,
        players: [player],
        status: "lobby",
        order: [],
        cursor: 0,
        owed: {},
        remaining: 0,
        deadline: 0,
        picks: [],
        events: [],
        cardIds: cube.cards.map((c) => c.id),
        revision: 0,
        createdAt: now,
      };
      const batch = db.batch(),
        ref = db.doc(`drafts/${id}`);
      batch.set(ref, { ...draft, wakeAt: 0 });
      for (let i = 0; i < cube.cards.length; i += 40)
        batch.set(ref.collection("pool").doc(String(i / 40).padStart(3, "0")), {
          cards: cube.cards.slice(i, i + 40),
        });
      batch.set(db.doc(`users/${uid}/drafts/${id}`), { name, createdAt: now });
      await batch.commit();
      return { id };
    }
    const id = String(data.id || "");
    if (!/^[a-f0-9-]{36}$/.test(id)) fail("Invalid draft link");
    return await run(id, uid, action, {
      ...data,
      name: request.auth?.token.name || "Player",
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error(e);
    throw new HttpsError(
      "failed-precondition",
      e instanceof Error ? e.message : "Unable to update draft",
    );
  }
});
// One inexpensive scheduler job. Deadlines are persisted, so closed browsers do not stop a draft.
// A late job advances one turn from processing time, avoiding cascades of instant missed turns.
export const advanceDrafts = onSchedule(
  { schedule: "every 1 minutes", maxInstances: 1, timeoutSeconds: 120 },
  async () => {
    const due = await db
      .collection("drafts")
      .where("status", "==", "active")
      .where("wakeAt", "<=", Date.now())
      .limit(100)
      .get();
    const results = await Promise.allSettled(
      due.docs.map((d) => run(d.id, "", "tick")),
    );
    results.forEach((r) => {
      if (r.status === "rejected")
        console.error("Draft advancement failed", r.reason);
    });
  },
);
