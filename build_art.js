/**
 * WastePlanner — application background artwork.
 *
 * Faint technical-drawing texture built from the same rear-lift vehicle profile
 * used by the swept path generator, so the backdrop and the product are drawn
 * from one source rather than being decorative art that drifts.
 *
 * Rendered once at build time, not per page load: `node build_art.js` writes
 * assets/wp-background.svg. Do not hand-edit the SVG — change this file and
 * regenerate (a test diffs the committed asset against this build, so drift
 * fails loudly).
 *
 * The vehicle module lives INLINED in index.html (single-file app, no build
 * step), so it is extracted from there rather than required from a second
 * copy on disk — a vehicle-profiles.js alongside this script would be the
 * exact silent-divergence this pipeline exists to prevent.
 *
 * One deliberate deviation from the original spec: the SVG's internal master
 * opacity defaults to 1, not .09. As a background-image the SVG is its own
 * document, so `--art-opacity` set on the page can never reach it — the
 * per-surface opacity (.09 projects / .10 profile / .05 queues) is applied by
 * the .app-backdrop element instead. The variable remains for inline embeds.
 */

const { loadEngine } = require('./tests/extract.js');
const { vehicleProfileSVG, VEHICLES } = loadEngine({ blocks: [
  ['VP_MODULE',         /^const VP_MODULE = \(\(\) => \{/],
  ['vehicleProfileSVG', /^const vehicleProfileSVG = VP_MODULE/],
  ['VEHICLES',          /^const VEHICLES = VP_MODULE/],
] });

const W = 1600, H = 900;

const r = (n) => Math.round(n * 10) / 10;

/** Faint construction grid. */
function grid(step = 48) {
  const out = [];
  for (let x = 0; x <= W; x += step) out.push(`<path d="M ${x} 0 V ${H}"/>`);
  for (let y = 0; y <= H; y += step) out.push(`<path d="M 0 ${y} H ${W}"/>`);
  return `<g class="grid">${out.join('')}</g>`;
}

/** Dimension line with end ticks and arrowheads. */
function dim(x1, y, x2, label) {
  const a = 7;
  return `<g class="dim">
    <path d="M ${x1} ${y - 14} V ${y + 14}"/>
    <path d="M ${x2} ${y - 14} V ${y + 14}"/>
    <path d="M ${x1} ${y} H ${x2}"/>
    <path d="M ${x1 + a} ${y - a * 0.6} L ${x1} ${y} L ${x1 + a} ${y + a * 0.6}"/>
    <path d="M ${x2 - a} ${y - a * 0.6} L ${x2} ${y} L ${x2 - a} ${y + a * 0.6}"/>
    <text x="${r((x1 + x2) / 2)}" y="${y - 10}" text-anchor="middle">${label}</text>
  </g>`;
}

/** Vertical dimension, label rotated. */
function vdim(x, y1, y2, label) {
  const a = 7;
  return `<g class="dim">
    <path d="M ${x - 14} ${y1} H ${x + 14}"/>
    <path d="M ${x - 14} ${y2} H ${x + 14}"/>
    <path d="M ${x} ${y1} V ${y2}"/>
    <path d="M ${x - a * 0.6} ${y1 + a} L ${x} ${y1} L ${x + a * 0.6} ${y1 + a}"/>
    <path d="M ${x - a * 0.6} ${y2 - a} L ${x} ${y2} L ${x + a * 0.6} ${y2 - a}"/>
    <text x="${x - 10}" y="${r((y1 + y2) / 2)}" text-anchor="middle"
          transform="rotate(-90 ${x - 10} ${r((y1 + y2) / 2)})">${label}</text>
  </g>`;
}

/** Swept path: two offset arcs with a dashed centreline between them. */
function sweptPath() {
  const cx = 620, cy = 1240;
  const arc = (rad, cls) => {
    const a0 = -166 * Math.PI / 180, a1 = -34 * Math.PI / 180;
    const pts = [];
    for (let k = 0; k <= 80; k++) {
      const a = a0 + (a1 - a0) * (k / 80);
      pts.push(`${r(cx + rad * Math.cos(a))} ${r(cy + rad * Math.sin(a))}`);
    }
    return `<path class="${cls}" d="M ${pts.join(' L ')}"/>`;
  };
  return `<g class="swept">
    ${arc(880, 'edge')}
    ${arc(770, 'centre')}
    ${arc(660, 'edge')}
  </g>`;
}

/** Bin rectangles, plan view, one rotated as if mid-placement. */
function bins() {
  const b = (x, y, w, h, rot = 0) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"${
      rot ? ` transform="rotate(${rot} ${r(x + w / 2)} ${r(y + h / 2)})"` : ''}/>`;
  return `<g class="bins">
    ${b(96, 726, 74, 58)}
    ${b(186, 726, 74, 58)}
    ${b(276, 726, 74, 58)}
    ${b(366, 726, 74, 58)}
    ${b(470, 720, 92, 70, -8)}
  </g>`;
}

/** Room corner: an L of wall, matching the mark's motif. */
function roomCorner() {
  return `<g class="room">
    <path d="M 60 640 V 812 H 620"/>
    <path d="M 74 654 V 798 H 606"/>
  </g>`;
}

// The vehicle, from the same module the swept path generator uses.
const truck = vehicleProfileSVG(VEHICLES.rear_lift, {
  detail: 'schematic',
  filled: false,
  strokeWidth: 70,
  showGround: false,
  padding: 100,
});
const truckInner = truck
  .replace(/^[\s\S]*?<g transform="scale\(1,-1\)">/, '')
  .replace(/<\/g>\s*<\/svg>\s*$/, '');
const truckViewBox = truck.match(/viewBox="([^"]+)"/)[1];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
     width="${W}" height="${H}" aria-hidden="true" focusable="false">
  <style>
    .art { opacity: var(--art-opacity, 1); }
    g, svg { fill: none; stroke: var(--art-stroke, #2DD4BF); }
    .grid  { stroke-width: 1;   opacity: .30; }
    .room  { stroke-width: 2;   opacity: .55; }
    .bins  { stroke-width: 2;   opacity: .60; }
    .dim   { stroke-width: 1.4; opacity: .70; }
    .dim text { stroke: none; fill: var(--art-stroke, #2DD4BF);
                font: 400 15px ui-sans-serif, system-ui, sans-serif; opacity: .85; }
    .swept .edge   { stroke-width: 2; opacity: .55; }
    .swept .centre { stroke-width: 2; opacity: .85; stroke-dasharray: 22 16;
                     stroke: var(--art-accent, #4BED12); }
    /* stripping the module's own stylesheet (see truckInner) also drops its
       strokeWidth — and this inherited value lands in the truck's MILLIMETRE
       viewport, so it must be the 70 passed to vehicleProfileSVG, not a
       pixel-ish 2.4 that renders sub-pixel and vanishes */
    .truck { stroke-width: 70; opacity: .95; }
  </style>

  <g class="art">
  ${grid()}
  ${sweptPath()}
  ${roomCorner()}
  ${bins()}

  <g class="truck">
    <svg viewBox="${truckViewBox}" x="700" y="318" width="800" height="322"
         preserveAspectRatio="xMidYMid meet" overflow="visible">
      <g transform="scale(1,-1)">${truckInner}</g>
    </svg>
  </g>

  ${dim(96, 838, 440, '4 × 1100L')}
  ${dim(700, 690, 1500, '9500')}
  ${vdim(662, 318, 640, '3400')}
  </g>
</svg>
`;

module.exports = { svg };

if (require.main === module) {
  require('fs').writeFileSync(require('path').join(__dirname, 'assets', 'wp-background.svg'), svg);
  console.log('written, viewBox', W, H);
}
