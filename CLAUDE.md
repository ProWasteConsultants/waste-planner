# WastePlanner — working conventions

Waste management SaaS: Supabase backend, canvas-based bin-room layout and
Austroads swept-path tooling.

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
