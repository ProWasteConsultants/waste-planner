// ── terms.html / privacy.html: render the document from legal/ ──────────────
// The page holds no legal text. It reads legal/versions.json for the title,
// version and effective date, fetches the document's Markdown and renders it
// with legal/md.js. Edit legal/<doc>.md (and its version in versions.json)
// and the page follows; nothing here changes.
(function () {
  const el = document.getElementById('doc');
  if (!el) return;
  const key = el.getAttribute('data-doc');
  // every legal/ path is resolved against this script's own URL, so the page
  // works at /terms, /terms.html and under the github.io project path alike
  const here = document.currentScript && document.currentScript.src;
  const at = f => new URL(f, here || location.href).href;
  const fail = (why) => {
    el.innerHTML = '<p class="err">This document could not be loaded (' + String(why).replace(/[<>&]/g, '') +
      '). <a href="' + at(key + '.md') + '">Read the text version</a>, or email <a href="mailto:info@prowaste.au">info@prowaste.au</a>.</p>';
  };
  fetch(at('versions.json'), { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('versions ' + r.status); return r.json(); })
    .then(v => {
      const d = v[key];
      if (!d) throw new Error('unknown document');
      return fetch(at(d.file), { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('text ' + r.status); return r.text(); })
        .then(md => ({ d, md }));
    })
    .then(({ d, md }) => {
      el.innerHTML = window.wpLegalMd.render(md);
      // the version line sits under the document's own heading; a document
      // without one gets the title from versions.json
      let h1 = el.querySelector('h1');
      if (!h1) { h1 = document.createElement('h1'); h1.textContent = d.title; el.insertBefore(h1, el.firstChild); }
      const meta = document.createElement('div');
      meta.className = 'updated';
      meta.textContent = 'Version ' + d.version + ' · Effective ' + window.wpLegalMd.longDate(d.effective);
      h1.insertAdjacentElement('afterend', meta);
      document.title = d.title + ' — WastePlanner';
      if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
    })
    .catch(e => fail(e.message || e));
})();
