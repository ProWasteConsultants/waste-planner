// ── WastePlanner legal documents: the ONE place their versions live ─────────
// Read by index.html (sign-up record, the re-acceptance check, links), and by
// terms.html / privacy.html (the version + date printed on each page). Change
// a document → change its version and date here, in the same commit as the
// page text. Never compute a date at run time: the page states the date of
// the document, not today's date.
//
// reacceptFrom — the day existing users must accept the current versions
// before continuing ('YYYY-MM-DD', Australia/Melbourne). Set it to 30 days
// after the notice email goes out (supabase/functions/legal-notice); null =
// existing users are not asked yet. Accounts created on or after `publishedAt`
// without having ticked the sign-up box (e.g. invited users) are asked straight
// away regardless — they never saw any earlier version.
window.WP_LEGAL = {
  terms:   { version: '2.0', date: 'TBC', title: 'Terms of Service', path: 'terms', url: 'https://wasteplanner.au/terms' },
  privacy: { version: '2.0', date: 'TBC', title: 'Privacy Policy',   path: 'privacy', url: 'https://wasteplanner.au/privacy' },
  publishedAt: null,
  reacceptFrom: null,
};
