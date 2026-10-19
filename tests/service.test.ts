import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { draftAction } from "../functions/src/index.ts";
import { current, type Draft } from "../functions/src/engine.ts";
const requireFn = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const { getFirestore } = requireFn("firebase-admin/firestore");
test(
  "transactional backend: approval, simultaneous picks, private queues, undo, pause and banked timeout",
  { skip: !process.env.FIRESTORE_EMULATOR_HOST },
  async () => {
    const db = getFirestore();
    const call = (uid: string, action: string, data: any = {}) =>
      draftAction.run({
        auth: { uid, token: { name: uid } },
        data: { action, ...data },
      } as any);
    await db.doc("cubeCache/testcube").set({
      at: Date.now(),
      cube: {
        name: "Fixture cube",
        cards: Array.from({ length: 12 }, (_, i) => ({
          id: "c" + i,
          name: "Card " + i,
          image: "",
          back: "",
          colors: [],
          cmc: 1,
          type: "Artifact",
          text: "",
          custom: false,
        })),
      },
    });
    const { id } = await call("host", "create", {
      name: "Integration draft",
      cubeUrl: "https://cubecobra.com/cube/list/testcube",
      settings: {
        poolSize: 12,
        picksPerPlayer: 2,
        order: "snake",
        seconds: 60,
        timezone: "America/New_York",
        quietStart: "",
        quietEnd: "",
      },
    });
    const ref = db.doc("drafts/" + id),
      read = async () => (await ref.get()).data() as Draft;
    await call("guest", "join", { id });
    await assert.rejects(call("guest", "start", { id, revision: 0 }));
    await assert.rejects(call("guest", "approve", { id, member: "guest" }));
    await call("host", "approve", { id, member: "guest" });
    let d = await read();
    assert.equal(d.players.length, 2);
    await call("host", "start", { id, revision: d.revision });
    d = await read();
    assert.equal(d.cardIds.length, 12);
    assert.equal(new Set(d.order).size, 2);
    await assert.rejects(
      call("outsider", "pick", { id, revision: d.revision, card: "c0" }),
    );
    const who = current(d);
    const results = await Promise.allSettled(
      ["c0", "c1"].map((card) =>
        call(who, "pick", { id, revision: d.revision, card }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    d = await read();
    assert.equal(d.picks.length, 1);
    const selected = d.picks[0].card;
    await call("host", "pause", { id, revision: d.revision });
    d = await read();
    assert.equal(d.status, "paused");
    assert.ok((d as any).pauseLeft > 0);
    await assert.rejects(
      call(current(d), "pick", { id, revision: d.revision, card: "c2" }),
    );
    await call("host", "undo", { id, revision: d.revision });
    d = await read();
    assert.equal(d.status, "paused");
    assert.equal(d.picks.length, 0);
    await call("host", "resume", { id, revision: d.revision });
    d = await read();
    assert.equal(d.status, "active");
    const qOwner = current(d);
    await call(qOwner, "queue", { id, cards: [selected, "c3"] });
    d = await read();
    assert.equal(d.picks.length, 1);
    assert.equal(d.picks[0].auto, true);
    const missed = current(d);
    await ref.update({ deadline: Date.now() - 1, wakeAt: Date.now() - 1 });
    // Saving a queue processes an overdue turn through the same transaction path used by the scheduler.
    await call(qOwner, "queue", { id, cards: [] });
    d = await read();
    assert.equal(d.events.at(-1)?.kind, "timeout");
    assert.ok(d.remaining >= 1);
    assert.ok(d.deadline > Date.now());
    assert.ok(d.owed[missed] >= 1 || current(d) === missed);
    await assert.rejects(call("outsider", "queue", { id, cards: ["c0"] }));
    await assert.rejects(call("guest", "cancel", { id, revision: d.revision }));
    await assert.rejects(
      call("host", "cancel", { id, revision: d.revision - 1 }),
    );
    const picksBefore = structuredClone(d.picks);
    await call("host", "cancel", { id, revision: d.revision });
    d = await read();
    assert.equal(d.status, "cancelled");
    assert.equal(d.deadline, 0);
    assert.equal((d as any).wakeAt, 0);
    assert.deepEqual(d.picks, picksBefore);
    assert.equal(d.events.at(-1)?.kind, "cancel");
    assert.equal(
      (await ref.collection("private").doc("undo").get()).exists,
      false,
    );
    for (const action of ["pick", "resume", "undo", "start", "queue", "cancel"])
      await assert.rejects(
        call("host", action, {
          id,
          revision: d.revision,
          card: "c4",
          cards: [],
        }),
      );
    // Paused drafts and lobbies can also be cancelled.
    for (const status of ["paused", "lobby"]) {
      await ref.update({ status, revision: d.revision + 1 });
      d = await read();
      await call("host", "cancel", { id, revision: d.revision });
      d = await read();
      assert.equal(d.status, "cancelled");
    }
  },
);
