// ── waste_rates.json: build, validate, diff ─────────────────────────────────
// ONE source of truth for generation rates: WastePlanner's res_rates /
// com_rates / councils tables. This module turns those rows into the file the
// free calculator on go.wasteplanner.au (and the prowaste.au embed), the
// in-app calculator and the WMP generator all read, and refuses a file any of
// them would misread. Pure — no network, no Deno, no DOM — so the edge
// function (publish-rates/index.ts), the landing-page backup script
// (scripts/landing-rates-backup.mjs) and tests/publish-rates.test.js all run
// the SAME code.
//
// The shape is fixed by the landing page and must not change without asking:
//   { version, PROFILES{STATE}, COUNCIL_PROFILES{"STATE|value"}, COUNCILS{STATE:[{value,label}]}, USES{code} }
// USES (2026-10-19, Lachy) carries {label, metric, defaultDays} for every
// commercial use a published rate names, so a calculator builds its use list
// from the file rather than from its own copy. A council profile with
// `comList: "own"` publishes its COMPLETE commercial list: a reader uses that
// council's comRates in place of the state's, never merged over them.

export const RATE_STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];
export const RATE_STREAMS = ['GW', 'REC', 'ORG', 'GLS', 'CARD', 'SOFT'];
// The residential streams a state profile's `streams` list is drawn from.
// CARD / SOFT are never base columns: the calculator adds them when a room
// separates something into them.
export const RES_BASE_STREAMS = ['GW', 'REC', 'ORG', 'GLS'];
export const RES_KEYS = ['townhouse', 'apt_1br', 'apt_2br', 'apt_3br'];
// Units weeklyL() has a formula for. L/Week/100m2 is not in the brief's list,
// but the calculator's own built-in profiles use it (childcare) and weeklyL's
// generic l/week branch computes it correctly (m² × rate / 100) — refusing it
// would block every publish that carries a childcare rate.
export const COM_UNITS = ['L/Day/100m2', 'L/Week/100m2', 'L/Bed/Day', 'L/Bed/Week', 'L/Apartment/Week',
  'L/Student/Week', 'L/Occupant/Week', 'L/Cat/Week', 'L/Week'];
// The calculator's built-in COMM table — label, input measure and default
// days per use. Pinned to COMM in index.html by a test. A use outside it is a
// com_uses row typed in (or extracted) in WastePlanner: it publishes with its
// own label / measure / days under USES, so every calculator that reads the
// file offers it without a code change.
export const COMM_META = {
  backpackers: { label: "Backpackers accommodation (per bed)", metric: "Beds (no.)", defaultDays: 7 },
  backpackers_sydney: { label: "Backpackers accommodation (per m²)", metric: "m² (NLA)", defaultDays: 7 },
  bakery: { label: "Bakery", metric: "m² (NLA)", defaultDays: 7 },
  banks: { label: "Banks", metric: "m² (NLA)", defaultDays: 5 },
  bar_club_function: { label: "Bar / club / function venue", metric: "m² (NLA)", defaultDays: 7 },
  boarding_house: { label: "Boarding house / guest house (per occupant)", metric: "Occupants (no.)", defaultDays: 7 },
  boarding_house_sydney: { label: "Boarding house / guest house (per m²)", metric: "m² (NLA)", defaultDays: 7 },
  bulky_goods: { label: "Bulky goods / department store", metric: "m² (NLA)", defaultDays: 7 },
  butcher: { label: "Butcher", metric: "m² (NLA)", defaultDays: 7 },
  cafe: { label: "Cafe", metric: "m² (NLA)", defaultDays: 7 },
  cattery: { label: "Cattery", metric: "Cats (no.)", defaultDays: 7 },
  childcare: { label: "Childcare", metric: "m² (NLA)", defaultDays: 5 },
  community_library: { label: "Community / library", metric: "m² (NLA)", defaultDays: 5 },
  convention_centre: { label: "Convention / conference centre", metric: "m² (NLA)", defaultDays: 5 },
  convenience_store: { label: "Convenience store", metric: "m² (NLA)", defaultDays: 7 },
  delicatessen: { label: "Delicatessen", metric: "m² (NLA)", defaultDays: 7 },
  education_area: { label: "Education / training (per m²)", metric: "m² teaching area", defaultDays: 5 },
  education_students: { label: "Education / training (per student)", metric: "Students (no.)", defaultDays: 5 },
  entertainment_venue: { label: "Entertainment venue", metric: "m² (NLA)", defaultDays: 7 },
  factories: { label: "Factories", metric: "m² (NLA)", defaultDays: 5 },
  fish_shop: { label: "Fish shop", metric: "m² (NLA)", defaultDays: 7 },
  florist: { label: "Florist / plant shop", metric: "m² (NLA)", defaultDays: 7 },
  function_room: { label: "Function room", metric: "m² (NLA)", defaultDays: 7 },
  garden_courtyards: { label: "Garden areas / courtyards", metric: "m² (NLA)", defaultDays: 7 },
  general_retail_large: { label: "General retail (large >100m²)", metric: "m² (NLA)", defaultDays: 7 },
  retail_nonfood: { label: "General retail (non-food)", metric: "m² (NLA)", defaultDays: 7 },
  general_retail_small: { label: "General retail (small ≤100m²)", metric: "m² (NLA)", defaultDays: 7 },
  greengrocer: { label: "Greengrocer", metric: "m² (NLA)", defaultDays: 7 },
  gym: { label: "Gym", metric: "m² (NLA)", defaultDays: 7 },
  hairdresser: { label: "Hairdresser / salon", metric: "m² (NLA)", defaultDays: 7 },
  hotel_beds: { label: "Hotel / motel (by bed count)", metric: "Beds (no.)", defaultDays: 7 },
  hotel_area: { label: "Hotel / motel (by floor area)", metric: "m² (NLA)", defaultDays: 7 },
  independent_living: { label: "Independent living", metric: "Apartments (no.)", defaultDays: 7 },
  kitchen_dining: { label: "Kitchen / dining", metric: "m² (NLA)", defaultDays: 7 },
  licensed_club: { label: "Licensed club", metric: "m² (NLA)", defaultDays: 7 },
  office: { label: "Office", metric: "m² (NLA)", defaultDays: 5 },
  restaurant: { label: "Restaurant", metric: "m² (NLA)", defaultDays: 7 },
  retirement_village: { label: "Retirement village", metric: "Apartments (no.)", defaultDays: 7 },
  serviced_apartments: { label: "Serviced apartments (per apartment)", metric: "Apartments (no.)", defaultDays: 7 },
  serviced_apartments_sydney: { label: "Serviced apartments (per m²)", metric: "m² (NLA)", defaultDays: 7 },
  show_room: { label: "Showroom", metric: "m² (NLA)", defaultDays: 7 },
  specialised_grocery: { label: "Specialised grocery", metric: "m² (NLA)", defaultDays: 7 },
  student_accommodation: { label: "Student accommodation", metric: "Occupants (no.)", defaultDays: 7 },
  supermarket: { label: "Supermarket", metric: "m² (NLA)", defaultDays: 7 },
  takeaway: { label: "Takeaway", metric: "m² (NLA)", defaultDays: 7 },
  warehouse: { label: "Warehouse", metric: "m² (NLA)", defaultDays: 5 },
};
export const COMM_KEYS = Object.keys(COMM_META);
// The input measure a use is counted in, read from a rate's unit — the
// fallback for a typed-in use whose com_uses row carries no metric.
export function metricForUnit(unit) {
  const u = String(unit || '');
  if (/100m2/.test(u)) return 'm² (NLA)';
  if (/Bed/.test(u)) return 'Beds (no.)';
  if (/Occupant/.test(u)) return 'Occupants (no.)';
  if (/Apartment/.test(u)) return 'Apartments (no.)';
  if (/Student/.test(u)) return 'Students (no.)';
  if (/Cat/.test(u)) return 'Cats (no.)';
  return 'Units (no.)';
}
export const USE_CODE_RE = /^[a-z0-9_]+$/;
// com_uses.use_code → COMM key, where WastePlanner's code differs from the
// calculator's. Empty while they agree; add a pair here rather than renaming
// either side (a council's published rate is keyed by it).
export const USE_ALIASES = {};
export const COUNCIL_VALUE_RE = /^[a-z0-9_-]+$/;
export const COUNCIL_KEY_RE = /^([A-Z]{2,3})\|([a-z0-9_-]+)$/;

// A missing figure stays missing (null) so validation names it — Number(null)
// is 0, and "nobody filled this in" must not publish as "no waste".
function fig(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
const sortObj = (o, order) => {
  const keys = Object.keys(o).sort((a, b) => {
    const ia = order ? order.indexOf(a) : -1, ib = order ? order.indexOf(b) : -1;
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const out = {};
  keys.forEach(k => { out[k] = o[k]; });
  return out;
};

// Rows → file. `councils` are councils-table rows ({state,value,label,
// published}); only `published === true` ones are listed, and rates under any
// other council are left out and reported. Never throws on bad data: what
// cannot be placed goes in `skipped` with the reason, and what is placed but
// wrong is left for validateRates to name.
export function buildRates({ councils = [], resRates = [], comRates = [], uses = [], version } = {}) {
  const skipped = [];
  const PROFILES = {}, COUNCIL_PROFILES = {}, COUNCILS = {}, USES = {};
  const listed = new Map();   // "STATE|value" → label
  const drafts = new Map();
  const own = new Set();      // councils whose commercial list replaces the state's
  const useRows = new Map();
  uses.forEach(u => { if (u && u.use_code) useRows.set(String(u.use_code), u); });
  councils.forEach(c => {
    const st = String(c.state || '').trim().toUpperCase();
    const value = String(c.value || '').trim();
    const key = st + '|' + value;
    if (c.published !== true) { drafts.set(key, c.label || value); return; }
    listed.set(key, String(c.label || '').trim());
    if (c.com_own === true) own.add(key);
    (COUNCILS[st] || (COUNCILS[st] = [])).push({ value, label: String(c.label || '').trim() });
  });
  Object.values(COUNCILS).forEach(list => list.sort((a, b) => a.label.localeCompare(b.label)));

  // where a row lands: the state profile, a listed council's profile, or nowhere
  const target = (r, what) => {
    const st = String(r.state || '').trim().toUpperCase();
    const cv = r.council_value == null || r.council_value === '' ? null : String(r.council_value).trim();
    if (!cv) return PROFILES[st] || (PROFILES[st] = { streams: [], resRates: {}, comRates: {} });
    const key = st + '|' + cv;
    if (!listed.has(key)) {
      skipped.push({ key, what, reason: drafts.has(key)
        ? `council "${drafts.get(key)}" is not published (draft) — its rates stay out of the public file`
        : 'no council with this value in the councils table' });
      return null;
    }
    return COUNCIL_PROFILES[key] || (COUNCIL_PROFILES[key] = {});
  };

  resRates.forEach(r => {
    const what = `residential ${r.unit_type} · ${r.stream}`;
    if (!RES_KEYS.includes(r.unit_type)) { skipped.push({ key: r.state + '|' + (r.council_value || ''), what, reason: 'unit type the calculator has no row for' }); return; }
    const t = target(r, what); if (!t) return;
    const rr = t.resRates || (t.resRates = {});
    (rr[r.unit_type] || (rr[r.unit_type] = {}))[r.stream] = fig(r.l_per_week);
  });
  comRates.forEach(r => {
    const use = USE_ALIASES[r.use_code] || r.use_code;
    const what = `commercial ${r.use_code} · ${r.stream}`;
    const row = useRows.get(r.use_code) || useRows.get(use) || null;
    if (!COMM_KEYS.includes(use) && !row) {
      skipped.push({ key: r.state + '|' + (r.council_value || ''), what, reason: 'use has no row in com_uses and the calculator has no row for it (add a USE_ALIASES pair in publish-rates/rates.mjs if it is one under another code)' });
      return;
    }
    const t = target(r, what); if (!t) return;
    const cr = t.comRates || (t.comRates = {});
    (cr[use] || (cr[use] = {}))[r.stream] = { rate: fig(r.rate), unitValue: fig(r.unit_value), unit: r.unit == null ? '' : String(r.unit) };
    if (!USES[use]) {
      const base = COMM_META[use] || {};
      const days = Math.round(Number(row && row.default_days));
      USES[use] = {
        label: String((row && row.label) || base.label || use).trim(),
        metric: String((row && row.metric) || base.metric || metricForUnit(r.unit)).trim(),
        defaultDays: days >= 1 && days <= 7 ? days : (base.defaultDays || 7),
      };
    }
  });
  Object.keys(COUNCIL_PROFILES).forEach(key => {
    const p = COUNCIL_PROFILES[key];
    if (own.has(key) && p.comRates && Object.keys(p.comRates).length) p.comList = 'own';
  });

  // `streams`: the residential streams the state actually rates. GW and REC
  // always; ORG / GLS once any state figure for them is above zero. A council
  // whose own figures bring in a stream the state lacks lists the union
  // (deepMerge replaces arrays, so the council's list must be complete).
  const rated = p => {
    const s = new Set();
    Object.values(p.resRates || {}).forEach(u => Object.entries(u || {}).forEach(([k, v]) => { if (v > 0) s.add(k); }));
    Object.values(p.comRates || {}).forEach(u => Object.entries(u || {}).forEach(([k, v]) => { if (v && v.rate > 0) s.add(k); }));
    return s;
  };
  Object.keys(PROFILES).forEach(st => {
    const p = PROFILES[st], s = rated(p);
    p.streams = RES_BASE_STREAMS.filter(x => x === 'GW' || x === 'REC' || s.has(x));
  });
  Object.keys(COUNCIL_PROFILES).forEach(key => {
    const st = key.split('|')[0], p = COUNCIL_PROFILES[key], s = rated(p);
    const base = (PROFILES[st] && PROFILES[st].streams) || null;
    if (!base) return;   // no published state profile: the page's built-in one stands
    const extra = RES_BASE_STREAMS.filter(x => s.has(x) && !base.includes(x));
    if (extra.length) p.streams = RES_BASE_STREAMS.filter(x => base.includes(x) || extra.includes(x));
  });

  // deterministic output: a republish of unchanged data is byte-identical
  const tidyProfile = p => {
    const out = {};
    if (p.streams) out.streams = p.streams;
    if (p.resRates) out.resRates = sortObj(Object.fromEntries(Object.entries(p.resRates).map(([k, v]) => [k, sortObj(v, RATE_STREAMS)])), RES_KEYS);
    if (p.comRates) out.comRates = sortObj(Object.fromEntries(Object.entries(p.comRates).map(([k, v]) => [k, sortObj(v, RATE_STREAMS)])));
    if (p.comList) out.comList = p.comList;
    return out;
  };
  const json = {
    version: version || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    PROFILES: sortObj(Object.fromEntries(Object.entries(PROFILES).map(([k, v]) => [k, tidyProfile(v)])), RATE_STATES),
    COUNCIL_PROFILES: sortObj(Object.fromEntries(Object.entries(COUNCIL_PROFILES).map(([k, v]) => [k, tidyProfile(v)]))),
    COUNCILS: sortObj(COUNCILS, RATE_STATES),
    USES: sortObj(USES),
  };
  return { json, skipped };
}

// File → list of errors (empty = publishable). Every message names the
// state, council, use and stream so whoever reads it can find the cell.
export function validateRates(json) {
  const errs = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ['the file is not a JSON object'];
  // USES is optional so a file published before it existed still validates
  const keys = Object.keys(json).filter(k => k !== 'USES').sort().join(',');
  if (keys !== 'COUNCILS,COUNCIL_PROFILES,PROFILES,version') errs.push(`top-level keys must be exactly version, PROFILES, COUNCIL_PROFILES, COUNCILS (+ USES) (found ${Object.keys(json).join(', ') || 'none'})`);
  if (typeof json.version !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(json.version) || isNaN(Date.parse(json.version))) errs.push('version must be an ISO timestamp');
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
  const num = (where, v, { positive = false } = {}) => {
    if (v === null || v === undefined) errs.push(`${where}: no figure (blank)`);
    else if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${where}: ${JSON.stringify(v)} is not a number`);
    else if (positive ? v <= 0 : v < 0) errs.push(`${where}: ${v} must be ${positive ? 'greater than 0' : '0 or more'}`);
  };
  const streamsOk = (where, list) => {
    if (!Array.isArray(list) || !list.length) { errs.push(`${where}: streams list is missing or empty`); return; }
    list.forEach(s => { if (!RATE_STREAMS.includes(s)) errs.push(`${where}: unknown stream "${s}" in streams`); });
    if (new Set(list).size !== list.length) errs.push(`${where}: streams list repeats a stream`);
  };
  const resOk = (where, rr, full) => {
    if (!isObj(rr)) { if (full) errs.push(`${where}: residential rates missing`); return; }
    if (full) RES_KEYS.forEach(k => { if (!isObj(rr[k])) errs.push(`${where}: residential "${k}" missing — enter the state's residential rates in Admin (0 where the state publishes none) and save`); });
    Object.entries(rr).forEach(([k, u]) => {
      if (!RES_KEYS.includes(k)) { errs.push(`${where}: unknown residential type "${k}"`); return; }
      if (!isObj(u)) { errs.push(`${where} · ${k}: not an object`); return; }
      Object.entries(u).forEach(([s, v]) => {
        if (!RATE_STREAMS.includes(s)) errs.push(`${where} · ${k}: unknown stream "${s}"`);
        num(`${where} · ${k} · ${s}`, v);
      });
    });
  };
  const U = json.USES;
  if (U !== undefined) {
    if (!isObj(U)) errs.push('USES: not an object');
    else Object.entries(U).forEach(([code, u]) => {
      const w = `USES · ${code}`;
      if (!USE_CODE_RE.test(code)) errs.push(`${w}: code must be lower-case letters, digits or _`);
      if (!isObj(u)) { errs.push(`${w}: not an object`); return; }
      if (typeof u.label !== 'string' || !u.label.trim()) errs.push(`${w}: label is blank`);
      if (typeof u.metric !== 'string' || !u.metric.trim()) errs.push(`${w}: input measure (metric) is blank`);
      if (!Number.isInteger(u.defaultDays) || u.defaultDays < 1 || u.defaultDays > 7) errs.push(`${w}: defaultDays ${JSON.stringify(u.defaultDays)} must be a whole number 1–7`);
    });
  }
  const knownUse = use => COMM_KEYS.includes(use) || (isObj(U) && isObj(U[use]));
  const comOk = (where, cr) => {
    if (cr === undefined) return;
    if (!isObj(cr)) { errs.push(`${where}: commercial rates not an object`); return; }
    Object.entries(cr).forEach(([use, u]) => {
      const w = `${where} · commercial ${use}`;
      if (!knownUse(use)) errs.push(`${w}: not a use the calculator knows, and USES does not describe it`);
      if (!isObj(u)) { errs.push(`${w}: not an object`); return; }
      Object.entries(u).forEach(([s, ro]) => {
        if (!RATE_STREAMS.includes(s)) errs.push(`${w}: unknown stream "${s}"`);
        if (!isObj(ro)) { errs.push(`${w} · ${s}: not a rate object`); return; }
        num(`${w} · ${s} · rate`, ro.rate);
        num(`${w} · ${s} · unitValue`, ro.unitValue, { positive: true });
        if (!COM_UNITS.includes(ro.unit)) errs.push(`${w} · ${s}: unit "${ro.unit}" is not one the calculator understands (allowed: ${COM_UNITS.join(', ')})`);
      });
    });
  };

  const P = json.PROFILES, CP = json.COUNCIL_PROFILES, C = json.COUNCILS;
  if (!isObj(P)) errs.push('PROFILES missing');
  else Object.entries(P).forEach(([st, p]) => {
    if (!RATE_STATES.includes(st)) errs.push(`PROFILES: unknown state "${st}"`);
    if (!isObj(p)) { errs.push(`${st}: profile not an object`); return; }
    streamsOk(st, p.streams);
    resOk(st, p.resRates, true);
    comOk(st, p.comRates);
  });
  const listed = new Set();
  if (!isObj(C)) errs.push('COUNCILS missing');
  else Object.entries(C).forEach(([st, list]) => {
    if (!RATE_STATES.includes(st)) errs.push(`COUNCILS: unknown state "${st}"`);
    if (!Array.isArray(list)) { errs.push(`COUNCILS ${st}: not a list`); return; }
    const seen = new Set();
    list.forEach(c => {
      if (!isObj(c)) { errs.push(`COUNCILS ${st}: entry is not an object`); return; }
      if (typeof c.value !== 'string' || !COUNCIL_VALUE_RE.test(c.value)) errs.push(`COUNCILS ${st}: value ${JSON.stringify(c.value)} must be lower-case letters, digits, _ or - (it is the ?council= in ad links)`);
      if (typeof c.label !== 'string' || !c.label.trim()) errs.push(`COUNCILS ${st} · ${c.value}: label is blank`);
      if (seen.has(c.value)) errs.push(`COUNCILS ${st}: "${c.value}" is listed twice`);
      seen.add(c.value); listed.add(st + '|' + c.value);
    });
  });
  if (!isObj(CP)) errs.push('COUNCIL_PROFILES missing');
  else Object.entries(CP).forEach(([key, p]) => {
    const m = COUNCIL_KEY_RE.exec(key);
    if (!m || !RATE_STATES.includes(m[1])) { errs.push(`COUNCIL_PROFILES: key "${key}" is not STATE|value`); return; }
    if (!listed.has(key)) errs.push(`COUNCIL_PROFILES: "${key}" has rates but is not in COUNCILS ${m[1]}`);
    if (!isObj(p)) { errs.push(`${key}: profile not an object`); return; }
    if (p.streams !== undefined) streamsOk(key, p.streams);
    resOk(key, p.resRates, false);
    comOk(key, p.comRates);
    if (p.comList !== undefined) {
      if (p.comList !== 'own') errs.push(`${key}: comList ${JSON.stringify(p.comList)} must be "own"`);
      else if (!isObj(p.comRates) || !Object.keys(p.comRates).length) errs.push(`${key}: comList "own" with no commercial rates — the council would offer no uses at all`);
    }
  });
  return errs;
}

// What a publish changes against the file it replaces. `removedCouncils` is
// the one a person must confirm: council values are the ?council= in ad links.
export function diffRates(prev, next) {
  const councils = j => {
    const m = new Map();
    Object.entries((j && j.COUNCILS) || {}).forEach(([st, list]) => (Array.isArray(list) ? list : []).forEach(c => c && m.set(st + '|' + c.value, c.label)));
    return m;
  };
  const leaves = (j) => {
    const out = new Map();
    const walk = (o, p) => {
      if (o && typeof o === 'object' && !Array.isArray(o)) Object.keys(o).forEach(k => walk(o[k], p ? p + '.' + k : k));
      else out.set(p, JSON.stringify(o));
    };
    if (j) { walk(j.PROFILES, 'PROFILES'); walk(j.COUNCIL_PROFILES, 'COUNCIL_PROFILES'); }
    return out;
  };
  const a = councils(prev), b = councils(next);
  const removedCouncils = [...a].filter(([k]) => !b.has(k)).map(([k, label]) => ({ key: k, label }));
  const addedCouncils = [...b].filter(([k]) => !a.has(k)).map(([k, label]) => ({ key: k, label }));
  const la = leaves(prev), lb = leaves(next);
  let changed = 0, added = 0, removed = 0;
  lb.forEach((v, k) => { if (!la.has(k)) added++; else if (la.get(k) !== v) changed++; });
  la.forEach((v, k) => { if (!lb.has(k)) removed++; });
  return { first: !prev, removedCouncils, addedCouncils, figures: { changed, added, removed } };
}

export function ratesCounts(json) {
  let res = 0, com = 0;
  const count = p => {
    Object.values((p && p.resRates) || {}).forEach(u => { res += Object.keys(u || {}).length; });
    Object.values((p && p.comRates) || {}).forEach(u => { com += Object.keys(u || {}).length; });
  };
  Object.values(json.PROFILES || {}).forEach(count);
  Object.values(json.COUNCIL_PROFILES || {}).forEach(count);
  return {
    states: Object.keys(json.PROFILES || {}).length,
    councils: Object.values(json.COUNCILS || {}).reduce((n, l) => n + l.length, 0),
    councilProfiles: Object.keys(json.COUNCIL_PROFILES || {}).length,
    residentialFigures: res,
    commercialFigures: com,
  };
}
