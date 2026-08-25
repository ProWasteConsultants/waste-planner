'use strict';
// Package C — council guidelines pipeline.
//
// C1: guidelines are VERSIONED. A save is a new row; the old row is superseded,
// never overwritten or deleted. Consumers read the latest non-superseded
// version, and every check records which version it ran against. These are
// source-level guards (the flows are DOM + Supabase), plus a check that the
// migration file carries what the brief demands.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE } = require('./extract.js');

const MIG_C1 = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-08-25-package-c1-guideline-versioning.sql'), 'utf8');
const MIG_C2 = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-08-25-package-c2-guideline-storage.sql'), 'utf8');

// ── C1: migration ───────────────────────────────────────────────────────
test('C1 migration: lifecycle columns, version sequencing, grants', () => {
  for (const col of ['effective_date', 'superseded_at', 'source_url', 'uploaded_by', 'notes'])
    assert.ok(MIG_C1.includes(col), 'migration adds ' + col);
  assert.ok(MIG_C1.includes('rename column version to version_label'),
    'the old free-text version is preserved, not destroyed');
  assert.ok(MIG_C1.includes('add column version integer not null default 1'),
    'the new integer version is an upload sequence');
  assert.ok(MIG_C1.includes('council_guidelines (council_key, version)'),
    'council_key alone is no longer unique — (council_key, version) is');
  assert.ok(/grant select, insert, update, delete on public\.council_guidelines to anon, authenticated;/.test(MIG_C1),
    'RLS filters rows; GRANTs confer privileges — ship both, every time');
});

// ── C1: writes never overwrite, never delete ────────────────────────────
test('C1: a guideline save is a new version; the old row is superseded', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function cgInsertVersion'), SOURCE.indexOf('async function cgSave'));
  assert.ok(fn.includes("row.version = prior?.length ? (prior[0].version || 0) + 1 : 1;"),
    'version is sequenced per council');
  assert.ok(fn.includes(".update({ superseded_at: new Date().toISOString() })"),
    'the previous live row gets superseded_at');
  assert.ok(fn.includes(".neq('id', ins.id).is('superseded_at', null)"),
    'only the previously-live rows are superseded, never the new one');
  const save = SOURCE.slice(SOURCE.indexOf('async function cgSave'), SOURCE.indexOf('async function cgEdit'));
  assert.ok(!save.includes("upsert"), 'the overwrite-by-council_key upsert is gone');
});

test('C1: retiring a council supersedes — the delete path is gone', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function cgDelete'), SOURCE.indexOf('// ── ADMIN: guidelines → Rates DB bridge'));
  assert.ok(!fn.includes(".delete()"), 'no SQL delete: past checks keep a row to point at');
  assert.ok(fn.includes("superseded_at: new Date().toISOString()"), 'retire = supersede');
});

// ── C1: consumers read the latest non-superseded version ────────────────
test('C1: the WMP requirements check uses only live versions and pins the one it used', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function creqLoad'), SOURCE.indexOf('function creqEvaluate'));
  assert.ok(fn.includes(".is('superseded_at', null).order('version', { ascending: false })"),
    'latest non-superseded only');
  assert.ok(fn.includes('d.creqSource = hit ? { guidelineId: hit.id || null'),
    'the WMP snapshot records guideline id + version (persists via p.wmp)');
  assert.ok(fn.includes("version: hit.version ?? null"), 'version is pinned, not re-derived later');
});

test('C1: the compliance checker fetches live versions and stamps the scan', () => {
  assert.ok(SOURCE.includes('superseded_at=is.null&amp;order=version.desc'),
    'the iframe REST fetch filters superseded versions');
  assert.ok(SOURCE.includes('state.checkedAgainst = structuredGuidelines ? {'),
    'each AI check records which guideline version it ran against');
});

// ── C2: bulk upload ─────────────────────────────────────────────────────
test('C2: bulk upload — councils assigned by hand, versioned through one path', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('const CGB = '), SOURCE.indexOf('// C1: guidelines are VERSIONED'));
  assert.ok(fn.includes("if (!name) { r.status = 'assign a council'; return false; }"),
    'no council assigned, no upload — filenames are never auto-matched');
  assert.ok(fn.includes('await cgInsertVersion({'),
    'bulk uploads version through the same supersede path as single saves');
  assert.ok(fn.includes('requirements: [],     // structured rows come from extraction + review (C3)'),
    'no structured requirements are invented at upload time');
  assert.ok(fn.includes('guidelines/${key}/'),
    'files land under the guidelines/ prefix of the existing bucket');
  assert.ok(fn.includes('sequential on purpose'),
    'same-council files take sequential versions instead of racing max(version)');
});

test('C2 migration: storage policies for the guidelines prefix', () => {
  assert.ok(MIG_C2.includes("(storage.foldername(name))[1] = 'guidelines'"),
    'policies scope to the guidelines/ prefix only');
  assert.ok(MIG_C2.includes('p.is_staff = true'), 'writes are staff-gated');
  assert.ok(!/create policy.*for (update|delete)/i.test(MIG_C2),
    'no update/delete policy — guideline files are never overwritten or removed');
});
