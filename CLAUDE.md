# WastePlanner — working conventions

Waste management SaaS: Supabase backend, canvas-based bin-room layout and
Austroads swept-path tooling.

## Known deferrals / pre-launch gates

Deliberate omissions, not oversights. Each one blocks a specific milestone —
check this list before widening who can use the app.

| # | Gate | Blocks | Why it matters |
| --- | --- | --- | --- |
| 1 | **Org-level title block branding.** `WS_BRAND` in `index.html` is a hard-coded constant for Pro Waste Consultants. | Any **external organisation** exporting a sheet. | Every firm's drawings would go out branded Pro Waste Consultants. Needs a row per org, editable in-app. The gate is restated at the constant itself. |
| 2 | **Private repository.** | **Launch.** | **Decided 2026-08-24: staying public for now.** The org is on the **free** GitHub plan, where Pages cannot serve from a private repo — flipping visibility would take the live site down at the `CNAME`. A scan found nothing that requires secrecy: the Supabase JWT is the **anon** key (`"role":"anon"`) with RLS as the real boundary, and there is no `service_role` key, private key or API secret. So this is hygiene with a real cost attached. It closes by moving hosting or paying for a plan — not by flipping the switch. Do not re-investigate; the blocker is the plan, not the repo. |
| 3 | **No PITR — daily backups only.** | **Real customer data.** | **Confirmed 2026-08-24: point-in-time recovery is NOT enabled.** The project has daily backups, which sets a recovery point objective of **up to 24 hours** — a customer who spends a day on a layout can lose that day, and nothing in the app warns them. A restore has also still never been **rehearsed**, so the retention window and the restore path are both untested. And daily backups cover **Postgres only**: uploaded plan PDFs live in Supabase **Storage** (`PLANS_BUCKET`), which they do not include. A restore that brings back every `projects` row and no plan PDFs is a half-restore — every project would open pointing at a drawing that is gone. Decide the acceptable RPO before real customer data, then enable PITR or accept 24h in writing, back up Storage separately, and rehearse once end to end. |
| 4 | **`pdf_rev` column** for cross-device plan freshness. | Multi-device use of one project. | Nothing currently tells a second device that the stored plan PDF changed, so it can serve a stale page under a current layout. |
| 6 | **Org-level custom equipment records.** The `equipment` table is one shared library. | Any **external organisation** placing equipment. | One firm's custom plant would appear in every other firm's picker and bin calculator. Needs org scoping on the table plus RLS, same shape as gate 1. |
| 9 | **ai-user anonymous allowance.** The `?check=wmp` entry hands the checker an `is_anonymous` session token; the ai-user edge function (not in this repo) must grant such tokens exactly ONE lifetime `compliance` run and refuse every other tool tag. Also: "Allow anonymous sign-ins" must be ON in Supabase Auth (off = graceful signup-first fallback, but the offer stops being "no account needed"). | **Pointing the planner landing page at real traffic.** | Until verified, an anonymous check either fails server-side or draws from an unintended allowance bucket. Client + DB fences are done (`sql/2026-09-12-anon-compliance-entry.sql`); this is the last leg. |

**Closed:** Swept-path title block panel (gate 5). `wsSheetVehPanel` renders the
bottom-centre card when the swept layer is on and paths exist: the D2 side
elevation (schematic, operating envelope on) beside DB-sourced vehicle data,
with the vehicle's `source` stated on the drawing — a contractor's truck must
never read as a design standard. Layer off → the export is unchanged.

**Closed:** Stripe test mode (gate 8). `stripeInstance` is built from a hard-coded
`pk_test_…` publishable key, and that is **deliberate until launch** — not an
oversight and not a leak (publishable keys are public by design). It is recorded
here rather than dropped because the failure mode is silent: in test mode checkout
*succeeds* and no money arrives. **Swapping to the live publishable key, and
confirming the server side is on live secrets, is a launch-day step.**

**Closed:** `equipment.streams` (gate 7). The column is migrated, the admin table
edits it, and placement assigns from it. `inferStreams()` in the calculator is now
a fallback for rows that predate the column — not the live path. Do not reintroduce
inference anywhere: stream association decides bin counts on issued drawings.

**Bin types are a curated list by design — the equipment library is that list.**
A bin schedule is only defensible if every container maps to a real collectable
product, so there is no free-text custom-bin path in any tool and none is
planned. What changed (2026-09-13): the list is no longer a constant compiled
into the calculator; it is the library's `item_kind = 'Bin'` records, curated in
the admin table (see "Bin calculator" below). Adding a size means adding a
library record. Custom *equipment* is gate 6.

Unknown branding fields (`abn`, `address`, `phone`, `email`) are intentionally
**blank**, and the title block omits blank lines rather than printing them. An ABN
and street address are legal identifiers on an issued drawing — they get entered
by someone who knows them, never guessed.

## Architecture

**Single file.** `index.html` is the entire application — markup, styles, and all
JavaScript in inline `<script>` blocks. There is no build step, no bundler, and no
module system. Deploys are a static file push (GitHub Pages, `CNAME` at the root).

Consequences to keep in mind:

- A syntax error anywhere in a `<script>` block kills **every** declaration in that
  block at parse time, with no error surfaced outside the console. `npm test`
  parses every block for exactly this reason.
- Declaration order matters. Top-level `const`/`let` are in TDZ until evaluated;
  function declarations hoist within their own block only. Blocks do not see each
  other's `const`/`let` unless assigned to `window`.
- Do not split `index.html` into modules or add a bundler without an explicit
  decision to change the deployment model.

## Where state lives (standing rule)

**localStorage is only for trivial per-device UI state** — a remembered tab, a
collapsed panel, an unsent draft, viewport/zoom position, the chosen org
context. **Anything that is user-created content, shared configuration, a team
standard, or billing/audit-relevant lives in Supabase**, scoped to the
organisation (`org_id`) or to the user where genuinely personal
(`org_id null` + `user_id`, the split the `projects` table uses). When in
doubt, it goes server-side. *"Add a shared table as a follow-up"* is not an
acceptable reason to ship content in localStorage first — it manufactures a
migration instead of avoiding one, and it is how WMP text presets briefly
ended up per-device (fixed 2026-09-16: `wmp_text_presets`).

Confirmed 2026-09-16: **projects are server-authoritative.** `loadProjectsFromDB`
merges cloud rows over the `pw_projects` cache (a cache, not a store), and
the free-project cap reads `profiles.projects_created`, a monotonic counter
kept by trigger (`sql/2026-09-07-free-tier-enforcement.sql`) — clearing the
browser cannot reset it.

## Supabase

- **The client binding is `sb`.** Always `sb.from(...)`, `sb.auth`, `sb.rpc(...)`.
  Never `supabase.` or `client.` — `supabase` is the CDN global and is used once,
  at `const sb = createClient(...)`, and nowhere else. `sb` is a lexical `const`,
  **not** `window.sb`; guard cross-block access with
  `if (typeof sb === 'undefined' || !sb) return;`.
  Enforced by a test in `tests/syntax.test.js`.
- **New tables need table-level `GRANT`s, not just RLS.** RLS policies filter rows;
  they do not confer table privileges. A table with perfect policies and no
  `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO anon, authenticated;` returns
  permission-denied. Ship both, every time.
- The vehicle library reads the `contractors` table (`include_in_swept = true`) and
  merges over the `WS_VEH` built-in presets. Built-ins are the offline fallback —
  keep them working so the swept tool never hard-fails on a DB outage.

## Anonymous compliance entry (planner landing page)

"Everything inside WastePlanner requires a free account" has exactly **one
scoped exception**: the planner landing page's `?check=wmp` entry opens the
compliance checker in an anonymous session for **one** free WMP check. The
result shows in full — the result itself is never gated — and *any* further
action (second check, export, submit, engage, navigating anywhere else)
raises the signup gate. Do not widen this to any other tool or entry point;
the rule and its exception are restated at the `ANONYMOUS MODE: ONE SCOPED
EXCEPTION` section in `index.html`.

How it hangs together (tested by `tests/anon-entry.test.js`):

- **The guest is a real Supabase `is_anonymous` user** (`signInAnonymously`),
  so the ai-user edge function can enforce a one-run allowance on a
  verifiable token, and RLS treats it as `authenticated`. The session boot
  routes `is_anonymous` sessions into the checker and **never** into the app
  proper. DB fences: `sql/2026-09-12-anon-compliance-entry.sql` (anonymous
  JWTs cannot write projects or profiles; events stay open for the funnel).
  Anonymous sign-ins must be ON in Supabase Auth settings — if the call
  fails, the entry falls back to signup-first instead of breaking.
- **`showScreen` is the wall**: in anon mode every screen except
  `compliance` routes to `wpAnonGate()`. The hidden nav rail
  (`body.wp-anon`) is cosmetics on top, not the enforcement.
- **One check per device** is `wp_anon_check_used` in localStorage plus the
  persisted anon session; the server allowance is the real meter. Clearing
  storage leaks a fresh check — accepted, this is lead gen, not metering.
- **Claim-on-signup is ONE shared mechanism** (`wpClaimPark` / `wpClaimApply`
  in `index.html`), parameterised by kind: the bin-calc handoff parks
  `calc`, the checker parks `compliance` (result JSON in the claim store,
  WMP bytes under the temp IDB key `doc:anon:check`). A future entry point
  adds a kind and an applier — never a parallel bespoke store. Applying the
  compliance claim creates the project with `complianceRuns: 1` (the
  anonymous run **is** the project's first check, so every free path tops
  out at the same two checks) and re-renders the exact stored result via the
  checker's `restoreScan()` — nothing re-runs, nothing double-counts
  (`state.restoring` suppresses the `wp-scan-done` report).
- **Attribution**: the landing page carries its own `utm_*` params; the
  existing first-touch capture and `signup_source` stamping cover it. The
  funnel events are `anon_check_entry`, `anon_check_run`, `anon_gate_shown`,
  `anon_banner_signup`, `compliance_claim_applied`.

## Canvas geometry

- **All geometry is in canvas pixels; `mpp` converts.** `wsSweptMpp()` returns
  metres per canvas pixel, derived from the scale selector, the paper-size
  selector, and the canvas width. It returns `null` when the workspace scale is not
  set — every caller must handle that, and the established fallback is
  `wsSweptMpp() || 0.05` with the result flagged as estimated in the UI.
- Convert metres to pixels at the point of use (`v.wb / mpp`), never store pixel
  values that outlive a scale change.
- Vehicle kinematics follow Austroads AP-G34-23 §3.5. `minR` is the **kerb-to-kerb**
  radius (outer front *wheel*) and `rww` is **wall-to-wall** (outer front *body
  corner*); `rww` takes precedence when present. `wsRearAxleRadius()` back-solves
  the rear-axle radius from whichever is given — do not treat `minR` as a rear-axle
  radius, which is the bug that understeered every vehicle before the current model.
- `wsCalibrationNumbers()` is the closed-form reference. Kerb ⌀ is an *identity*
  (`2 × minR`), so any drift there is a model regression, not rounding.

## SVG layers

Overlay content lives in fixed layer groups, in this stacking order:

```
ws-layer-dxf · ws-layer-binroom · ws-layer-waste · ws-layer-markups · ws-layer-swept · ws-layer-dims
```

Render each concern into its own group — never mix content across layers, and never
create ad-hoc groups outside this set. Layer visibility toggles key off these ids.

## Labels

Annotation text scales with the drawing, not the viewport. Multiply font sizes and
label offsets by **`wsLblF()`**, which returns `0.026 / mpp` clamped to `[0.5, 3]`
(1.0 at roughly 1:100). Hard-coded `font-size` on annotation text is a bug: it makes
labels illegible at 1:500 and cartoonish on detail plans.

## Tests

`npm test` runs the Node test suite in `tests/`.

| File | Covers |
| --- | --- |
| `tests/extract.js` | Extraction harness + DOM stub (not a test file) |
| `tests/rs-planner.test.js` | `wsRsPlan` Reeds-Shepp property test, 10,000 random poses |
| `tests/ackermann.test.js` | Ackermann calibration against published turning circles |
| `tests/refine-pos.test.js` | `wsRefinePos` curvature, length, gear-flag invariants |
| `tests/layout-rooms.test.js` | Room containment tagging and schedule reconciliation |
| `tests/room-edit.test.js` | Room vertex/drag operations, chip placement and visibility |
| `tests/sheet-export.test.js` | Sheet scale selection, card layout, legend content |
| `tests/layout-polish.test.js` | Shift-snap maths, room dimensions, door geometry, selection |
| `tests/reconcile-equipment.test.js` | Compaction maths, invariants, snapshot, WMP obligations |
| `tests/provision-zones.test.js` | Provision streams, zone types, and their four UI surfaces |
| `tests/vehicle-profile.test.js` | D2 side-elevation module: axle positions, defaults, SVG output; D3 panel gating |
| `tests/anon-entry.test.js` | Anonymous compliance entry, shared claim store, signup gate |
| `tests/bin-library.test.js` | Calculator bin selection: library sizes, collection method, council schedule; kerb cadence |
| `tests/residential-method.test.js` | Residential method types: stepped-table lookup, review gate, state fallback |
| `tests/wmp-generator.test.js` | WMP generator: title, guideline auto-load, assembled narrative, polish guard, override provenance, text-library conditions and presets |
| `tests/cd-stages.test.js` | Site preparation & construction stages: the Terrigal fixture, estimator rules, overrides, prefill, appendix renderers, the Central Coast form map and fill (pdf-lib test skips when not installed) |
| `tests/syntax.test.js` | Parses every `<script>` block; convention checks |

**Extract test subjects from `index.html`; never duplicate them.** `tests/extract.js`
lifts each declaration out of the file by anchor pattern, brace-matches to its end,
and evaluates the result in a `node:vm` context with a stubbed `document`. Copying a
function into a test file creates a fork that passes forever while the shipped code
rots.

To cover a new function, add an anchor to `BLOCKS` in `tests/extract.js`. Anchors
are matched against whole lines and must resolve to exactly one line — extraction
throws on zero or multiple matches, so a rename fails loudly rather than silently
testing stale code. This means top-level declarations should stay at column 0 with
their opening brace on the declaration line.

## Bin calculator: library-driven sizes, collection method, council schedule

Three layered constraints decide what a bin-size dropdown offers, in this order
(`binSizesFor` in the calculator srcdoc; `tests/bin-library.test.js` runs it):

1. **The library is the list.** The parent pushes every active `Bin` record
   with a capacity as `bins` on `ws-calc-fill`; `ALLOWED_SIZES` is the
   **offline fallback only** (the `WS_VEH` contract — never edit it to add a
   size). `equipment.is_common` is the short default group ("Bins"); the rest
   sits under "More sizes", still selectable. Sizes dedupe per litre: common if
   any record says so, method-restricted only if every record is. A record's
   `streams` narrows which streams it serves; empty = unrestricted. Footprint
   comes from the record's dimensions first, the built-in table second, and a
   size known to neither flags the room area incomplete.
2. **The collection method constrains.** Per room section (`room.method.r/c`,
   persisted in `bin_rooms`), defaulting from the mix — townhouse-only →
   kerbside individual, anything else → bulk. `COLLECT_METHODS` is data:
   kerbside methods top out at **360L** and offer **no compaction plant or
   containers**; a record tagged `collection_methods` (e.g. a front-lift bin
   tagged `bulk`) is never offered elsewhere. Only kerbside methods are
   `kerb: true` — the Collection Point presents those bins and nothing else.
   **Kerbside individual counts dwellings, not litres**: every dwelling (every
   tenancy, for a commercial section) wheels out its own bin per stream, so
   `perDwellingUnits` sets the count and the capacity check then says whether
   that one bin holds its share. Shared kerbside and bulk size from volume.
3. **The council's kerbside service specialises.** It is **structured data
   typed in by someone who knows it** — Admin › Council & state database ›
   *Kerbside collection service*, stored as one JSON `waste_meta` row
   (`field_key = 'kerbside_schedule'`, parsed by `wpKerbScheduleParse`, pure):
   per stream `{ sizeL, altL[], cycle }` with cycle `W` weekly · `A`/`B`
   fortnightly on that week · `F` fortnightly (week not stated) · `M` monthly ·
   `OFF` not collected at the kerb, plus `bulk { maxL, maxPerWeek }` caps. A
   state row (no council value) is the default for councils without their own.
   **Never infer it from guideline clauses** — a non-residential generation
   rate approved under the wrong type once became a 50L residential bin. The
   approved clauses are listed on the council card as the *reference* for
   whoever types the service in. Under a kerbside method the council service
   **is** the list — the default bin plus the sizes the council also offers,
   nothing else; editing means choosing among what the council supplies. Its
   cycle sets the frequency (`0.5` fortnightly, `0.25` monthly). Under a
   bulk collection point and a private shared bin collection (method id
   `self_haul` — its original name; the id is persisted in `bin_rooms`, so
   only the label changed) **every library bin and container that serves
   the stream** is offered — the stream rule is physical and holds under
   every method (a glass crusher is never a food-waste option) — trimmed
   only by the council's bulk caps. Departing from the
   service is allowed and **stated**; no service on record is a visible note
   naming where to add one and how many services are loaded. Saving the grid
   pushes straight to the calculator; ↻ in the calculator re-reads library +
   services. `sql/2026-09-14-kerbside-service-read.sql` lets every signed-in
   user read that one `waste_meta` row (officer contacts stay closed).

The WMP generator's bin rows apply the same three rules through pure platform
**mirrors** of `binSizesFor` and its defaults (`wpBinSizesFor` and friends),
pinned to the calculator by `tests/bin-library.test.js` §5 — see the WMP
generator section. Change the rule in the calculator and the pin fails until
the mirror follows.

### Residential method: rate · stepped table · state fallback (2026-09-15)

Most councils publish a residential generation **rate** and `res_rates` serves
them — that is the default and nothing below changes it. Some publish a stepped
**lookup table** instead (dwelling-count bands fixing bin counts and sizes per
stream; Northern Beaches Appendix A is the case that prompted this). That is a
different **shape** of answer, not a different number: there is no
litres-per-dwelling figure to read out of such a table, so forcing it onto the
rate model would mean inventing one — the same class of error as halving a
combined rate.

So the method is a per-council **type** with its own payload, stored as one JSON
`waste_meta` row (`field_key = 'residential_method'`, parsed by
`wpResMethodParse`, pure): `{ type, status, source, <payload under the type's
own key> }`. Rules, all tested in `tests/residential-method.test.js`:

- **The type is a registry, not a switch.** `WP_RES_METHOD_TYPES` maps each type
  to its payload key (`rate` has none; `table` carries `table`). A fourth shape
  — a hybrid, a per-bedroom table — is **added to the registry**, and every
  other council's stored row is untouched. That is the whole point of the
  discriminator. An **unknown type parses to `null`** rather than being coerced
  onto the nearest known one: a council served by a method this build does not
  understand falls back and says so, and never silently reads as a rate.
- **`status` is the human review gate.** Extraction only ever writes `'draft'`;
  `wpResMethodPick` serves only `'live'`, so a method nobody has signed off is
  invisible to the calculator however complete it looks. Only the exact word
  `live` opens the gate. Marking it live is a deliberate act in Admin › Council
  & state database › *Residential method*, with the document in front of you.
- **A project outside the published bands is reported, never rounded in.**
  `wpResTableLookup` returns a miss naming `below`/`above` and the bound it hit;
  the calculator puts that on the room and the volume path takes over. A council
  that tabled 3–20 dwellings did not table 40, and answering as though it had is
  how a figure lands under a council's name that the council never wrote.
- **The table is gated where it is physically wrong**, and both gates are
  physical rather than cosmetic: **residential** sections only (commercial keeps
  its use-based rates), and **shared** collection only. Under kerbside
  *individual* every dwelling wheels out its own bin — a fact about the
  development, not a figure a council can table — so `perDwellingUnits` keeps
  that case. A bulk collection point is not the council's kerbside service at
  all.
- **Departing from the table's size carries the council's CAPACITY over**, not
  the bare count (`resTableCount`): 4 × 660L re-sized to 240L is 11 bins, not 4.
  Keeping the count would quietly under-provide against the council's own
  figure. A manual `_binOv` count is still the last word, as on every other path.
- **Extraction is TRANSCRIBED, not summarised** (`WP_RES_TRANSCRIBE` +
  `wpResTableLines`, pure), the same lesson `crqRateSweep` learned: one line per
  stream per band, pipe-delimited, and **our** code decides the structure. A
  line missing a count, a size or a recognisable stream is **reported by name**
  in the panel, never half-stored and never inferred. It writes a draft and
  cannot mark itself live.
- **The fallback is stated wherever the number appears.** `scope` is `council`,
  `state` or `none`; a state row standing in for a council reads *"state
  fallback used — no council-specific method found"* on the calculator's rates
  line, in the results payload (`residential`), and — because the WMP is written
  later with the calculator closed — on the project (`p.residential_method`) and
  in the WMP's own rates pill (`wmpgResMethodNote`).
- `resTableLookup` in the calculator **mirrors** `wpResTableLookup` in the
  platform; the srcdoc is sandboxed and cannot call the parent's copy, so a test
  pins the two together, exactly as `councilKey` and `glBridgeNorm` are pinned.
- `sql/2026-09-15-residential-method.sql` lets every signed-in user read that one
  `waste_meta` row (officer contacts stay closed). The review gate is in the
  **data** (`status`), not in the policy.
- **The admin panel and the core live in different `<script>` blocks.** Function
  declarations cross blocks; top-level `const`/`let` are not relied on to. Every
  cross-block reader goes through `wpResMethodSpec` / `wpResStreams` /
  `wpResMethodTypeIds`, never `WP_RES_METHOD_TYPES` or `WP_RES_STREAMS`
  directly — a test enforces it, because the alternative throws only in the
  browser, only when an admin opens that panel.

Not built (its own brief, per the architecture brief's own sequencing):
equipment **categories** with distinct calculation branches — see the Equipment
section.

## WMP generator (revised 2026-09-15)

Full-screen, two panes (inputs / preview), larger higher-contrast controls.
Rules, all tested in `tests/wmp-generator.test.js`:

- **Every figure is traceable to where it came from.** A bin row carries
  `design` — the Design-tab (calculator schedule) value it was hydrated with —
  and `src` (`calc` · calculator `manual` override · generator `auto` estimate
  when no schedule exists). An edit in the generator is an **override**: it
  stays local to the WMP, is marked *"edited in WMP — differs from Design tab"*
  wherever it shows (`wmpgBinDiff`, pure), and **never writes back on its
  own**. `wmpgApplyToDesign` is the one explicit way across: per row, asks
  first, writes the project's `p.schedule` / `p.calc_rooms` as a named manual
  override (`manualWhy: 'Set in the WMP generator'`) and re-feeds an open
  layout. The bin calculator does not keep it — a re-run recalculates — and
  the UI says so. The **vehicle** has no apply-to-design: the swept path was
  *drawn* for a vehicle, so an edit is flagged against the drawing and offers
  a reset, never a rename. The parent keeps `p.presentation` from
  `ws-calc-results` so the re-feed carries the cadence source.
- **The compliance document is the guidelines library's current version**
  (`wmpgPickGuideline`, pure: newest **non-superseded** row for the council,
  matched through `glBridgeNorm`). Fills on open and on council change
  (`wmpgCouncilChanged`, which also re-loads the requirements pack). A
  hand-typed entry is `complianceSrc.kind = 'manual'` and is never overwritten;
  no document on file is an explicit *"no guideline on file for X"* state, with
  the council card's free text as the second source (`council_db`).
- **The document title is editable** (`d.title`, default
  `"<project> — Waste Management Plan"` via `wmpgTitleDefault`); it prints on
  the cover and lands in the .docx as `BM_DocTitle`.
- **The collection narrative is template-assembled, never generated**
  (`wmpgNarrative`, pure): one template per method — kerbside individual /
  kerbside shared / on-site bulk / private shared (`self_haul`) — with slots
  filled from the room's bins (count, size, **cycle letters** — the same
  `W`/`A`/`B`/`F`/`M` the Collection Point reads, rendered by `wmpgCycleWords`
  so A-against-B reads *"fortnightly on alternating weeks"*), provider,
  vehicle, collection point, street, tug and ramp gradient. A missing fact is a
  visible `[collection vehicle not yet selected]`-style placeholder, never a
  guess and never a dropped sentence; the pre-flight QA names each one. The
  author's edit (`room.collection.narrative`) wins; ↺ rebuilds. Preview and
  .docx both read `wmpgNarrativeText`, so they cannot differ.
- **AI polishes wording only, and is checked before it lands.**
  `wmpgPolishGuard` (pure) refuses a polish that drops or invents any number,
  loses a `[placeholder]`, or halves the text — the refusal names the figure.
  Same rule as rates and residential methods: deterministic for anything a
  council will check, AI only for presentation.
- **Text library: review exceptions, don't choose everything.** `wmpgShape(d)`
  is one pure reading of the project (development type, methods, provider,
  streams, equipment); `tbCondMet` reads snippet conditions against it —
  comma-joined tokens all hold, `!` negates, aliases resolve, and an **unknown
  token never hides a snippet** (a library typo must not drop a paragraph from
  an issued document). Groups with nothing applicable are hidden and counted.
  The library editor sets `cond` per snippet (`TB_CONDS`). **Presets**: the
  built-ins are project *shapes* (`shapeHint` fills only what the project has
  not said — project data always wins); saved presets are exact on/off + edit
  maps in **`wmp_text_presets`, server-side and org-scoped**
  (`sql/2026-09-16-wmp-text-presets.sql`; `org_id null` = personal, the
  projects split). Anyone in the org may create; changing or deleting a
  preset someone else created needs the org `admin` role — RLS enforces it,
  `tbPresetCanEdit` (pure) mirrors it for the UI. Loaded per open
  (`tbLoadPresets`) because the org context can change between opens. The
  brief per-device era is handled by a **one-time import offer**
  (`tbOfferLocalImport`, `tbPresetImportPlan` pure — clashes renamed, never
  merged over); the legacy key is then cleared or parked, never read again.
  Council-wide defaults stay server-side (`tbSaveCouncilDefaults`).
- **The preview is the workspace.** `tbNodes` tags nodes with their group;
  `wmpgBuildHtml` (screen only — `forPrint` sees plain nodes) wraps runs in
  `.tbsec` with a hover control: **⇄ swap text** opens a popover rendered by
  the same `tbGroupHtml` the panel uses, **✎ narrative** opens rebuild /
  polish / edit, **✎ edit** jumps to the field (`data-path` on every input).
  One selection, two places to reach it.
- **The preview follows the field being edited** — the same mapping, read the
  other way. Every doc node carries `src` (the input paths that feed it, `*`
  for any index) and `pri` where it is the PRIMARY place a path shows;
  text-library nodes carry `tb:<group>` plus every `{token}` their bodies
  use. `wmpgSet` / `wmpgBinSet` / `tbToggle` / `tbEdit` name the edited path
  (`wmpgFollow`); the next render picks the most specific matching node
  (`wmpgFollowPick`, pure — ties to a `pri` node, then document order),
  scrolls to it and highlights it, lightly marking the others: a bin count
  lands on the storage table and glows in the collection table and narrative,
  never jumping between them. **On edit, never on focus** — tabbing must not
  fight a reader who scrolled deliberately — and the header toggle pauses it
  (`wmpg_follow` in localStorage: per-device UI state, the allowed kind).
  Setting `srcdoc` reloads the iframe, so the follow runs in `onload`, and a
  render with no fresh edit **restores the scroll position** instead of
  throwing the reader to the top. Reverse: clicking a section calls
  `wmpgFocus` on its first input path. Print sees no `data-src`.
- **Vehicle, bulky waste and chutes read the app's own models — never free
  text.** The collection vehicle is a dropdown over `wsVehAll()` (the swept
  path tool's list: DB rows + `WS_VEH` built-ins, loaded via
  `wsVehEnsureLoaded` before the form renders); `room.collection.vehicleId`
  is the truth and the printed name is only ever set from a record, so facts
  like min R come from the record, not carried text. Default is the swept
  path's nomination; another pick is a flagged override, and *nominate on the
  project* writes `p.vehicle` and says the path must be redrawn. **Bulky
  waste / textiles** default from the calculator's Additional storage
  (`calc_rooms[].units` `ALLOW_HARD` / `ALLOW_TEXTILE`) as the Design value
  (`wmpgExtraDiff`, pure); the room-1 house default yields to a calculator
  figure, on or off; apply-to-design writes the calculator's own
  `summary.bin_rooms[].allow[id] = {on, m2}` shape. **Chutes** carry the
  calculator's whole configuration (`room.chute`: type, openings, receivers,
  FFH…) with `room.chuteDesign` as baseline; the editor offers exactly the
  calculator's set — `wsChuteTypes()` from `WS_CHUTE_SPECS`, and receivers per
  stream from `wsRecvOptsFor`, a **mirror** of the calculator's
  `RECV_BY_STREAM`/`recvOptsFor` (library `chute_receiver` records above
  *None*, compactor garbage-only) pinned by a test. `chutesOn` is derived,
  `chuteText` is generated from the configuration (`wmpgChuteText`) unless
  edited, and a compactor receiver makes `wmpgShape.compaction` and
  `chute_compactor` true so the compaction text switches on. Apply-to-design
  writes `summary.bin_rooms[].chute` keeping the calculator's FFH/slab/angle
  fields and re-pushes the summary to the calculator.
- **The cover is the PWC master, filled — never rebuilt in code.** At export
  the master's cover keeps its bands, art, colours and fonts; the code only
  (1) fills or removes the bracketed placeholders (`wmpgTplCoverPlaceholders`,
  pure — paragraph text is joined first, so a placeholder split across runs
  is still found; a paragraph left with only separators is emptied, keeping
  its mark so the band's spacing holds; **no `[…]` survives on the cover**,
  visible or hidden), (2) rewrites the literal heading with the editable
  title when the master has no `BM_DocTitle` bookmark, and (3) optionally
  drops a project image into the lower band. Page 2 is untouched. The date
  is DD/MM/YYYY throughout, matching the revision table.
- **Cover image + credit are WMP-local presentation** (`d.cover`: metadata,
  `source`, `received`, scrim) — no Design-tab source, no override convention.
  Bytes live in IndexedDB (`wmp:cover:<projectId>`), never in the project
  record. JPEG/PNG, 4 MB cap. **Two ways in, one path**: the file picker and
  Ctrl/Cmd+V anywhere in the open generator (`wmpgCoverPaste` claims a
  clipboard that carries a JPEG/PNG file and nothing else — text pastes into
  fields are untouched) both call `wmpgCoverAccept`, so validation, storage,
  the immediate preview and ✕ Remove are identical. The embedded picture is
  rendered band-shaped and cover-fit (`wmpgCoverFit`, pure — cropped and
  centred, never stretched) with a light bottom-weighted scrim baked in, on by
  default, so the white logo stays crisp. No image → the template is
  untouched: no frame, no placeholder picture.
- **The credit is composed, never typed as one string.** *Image source* +
  *Date received* (a date picker) print up the right edge as
  `Source: <source>, <DD/MM/YYYY>` via `wmpgCoverCreditText` (pure): built
  only from what is filled — no bare "Source:", no dangling comma, nothing
  at all without an image — and read by BOTH the preview and
  `wmpgTplCoverImage`, so they cannot differ. The brief free-text era is
  split once on draft upgrade (`wmpgCoverCreditParse`) and the old field
  dropped.
- **The photo is placed the way the Flinders St example places it** — read
  off the real master (`xxxPW_Address_WMP_Master.dotx`): the cover is one
  table of shaded cells (`003D3D` dark teal, `005F5F` title band, `4BED12`
  rule); the lower band is the cell whose paragraph carries the anchored
  ProWaste logo, in a row of **exact height 5954 twips**. `wmpgTplCoverBand`
  (pure) finds that paragraph (the logo is the second picture the cover
  references) and the photo goes into it as an **inline** picture, page-wide
  and row-high; the template's own anchored logo draws above inline content,
  so nothing about layers or page offsets is guessed. The credit replicates
  the example's `Text Box 2`: anchored to the same paragraph, `rot="16200000"`
  (reads bottom-to-top), 9pt white Segoe UI, `wrap="none"` so a substituted
  font can never fold it, its lower end ~15 mm above the band's bottom edge.
  `wmpgTplParagraphs` treats Word's self-closing `<w:p …/>` as whole
  paragraphs — the master's cover has nine — or every paragraph after the
  first would read as nested. An unrecognised template gets **no picture and
  a plain export note**, never a blind placement. **The title band's
  exact-height row can show the address line above the heading OR the
  `[Development Name] | [Street Address, Suburb]` line beneath the rule, not
  both** — the example shows the former with the latter clipped out of sight
  (the green rule is that empty paragraph's own border, so it cannot be
  dropped to make room). When the address line is printed, that line is
  emptied, never filled-and-hidden. Verified by filling the real master and
  rendering it with LibreOffice beside the example's own render.
- **The address line inherits the master's own run.** `BM_SiteAddress` sits
  inside the heading paragraph, so `wmpgTplCoverAddressRpr` (pure) reads that
  paragraph's run (Segoe UI, bold, white, sz 68) and rescales `sz`/`szCs` to
  80% (→ 54, 27pt against the 34pt heading). The hand-set rpr in
  `wmpgTplPayload` is only the fallback for a template with no run to read.
- **The preview cover is drawn from the master's numbers, not styled to look
  like it** (`WMPG_COVER_ROWS` in twips, `WMPG_COVER_LOGO` in EMU,
  `wmpgCoverGeom` + `wmpgCoverCss`, all pure). Bands are container-unit
  fractions of the page width, so the cover scales as one piece; colours are
  the master's four (`003D3D` bands, `005F5F` title band, `4BED12` rules,
  `B3D9D9` small print — no invented tints); the logo box is the drawing's
  own offsets (58% of the page width, centred, top at two-thirds of the
  band); the footer is the page's remainder because Word paints it to the
  edge. Two rows are **measured on the example's Word render** rather than
  copied — the auto-height PREPARED FOR / DATE row (≈750) and the title row,
  which Word lays out at ≈2820 from a 2600 exact row — and the comment says
  so. The cover's footer is `.cfoot`, not `.foot`: the document footer's
  global rule (38 px top margin, border) leaked in once. An over-long title
  clips at the bottom of the band (`safe center`), as Word's exact row does.
  Verified side by side with the example's own PDF at the same zoom; the only
  visible difference is Segoe UI vs the fallback face on machines without it.

- **The bin rows follow the bin calculator (2026-09-16).** Size, cadence and
  count in the generator come from the calculator's own three rules — the
  library is the list, the collection method constrains it, the council's
  kerbside service specialises it — not from a fixed size list. The
  calculator is a sandboxed srcdoc, so the platform carries **mirrors**
  (`wpBinLib`, `wpBinSizesFor`, `wpBinDefaultMethod`, `wpBinDefSize`,
  `wpBinDefCw`, `wpBinCycleFor`, `wpCouncilScheduleFor`, all pure, beside
  `wpKerbScheduleParse`) and `tests/bin-library.test.js` §5 runs each pair
  on the same fixtures — the arrangement `resTableLookup` /
  `wpResTableLookup` already has. `wmpgBinOffer(room, b)` is the one
  reading per row: the dropdown is grouped as the calculator groups it
  (council schedule or common sizes first, *More sizes* after, `(council)`
  on a council-supplied size), the council's cadence is named on its
  frequency option and is the default, kerbside *individual* counts
  dwellings and offers the number. **Editing stays free**: a size the rules
  do not offer is KEPT under its own heading and named on the row, never
  silently replaced; changing the method re-snaps size, cadence and count
  through `wmpgBinResnap` exactly as the calculator would, and the status
  line says what changed. Every room states where its sizes came from
  (`wmpgRoomOfferNote`), including "no kerbside service recorded for X" with
  where to add one. The library and services load before the form renders
  (`wpBinLibraryEnsure`); the push to the calculator and the generator read
  ONE mapping (`wpBinLibraryRows`), so they can never see different
  libraries. Not mirrored: the council stepped table — the calculator's
  schedule rows already carry its sizes, and a WMP re-size is a stated
  departure.

- **§1.1 scope drives the intro (2026-09-17).** `wmpgScopeFlags(d)` reads
  which §1.1 bullets are ticked ABOVE the "outside the scope" line — from the
  on-state alone, never through `tbCondMet`, which reads these flags and
  would recurse — and `wmpgPhaseWords` turns that into the `{phase}` token
  ("construction, demolition and operation" once C&D is in scope). Green
  Star in scope adds the `{green_star}` sentence and the conditioned seed
  snippet `INTRO_2` (`cond: greenstar`; `sql/2026-09-17-wmp-intro-scope.sql`
  puts it in the live library). `cnd` / `greenstar` are snippet conditions
  like any other (`TB_CONDS`). No library → the built-in scope (operational
  + C&D), and both built-in intros say the phases.
- **§1.5 always lists the council's own document.** `wmpgCouncilGuidelineLine`
  (the library version the checker uses, else a plain council reference) is
  appended after the text library's bullets unless one already names it
  (`wmpgGuidelineListed`, pure), in the preview and the .docx alike.
  `wmpgGuidelinesSync` keeps it in the author's §1.5 list as the council
  changes — the line this generator put there last time (`guidelinesCouncil`)
  is swapped for the current one, the author's own lines are never touched —
  and runs on draft upgrade so old drafts get it.
- **§1.2 site context can be generated** (`wmpgGenerateSiteContext`): the
  library's snippets are skeletons ("The surrounding land uses include xxx"),
  so ✨ writes the paragraph from the WMP's facts (`wmpgSiteContextFacts`) —
  address, council, development, previous use, collection street/point — and
  the locality's character is the one thing the model supplies from what it
  knows of the area. Same discipline as the polish: `wmpgContextGuard` (pure)
  refuses text that drops the address, brings in a number the facts do not
  contain, or uses bullets; a fact the model lacks is a `[bracketed
  placeholder]`. The result is marked *AI-generated — check the surrounding
  land uses* (`siteContextSrc`), the mark follows an edit (`edited`), and the
  .docx now applies the preview's rule — an author's or generated text beats
  the library skeleton (it used to print the skeleton regardless).
- **Text-library groups keep their open state** across the re-render a tick
  causes (`TB.open`, `tbGroupToggled`), and **a selection follows to its
  section**: `data-src` is space-separated, so the group tag travels as
  `tbSrcTag(g)` = `tb:1.1_Scope` — the old `tb:1.1 Scope` split into pieces
  and matched nothing.

- **Figure 1 (site location) is generated from PUBLIC state services — no
  key, no Google** (`WP_SITEFIG_PROVIDERS`, one record per state, NSW =
  Spatial Services; endpoints are data, not code). `wmpgSiteFigGenerate`:
  geocode (OpenStreetMap Nominatim, credited on the figure) → lot polygon
  from the state cadastre (point-in-lot, Web Mercator) → aerial or base map
  export for a frame padded per zoom and widened to the image aspect
  (`wpSiteFigFrame`, pure) → composed HERE on a canvas (`wmpgSiteFigCompose`:
  boundary, north arrow, scale bar in GROUND metres — `wpSiteFigScaleBar`
  applies cos(lat) — and attribution), so no third party's terms sit on the
  picture. Bytes in IndexedDB (`wmp:sitefig:<projectId>`) like the cover;
  `d.siteFigure` carries provider, lots, zoom, map type, access date. A
  development that spans lots gets the adjoining lots from an envelope
  query and a one-click add (`extraLots`) — the one human step. A state not
  wired up, an address the geocoder misses, or no lot under the point is
  STATED and nothing wrong is drawn (no lot → the figure without a boundary,
  flagged). Uploading a site plan is the other way in. The export places
  the picture at the master's own cyan "[Insert location map / aerial
  image here]" paragraph at the body text width and rewrites the "Source:
  …" line beneath the caption (`wmpgTplSiteFigure`, pure; no placeholder →
  not placed, export note). The live endpoints could not be reached from
  the build sandbox: the pipeline is verified against stubbed responses in
  the exact request/answer shapes; the first real run confirms the field
  names (`lotFields`) and CORS.

Not built: per-user overrides on top of the org preset baseline (add only on
demand), and access-path facts beyond the manual travel-path token and ramp
gradient.

## Site preparation & construction stages (C&D) — PWC staff only (2026-09-17)

NSW councils want a Resource & Waste Management Plan covering site
preparation, construction and occupancy; the app did occupancy only. Steps 1–3
of the brief are built (record + estimator + DOCX appendix; facilities and
council profiles server-side; the Central Coast fillable-PDF field map).
Stage layers and calibration follow. Rules, tested in `tests/cd-stages.test.js`:

- **One canonical StageRecord per stage** (`cdEmptyStage`: description,
  contractor, workers comp, asbestos, hazardous, facilities, declarations,
  `materials[]`, recycling, journeys, risks, site-plan checklist,
  `estimatedWith`, `calibration`) at `p.stages.site_prep` /
  `p.stages.construction` — **server-authoritative through `app_data.stages`**
  both ways. Occupancy stays in its own shape for now (decided 2026-09-17:
  the calculator, layout, Collection Point and generator all read it, and a
  migration bought no output). Everything sits behind `wmpgIsStaff()` inside
  the generator; no new routes.
- **The estimator is parametric and transparent.** Rates are a **versioned
  JSON seed** (`#cd-rates-seed`, `cdRates()`) — the brief's §5 priors, which
  reproduce the Terrigal fixture exactly — never constants in code, and the
  version stamps every estimate. `cdEstimateSitePrep` / `cdEstimateConstruction`
  (pure) return the Central Coast 20-row superset in its order: a stream at or
  above the 10 m³ threshold (or one the council always wants a figure for —
  residual, excavation) gets a rounded quantity, its split
  (`cdSplit` from the seed's split table; excavation keeps the retained
  fraction on site) and a `basis` string naming the rule; **every other
  listed material is the council's "under 10 m³" tick with no figure**, except
  *Other* — that is what the submitted form did. A pre-1990 building makes
  asbestos **TBC (survey)** and never a guessed volume. Diverted = reuse +
  separated + unseparated × the council's recovery factor (0.8), so 12 m³ of
  packaging counts 10, as submitted; `cdDiversionPct` is over quantified rows.
- **An override is never overwritten.** Rows carry `source` (`estimate` ·
  `override` · `contractor`); `cdApplyEstimate` moves estimate rows only and
  keeps the fresh estimate beside an override (`estimate`) for the ↺. A hand
  edit in the form tags the row `override` (`cdSetMaterial`). Contractor
  quotes and dockets go in `calibration`, apart from estimates — the dataset
  a later "fit rates from history" job reads.
- **Pre-fill is templates, not generation** (`cdPrefill`, pure): one journey
  per key stream group with the council's **nine** touchpoints (generation ·
  capture · consolidation · transfer · on-site reuse · transfer to
  collection · collection point · vehicle access · off-site — the rows the
  council's own form has), destinations picked from the facilities table
  (licence numbers null until verified against the EPA register — renderers
  print *EPL TBC*; a `tbc` facility is marked), a missing street is a
  `[street]` placeholder; risks from the Terrigal rows as templates. Council
  profile (`cdCouncilProfile`: target, recovery factor, tick rule,
  renderers) by council-name match, NSW default otherwise.
- **Facilities and council profiles are server-side** (`cd_facilities`,
  `cd_council_profiles`; `sql/2026-09-17-cd-facilities.sql` — GRANTs + RLS,
  every signed-in user reads, `profiles.is_staff` writes, seeded with the
  seven Terrigal facilities and two profiles). `cdLoadRemote` runs per
  generator open for staff; `cdRates()` merges the rows over the JSON seed
  and says which it used (`facilitiesSource`, stated in the section note —
  "built-in seed … run the SQL" until the tables exist). The **rates**
  themselves stay the versioned seed. `cdSaveFacility` upserts from the
  section's form and never takes a licence number — that is typed in only
  after the EPA register is checked, so nothing prints an unverified EPL.
- **One node list feeds both renderers.** `cdAppendixNodes` (pure) builds the
  appendix as doc-model nodes — general information, declarations, the
  materials table with a total row and the diversion sentence, recycling,
  the journey table, risks, the ticked site-plan items; the preview renders
  them and `cdNodesXml` turns them into the master's own styles
  (`ProWaste-Heading3`, `ProWaste-Table`, captions). `cdTplAppendixE` (pure)
  replaces the master's Appendix E body under its own "Construction and
  demolition waste" `ProWaste-Appendices` heading (matched with tags and
  spaces stripped — Word splits the words across runs) up to the next
  appendix heading or the section end; no heading → not placed, export note.
- **The Central Coast RWMP form is the council's own PDF, filled — never
  redrawn.** The field map is a JSON seed (`#cd-ccc-map`, `cdCccMap()`)
  decoded from the form's own geometry: Part A, the page-3 and page-9 grids
  (quantity · reuse · recycled separated · recycled unseparated · landfill ·
  diverted per material, the under-10 m³ tick, the % cell), three journey
  columns and risk rows per stage, the site-plan checklists, Part D
  (occupancy, from the WMP's own rooms and bins) and the page-19
  declarations. `tests/fixtures/ccc_rwmp_fields.json` is every field's
  page, name, type and rect (structure only — never the filled form, which
  is client work) and §5 proves each mapped name exists, sits on its row and
  is the right kind. `cdCccValues` (pure) builds `{ text, checks, radios,
  notes }` from the stage records and the draft — §6 reproduces the
  submitted Terrigal grid, ticks and percentages by the form's own field
  names; a fourth journey or an extra risk row is a **note**, never dropped
  silently. `cdCccFill` (pdf-lib, loaded on demand from cdnjs like jsPDF)
  writes them and returns every field the PDF lacks **by name** — an old or
  different form is reported, not half-filled. Radio option names are read
  from the PDF at fill time (`Choice1` on this form, `/0` or `Yes`
  elsewhere). The blank form comes from the `pwc-templates` bucket
  (`ccc_rwmp_form.pdf`) with a per-device IndexedDB cache behind the ⬆
  button; the fill button appears only for a council whose profile lists
  the `pdf` renderer. **`sharedFields`**: the council's form has one field
  (`C9`) serving both the page-1 "site preparation completed" box and the
  page-3 asbestos tick, so they can only ever agree — the grid's value
  wins, page 1 does not claim it, and the export says so. Not built yet:
  stage layers, calibration capture / fit-rates, the tonnage view
  (densities are in the seed).

## Council requirements list (C3, revised 2026-09-15)

The "Requirements review queue" is gone. Each council has ONE persistent,
always-editable **Requirements list**, and the list IS the live data — there
is no approved state to graduate into. In `council_requirements`,
`status = 'approved'` now means *in the list* (the anon/authenticated read
policy keys on it, so every consumer is unchanged) and `'proposed'` is
retired (`sql/2026-09-15-requirements-list.sql` promotes any old queue rows
and adds `source` = `extraction` | `manual`). **Removing a row deletes it**
(2026-09-16): it used to be parked as `'rejected'` "for audit", which nobody
read and every tool hid; `sql/2026-09-16-requirements-hard-delete.sql`
purges those and nothing writes the status any more. Rules, all tested in
`tests/council-pipeline.test.js`:

- **Extraction is append-only.** `crqExtract` only ever INSERTs rows pinned
  to the document version it read; it never updates or deletes an existing
  row — an earlier run's rows, an older version's rows and hand-typed rows
  all survive every re-run and every new upload. A row whose stream cannot be
  resolved joins the list with the stream blank and the wording noted, and
  the list flags it ("⚠ stream to set") — never guessed, never dropped.
- **Duplicates are flagged, never merged.** `crqDupFlags` (pure) marks the
  NEWER of two rows of the same type and stream as a possible duplicate when
  they share a figure (value + unit + use class), the same clause across
  document versions, or mostly the same wording. Two facts under one clause
  in the same document are not duplicates. Removal is always a human act.
- **Add / inline edit / remove need no approval.** `crqAdd` inserts a live
  `source: 'manual'` row pinned to the council's serving document (a council
  with no document cannot hold rows — the FK is the data model, and the
  panel says so); `crqSave` saves a field as it is left; `crqRemove` /
  `crqRemoveSelected` **delete** — one row, or every ticked row at once
  (a checkbox per row, select-all over the rows the filter shows, the
  selection scoped to the council) — through one path (`crqRemoveRows`)
  and one confirmation that says it is a delete and names the rows. Removal
  is still a human act; nothing is parked. Every row keeps a source: the
  clause, or where it came from.
- **Serving is automatic.** `crqSyncServe(councilKey, name)` projects the
  council's WHOLE list — every live row across every version, plus manual
  rows — onto the serving guideline version's `requirements` JSONB after
  every change (extract, add, edit, remove). No Serve button.
- **Extraction continues past the length cap.** A council rate table can
  run to 100+ rows, well past one reply's cap — a single pass silently lost
  everything after the cut. `crqExtract` now loops (at most six passes):
  each continuation is told which clause/use/stream combinations are already
  captured and returns only what is missing; rows repeated across passes are
  dropped by key, a pass that adds nothing ends the loop, and a failed
  continuation keeps what was read and says so.
- **The rate table is TRANSCRIBED, not summarised** (`crqRateSweep`). A
  general "extract the requirements" pass reads a 50-row table as *some*
  rates, and asking for structured JSON over that table made it worse: the
  model summarises. Asked to **copy** it, it copies. So the sweep is two
  independent reads — a verbatim pipe-delimited **transcription**
  (`CRQ_SWEEP_TRANSCRIBE`) parsed by our own code, and a short label
  **manifest** (`CRQ_SWEEP_LIST`) that acts only as the **verifier**.
  Anything the manifest saw and the transcription did not is re-asked **by
  name**, once, and then REPORTED BY NAME — never a blind "continue", never
  assumed read. A failed manifest leaves the transcription standing; only a
  failed transcription is a failed sweep. Sweep rows join the general pass's
  dedupe.
- **`crqRateLines` / `crqRateCell` are pure and are where the table's
  structure is decided** — so it can be tested against the real table
  instead of trusting a model's idea of the right JSON shape. They handle
  split garbage/recycling columns, a single **combined** figure (carried as
  `stream: null, combined: true` — never halved), indented sub-rows under a
  heading (`"Assembly Rooms — Social"`), a bare figure taking its row's unit
  (`Car parks | 0 | 0L/100m²/day`), a rate of **0** as a real figure, and an
  unusual unit copied verbatim (`L/seats/screening` — which has no formula
  in the commercial table, so the row is captured, listed and reported
  rather than forced onto a unit the council did not write).
- **Generation rates go straight into the rate tables.** A
  `generation_rate` row is a rate, not a clause to list: `crqExtract` hands
  them to `crqWriteRates`, which maps each onto a `res_rates` row (dwelling
  type via `crxResUnit`, L/week per dwelling — per day ×7, per fortnight ÷2)
  or a `com_rates` row (use matched to `com_uses` by label; the unit mapped
  onto the calculator's exact formula keys by `crqComBasis`, per m² → per
  100 m²) and INSERTs the ones the table does not already hold. **The unit's
  basis picks between use VARIANTS**: the uses list carries per-bed,
  per-m² and per-occupant versions of the same premises, so `crqUseBasis` +
  `CRQ_UNIT_BASIS` keep a per-100 m² rate off the per-bed row, and refuse
  with the mismatch named when no matching variant exists. A **combined**
  garbage-and-recycling figure is labelled as such and never split
  automatically — the split is a judgement call, typed into the report's own
  GW/REC boxes (`crqPlaceSplit`), which writes the garbage half onto the row
  and a `source: 'manual'` recycling sibling under the same clause. — never an
  upsert, so an existing rate is never overwritten. Anything that would need
  a guess (no dwelling type, an unknown use, a unit with no formula) is
  reported with the reason and typed in by hand — or resolved in the rates
  report itself, whose picker can also CREATE a commercial use
  (`crqUseCode` derives the code, the row is inserted into `com_uses` and
  appears at once in the commercial table's picker). **A premises is never
  relabelled onto a lookalike**: the wording is read for a use only when the
  row names no premises of its own (a *broad* class), and generic words that
  name a KIND of premises rather than one — "retail", "store", "goods",
  "house" (`CRQ_GENERIC_WORDS`) — never carry a match, because "Retail store
  (non-food)" seated on "General retail" is how one premises' figure lands
  under another's name. Two premises claiming one cell are BOTH named in the
  report (`out.clashes`) — first-wins is not silence. No list, no diff, no
  approve button: edit them in the tables, then ⬆ Publish to live. The
  clause still serves the checker's citations via `crqSyncServe`; the
  Requirements list never shows it (`CRQ_RATE_TYPES`, `crqIsRate`). Not
  built: version-to-version diffing.

### Two guardrails on rate extraction (2026-09-14)

Both are **refusals**, both are tested in `tests/council-pipeline.test.js`,
and neither is a UI preference to be traded away for convenience. They exist
because a wrong rate on an issued drawing reads as the council's own number.

**1 — A combined figure is never force-fit into GW/REC.** Where a guideline
states ONE figure covering garbage and recycling together (Northern Beaches
has seven: Automotive 3350, Camera shop 130, Domestic appliance 50, Domestic
hardware 40, Fabric 40, Florist 1170, Newsagent 80), that figure is neither a
garbage rate nor a recycling rate. `crqRateToTable` **refuses** it and never
divides, apportions or assigns it to one stream; the rates report **holds**
it in its own section (`crqIsCombined`, pure), shows the council's figure
verbatim, and says the rate tables have no combined type yet — a pending
schema decision, surfaced rather than worked around. Nothing is written for
a held row until that type lands. `crqPlaceSplit` survives only as an
explicit disclosure ("record a split myself") that requires both halves,
states on screen that the numbers are the user's and not the council's, and
records the split on the row as a human act (`source: 'manual'`, same
clause). Inventing a split deliberately would be worse than the accidental
80-instead-of-50 bleed that prompted these rules.

**2 — The use taxonomy never grows on its own.** Exactly ONE place in the
app inserts into `com_uses`: the rates report's "+ new use…" action inside
`crqPlaceFixed`, reached by opening the picker, choosing it, typing the name
and pressing Place. `crqWriteRates` only reads the uses list and `crqExtract`
never touches the table at all. A premises the table does not carry surfaces
as **not placed**, with the council's own use, stream and figure intact and
the create-a-use action on the row — visible and ready, waiting on a human
to decide what becomes an official use. Same manual-first rule as the
requirements list.

Not decided by these guardrails, and deliberately left open: how a
combined-rate type is structured in the data model and the calculator, and
the final shape of the not-placed review state.

Matching is by registry value first, then normalised council name —
`glBridgeNorm` (parent) and `councilKey` (calculator) must stay identical; a
test compares them.

**Downstream:** the results payload carries `method` and `cycle` per target —
the council's own week letter (`A`/`B`) when the row still runs on the council
cadence, else `W`/`F`/`M` from the frequency — and a `presentation` block
naming the cadence's source. The Collection Point:

- **Kerbside methods** → the kerb line. Scenarios come from the cycles
  (`wsCollectCyclesFromTargets` → `wsCollectSchedule(streams, saved, calc)`:
  panel edit → calculator → default pattern): weekly and monthly streams in
  every week, A/B alternating, OFF never — the busiest week is the design case,
  so the kerb shows the weekly bins plus the larger of the two alternating
  fortnights (plus monthly), never every stream at once.
- **Bulk collection point / private shared bin collection** → a drawn
  **Collection point area** (zone type `COLLECT`, drawn through the zone
  polygon tool from the tab's own button). `wsCollectBulk` packs **every**
  bulk-method bin, all streams at once — neither service alternates weeks —
  first-fit across the areas via `wsPackBins`; the verdict counts what does
  not fit. DXF: `A-COLLECT-BINS`.
- **The tab shows the calculator's bin set before anything is drawn.**
  `wsCollectCompute` returns null only when there is no kerb, no area *and*
  no schedule; with a schedule and nothing traced it lists the design-week
  bins per stream (`wsCollectBinSummary`, pure) and says which alternating
  week won and why, so the user traces the kerb knowing what must fit. A
  fresh calculator payload refreshes the open tab (`wsLayoutSetTargets`). Bin
  labels are the **scheduled size**; the footprint is the record's, and a
  borrowed footprint (a size whose record has no W×D, placed as the nearest
  sized record) is flagged with the fix, never relabelled. The DXF still
  carries kerb content only once a kerb or area exists.
- Bin types resolve against the **live** bin list
  (`wsCollectBins(targets, streams, types)`) — library ids used to miss the
  built-in lookup and silently empty the kerb.
- **Kerb and collection point bins are real placed bins.** Committing a
  kerb (Enter, double-click or the panel's ✓ Finish kerb) runs
  `wsCollectPlaceBins`; drawing a `COLLECT` zone runs
  `wsCollectPlaceAreaBins`. Both go through `wsCollectMaterialise`, which
  turns the pack (`wsCollectKerbBinPoses` / `wsCollectAreaBinPoses`, pure)
  into `slot.bins` entries tagged `kerb: <kerbId>` or `collectArea:
  <zoneId>` — from then on they select, drag, rotate and delete like any
  bin, print on the sheet and export to `A-KERB-BINS` / `A-COLLECT-BINS`.
  The engine never draws ghost bins on the canvas. Such a bin is
  **presentation, not storage** (`wsIsPresentationBin`):
  `wsLayoutPlacedCount`, `wsLayoutUntagged`, the status line, the targets
  fallback and `wsTagBinsToRooms` all leave it out — an area drawn inside
  the bin room must not double-count the schedule. Deleting a kerb deletes
  its bins (stated on the button); deleting the zone prunes its bins
  (`wsCollectPruneAreaBins` on every delete path); both undoable. Flipping
  the kerb side re-places; the panel's re-place buttons snap moved bins back
  to the pack. The kerb LINE (trace, committed line, blocked stretches)
  renders into `ws-layer-binroom`, so the Bin room layer toggle hides it. No
  verdict text on the drawing — only the "don't fit" mark when the busiest
  week overflows.

Not built (its own brief): equipment **categories** with distinct calculation
branches — balers, transpackers, organics processors. Today anything with a
compaction ratio is "compaction equipment", collectable or plant; see the
Equipment section.

## Layout: rooms, schedules and bins

Three things interact in the layout generator, and the link between them is
containment:

| Thing | Lives in | Means |
| --- | --- | --- |
| Bin-calculator room card | `WS_CALC_ROOMS` | what a room **requires** |
| Drawn polygon room | `slot.rooms` | where it **is** on the plan |
| Bin | `slot.bins` | what has been **placed** |

- Every drawn room has a stable `id` (`wsRoomNewId`). Legacy saves predate it, so
  `wsLayoutSlot()` calls `wsEnsureRoomIds()` on every access — that is the single
  choke point, don't scatter id assignment.
- A bin belongs to the drawn room whose polygon contains its **centre**
  (`bin.roomId`, set by `wsBinRoomId`). This is the same containment rule
  equipment already used for `calcRoom`, generalised to any polygon. Retag with
  `wsTagBinsToRooms()` after anything that moves a bin or changes an outline —
  a stale tag keeps counting toward a room the bin has left.
- `room.calcRoom` assigns a schedule; `room.streams` optionally narrows it to a
  subset so two drawn rooms can split one calculator card (residential vs
  commercial). `null`/`[]` both mean "the whole schedule" — never store a subset
  that happens to be complete.
- `wsRoomReconcile(roomId, targets, bins)` is the single source of truth for the
  chip, the pill and the status line. Green means every stream meets its
  requirement; surplus satisfies but is flagged `over`.

`wsRoomAtPt`, `wsBinRoomId`, `wsTagBinsToRooms`, `wsRoomTargets` and
`wsRoomReconcile` are **pure** — geometry and plain objects in, plain objects out,
no DOM and no globals. Keep them that way; they are what `tests/layout-rooms.test.js`
covers. Rendering and pill wiring sit on top and are not unit-tested.

Deleting a room removes the outline only — the bins inside stay on the plan and
are untagged. Never silently discard placed work.

### Editing rooms

Rooms are editable polygons. The pure operations (`wsRoomTranslate`,
`wsRoomMoveVertex`, `wsRoomInsertVertex`, `wsRoomDeleteVertex`, `wsRoomDragMove`)
keep `pts` and the derived `x1/y1/x2/y2` box in sync via `wsRoomSyncBBox` — older
code still reads the box, so never move points without resyncing.

- **Hit-test order is load-bearing.** A selected room's corner and edge-midpoint
  handles are grabbed *before* contents (same convention as the aisle end handles);
  the room *interior* is grabbed *last*, after bins, chutes, equipment and
  callouts. A room grab sets `WS.isPanning = false` like every other grab.
- A whole-room drag translates what is **tagged** to the room, not what currently
  falls inside it — a bin deliberately parked outside stays put.
- Any room edit retags on drag end (`wsTagBinsToRooms` for both bins and equip)
  and re-renders, so reconciliation needs no separate bookkeeping.
- A polygon never drops below three corners.

Chips are placed by `wsRoomChipAnchor` (outside the outline — above the top edge,
flipping below when the room is hard against the top of the sheet) and gated by
`wsRoomChipState`, which returns the CSS classes. **The class names and the CSS
must agree**: `.ws-chip.ok` collapses to a ✓ badge, `:hover`/`.sel` expands it,
and `#ws-overlay-svg.ws-hide-labels .ws-chip` hides the whole group with the
Labels layer. Room line style is *not* exported to DXF (the entity writer emits
layer and colour only, no linetype group code), so screen styling is free to
change — a test guards that assumption.

## Chutes and receivers

The chute-angle geometry mirrors the "Chute Angle" tab of `PW_WMP_Master.xlsm`
(Method 1): per level, `drop = (ffl_above − ffl) − termH×[terminate] −
slab×[not deflecting_above]`; the max horizontal transition is
`Σ drop×tan(θ)` over deflecting levels. Pure functions (`wsChuteLevelDrops`,
`wsChuteRmaxM`, `wsChuteOpeningGeom`) are covered by
`tests/chute-geometry.test.js`; the reference case is 3100 FFH / 300 slab /
1330 bin → drop 1.47 m, r_max 1.47 m @45°, 0.609 m @22.5°.

- **3100 / 300 / 150 / 22.5° are defaults, set in `normChute` only** — every
  value is per-room editable in the calc chute editor, and a room carrying a
  `levels_mm` array uses the full multi-level table instead of the two-level
  default. Angles: GW/ORG 45°; REC prefers 22.5°, may be raised to 45° as a
  stated worst case — past 22.5° every REC receiver is tagged in warnings.
- **Chute linework is royal blue `#4169E1`** (symbol, connectors, drag-only
  radius circles); red `#E06B4E` only past r_max, always with the breach
  named. Not a stream or zone colour. DXF: symbol + connectors on `CHUTE`
  (ACI 5), receivers on `E-CHUTE-RECV`.
- **Placement has three ways in, all through `wsChutePlaceFor`**: the calc
  toggle (`wsChuteSyncFromCalc`, runs on every calc payload — it never sweeps
  when the payload is empty), the room-card drop, and the card's by-hand
  button (`wsLayoutChuteMode`). A same-shape calc edit refreshes metadata but
  keeps dragged receiver positions.
- **Receivers are library records** (`equipment.category = 'chute_receiver'`,
  keys `LIB_<code>`), merged over the `RECV_SPECS`/`WS_RECV_SPECS` built-ins
  which stay as the offline fallback. Anything containing a compactor is
  garbage-only, enforced in `recvOptsFor` regardless of the record. A
  receiver-bundled compactor IS the room's compaction plant (record's own
  ratio, footprint counted once); index/carousel bin counts floor the
  collection-bin count because those bins exist physically.

## Equipment, compaction and reconciliation

A placed item references the equipment library **by id** (`equipmentId`) and carries
the stream it was assigned **at placement**. Both matter:

- **By id, never by name.** Name-keyed lookup was the workbook’s approach; a rename
  silently repointed a record. `wsEquipLibrary()` keys on id.
- **Assigned once, explicitly.** `wsEquipAssignStream()` resolves the user’s current
  stream against the record’s allowable set at placement time. It is never re-derived
  later, and `inferStreams()` is not consulted in this path. Library `streams[]` is
  picker metadata: **empty = unrestricted, populated = physically restricted**.

Two pairing kinds, and the difference is not cosmetic:

| | Means | Effect |
| --- | --- | --- |
| `densify` | same container, less volume in it | bin count drops, stream survives |
| `convert` | material leaves the stream in a new form | input volume removed, paired output emitted with its own footprint and collection line |

**The two invariants are refusals, not warnings.** A ratio that fires without its
counterpart silently destroys material on a compliance drawing:

- **A** — `convert` must resolve its paired output. If it cannot, the ratio does
  **not** apply and the reason is reported.
- **B** — a chute compactor must have a `receiver` allocated in the same room. Same
  rule: no receiver, no ratio, and say so.

Three deliberate refusals to guess, all tested:

- A ratio ≤ 1 is ignored, never applied — it would *inflate* a requirement.
- Missing bin capacity or frequency returns **null, not 0**. "No bins required" and
  "nobody filled this in" must not print the same.
- A target with no volume basis is **never compacted**; the row is flagged
  `needsVolume`. A count approximation double-rounds and would disagree with the
  calculator and the WMP.

`wsRoomReconcileLive()` is the single entry point. The room pill, the project
snapshot and the WMP generator all read it, so they cannot drift apart — three
callers each computing the number slightly differently is how a document ends up
disagreeing with its own drawing. The WMP links rooms by **calculator room id**
(`room.srcId` ↔ `room.calcRoom`), never by name.

Volumes reach the layout as **data only**. The panel shows counts; a test asserts no
volume key reaches the room view.

**Stream values must be resolved, never matched.** `equipment.streams` has been
written in three vocabularies over the life of the table: canonical ids (`paper`),
`WS_STREAMS` labels (`Paper/Card`), and the bin calculator’s display names
(`Paper & cardboard`, `General waste`, `Commingled recycling`). `wsStreamId()`
collapses all three onto the canonical id — case, punctuation and `&` vs `and` are
noise. A bare `indexOf` against the id list reads every calculator-vocabulary name
as "serves no stream", which is what silently made three live rows **unplaceable**:
they appeared in the picker and clicking the plan did nothing.

That is also why **a restriction nobody can read is not a restriction.** When every
stored value fails to resolve, the item falls back to *unrestricted* and the bad
values are reported by `wsEquipStreamIssues()` at placement time. Refusing on
unreadable metadata blocks real work over a data-entry error. This does not weaken
the invariant — populated **and readable** still restricts, and that is tested.

Legacy instances (no `equipmentId`) are mapped by code where one matches and
otherwise **preserved and flagged `legacy`** — guessing at the nearest record would
silently change what an old drawing says.

## Provision streams and zones

**Provision streams** are things a development must provide for but which have no
generation rate — you cannot compute litres of e-waste per dwelling per week. They
are therefore absent from the bin calculator by design (a test asserts no provision
id is ever a calculator stream) and reconcile as a **presence check**, never a count.
Custom ids are namespaced `custom:` so a future predefined stream can never be
shadowed. Assignment and management both live in the **room side panel** — never on
the canvas; a presence check is a checklist, not a drawing.

**Zones** are floor-area *claims*, not equipment records: no capacity, no compaction
ratio, never in a collection table. They are placeable from the Zones palette, share
the aisle end-handle drag (the claimed area is the point), and export to their own
DXF layer — stable per type, or derived from the label for a custom zone, truncated
on word boundaries.

A zone and an access aisle can **never** share a colour. One expression decides it.

## Sheet export

`wsExportPDF()` opens the export dialog; `wsSheetExport()` builds an A3 landscape
sheet — plan viewport above a title block strip.

**The stated scale must be physically true.** "1:200@A3" means 1 mm of paper is
exactly 200 mm on site. That only holds because the crop window is derived *from*
the scale (`wsSheetCropPx`), never the drawing fitted to the page. Do not add a
fit-to-page path; if the content does not fit, the sheet crops and the dialog
says so before export.

- `window.print()` is **not** viable for this. Paper size, margins and Chrome's
  default "fit to printable area" belong to the browser, which silently rescales.
  jsPDF places content at exact millimetres; svg2pdf converts the overlay to
  vector. Both load from CDN and are optional at run time — export reports a
  clear error rather than producing a wrong sheet.
- The plan underlay is a rendered PDF page, so it exports as high-DPI raster
  (re-rendered through pdf.js at export DPI, not upscaled from the screen canvas).
  Annotation is vector, with a raster fallback if svg2pdf chokes — the fallback is
  reported in the status line, never silent.
- Export renders **currently visible layers**. Hidden layer groups are removed
  from the overlay clone outright rather than relied upon to stay styled off.
- Editing chrome must never print: the selection is cleared and re-rendered before
  export and restored in a `finally`.
- `wsLegendItems` lists only styles that are both on a visible layer and actually
  present on the page — an unplaced stream gets no swatch.
- Default scale: the plan's own scale when the visible extent fits at it,
  otherwise the most detailed standard that does. 1:50 is not offered, so a plan
  set to it falls through to 1:100 — stating a coarser scale is always safe,
  stating a finer one never is.

**The base plan is screened back to 60% on export.** The sheet is an overlay on
someone else’s drawing, so the waste layout, markups and swept paths have to be
the figure and the architect’s linework the ground. `wsPlanScreenAlpha()` bounds
it to `[0.05, 1]` — never fully transparent, because a blank underlay would drop
the base plan with no error at all — and `null`/`''` fall back to the default
rather than to `Number(null) === 0`.

Two things about how it is applied:

- It is composited **against white**, inside `wsSheetRenderUnderlay()`. Alpha over
  a white ground lightens every tone toward paper, which is what "screened" means
  on a drawing. Alpha over whatever happens to be behind it would just make the
  plan translucent.
- It touches the **raster underlay only**. Annotation is the thing screening exists
  to make readable, so fading it too would be self-defeating. A test asserts the
  vector path never passes through that canvas.

Screen editing stays at full contrast — this is an export concern, not a view mode.

The DXF export is a separate path and is unaffected by any of this.

## Markups

Markup tools live in a floating collapsible card (`#ws-markup-panel`) below the
Layers card, both inside `#ws-side-stack`. They work from **any** tab, which is
why:

- `wsMarkSuspend()` parks the currently armed tool (`WS._mode` plus its
  in-progress state) and `wsMarkExit()` puts it back. Markup finish, callout
  finish and Escape all route through `wsMarkExit`, never `wsLayoutEndMode` —
  ending the mode outright is what discards the parked tool.
- The layout keydown handler bails on `!WS_LAYOUT.tabActive` *unless* the mode is
  `layoutmark`, so Enter/Escape still close a markup started from another tab.
- The pan guard keys off `#ws-side-stack`, so clicks on either card never pan.

## Ramp section mode

The swept tab's `⛰ Ramp section…` launcher opens `#ws-ramp-modal`: a longitudinal
grade-clearance check (scrape / ground-out at grade changes), separate from the
plan-view canvas. The engine is pure and lives at column 0 near `WS_VEH`
(`tests/ramp-section.test.js` covers it):

- **The model is the segment table** — `{grade %, len m horizontal run}` per
  segment, travel in +x. The uploaded section drawing is a tracing backdrop
  only (same contract as the admin shape tracer): calibrate with two points +
  a metre distance, trace the surface, and `wsRampSegsFromTrace` merges the
  near-collinear clicks into segments. Nothing from the image is stored;
  `slot.ramp` persists segments + vehicle + hand-entered heights.
- **Underside = three flat lines** (the brief's own parameters): front-overhang
  underside `gcf`, belly `gcm`, rear-overhang `gcr`, heights above ground on
  the flat, rigid perpendicular to the wheelbase chord. `wsRampScan` walks both
  wheel contacts along the profile (`wsRampPose` solves the chord = wheelbase)
  and measures clearance **vertically** — a negative number is mm of
  interference. On flat ground each feature reads exactly its entered height.
- **Heights come from the vehicle library** (`contractors.gc_front_m`,
  `gc_rear_m`, and the pre-existing `ground_clearance_m` for the belly). Null
  falls back to `WS_RAMP_SEC_DEFAULTS` per category and the result is flagged
  **assumed** everywhere it appears, snapshot included — a scrape verdict on a
  guessed sump height is not a verdict.
- **AS 2890.1 is a labelled light-vehicle REFERENCE, not the truck verdict.**
  `wsRampTransitionCheck` takes its rule as data (`WS_RAMP_RULES`); the
  clearance scan is the commercial-vehicle check (the AS 2890.2 template
  method). A vertex passes when the grade change is within the rule, so the
  standard's own remedy — a half-grade transition segment — passes naturally.
- A profile shorter than the wheelbase is reported (`short: true`), never
  padded with invented ground; overhang tips past the profile ends are judged
  against the end segment's grade extended.

## Manoeuvrability checks (layout tab)

The "Can it be wheeled?" panel animates a bin/equipment footprint along
user-clicked waypoints and checks every pose — travel, chute bin swap (two
runs + a swept-envelope conflict test), spin-in-place, and an automated
easy-to-reach peel. Engine is pure, column 0, next to the wsFp* SAT section
it builds on (`tests/manoeuvre.test.js`):

- **Two-tier turning model**: small MGBs (≤ 360L) pivot on the spot; 660L+
  and large equipment turn wide on an effective radius (fillet arcs, clamped
  and *flagged* when a corner is too sharp). Per-record override via
  `equipment.turn_type` / `turn_radius_mm`; everything else is a size-based
  default and the result says the behaviour is **assumed**.
- **Walls are door-trimmed segments** (`wsManWalls`): doorway spans are cut
  out of the room edges, so passing through a door is legal and brushing the
  jamb still counts. Aisles, zones and doors are walkable; fixtures, chutes,
  receivers and other bins are obstacles.
- **The operator zone is a separate verdict.** A person-width strip trails
  the bin; a route can fit the bin and still squeeze the pusher — that reads
  amber, never silently green.
- **Access peel** (`wsManAccess`): a bin is directly takeable when it can
  slide out along one of its own axes by its diagonal plus a hand's-width;
  peeling rounds give tiers. Tiers count *rounds of clearing*, not exact bins
  — the UI says so.
- **Friendly on the surface, numbers underneath.** Building managers and
  cleaners see this panel: canvas labels stay plain ("stuck here", "tight for
  the pusher"); mm values live under "Numbers for the report", the PNG
  snapshot and the DXF.
- **Export hygiene**: the overlay is editing chrome — `wsSheetOverlayClone`
  strips `#ws-man-overlay`, so a paused animation never prints. The DXF
  envelope (corner traces + endpoints on `A-WASTE-MAN`, ACI 6) is written
  ONLY while a check is live on screen — an issued DXF never grows silent
  extra content.

## Collection Point (kerbside presentation)

Its own tool tab (Layout → **Collection Point** → Swept Paths): does the kerb
frontage physically fit every bin on collection day? Engine is pure, column 0,
after the manoeuvrability engine (`tests/collection-point.test.js`):

- **The kerb is a traced polyline parameterised by arc length** (`slot.collect
  .kerbs`, each `kind: 'line'`). Obstructions project onto it as exclusion
  intervals (default width per street-furniture fixture + a working clearance
  each side — both flagged assumptions, both editable); sight-**splay** zones
  (a `WS_ZONE_TYPES` entry — drawn polygons, they scale with the frontage) cut
  the stretch they cover. Bins pack first-fit into the clear stretches,
  spilling across segments so corner lots split bins across frontages.
- **The design case is the busiest collection week**, never the sum of every
  stream: `wsCollectScenarios` resolves the cycle pattern (garbage weekly,
  recycling/FOGO alternating — the flagged default; every stream's cycle is
  editable, weekly/A/B/off, so odd councils are manual entry, and glass joins
  whichever week it lands in). Identical weeks collapse to "Every week".
- **The verdict is metres, not pass/fail**: required vs clear, shortfall
  stated; a frontage too short even when *empty* reads as a **site
  constraint**; enough total length in too-short stretches reads as
  **fragmented**. Plain words on screen, clause-grade numbers in the export.
- **One assembler (`wsCollectCompute`) feeds the panel, the canvas and the
  DXF** — they can never disagree. Kerb content is real placed drawing content
  (renders in the waste layer, prints on the sheet, exports to `A-KERB` /
  `A-KERB-EXCL` / `A-KERB-BINS` with a DESIGN CASE header naming the scenario
  and the metres) — unlike the manoeuvrability overlay, which is chrome.
- Street furniture (`POLE/TREE/XOVER/PIT/HYDRANT/SIGN`) lives in the shared
  `WS_FIXTURES` library with an `excl` default, usable on any canvas.
- Future **area mode**: holding bays and presentation areas pack a polygon,
  not a line — new kerb entries carry `kind` so they are never forced through
  the line logic.

## Swept-path refinement

`wsRefinePos` polishes **hand-driven** paths only. Cursor jitter shows up as steering
chatter *within* the vehicle limits, not as limit violations, so refinement resamples
the rear axle, low-passes it, and re-integrates through the bicycle model.

Four rules hold it together — none of them are optional:

1. **Planner output is never refined.** `wsShouldRefine(path)` returns `false` for
   `label: 'AUTO'` (Reeds-Shepp) and `'CAL'` (full-lock circle). Reeds-Shepp assumes
   *instantaneous* steering; a 6.0 s lock-to-lock truck needs 8.33 m of travel to go
   lock-to-lock, against arcs only a few metres long. Re-integrating a planner path
   under that limit moves the truck off a path it was already drawing perfectly.
2. **Gear segments chain.** Each segment re-integrates from the previous refined
   segment's *end pose*, not from its own raw start point. Starting from the raw point
   teleported the swept envelope by up to 8 m at every cusp.
3. **Smoothing is curvature-aware.** A Laplacian pass scales a circular arc by
   `cos²(Δθ/2)`, so low-passing a full-lock turn yields a reference tighter than the
   truck can hold. The repair pass caps each triple's sagitta at `h²/2·rMin`.
4. **Tracking is feedforward + bounded feedback.** The follower commands the
   reference's own curvature, plus cross-track and heading correction that settles over
   about one wheelbase. Pure pursuit alone has *zero* authority on a reference already
   at the curvature limit — it under-turns on the first sample, drifts inside the arc,
   and orbits until the iteration backstop.

Do not crank the feedback gains. The steer-rate limit is a lag in the loop, so a
tighter settle oscillates instead of converging — halving `SETTLE` takes worst-case
endpoint error from 15 px to 214 px. The stable plateau is roughly `WB × [0.8, 2.0]`.

The test corpora mirror this split: `drivenPath()` in `tests/helpers.js` generates
hand-driven input and carries the full contract (length, endpoint, continuity);
Reeds-Shepp paths are kept as a deliberately untrackable reference that must still
satisfy the safety invariants (bounded curvature, preserved gears, termination).

## Layout drawing conventions

- **Callouts have their own scale floor.** `wsCalloutF()` is `max(0.85, wsLblF())`
  — a note is unreadable long before a bin label is, and `wsLblF()` bottoms out at
  0.5. Both the renderer and the callout hit-test must use it, or the box and its
  clickable area disagree. The PDF export inherits it for free (same SVG).
- **Bin outlines are 1 px.** The shaded-outline colour logic (`wsShade`) is what
  separates adjacent same-stream bins, not stroke weight.
- **Zones vs aisles.** Hard waste zones (`wsIsHardWasteZone`) use the keep-clear
  hatch convention in **purple**; access aisles stay red. They must never share a
  colour — one is a storage allowance, the other is circulation that must stay
  empty. DXF puts them on separate layers (`A-WASTE-ZONE` / `A-WASTE-AISLES`).
- **Dimensions are rooms only.** `wsRoomDimEdges` letters each room edge in metres
  to one decimal, offset outside the polygon, angle normalised into (-90°, 90°] so
  nothing reads upside-down. Bins and equipment are dimensioned by the schedule.
- **Door symbols come from `wsDoorGeometry`**, in metres, and are shared by the
  screen renderer and the DXF writer so the linework can never drift. Arcs are
  chorded for DXF rather than emitting an LTYPE.
- **Handles are sized in screen pixels.** Anything grabbable — room corners, edge
  midpoints, aisle ends — converts through `wsCanvasPerScreen()`. A fixed
  canvas-pixel radius becomes a sub-pixel target at 53% zoom.
