import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc } from "firebase/firestore";
test(
  "public spectators see a single draft, but cannot enumerate drafts, mutate state, or read queues",
  { skip: !process.env.FIRESTORE_EMULATOR_HOST },
  async () => {
    const env = await initializeTestEnvironment({
      projectId: "demo-rotisserie",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    try {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, "drafts/test"), { host: "host" });
        await setDoc(doc(db, "drafts/test/queues/player"), { cards: ["c1"] });
        await setDoc(doc(db, "drafts/test/requests/player"), { uid: "player" });
        await setDoc(doc(db, "drafts/test/pool/000"), { cards: [] });
      });
      const anon = env.unauthenticatedContext().firestore(),
        host = env.authenticatedContext("host").firestore(),
        player = env.authenticatedContext("player").firestore();
      await assertSucceeds(getDoc(doc(anon, "drafts/test")));
      await assertSucceeds(getDocs(collection(anon, "drafts/test/pool")));
      await assertFails(getDocs(collection(anon, "drafts")));
      await assertFails(setDoc(doc(player, "drafts/test"), { host: "player" }));
      await assertFails(getDoc(doc(anon, "drafts/test/queues/player")));
      await assertFails(getDoc(doc(host, "drafts/test/queues/player")));
      await assertSucceeds(getDoc(doc(player, "drafts/test/queues/player")));
      await assertSucceeds(getDocs(collection(host, "drafts/test/requests")));
      await assertSucceeds(getDoc(doc(player, "drafts/test/requests/player")));
      await assertFails(getDocs(collection(player, "drafts/test/requests")));
      await assertFails(getDoc(doc(player, "drafts/test/private/undo")));
    } finally {
      await env.cleanup();
    }
  },
);
