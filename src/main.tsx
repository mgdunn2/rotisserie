import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { auth, db, configured, command } from "./firebase";
import {
  choose,
  drain,
  current,
  count,
  quiet,
  activeRemaining,
  deadline,
  type Draft,
  type Card,
} from "../functions/src/engine";
import { defaults, demoCards, demoDraft } from "./demo";
import "./style.css";
const ROUTE = /^#\/draft\/([a-f0-9-]{36})$/;
function formatTime(ms: number) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;
}
function group(c: Card) {
  if (c.type.includes("Land")) return "Lands";
  const cs = c.colors.filter((x) => x !== "C");
  return cs.length > 1
    ? "Multicolor"
    : { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" }[cs[0]] ||
        "Colorless";
}
const groups = [
  "White",
  "Blue",
  "Black",
  "Red",
  "Green",
  "Multicolor",
  "Colorless",
  "Lands",
];
function App() {
  const [demoUid, setDemoUid] = useState("demo");
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(!configured);
  const [id, setId] = useState(location.hash.match(ROUTE)?.[1] || ""),
    [demo, setDemo] = useState(false),
    [d, setD] = useState<Draft | null>(null),
    [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    [loaded, setLoaded] = useState(false);
  const [requests, setRequests] = useState<{ uid: string; name: string }[]>([]),
    [requested, setRequested] = useState(false),
    [queue, setQueue] = useState<string[]>([]),
    [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState(""),
    [owner, setOwner] = useState("available"),
    [color, setColor] = useState("All colors"),
    [sort, setSort] = useState(
      localStorage.getItem("rotisserie-sort") || "color",
    );
  const [view, setView] = useState(
      localStorage.getItem("rotisserie-view") || "gallery",
    ),
    [tab, setTab] = useState("players"),
    [selected, setSelected] = useState<Card | null>(null),
    [confirm, setConfirm] = useState("");
  const [create, setCreate] = useState(false),
    [name, setName] = useState("Friday night cube"),
    [cubeUrl, setCubeUrl] = useState(
      "https://cubecobra.com/cube/list/da519447-9b91-4eac-a6d6-8a263f42e093",
    ),
    [settings, setSettings] = useState(defaults);
  const uid = demo ? demoUid : user?.uid || "",
    host = d?.host === uid,
    member = d?.players.some((p) => p.uid === uid),
    playerName = (who: string) =>
      d?.players.find((p) => p.uid === who)?.name || "Player";
  useEffect(() => {
    const onHash = () => {
      setId(location.hash.match(ROUTE)?.[1] || "");
      setDemo(false);
      setError("");
      setSelected(null);
    };
    window.addEventListener("hashchange", onHash);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener("hashchange", onHash);
      clearInterval(t);
    };
  }, []);
  useEffect(
    () =>
      auth
        ? onAuthStateChanged(
            auth,
            (u) => {
              setUser(u);
              setAuthReady(true);
            },
            (e) => {
              setError(e.message);
              setAuthReady(true);
            },
          )
        : undefined,
    [],
  );
  useEffect(() => {
    if (demo) return;
    if (!id || !db) {
      setD(null);
      setCards([]);
      setLoaded(true);
      return;
    }
    setD(null);
    setCards([]);
    setLoaded(false);
    setRequested(false);
    let alive = true;
    getDocs(collection(db, "drafts", id, "pool"))
      .then((s) => {
        if (alive) setCards(s.docs.flatMap((x) => x.data().cards));
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    const unsub = onSnapshot(
      doc(db, "drafts", id),
      (s) => {
        setD(s.exists() ? (s.data() as Draft) : null);
        setLoaded(true);
      },
      (e) => {
        setError(e.message);
        setLoaded(true);
      },
    );
    return () => {
      alive = false;
      unsub();
    };
  }, [id, demo]);
  useEffect(() => {
    setRequests([]);
    if (!id || demo || !db || !host) return;
    return onSnapshot(
      collection(db, "drafts", id, "requests"),
      (s) =>
        setRequests(
          s.docs.map((x) => x.data() as { uid: string; name: string }),
        ),
      (e) => setError(e.message),
    );
  }, [id, host, demo]);
  useEffect(() => {
    setQueue([]);
    if (!id || demo || !db || !user || !member) return;
    return onSnapshot(
      doc(db, "drafts", id, "queues", user.uid),
      (s) => setQueue(s.data()?.cards || []),
      (e) => setError(e.message),
    );
  }, [id, user?.uid, member, demo]);
  useEffect(() => {
    if (!id || !db || !user || demo || member) return;
    return onSnapshot(
      doc(db, "drafts", id, "requests", user.uid),
      (s) => setRequested(s.exists()),
      (e) => setError(e.message),
    );
  }, [id, user?.uid, member, demo]);
  useEffect(() => {
    setMine([]);
    if (!db || !user) return;
    return onSnapshot(
      query(
        collection(db, "users", user.uid, "drafts"),
        orderBy("createdAt", "desc"),
      ),
      (s) => setMine(s.docs.map((x) => ({ id: x.id, name: x.data().name }))),
      (e) => setError(e.message),
    );
  }, [user?.uid]);
  useEffect(() => {
    localStorage.setItem("rotisserie-sort", sort);
  }, [sort]);
  useEffect(() => {
    localStorage.setItem("rotisserie-view", view);
  }, [view]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setConfirm("");
        setCreate(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  async function work(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    await work(async () => {
      await signInWithPopup(auth!, new GoogleAuthProvider());
    });
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    await work(async () => {
      if (demo && d) {
        const copy = structuredClone(d);
        if (action === "pick") choose(copy, uid, String(extra.card), now);
        else if (action === "cancel") {
          copy.status = "cancelled";
          copy.deadline = 0;
          copy.remaining = 0;
          copy.events.push({ kind: "cancel", uid, at: now });
        } else if (action === "pause") {
          (copy as any).pauseLeft = activeRemaining(
            now,
            copy.deadline,
            copy.settings,
          );
          copy.status = "paused";
        } else if (action === "resume") {
          copy.status = "active";
          copy.deadline = deadline(now, (copy as any).pauseLeft, copy.settings);
        } else if (action === "queue") {
          setQueue(extra.cards as string[]);
          drain(copy, { [uid]: extra.cards as string[] }, now);
        } else throw new Error("This action is available in connected drafts.");
        if (action === "pick") drain(copy, { [uid]: queue }, now);
        copy.revision++;
        setD(copy);
      } else await command({ action, id, revision: d?.revision, ...extra });
      setSelected(null);
      setConfirm("");
    });
  }
  async function toggleQueue(card: string) {
    const next = queue.includes(card)
      ? queue.filter((x) => x !== card)
      : [...queue, card];
    await act("queue", { cards: next });
  }
  const picked = new Map(d?.picks.map((p) => [p.card, p]) || []),
    pool = cards.filter((c) => d?.cardIds.includes(c.id)),
    byId = new Map(cards.map((c) => [c.id, c]));
  const filtered = pool
    .filter(
      (c) =>
        `${c.name} ${c.type} ${c.text}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (color === "All colors" || group(c) === color) &&
        (owner === "all" ||
          (owner === "available" && !picked.has(c.id)) ||
          picked.get(c.id)?.uid === owner),
    )
    .sort((a, b) =>
      sort === "mana"
        ? a.cmc - b.cmc || a.name.localeCompare(b.name)
        : sort === "color"
          ? groups.indexOf(group(a)) - groups.indexOf(group(b)) ||
            a.cmc - b.cmc ||
            a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    );
  const yourTurn =
    d?.status === "active" &&
    current(d) === uid &&
    !quiet(now, d.settings) &&
    now < d.deadline;
  const queueAvailable = queue.filter((c) => byId.has(c) && !picked.has(c));
  function exportPool(who: string) {
    if (!d) return;
    const text = d.picks
      .filter((p) => p.uid === who)
      .map((p) => "1 " + byId.get(p.card)?.name)
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `${playerName(who).replace(/[^a-z0-9]/gi, "_")}-pool.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const pill = (
    <span className="pill">
      <span className="dot" /> ASYNC CUBE DRAFTING
    </span>
  );
  return (
    <>
      <header>
        <a
          className="brand"
          href="#"
          onClick={() => {
            setDemo(false);
            setD(null);
          }}
        >
          {" "}
          <span className="brandmark">↝</span> rotisserie
          <span className="brand-sub">THE OPEN TABLE</span>
        </a>
        <div className="header-right">
          <a
            href="https://github.com/mgdunn2/rotisserie#readme"
            target="_blank"
            rel="noreferrer"
          >
            Guide ↗
          </a>
          {user ? (
            <>
              <span className="username">{user.displayName}</span>
              <button className="subtle" onClick={() => signOut(auth!)}>
                Sign out
              </button>
            </>
          ) : configured ? (
            <button onClick={login} disabled={busy || !authReady}>
              Sign in with Google
            </button>
          ) : (
            <span className="setup-badge">
              Preview · Firebase setup required
            </span>
          )}
        </div>
      </header>
      {error && (
        <div role="alert" className="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="notice" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
      {!d && (!id || loaded) ? (
        <main className="landing">
          <section className="hero">
            <div>
              {pill}
              <h1>
                A whole cube.
                <br />
                An open table.
                <br />
                <em>Your next pick.</em>
              </h1>
              <p>
                All the cards in sight. Everyone’s strategy unfolding.
                <br />
                Draft a cube together, one pick at a time, on your own schedule.
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    configured
                      ? user
                        ? setCreate(true)
                        : login()
                      : setNotice(
                          "Connect Firebase using the repository setup guide to create a live draft.",
                        )
                  }
                >
                  Create a draft <span>↗</span>
                </button>
                <button
                  className="outline"
                  onClick={() => {
                    setId("");
                    location.hash = "";
                    setDemo(true);
                    setDemoUid("demo");
                    setD(demoDraft());
                    setCards(demoCards);
                    setOwner("available");
                  }}
                >
                  Explore the demo →
                </button>
              </div>
              <div className="hero-foot">
                GOOGLE SIGN-IN <span>·</span> CUBECOBRA IMPORT <span>·</span>{" "}
                REALTIME PICKS
              </div>
            </div>
            <div className="hero-art">
              <img
                src={`${import.meta.env.BASE_URL}rotisserie-hero.png`}
                width="402"
                height="324"
                alt="A red-clad mage tending a flaming rotisserie"
                fetchPriority="high"
              />
            </div>
          </section>
          {id && (
            <div className="panel">Draft not found. Check the invite link.</div>
          )}
          <section className="features">
            <article>
              <span>01 / THE CUBE</span>
              <h3>Bring your card pool.</h3>
              <p>
                Import a CubeCobra link, including your custom cards. Reveal a
                completely random selection at the start.
              </p>
            </article>
            <article>
              <span>02 / THE CLOCK</span>
              <h3>Make room for real life.</h3>
              <p>
                Set the pick clock, overnight quiet hours, and snake or linear
                order. Miss a turn? Your picks carry forward.
              </p>
            </article>
            <article>
              <span>03 / THE TABLE</span>
              <h3>See the entire story.</h3>
              <p>
                Follow every pick and every player’s pool. Keep your own sorts,
                filters, and autopick queue.
              </p>
            </article>
          </section>
          {mine.length > 0 && (
            <section>
              <h2>Your tables</h2>
              <div className="draft-list">
                {mine.map((m) => (
                  <a className="panel" key={m.id} href={`#/draft/${m.id}`}>
                    <h3>{m.name}</h3>
                    <span>Open draft →</span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </main>
      ) : !d ? (
        <main className="loading">Opening the table…</main>
      ) : (
        <main className="draft-page">
          <div className="draft-heading">
            <div>
              <div className="eyebrow">
                {demo
                  ? "INTERACTIVE DEMO · CHANGES STAY IN THIS SESSION"
                  : d.status === "lobby"
                    ? "GATHERING THE TABLE"
                    : "THE DRAFT ROOM"}
              </div>
              <h1>{d.name}</h1>
              <a href={d.cubeUrl} target="_blank" rel="noreferrer">
                {d.cubeName} ↗
              </a>
              <span className="muted">
                {" "}
                · {d.settings.order === "snake" ? "Snake" : "Linear"} ·{" "}
                {d.settings.picksPerPlayer} picks / player
              </span>
            </div>
            <div className="actions">
              {demo && (
                <label className="demo-switch">
                  Play as
                  <select
                    aria-label="Demo player"
                    value={demoUid}
                    onChange={(e) => setDemoUid(e.target.value)}
                  >
                    {d.players.map((p) => (
                      <option key={p.uid} value={p.uid}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="outline"
                onClick={() =>
                  work(async () => {
                    await navigator.clipboard.writeText(location.href);
                    setNotice(
                      "Invite link copied. Anyone with the link can spectate.",
                    );
                  })
                }
              >
                Copy invite link ↗
              </button>
              {host && d.status === "lobby" && (
                <button
                  className="primary"
                  disabled={busy || d.players.length < 2}
                  onClick={() => setConfirm("start")}
                >
                  Start draft →
                </button>
              )}
              {host && d.status === "active" && (
                <button disabled={busy} onClick={() => act("pause")}>
                  Pause
                </button>
              )}
              {host && d.status === "paused" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => act("resume")}
                >
                  Resume draft
                </button>
              )}
              {host && ["lobby", "active", "paused"].includes(d.status) && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => setConfirm("cancel")}
                >
                  Cancel draft
                </button>
              )}
              {host &&
                d.status !== "cancelled" &&
                d.picks.length > 0 &&
                !demo && (
                  <button onClick={() => setConfirm("undo")} disabled={busy}>
                    Undo last pick
                  </button>
                )}
            </div>
          </div>
          {d.status === "lobby" ? (
            <>
              <div className="lobby-grid">
                <section className="panel">
                  <div className="eyebrow">WAITING ROOM</div>
                  <h2>The table is coming together.</h2>
                  <p>
                    Share the invite link. The host approves players before
                    starting and randomly assigning seats.
                  </p>
                  <div className="player-list">
                    {d.players.map((p, i) => (
                      <div key={p.uid}>
                        <span
                          className="avatar"
                          style={{ "--seat": i } as React.CSSProperties}
                        >
                          {p.name[0]}
                        </span>
                        <strong>{p.name}</strong>
                        <span className="muted">
                          {p.uid === d.host ? "Host" : "Approved"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {!member &&
                    (user ? (
                      <button
                        className="primary"
                        disabled={requested || busy}
                        onClick={() => act("join")}
                      >
                        {requested
                          ? "Awaiting host approval"
                          : "Request a seat"}
                      </button>
                    ) : (
                      <button className="primary" onClick={login}>
                        Sign in to request a seat
                      </button>
                    ))}
                  {host && requests.length > 0 && (
                    <>
                      <h3>Seat requests</h3>
                      {requests.map((r) => (
                        <div className="request" key={r.uid}>
                          <span>{r.name}</span>
                          <button
                            disabled={busy}
                            onClick={() => act("approve", { member: r.uid })}
                          >
                            Approve
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </section>
                <section className="panel">
                  <div className="eyebrow">DRAFT SETTINGS</div>
                  <h2>Set for this table</h2>
                  <dl>
                    <dt>Random reveal</dt>
                    <dd>
                      {d.settings.poolSize} of {cards.length || "…"} cards
                    </dd>
                    <dt>Pick order</dt>
                    <dd>{d.settings.order}</dd>
                    <dt>Pick clock</dt>
                    <dd>{d.settings.seconds / 3600} hours per card</dd>
                    <dt>Quiet hours</dt>
                    <dd>
                      {d.settings.quietStart
                        ? `${d.settings.quietStart}–${d.settings.quietEnd}`
                        : "None"}
                    </dd>
                    <dt>Timezone</dt>
                    <dd>{d.settings.timezone}</dd>
                    <dt>Missed picks</dt>
                    <dd>Banked for your next turn</dd>
                  </dl>
                  <p className="muted">
                    The card pool below is the full imported cube. The random
                    draft pool is revealed when the host starts.
                  </p>
                  {d.players.length * d.settings.picksPerPlayer >
                    d.settings.poolSize && (
                    <p className="warning">
                      The pool is too small for these players. Create a new
                      table with more cards or fewer picks before starting.
                    </p>
                  )}
                </section>
              </div>
            </>
          ) : (
            <section className={"turn-bar " + (yourTurn ? "your-turn" : "")}>
              <div>
                <span className="eyebrow">
                  {d.status === "cancelled"
                    ? "TABLE CLOSED"
                    : d.status === "complete"
                      ? "ALL PICKS ARE IN"
                      : d.status === "paused"
                        ? "TABLE PAUSED"
                        : quiet(now, d.settings)
                          ? "QUIET HOURS"
                          : yourTurn
                            ? "YOU’RE ON THE CLOCK"
                            : "ON THE CLOCK"}
                </span>
                <h2>
                  {d.status === "cancelled"
                    ? "This draft was cancelled."
                    : d.status === "complete"
                      ? "The draft is complete."
                      : d.status === "paused"
                        ? "Take a breather."
                        : `${playerName(current(d))}’s turn`}
                </h2>
                <span>
                  {["cancelled", "complete"].includes(d.status)
                    ? `${d.picks.length} cards drafted`
                    : `${d.remaining} pick${d.remaining === 1 ? "" : "s"} this turn · Turn ${d.cursor + 1} · ${d.picks.length} / ${d.players.length * d.settings.picksPerPlayer} drafted`}
                </span>
              </div>
              <div className="clock">
                <strong>
                  {d.status === "cancelled"
                    ? "—"
                    : d.status === "complete"
                      ? "✓"
                      : d.status === "paused"
                        ? formatTime((d as any).pauseLeft || 0)
                        : formatTime(
                            activeRemaining(
                              now,
                              Math.max(now, d.deadline),
                              d.settings,
                            ),
                          )}
                </strong>
                <small>
                  {d.status === "active" && quiet(now, d.settings)
                    ? `Clock rests until ${d.settings.quietEnd} · ${d.settings.timezone}`
                    : d.status === "active" && now >= d.deadline
                      ? "Processing timeout…"
                      : d.status === "active"
                        ? `Active time remaining · ${d.settings.timezone}`
                        : d.status === "paused"
                          ? "Remaining time preserved"
                          : d.status === "cancelled"
                            ? "Picks and pools remain available"
                            : "Ready to build"}
                </small>
              </div>
            </section>
          )}
          {d.status !== "lobby" && !member && (
            <div className="spectator">
              You’re spectating. All picks and player pools are public to anyone
              with this link.
            </div>
          )}
          <div className="workspace">
            <section className="board">
              <div className="section-title">
                <h2>
                  {d.status === "lobby" ? "Imported cube" : "The card pool"}{" "}
                  <span>{filtered.length}</span>
                </h2>
                <div className="segmented">
                  <button
                    aria-pressed={view === "gallery"}
                    onClick={() => setView("gallery")}
                  >
                    Gallery
                  </button>
                  <button
                    aria-pressed={view === "list"}
                    onClick={() => setView("list")}
                  >
                    List
                  </button>
                </div>
              </div>
              <div className="filters">
                <input
                  aria-label="Search cards"
                  placeholder="Search cards, types, rules…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="Filter owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option value="available">Available</option>
                  <option value="all">All cards</option>
                  {d.players.map((p) => (
                    <option key={p.uid} value={p.uid}>
                      {p.name}’s pool
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                >
                  <option>All colors</option>
                  {groups.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                <select
                  aria-label="Sort cards"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="color">Color → mana value</option>
                  <option value="mana">Mana value</option>
                  <option value="name">Name</option>
                </select>
              </div>
              <div className="board-note">
                Sorts and filters are just for you.
                {owner !== "all" && owner !== "available" && (
                  <button
                    className="text-button"
                    onClick={() => exportPool(owner)}
                  >
                    Export this pool ↓
                  </button>
                )}
              </div>
              {cards.length === 0 ? (
                <p className="empty">Loading the cube…</p>
              ) : filtered.length === 0 ? (
                <p className="empty">
                  No cards here. Try changing your filters.
                </p>
              ) : view === "list" ? (
                <div className="card-table">
                  <div className="table-label">
                    <span>CARD</span>
                    <span>MV</span>
                    <span>TYPE</span>
                    <span>PICKED BY</span>
                  </div>
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      className="table-row"
                      onClick={() => setSelected(c)}
                    >
                      <span>
                        <i className={"color-marker " + group(c)} />
                        {c.name}
                        {queueAvailable.includes(c.id) && " ☆"}
                      </span>
                      <span>{c.cmc}</span>
                      <span>{c.type}</span>
                      <span>
                        {picked.has(c.id)
                          ? playerName(picked.get(c.id)!.uid)
                          : "—"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="card-grid">
                  {filtered.map((c, i) => (
                    <React.Fragment key={c.id}>
                      {sort === "color" &&
                        (i === 0 || group(filtered[i - 1]) !== group(c)) && (
                          <h3 className="color-heading">
                            <i className={"color-marker " + group(c)} />
                            {group(c)}
                          </h3>
                        )}
                      <button
                        className={
                          "card-tile " + (picked.has(c.id) ? "drafted" : "")
                        }
                        onClick={() => setSelected(c)}
                      >
                        <div className="card-image">
                          {c.image ? (
                            <img
                              loading="lazy"
                              src={c.image}
                              alt={c.name}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : null}
                          <div className="image-fallback">
                            {c.name}
                            <small>{c.type}</small>
                          </div>
                          {picked.has(c.id) && (
                            <span className="picked-label">
                              {playerName(picked.get(c.id)!.uid)}
                            </span>
                          )}
                          {queueAvailable.includes(c.id) && (
                            <span className="queue-label">
                              ☆ {queueAvailable.indexOf(c.id) + 1}
                            </span>
                          )}
                        </div>
                        <div className="card-caption">
                          <strong>{c.name}</strong>
                          <span>{c.cmc}</span>
                        </div>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </section>
            {d.status !== "lobby" && (
              <aside className="sidebar">
                <div className="side-tabs">
                  {["players", "picks", ...(member ? ["queue"] : [])].map(
                    (t) => (
                      <button
                        className={tab === t ? "active" : ""}
                        key={t}
                        onClick={() => setTab(t)}
                      >
                        {t === "queue"
                          ? "My queue"
                          : t[0].toUpperCase() + t.slice(1)}
                      </button>
                    ),
                  )}
                </div>
                {tab === "players" ? (
                  <>
                    <div className="eyebrow sidebar-label">PICK ORDER</div>
                    {d.order.map((who, i) => (
                      <div
                        className={
                          "player-panel " +
                          (d.status === "active" && current(d) === who
                            ? "on-clock"
                            : "")
                        }
                        key={who}
                      >
                        <button
                          className="player-summary"
                          onClick={() => setOwner(who)}
                        >
                          <span
                            className="avatar"
                            style={{ "--seat": i } as React.CSSProperties}
                          >
                            {i + 1}
                          </span>
                          <div>
                            <strong>{playerName(who)}</strong>
                            <small>
                              {count(d, who)} / {d.settings.picksPerPlayer}{" "}
                              cards
                              {d.owed[who] ? ` · ${d.owed[who]} banked` : ""}
                            </small>
                          </div>
                          <span>↗</span>
                        </button>
                        <div className="pool-preview">
                          {d.picks
                            .filter((p) => p.uid === who)
                            .slice(-4)
                            .map((p) => (
                              <button
                                key={p.card}
                                onClick={() =>
                                  setSelected(byId.get(p.card) || null)
                                }
                              >
                                {byId.get(p.card)?.name}
                              </button>
                            ))}
                        </div>
                      </div>
                    ))}
                    <div className="side-help">
                      {d.settings.order === "snake"
                        ? "Snake order reverses each round."
                        : "Linear order repeats each round."}{" "}
                      Banked picks join your next turn. Each card gets its own
                      clock.
                    </div>
                  </>
                ) : tab === "picks" ? (
                  <>
                    <h3 className="sidebar-label">The draft so far</h3>
                    {[...d.picks].reverse().map((p, i) => (
                      <button
                        className="pick-row"
                        key={p.card}
                        onClick={() => setSelected(byId.get(p.card) || null)}
                      >
                        <span className="pick-number">
                          {d.picks.length - i}
                        </span>
                        <div>
                          <strong>{byId.get(p.card)?.name}</strong>
                          <small>
                            {playerName(p.uid)}
                            {p.auto ? " · Autopick" : ""} ·{" "}
                            {new Date(p.at).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </small>
                        </div>
                      </button>
                    ))}
                    {!d.picks.length && (
                      <p className="side-help">
                        The first pick is still ahead.
                      </p>
                    )}
                    <h3 className="sidebar-label">Table activity</h3>
                    {[...d.events].reverse().map((e, i) => (
                      <p className="side-help" key={i}>
                        {e.kind === "cancel"
                          ? "Host cancelled the draft."
                          : e.kind === "timeout"
                            ? `${playerName(e.uid)} missed a turn; picks banked.`
                            : e.kind === "undo"
                              ? "Host undid the latest pick and paused the table."
                              : `Host ${e.kind === "pause" ? "paused" : "resumed"} the table.`}{" "}
                        <small>{new Date(e.at).toLocaleString()}</small>
                      </p>
                    ))}
                  </>
                ) : (
                  <>
                    <h3 className="sidebar-label">Your private shortlist</h3>
                    <p className="side-help">
                      The first available card is picked automatically when your
                      turn opens. Add cards from their detail view. Reorder with
                      the arrows.
                    </p>
                    {queueAvailable.map((card, i) => (
                      <div className="queue-row" key={card}>
                        <button
                          className="queue-name"
                          onClick={() => setSelected(byId.get(card)!)}
                        >
                          <span>{i + 1}</span>
                          {byId.get(card)?.name}
                        </button>
                        <button
                          aria-label={`Move ${byId.get(card)?.name} up`}
                          disabled={i === 0 || busy}
                          onClick={() => {
                            const q = [...queueAvailable];
                            [q[i - 1], q[i]] = [q[i], q[i - 1]];
                            act("queue", { cards: q });
                          }}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Move ${byId.get(card)?.name} down`}
                          disabled={i === queueAvailable.length - 1 || busy}
                          onClick={() => {
                            const q = [...queueAvailable];
                            [q[i + 1], q[i]] = [q[i], q[i + 1]];
                            act("queue", { cards: q });
                          }}
                        >
                          ↓
                        </button>
                        <button
                          aria-label={`Remove ${byId.get(card)?.name}`}
                          disabled={busy}
                          onClick={() => toggleQueue(card)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {!queueAvailable.length && (
                      <p className="side-help empty">
                        An empty queue means you’ll pick manually.
                      </p>
                    )}
                  </>
                )}
              </aside>
            )}
          </div>
        </main>
      )}
      <footer>
        <span>rotisserie / THE OPEN TABLE</span>
        <span>Made for long drafts & good company.</span>
      </footer>
      {selected && d && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="modal card-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="card-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              autoFocus
              aria-label="Close card"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <div className="detail-images">
              <img src={selected.image || undefined} alt={selected.name} />
              {selected.back && (
                <img src={selected.back} alt={`${selected.name} back face`} />
              )}
            </div>
            <div>
              <div className="eyebrow">
                {selected.custom ? "CUSTOM CUBE CARD" : group(selected)}
              </div>
              <h2 id="card-title">{selected.name}</h2>
              <p>
                {selected.type} · MV {selected.cmc}
              </p>
              {!selected.custom && <p className="oracle">{selected.text}</p>}
              {selected.custom && (
                <p className="muted">
                  The card image contains the custom rules text.
                </p>
              )}
              {picked.has(selected.id) ? (
                <div className="picked-by">
                  Drafted by {playerName(picked.get(selected.id)!.uid)}
                </div>
              ) : (
                <>
                  {yourTurn && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => act("pick", { card: selected.id })}
                    >
                      Draft {selected.name} →
                    </button>
                  )}
                  {member && ["active", "paused"].includes(d.status) && (
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={() => toggleQueue(selected.id)}
                    >
                      {queue.includes(selected.id)
                        ? "Remove from my queue"
                        : "☆ Add to my autopick queue"}
                    </button>
                  )}
                  {!yourTurn && d.status === "active" && (
                    <p className="muted">
                      Waiting for {playerName(current(d))} to pick.
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}
      {confirm && d && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title">
              {confirm === "cancel"
                ? "Cancel this draft?"
                : confirm === "start"
                  ? "Ready to reveal the pool?"
                  : "Undo the latest pick?"}
            </h2>
            <p>
              {confirm === "cancel"
                ? "This permanently stops the draft for everyone. The clock and autopicks stop, and the draft cannot be resumed. Existing picks and pools remain available to view and export."
                : confirm === "start"
                  ? `Randomly reveal ${d.settings.poolSize} cards and assign ${d.players.length} players a pick order. Seats and settings will be locked.`
                  : "The last selected card returns to the pool and the table pauses. The restored pick gets a fresh clock when you resume. Automatic picks count as individual picks."}
            </p>
            <div className="actions">
              <button autoFocus onClick={() => setConfirm("")}>
                {confirm === "cancel" ? "Keep drafting" : "Cancel"}
              </button>
              <button
                className={confirm === "cancel" ? "danger" : "primary"}
                disabled={busy}
                onClick={() => act(confirm)}
              >
                {busy
                  ? "Working…"
                  : confirm === "cancel"
                    ? "Cancel draft"
                    : confirm === "start"
                      ? "Start draft"
                      : "Undo & pause"}
              </button>
            </div>
          </section>
        </div>
      )}
      {create && (
        <div className="modal-backdrop">
          <section
            className="modal create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
          >
            <button
              className="close"
              aria-label="Close"
              onClick={() => setCreate(false)}
            >
              ×
            </button>
            <div className="eyebrow">A NEW TABLE</div>
            <h2 id="create-title">Bring your cube.</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                work(async () => {
                  const result = await command({
                    action: "create",
                    name,
                    cubeUrl,
                    settings,
                  });
                  setCreate(false);
                  location.hash = `/draft/${result.id}`;
                });
              }}
            >
              <label>
                Draft name
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                CubeCobra link
                <input
                  required
                  type="url"
                  value={cubeUrl}
                  onChange={(e) => setCubeUrl(e.target.value)}
                />
              </label>
              <div className="form-grid">
                <label>
                  Cards to reveal
                  <input
                    required
                    type="number"
                    min={2}
                    max={1000}
                    value={settings.poolSize}
                    onChange={(e) =>
                      setSettings({ ...settings, poolSize: +e.target.value })
                    }
                  />
                </label>
                <label>
                  Picks per player
                  <input
                    required
                    type="number"
                    min={1}
                    max={100}
                    value={settings.picksPerPlayer}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        picksPerPlayer: +e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Pick order
                  <select
                    value={settings.order}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        order: e.target.value as "snake" | "linear",
                      })
                    }
                  >
                    <option value="snake">Snake (1…N, N…1)</option>
                    <option value="linear">Linear (1…N, 1…N)</option>
                  </select>
                </label>
                <label>
                  Minutes per card
                  <input
                    required
                    type="number"
                    min={1}
                    max={4320}
                    value={settings.seconds / 60}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        seconds: +e.target.value * 60,
                      })
                    }
                  />
                </label>
                <label>
                  Quiet hours start
                  <input
                    type="time"
                    value={settings.quietStart}
                    onChange={(e) =>
                      setSettings({ ...settings, quietStart: e.target.value })
                    }
                  />
                </label>
                <label>
                  Quiet hours end
                  <input
                    type="time"
                    value={settings.quietEnd}
                    onChange={(e) =>
                      setSettings({ ...settings, quietEnd: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Quiet hours timezone
                <input
                  required
                  value={settings.timezone}
                  onChange={(e) =>
                    setSettings({ ...settings, timezone: e.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setSettings({ ...settings, quietStart: "", quietEnd: "" })
                }
              >
                Disable quiet hours
              </button>
              <p className="muted">
                Cards are sampled uniformly, with no color balancing. Missed
                picks carry forward. Queues are private. Settings lock when you
                create the table.
              </p>
              <button className="primary" disabled={busy}>
                {busy ? "Importing cube…" : "Import cube & create table →"}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
