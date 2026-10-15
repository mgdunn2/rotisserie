import type { Card, Draft, Settings } from "../functions/src/engine";
export const defaults: Settings = {
  poolSize: 360,
  picksPerPlayer: 45,
  order: "snake",
  seconds: 14400,
  timezone: "America/New_York",
  quietStart: "23:00",
  quietEnd: "08:00",
};
const names = [
  ["Black Lotus", "Artifact", "", 0],
  ["Sol Ring", "Artifact", "", 1],
  ["Lightning Bolt", "Instant", "R", 1],
  ["Counterspell", "Instant", "U", 2],
  ["Birds of Paradise", "Creature — Bird", "G", 1],
  ["Swords to Plowshares", "Instant", "W", 1],
  ["Thoughtseize", "Sorcery", "B", 1],
  ["Time Walk", "Sorcery", "U", 2],
  ["Mox Sapphire", "Artifact", "", 0],
  ["Tropical Island", "Land", "", 0],
  ["Demonic Tutor", "Sorcery", "B", 2],
  ["Mana Drain", "Instant", "U", 2],
  ["Strip Mine", "Land", "", 0],
  ["Giver of Runes", "Creature — Kor Cleric", "W", 1],
  ["Anafenza, Tree Sentinel", "Legendary Creature — Spirit Soldier", "W", 2],
  ["Phelia, Exuberant Shepherd", "Legendary Creature — Dog", "W", 2],
  ["Wrenn and Six", "Legendary Planeswalker", "RG", 2],
  ["Uro, Titan of Nature’s Wrath", "Legendary Creature — Elder Giant", "UG", 3],
  ["Oko, Thief of Crowns", "Legendary Planeswalker", "UG", 3],
  ["Fury", "Creature — Elemental", "R", 5],
  ["Grief", "Creature — Elemental", "B", 4],
  ["Reanimate", "Sorcery", "B", 1],
  ["Channel", "Sorcery", "G", 2],
  ["Emrakul, the Aeons Torn", "Legendary Creature — Eldrazi", "", 15],
];
export const demoCards: Card[] = names.map(([name, type, color, cmc], i) => ({
  id: `c${i}`,
  name: String(name),
  type: String(type),
  colors: String(color).split(""),
  cmc: Number(cmc),
  image:
    i === 14
      ? "https://i.imgur.com/yl70jwt.png"
      : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(String(name))}&format=image`,
  back: "",
  text: "Demo card — open a connected draft to see imported cube details.",
  custom: i === 14,
}));
export function demoDraft(): Draft {
  return {
    name: "The Thursday table",
    host: "demo",
    cubeName: "A taste of the powered cube",
    cubeUrl:
      "https://cubecobra.com/cube/list/da519447-9b91-4eac-a6d6-8a263f42e093",
    settings: {
      ...defaults,
      quietStart: "",
      quietEnd: "",
      poolSize: 24,
      picksPerPlayer: 6,
    },
    players: [
      { uid: "demo", name: "You" },
      { uid: "alex", name: "Alex" },
      { uid: "sam", name: "Sam" },
      { uid: "jules", name: "Jules" },
    ],
    status: "active",
    order: ["demo", "alex", "sam", "jules"],
    cursor: 7,
    owed: {},
    remaining: 1,
    deadline: Date.now() + 14400000,
    picks: [
      { uid: "demo", card: "c0", at: Date.now() - 400000, auto: false },
      { uid: "alex", card: "c1", at: Date.now() - 300000, auto: false },
      { uid: "sam", card: "c7", at: Date.now() - 200000, auto: false },
      { uid: "jules", card: "c8", at: Date.now() - 100000, auto: false },
    ],
    events: [],
    cardIds: demoCards.map((c) => c.id),
    revision: 4,
    createdAt: Date.now(),
  };
}
