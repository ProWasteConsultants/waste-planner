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
| 5 | **Swept-path title block panel** (vehicle diagram + spec table). | Issuing swept-path sheets as standalone drawings. | Swept linework already exports on a layout sheet; it just has no dedicated panel stating the design vehicle and its dimensions. |
| 6 | **Org-level custom equipment records.** The `equipment` table is one shared library. | Any **external organisation** placing equipment. | One firm's custom plant would appear in every other firm's picker and bin calculator. Needs org scoping on the table plus RLS, same shape as gate 1. |

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

**Bin types are a closed list by design.** There is no custom-bin path and none
is planned: a bin schedule is only defensible if every container maps to a real
collectable product. Custom *equipment* is gate 6; custom *bins* are a no.

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
| `tests/ai-extract.test.js` | AI plan-extraction prompt; commercial-use resolution and room seeding |
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
