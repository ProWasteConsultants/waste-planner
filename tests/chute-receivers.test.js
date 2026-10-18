'use strict';
// ── CHUTE RECEIVERS IN THE LAYOUT ─────────────────────────────────────────
// Receiver bins read like placed bins (solid stream fill), sit UNDER their
// chute, and turn on their own (o.rrot) — following the chute until turned.

const test = require('node:test');
const assert = require('node:assert');
const { SOURCE, extractBlock } = require('./extract.js');

test('wsRecvRot: follows the chute until the receiver is turned on its own', () => {
  const { wsRecvRot: R } = new Function(extractBlock(/^function wsRecvRot\(/).text + '\n;return { wsRecvRot };')();
  assert.equal(R({ rot: 90 }, {}), 90, 'no own angle: the chute\'s');
  assert.equal(R({ rot: 90 }, { rrot: 0 }), 0, 'an own angle of 0 is an angle, not "unset"');
  assert.equal(R({ rot: 90 }, { rrot: 45 }), 45);
  assert.equal(R({}, {}), 0);
  assert.equal(R({ rot: 30 }, { rrot: 'x' }), 30, 'garbage falls back to the chute');
});

test('every receiver consumer reads wsRecvRot — never the chute\'s angle', () => {
  const hit = extractBlock(/^function wsLayoutHitChute\(/).text;
  assert.match(hit, /const a = -wsRecvRot\(ch, o\) \* Math\.PI \/ 180;/);
  assert.match(extractBlock(/^function wsKeepoutFps\(/).text, /wsFpRect\(o\.rx, o\.ry, dm\.w \/ 2 \/ mpp, dm\.d \/ 2 \/ mpp, wsRecvRot\(ch, o\)\)/);
  assert.ok(SOURCE.includes("why: 'the chute bin position'") && SOURCE.includes('dm.d / 2 / mpp, wsRecvRot(ch, o)), why: \'the chute bin position\''), 'manoeuvre obstacles');
  assert.ok(SOURCE.includes("d += rect('E-CHUTE-RECV', 8, o.rx, o.ry, dm.w, dm.d, wsRecvRot(ch, o));"), 'DXF');
  assert.ok(!/rotate\(\$\{ch\.rot \|\| 0\} \$\{o\.rx\}/.test(SOURCE), 'no receiver drawn at the chute\'s rotation');
});

test('paint order: receivers, then the chute over them, then labels; bins drawn solid', () => {
  const i = SOURCE.indexOf('const grpR = mk(\'g\', {});');
  assert.ok(i > 0 && i < SOURCE.indexOf('const grp = mk(\'g\', {});', i) && SOURCE.indexOf('const grp = mk(\'g\', {});', i) < SOURCE.indexOf('const grpL = mk(\'g\', {});', i));
  const rb = SOURCE.slice(SOURCE.indexOf('const recvBin = '), SOURCE.indexOf('const recvPt = '));
  assert.match(rb, /fill: st\.col, stroke: wsShade\(st\.col\), 'stroke-width': 1/, 'the placed-bin fill and outline');
  assert.match(rb, /fill: wsInk\(st\.col\), opacity: 0\.25/, 'the lid band');
  assert.ok(SOURCE.includes('recvBin(grpR, o.rx, o.ry, dm.w, dm.d, rr, st);'), 'a single-bin receiver is a solid bin, under the chute');
  assert.ok(SOURCE.includes('recvBin(grpR, ci.x, ci.y, BIN.w, BIN.d, rr, st);'), 'index: its two bins');
  assert.ok(SOURCE.includes('recvBin(grpR, c4.x, c4.y, BIN.w, BIN.d, rr + q, st);'), 'carousel: its four bins');
});

test('R and the handle turn just the selected receiver; turning the chute carries receivers with it', () => {
  assert.match(SOURCE, /\} else if \(a === 'rotate' && WS_LAYOUT\.selKind === 'recv'\) \{[\s\S]{0,400}o\.rrot = \(Math\.floor\(\(wsRecvRot\(rc, o\) \+ 0\.01\) \/ 90\) \* 90 \+ 90\) % 360;/);
  assert.match(SOURCE, /\} else if \(dg\.kind === 'rotate' && dg\.targKind === 'recv'\) \{[\s\S]{0,600}o\.rrot = /);
  const rt = extractBlock(/^function wsRotTarget\(\)/).text;
  assert.match(rt, /kind: 'recv', op: WS_LAYOUT\.selOp/, 'a receiver has its own rotate handle');
  assert.ok(SOURCE.includes('if (r0.rrot != null) o.rrot = '), 'handle-turning the chute keeps a turned receiver\'s relative angle');
  assert.ok(SOURCE.includes('t.openings.forEach(o => { if (o.rrot != null) o.rrot = '), 'so does R on the chute');
});
