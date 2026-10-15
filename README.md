# Rotisserie — the open table

An asynchronous Magic: The Gathering cube rotisserie draft app. React + TypeScript frontend on GitHub Pages; Firebase Authentication, Firestore, and a small serverless Firebase backend.

## What works

- Google sign-in; invite links with anonymous spectating and host-approved player requests.
- CubeCobra mainboard import, including custom names, custom front/back image URLs, card overrides, and separately draftable duplicate entries. No Scryfall substitution of custom cards.
- Configurable random pool size, picks per player, snake/linear order, pick clock, quiet hours, and IANA timezone. Uniform random sampling and seat assignment use Node's cryptographic random generator.
- Realtime shared board, every player's pool, chronological picks, recent table activity, private ranked autopick queues, local sorts/filters, gallery/list views, card details, and text pool exports.
- Missed picks bank for the next turn. Each card gets its own clock; final outstanding picks receive catch-up rounds.
- Host pause/resume preserves active time. Undo restores the state immediately before the latest individual selection and pauses the table; resume gives that selection a fresh clock.
- A useful interactive demo is available before Firebase is configured. Demo changes are session-only; use **Play as** to try different seats.

## 1. Create Firebase

Use a **separate Firebase project** for this app so billing and limits are isolated.

1. Open https://console.firebase.google.com/ and create a project. Analytics is optional and unused.
2. Upgrade to the **Blaze** plan and attach a billing account. There is no fixed subscription fee, but usage above free allowances and supporting services can be billed.
3. Build → Authentication → Get started → Sign-in method → enable **Google**. Choose a support email. Other sign-in providers are unnecessary.
4. Authentication → Settings → Authorized domains: add **`mgdunn2.github.io`**. Add `localhost` if testing against the live project locally. Leave the default Firebase domains present.
5. Build → Firestore Database → create the default database, **Standard edition**, Production mode. Choose a US region near you; `us-east4` or a US multi-region is reasonable. Database location is a lasting choice. The functions default to `us-central1`; you can change the source and frontend variable together before deployment if desired.
6. Project settings → General → Your apps → add a **Web app**. You do not need Firebase Hosting. Copy its Firebase config values for the next steps.

## 2. Deploy the backend and security rules

Use Node **22**. From the repository root:

```sh
npm ci
npm ci --prefix functions
npx firebase login
npx firebase use --add
```

Select your project and give it the alias `default`. This writes your local project association. Then:

```sh
npm run check
npx firebase deploy --only firestore,functions
```

Allow the Firebase CLI to enable required Google Cloud APIs if asked. The first Functions deploy can take several minutes. Ensure both `draftAction` and `advanceDrafts` deploy successfully and that Firestore's `status + wakeAt` index finishes building. Functions run under the project's service account, using the Admin SDK; no service-account key belongs in the frontend or repo.

The deployment creates:

- **`draftAction`**: authenticated callable function for cube import, table creation, approvals, start, picks, queues, pause/resume, and undo.
- **`advanceDrafts`**: one Cloud Scheduler job every minute for expired turns and queues waiting through quiet hours. Firebase creates its authenticated scheduler wiring.

No always-running server, VM, cron host, or GitHub Actions timer is needed. After backend changes, redeploy functions/rules; Pages deployment only updates the frontend.

## 3. Configure and publish GitHub Pages

In https://github.com/mgdunn2/rotisserie/settings/variables/actions add these **repository variables** (not environment variables):

| Name                        | Firebase config value                              |
| --------------------------- | -------------------------------------------------- |
| `VITE_FIREBASE_API_KEY`     | `apiKey`                                           |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain`, usually `PROJECT_ID.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID`  | `projectId`                                        |
| `VITE_FIREBASE_APP_ID`      | `appId`                                            |

These are public Firebase web configuration values, not admin credentials. Access is controlled by authentication, backend authorization, and Firestore rules. Do not add a service-account JSON file or private key.

1. Repository Settings → Pages → Build and deployment → Source → **GitHub Actions**.
2. Actions → **Check and deploy Pages** → Run workflow on `main` (or push a commit).
3. Open **https://mgdunn2.github.io/rotisserie/** once the deployment succeeds.

The workflow runs tests, checks and builds the functions, builds the web app, and publishes `dist/`. Missing Firebase config deliberately produces the preview/demo rather than a broken login screen. Configuration changes require a new workflow run. `vite.config.ts` already uses `/rotisserie/`; hash routes keep invite links working on static Pages without rewrites.

## 4. Set billing controls

For a small private group, normal usage is expected to be within free allowances or incur small charges; this is an estimate, not a zero-cost guarantee. The scheduler, function deployment artifacts/builds, logging, database operations, and egress all deserve monitoring.

- **Project budget alerts**: Google Cloud Console → Billing → Budgets & alerts → create a project-filtered monthly budget (for example $5), with actual and forecast alerts. Alerts alone do not stop spending.
- **Functions spend cap**: Firebase → Settings → Usage and billing → Details & settings → Service-level spend caps → Cloud Functions. Set a small monthly amount. This feature is in Preview. Enforcement is delayed; overages can still be billed. It is service-specific and does not cap Firestore or every supporting service. A functions cap pauses picks, approvals, imports, and timeout processing; viewing Firestore data can continue. Lift/increase the cap to restore draft actions.
- Functions have `minInstances: 0` and `maxInstances: 2`; the scheduler has `maxInstances: 1`. This limits scaling, not total monthly spend. Keep the CLI's Artifact Registry cleanup policy enabled when prompted, or configure it in Google Cloud.
- Authenticated actions are limited to 120/minute per user. Creating/importing tables is limited to 3/day/user. Cube exports are cached for one hour. Drafts are bounded to 16 players, 100 picks/player, and 1,000 revealed cards; imports accept up to 1,500 mainboard entries and bound response bytes.
- Spectators read public data directly; no background polling loop. One draft snapshot listener streams state. Cube data loads once per visit in chunks. Spectators can still generate reads/egress, so unlisted links are not a complete abuse/cost boundary.
- Retain strong security rules. Consider Firebase App Check if the app is opened beyond friends. It is not enabled by default because it requires provisioning a web attestation provider.

There is **no guaranteed project-wide hard dollar cutoff** in this implementation. Budget automation that disables billing is possible but delayed and disruptive, and isn't installed automatically.

Current references: [Firebase pricing](https://firebase.google.com/pricing), [spend caps and limitations](https://firebase.google.com/docs/projects/billing/spend-caps), [budget alerts](https://firebase.google.com/docs/projects/billing/budget-alerts), [function scaling controls](https://firebase.google.com/docs/functions/manage-functions).

## Running a draft

1. Sign in and create a table with a public CubeCobra list link. The provided Hale St Powered Cube link is prefilled.
2. Choose pool size, picks/player, order, minutes per card, and quiet hours/timezone. Clear both quiet-hour fields to disable. Settings are fixed at creation; create a replacement lobby if they need changing.
3. Share the invite link. Players sign in and request a seat. Approve them in the waiting room. Anyone with the link can spectate without signing in.
4. Start once everyone is approved. The pool must be at least `players × picks/player`. Both seats and the subset of cards are randomized on the server. Pool is immutable once started, even if the source cube changes.
5. Open a card to pick it or queue it. Queue ranks available card **instances**, not just names; duplicate copies can be queued separately. Queued cards are picked immediately when a turn opens, including banked picks and consecutive snake turns. The host cannot read anyone else's queue through the app or Firestore client rules.
6. Sort by color/mana/name, search names/types/rules text, filter available cards or a player's pool, and export a pool as text. Sort and gallery/list preferences stay in the current browser; search and filters are session-local.

### Clock and undo details

- Snake is `1…N, N…1`; linear is `1…N, 1…N`. Initial order is randomized once.
- Every card gets the configured amount of active time. Missing a turn banks **all still-owed picks from that turn**. At the next turn, those picks are added to the normal one. Final catch-up rounds repeat until everybody reaches their target; there is no random fallback pick.
- A user who keeps missing catch-up turns can keep a draft open indefinitely. They can return or provide an autopick queue; host can pause the table.
- Quiet hours use the draft timezone, including daylight saving transitions. Picks and autopicks wait during quiet hours. Pause preserves the remaining active time and resume schedules around quiet hours again. The UI reports active time, not raw wall-clock time.
- Deadline enforcement uses the function's server clock. Browser clocks only drive display. Firestore transactions serialize picks, queues, timeouts, and host controls. Offline picks are not accepted or queued silently.
- Scheduler processing is normally within about a minute of a deadline, but cloud delays are possible. A late job advances **one turn**, starting the next clock at actual processing time so delays do not skip many players. It handles up to 100 due tables per run; larger backlogs spill to following minutes.
- Undo is a **single-level state restore** before the most recent manual or automated selection, including intervening clock progress since that selection. It pauses immediately and requires host resume. Earlier undo history is not kept. Queue entries remain in the private queue, so remove a restored card from your queue if you don't want it automatically picked again on resume.
- Recent activity retains the latest 100 non-pick events; all picks remain visible. No notifications/email reminders are included.

## Architecture and privacy

Public, unlisted draft URLs use random UUIDs. Rules allow exact draft reads and its card chunks, but deny listing all drafts. Display names, Firebase user IDs, pools, picks, and draft settings are public to anyone who has that link. This is **unlisted**, not private/invite-only viewing. Emails and OAuth tokens are never written into public draft data.

```
src/                     React UI, Firebase client, interactive demo
functions/src/engine.ts  Pure clock, pick, and carryover logic
functions/src/cube.ts    Bounded CubeCobra API import/normalization
functions/src/index.ts   Authenticated commands, transactions, scheduler
firestore.rules          Read access and client write denial
firestore.indexes.json   Scheduler query and large-field index exclusions
tests/                   Engine/import, security rules, transactional integration
```

Clients use Firestore realtime reads; **all writes go through callable functions**. Keeping one transition implementation server-side makes undo, private queues, randomization and timeout handling consistent. The UI sends an expected revision for pick/host controls, so stale tabs fail rather than selecting into a different turn. Queue updates also advance revision; retry a pick after reviewing a changed board.

Draft state is one bounded document, immutable imported card data is chunked separately, queue documents are private to their owners, requests are visible to the host and requester, and a private undo snapshot is backend-only. Service Admin SDK access bypasses Firestore rules, so deployment permissions must remain restricted to trusted maintainers.

Cube import uses the [CubeCobra JSON export API](https://cubecobra.com/help/apidocs), not HTML scraping. Only mainboard entries are imported; maybeboard/basics are excluded. Each array entry is one copy; `quantity` is not expanded because CubeCobra uses that field as a derived duplicate count. Customs prefer `custom_name`, `imgUrl`, `imgBackUrl`, `cmc`, `colors`, and `type_line` over placeholder details. Image files remain on the original hosts (including Imgur), so a removed or blocked external image cannot be repaired by the app. Custom rules text is read from the custom image; placeholder Oracle text is not presented as its rules. This app drafts a voucher as one card; CubeCobra-specific voucher expansion/dynamic draft effects are not implemented.

## Local development and validation

Copy `.env.example` to `.env.local` and fill the public Firebase web config. Use `npm run dev` for the frontend. To avoid touching production, use Firebase emulators:

```sh
# Terminal 1
npm --prefix functions run build
npx firebase emulators:start --project demo-rotisserie --only auth,firestore,functions
# Terminal 2: set VITE_USE_EMULATORS=true and use projectId demo-rotisserie
npm run dev
```

For emulator Google sign-in, use the emulator's popup test flow. The scheduler is not automatically driven by the local emulator; deployed scheduling must be verified in your Firebase project. A cube import in emulators still calls the public CubeCobra API.

```sh
npm run check           # engine/import tests + frontend/functions typechecks and builds
npm run test:emulators  # Firestore security rules + transactional command integration
```

The emulator suite requires Java (21 recommended) and downloads Google's Firestore emulator on first use. Backend integration tests seed a local cube fixture and exercise approval authorization, concurrent picks, queue autopicks, pause/resume, undo, and banked expiry. Tests never need a production service-account key.

Before using for an actual draft, sign in on two separate browser sessions, approve a second player, start a short test, try a queued pick and an expired turn, and verify Cloud Scheduler execution. OAuth and cloud IAM/scheduler wiring cannot be validated until your Firebase project is configured.
