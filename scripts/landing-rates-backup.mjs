#!/usr/bin/env node
// ── Landing page offline backup, regenerated from waste_rates.json ──────────
// The free calculator on go.wasteplanner.au loads waste_rates.json from R2
// and falls back to the rates built into its own index.html when R2 is
// unreachable. This rewrites those built-in blocks — PROFILES,
// COUNCIL_PROFILES, COUNCILS_BY_STATE — from a published export, so the
// offline answer matches the online one. It writes a NEW file, ready to
// upload in Cloudflare (wasteplanner-landing → New deployment); it never
// deploys anything and never edits the input.
//
//   node scripts/landing-rates-backup.mjs --page <landing index.html>
//        [--rates waste_rates.json | --url <published file URL>]
//        [--out landing-build/index.html]
//
// Merge rule = the page's own runtime rule, so offline == online:
//   PROFILES[STATE]            published state replaces the built-in one
//   COUNCIL_PROFILES[key]      published key replaces the built-in one
//   COUNCILS_BY_STATE[STATE]   published councils added (labels updated);
//                              built-in-only councils are KEPT — removing a
//                              council is a decision for a person, not this
//                              script. Built-in-only entries are reported.
// The export is validated with the same rules publish-rates uses, every
// published commercial use must exist in the page's own COMM, and every
// <script> block of the output must still parse.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { validateRates, RATE_STATES } from '../supabase/functions/publish-rates/rates.mjs';

export const DEFAULT_URL = 'https://pub-889b5ab565ad46769be89dc35692374e.r2.dev/waste_rates.json';
const STAMP = '// Offline backup regenerated from waste_rates.json';

// The object literal assigned by `const NAME=` — exactly one, brace-matched
// past strings, template literals and comments. Throws on zero or several, so
// a renamed or duplicated constant fails loudly instead of half-rewriting.
export function findLiteral(src, name) {
  const re = new RegExp(`(^|[^\\w$.])const\\s+${name}\\s*=\\s*\\{`, 'gm');
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) throw new Error(`expected exactly one "const ${name}={" in the page, found ${hits.length}`);
  const open = hits[0].index + hits[0][0].length - 1;
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  if (depth !== 0) throw new Error(`unbalanced braces in const ${name}`);
  const declStart = hits[0].index + hits[0][1].length;
  return { declStart, start: open, end: i + 1, text: src.slice(open, i + 1) };
}
export const evalLiteral = text => vm.runInNewContext('(' + text + ')', {});

// Readable JS literal: short values inline, long ones one key per line.
export function jsLiteral(v, indent = '') {
  const key = k => /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
  const flat = x => {
    if (Array.isArray(x)) return '[' + x.map(flat).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).map(k => key(k) + ':' + flat(x[k])).join(',') + '}';
    return JSON.stringify(x);
  };
  const one = flat(v);
  if (one.length + indent.length <= 150 || !v || typeof v !== 'object') return one;
  const inner = indent + '  ';
  if (Array.isArray(v)) return '[\n' + v.map(x => inner + jsLiteral(x, inner)).join(',\n') + '\n' + indent + ']';
  return '{\n' + Object.keys(v).map(k => inner + key(k) + ':' + jsLiteral(v[k], inner)).join(',\n') + '\n' + indent + '}';
}

// Pure: page text + published export → { html, report }.
export function rebuildPage(page, rates) {
  const errors = validateRates(rates);
  if (errors.length) throw new Error('the export fails validation — not building a backup from it:\n  ' + errors.join('\n  '));
  const blocks = ['PROFILES', 'COUNCIL_PROFILES', 'COUNCILS_BY_STATE'].map(n => ({ name: n, ...findLiteral(page, n) }));
  const [P, CP, CB] = blocks.map(b => evalLiteral(b.text));
  const report = { version: rates.version, states: [], councilProfiles: { replaced: [], added: [], builtInOnly: [] },
    councils: { added: [], relabelled: [], builtInOnly: [] }, missingUses: [] };

  // the page's own commercial uses — a published use it has no row for would be dead data
  try {
    const comm = evalLiteral(findLiteral(page, 'COMM').text);
    const have = new Set(Object.keys(comm));
    const seen = new Set();
    [...Object.entries(rates.PROFILES), ...Object.entries(rates.COUNCIL_PROFILES)].forEach(([k, p]) =>
      Object.keys(p.comRates || {}).forEach(u => { if (!have.has(u) && !seen.has(u)) { seen.add(u); report.missingUses.push(`${u} (${k})`); } }));
  } catch (e) { report.missingUses.push('could not read the page\'s COMM: ' + e.message); }
  if (report.missingUses.length) throw new Error('the export has commercial uses this page does not list in COMM: ' + report.missingUses.join(', '));

  const profiles = { ...P };
  Object.entries(rates.PROFILES).forEach(([st, p]) => { profiles[st] = p; report.states.push(st); });
  const councilProfiles = { ...CP };
  Object.entries(rates.COUNCIL_PROFILES).forEach(([k, p]) => {
    (k in CP ? report.councilProfiles.replaced : report.councilProfiles.added).push(k);
    councilProfiles[k] = p;
  });
  report.councilProfiles.builtInOnly = Object.keys(CP).filter(k => !(k in rates.COUNCIL_PROFILES));
  const councils = {};
  [...new Set([...RATE_STATES, ...Object.keys(CB)])].forEach(st => { if (st in CB || rates.COUNCILS[st]) councils[st] = (CB[st] || []).map(c => ({ ...c })); });
  Object.entries(rates.COUNCILS).forEach(([st, list]) => {
    const local = councils[st] || (councils[st] = []);
    list.forEach(c => {
      const have = local.find(x => x.value === c.value);
      if (!have) { local.push({ value: c.value, label: c.label }); report.councils.added.push(`${st}|${c.value}`); }
      else if (have.label !== c.label) { have.label = c.label; report.councils.relabelled.push(`${st}|${c.value}`); }
    });
  });
  Object.entries(CB).forEach(([st, list]) => (list || []).forEach(c => {
    if (!((rates.COUNCILS[st] || []).some(x => x.value === c.value))) report.councils.builtInOnly.push(`${st}|${c.value}`);
  }));

  const values = { PROFILES: profiles, COUNCIL_PROFILES: councilProfiles, COUNCILS_BY_STATE: councils };
  // replace back to front so earlier offsets stay valid
  let html = page;
  [...blocks].sort((a, b) => b.start - a.start).forEach(b => {
    html = html.slice(0, b.start) + jsLiteral(values[b.name]) + html.slice(b.end);
  });
  // one provenance line above PROFILES, replacing the previous run's
  const at = findLiteral(html, 'PROFILES').declStart;
  const lineStart = html.lastIndexOf('\n', at - 1) + 1;
  const indent = html.slice(lineStart, at).match(/^\s*/)[0];
  const stampLine = `${indent}${STAMP} version ${rates.version} by scripts/landing-rates-backup.mjs — edit rates in WastePlanner, not here.\n`;
  const prevLineStart = html.lastIndexOf('\n', lineStart - 2) + 1;
  if (lineStart > 0 && html.slice(prevLineStart, lineStart).trim().startsWith(STAMP)) html = html.slice(0, prevLineStart) + stampLine + html.slice(lineStart);
  else html = html.slice(0, lineStart) + stampLine + html.slice(lineStart);

  // a syntax error kills every declaration in its block — refuse to write one
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc\s*=/.test(m[0].slice(0, m[0].indexOf('>'))) && !/type\s*=\s*["']?(application\/(ld\+)?json|text\/template)/i.test(m[0].slice(0, m[0].indexOf('>'))));
  scripts.forEach((m, i) => {
    try { new vm.Script(m[1]); } catch (e) { throw new Error(`<script> block ${i + 1} of the output does not parse: ${e.message}`); }
  });
  return { html, report };
}

function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const pagePath = arg('page');
  if (!pagePath) { console.error('usage: node scripts/landing-rates-backup.mjs --page <landing index.html> [--rates file.json | --url URL] [--out landing-build/index.html]'); process.exit(2); }
  const out = arg('out') || 'landing-build/index.html';
  let rates;
  if (arg('rates')) rates = JSON.parse(fs.readFileSync(arg('rates'), 'utf8'));
  else {
    const url = arg('url') || DEFAULT_URL;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`could not fetch ${url}: ${r.status}`);
    rates = await r.json();
  }
  const page = fs.readFileSync(pagePath, 'utf8');
  const { html, report } = rebuildPage(page, rates);
  if (path.resolve(out) === path.resolve(pagePath)) throw new Error('--out must not overwrite the input page');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  const r = report;
  console.log(`✓ Wrote ${out} — built-in rates now match waste_rates.json version ${r.version}`);
  console.log(`  state profiles replaced: ${r.states.join(', ') || 'none'}`);
  console.log(`  council profiles: ${r.councilProfiles.replaced.length} replaced, ${r.councilProfiles.added.length} added` +
    (r.councilProfiles.builtInOnly.length ? `; kept from the old backup (not in the export): ${r.councilProfiles.builtInOnly.join(', ')}` : ''));
  console.log(`  councils: ${r.councils.added.length} added, ${r.councils.relabelled.length} relabelled` +
    (r.councils.builtInOnly.length ? `; kept from the old backup (not in the export): ${r.councils.builtInOnly.join(', ')}` : ''));
  console.log('  Upload it in Cloudflare: Workers & Pages → wasteplanner-landing → New deployment.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
}
