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
const MIG_C3 = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-08-25-package-c3-council-requirements.sql'), 'utf8');

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

// ── C3: structured requirements + review queue ──────────────────────────
test('C3 migration: pipeline table with the agreed enum, clause_ref required, RLS split', () => {
  for (const t of ['generation_rate', 'room_dimension', 'aisle_width', 'chute_spec',
                   'collection_limit', 'equipment_rule', 'stream_split', 'other'])
    assert.ok(MIG_C3.includes(`'${t}'`), 'requirement_type includes ' + t);
  assert.ok(MIG_C3.includes('clause_ref text not null'),
    'every row is traceable to a clause — enforced by the schema, not convention');
  assert.ok(MIG_C3.includes("check (status in ('proposed','approved','rejected'))"));
  assert.ok(MIG_C3.includes("'garbage','recycling','fogo','glass','paper','soft'"),
    'streams are the canonical ids, checked in the schema');
  assert.ok(MIG_C3.includes("using (status = 'approved')"),
    'non-staff read approved rows ONLY — proposed is never consumed');
  assert.ok(MIG_C3.includes('grant select on public.council_requirements to anon'),
    'GRANTs ship with the table, every time');
});

test('C3: extraction drops untraceable rows and never invents streams', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqExtract'), SOURCE.indexOf('const CRQ_Q ='));
  assert.ok(fn.includes('if (!clause) { dropped++; return; }'),
    'a row with no clause reference is never inserted');
  assert.ok(fn.includes("status = 'rejected'; rejected++;"),
    'an unresolvable stream rejects the row rather than guessing');
  assert.ok(fn.includes('wsStreamId'),
    'synonyms resolve through the one canonical resolver');
  assert.ok(fn.includes('council_guideline_id: doc.id'),
    'every proposal is pinned to the exact guideline version');
  assert.ok(fn.includes(".is('superseded_at', null)"),
    'extraction targets the live document version');
});

test('C3: approval is the only path to machine-usable rows', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqDecide'), SOURCE.indexOf('// C1: guidelines are VERSIONED'));
  assert.ok(fn.includes("if (status === 'approved' && !edits.clause_ref)"),
    'approval without a clause reference is refused');
  assert.ok(fn.includes("reviewed_by: currentUser?.id || null, reviewed_at: new Date().toISOString()"),
    'decisions record who and when');
  assert.ok(fn.includes(".eq('status', 'proposed')"),
    'a decision only ever moves a PROPOSED row — no re-approving rejected rows by accident');
  const q = SOURCE.slice(SOURCE.indexOf('async function crqLoad'), SOURCE.indexOf('function crqRender'));
  assert.ok(q.includes(".eq('status', 'proposed')"), 'the queue lists proposed rows only');
});

test('C2 migration: storage policies for the guidelines prefix', () => {
  assert.ok(MIG_C2.includes("(storage.foldername(name))[1] = 'guidelines'"),
    'policies scope to the guidelines/ prefix only');
  assert.ok(MIG_C2.includes('p.is_staff = true'), 'writes are staff-gated');
  assert.ok(!/create policy.*for (update|delete)/i.test(MIG_C2),
    'no update/delete policy — guideline files are never overwritten or removed');
});
