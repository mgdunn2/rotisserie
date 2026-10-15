import { test } from "node:test";
import assert from "node:assert/strict";
import {
  choose,
  current,
  count,
  deadline,
  activeRemaining,
  expire,
  drain,
  quiet,
  seat,
  validateSettings,
  type Draft,
  type Settings,
} from "../functions/src/engine.ts";
import { normalizeCube, cubeId } from "../functions/src/cube.ts";
const settings: Settings = {
  poolSize: 12,
  picksPerPlayer: 3,
  order: "snake",
  seconds: 60,
  timezone: "America/New_York",
  quietStart: "",
  quietEnd: "",
};
function draft(): Draft {
  return {
    name: "Test",
    host: "a",
    cubeName: "Cube",
    cubeUrl: "",
    settings: { ...settings },
    players: [
      { uid: "a", name: "A" },
      { uid: "b", name: "B" },
    ],
    status: "active",
    order: ["a", "b"],
    cursor: 0,
    owed: {},
    remaining: 1,
    deadline: 60000,
    picks: [],
    events: [],
    cardIds: Array.from({ length: 12 }, (_, i) => "c" + i),
    revision: 0,
    createdAt: 0,
  };
}
test("snake includes double turns at each end; linear repeats", () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, i) => seat(["a", "b", "c"], i, "snake")),
    ["a", "b", "c", "c", "b", "a", "a", "b", "c"],
  );
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => seat(["a", "b", "c"], i, "linear")),
    ["a", "b", "c", "a", "b", "c"],
  );
});
test("pick ownership, availability, and deadline are enforced", () => {
  const d = draft();
  assert.throws(() => choose(d, "b", "c0", 1));
  assert.throws(() => choose(d, "a", "bad", 1));
  assert.throws(() => choose(d, "a", "c0", 60000));
  choose(d, "a", "c0", 1);
  assert.throws(() => choose(d, "b", "c0", 2));
  assert.equal(current(d), "b");
});
test("missed picks are banked, catch-up uses a new clock per card", () => {
  const d = draft();
  expire(d, 60000);
  assert.equal(d.owed.a, 1);
  choose(d, "b", "c1", 60001);
  choose(d, "b", "c2", 60002);
  assert.equal(current(d), "a");
  assert.equal(d.remaining, 2);
  choose(d, "a", "c3", 60003);
  assert.equal(d.remaining, 1);
  assert.equal(d.deadline, 120003);
  choose(d, "a", "c4", 60004);
  assert.equal(current(d), "a");
  assert.equal(d.remaining, 1);
});
test("final missed picks get additional rounds and eventual completion", () => {
  const d = draft();
  d.settings.picksPerPlayer = 1;
  expire(d, 60000);
  choose(d, "b", "c0", 60001);
  assert.equal(current(d), "a");
  assert.equal(d.remaining, 1);
  choose(d, "a", "c1", 60002);
  assert.equal(d.status, "complete");
  assert.equal(count(d, "a"), 1);
});
test("timeouts do not cascade through hours of browser inactivity", () => {
  const d = draft();
  expire(d, 10000000);
  assert.equal(d.cursor, 1);
  assert.equal(d.deadline, 10060000);
});
test("queues skip claimed cards and can fulfill adjacent turns", () => {
  const d = draft();
  d.picks.push({ uid: "b", card: "c5", at: 0, auto: false });
  drain(d, { a: ["c5", "c0", "c3"], b: ["c1", "c2"] }, 1);
  assert.equal(d.picks.length, 5);
  assert.equal(d.picks[1].card, "c0");
  assert.equal(d.picks[2].uid, "b");
  assert.equal(d.picks[3].uid, "b");
  assert.equal(d.picks[4].uid, "a");
  assert.ok(d.picks.slice(1).every((p) => p.auto));
});
test("quiet hours defer picks, preserve active time, and cross midnight", () => {
  const s = { ...settings, quietStart: "23:00", quietEnd: "08:00" };
  const at = Date.parse("2026-10-15T22:30:00-04:00");
  const end = deadline(at, 3600000, s);
  assert.equal(new Date(end).toISOString(), "2026-10-16T12:30:00.000Z");
  assert.equal(activeRemaining(at, end, s), 3600000);
  assert.ok(quiet(Date.parse("2026-10-16T03:00:00-04:00"), s));
  const d = draft();
  d.settings = s;
  d.deadline = end;
  assert.throws(() =>
    choose(d, "a", "c0", Date.parse("2026-10-16T03:00:00-04:00")),
  );
});
test("quiet hours track DST in both directions", () => {
  const s = { ...settings, quietStart: "23:00", quietEnd: "08:00" };
  for (const date of [
    "2026-03-07T22:30:00-05:00",
    "2026-10-31T22:30:00-04:00",
  ]) {
    const at = Date.parse(date),
      end = deadline(at, 3600000, s);
    assert.equal(activeRemaining(at, end, s), 3600000);
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: s.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(end);
    assert.equal(local, "08:30");
  }
});
test("daytime quiet hours and a draft started during quiet hours", () => {
  const s = { ...settings, quietStart: "12:00", quietEnd: "14:00" };
  assert.equal(
    new Date(
      deadline(Date.parse("2026-10-15T13:00:00-04:00"), 60000, s),
    ).toISOString(),
    "2026-10-15T18:01:00.000Z",
  );
});
test("settings reject ambiguous/invalid quiet hours and large workloads", () => {
  for (const s of [
    { ...settings, poolSize: 1001 },
    { ...settings, timezone: "bad" },
    { ...settings, seconds: 0 },
    { ...settings, quietStart: "23:00", quietEnd: "23:00" },
    { ...settings, quietStart: "bad", quietEnd: "08:00" },
  ])
    assert.throws(() => validateSettings(s));
  assert.deepEqual(validateSettings(settings), settings);
});
test("custom images and names override placeholder details; duplicates remain separate cards", () => {
  const card = {
    custom_name: "Anafenza, Tree Sentinel",
    cardID: "custom-card",
    cmc: "2",
    colors: ["W"],
    imgUrl: "https://i.imgur.com/yl70jwt.png",
    imgBackUrl: "https://example.org/back.png",
    type_line: "Legendary Creature",
    details: {
      name: "Custom Card",
      image_normal: "https://example.org/wrong.png",
      cmc: 0,
    },
  };
  const cube = normalizeCube({
    name: "Test",
    cards: { mainboard: [card, card] },
  });
  assert.equal(cube.cards[0].name, card.custom_name);
  assert.equal(cube.cards[0].image, card.imgUrl);
  assert.equal(cube.cards[0].cmc, 2);
  assert.equal(cube.cards[0].back, card.imgBackUrl);
  assert.notEqual(cube.cards[0].id, cube.cards[1].id);
  assert.equal(cube.cards[0].custom, true);
});
test("CubeCobra importer rejects arbitrary fetch hosts and malformed data", () => {
  assert.equal(
    cubeId(
      "https://cubecobra.com/cube/list/da519447-9b91-4eac-a6d6-8a263f42e093",
    ),
    "da519447-9b91-4eac-a6d6-8a263f42e093",
  );
  assert.throws(() => cubeId("https://evil.test/cube/list/id"));
  assert.throws(() => cubeId("https://cubecobra.com.evil.test/cube/list/id"));
  assert.throws(() => normalizeCube({}));
});
test("random long drafts preserve ownership counts through misses and banked turns", () => {
  for (const order of ["snake", "linear"] as const) {
    const d = draft();
    d.settings = { ...settings, picksPerPlayer: 20, order };
    d.cardIds = Array.from({ length: 50 }, (_, i) => "c" + i);
    let now = 1,
      c = 0;
    for (let n = 0; n < 200 && d.status === "active"; n++) {
      if (n % 7 === 0) {
        now = d.deadline;
        expire(d, now);
      } else {
        choose(d, current(d), "c" + c++, now);
      }
      now++;
    }
    assert.equal(d.status, "complete");
    assert.equal(count(d, "a"), 20);
    assert.equal(count(d, "b"), 20);
    assert.equal(new Set(d.picks.map((p) => p.card)).size, 40);
  }
});
