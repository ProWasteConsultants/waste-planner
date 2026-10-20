// ── Markdown → HTML for the legal pages ─────────────────────────────────────
// Renders legal/terms.md and legal/privacy.md on terms.html / privacy.html.
// Self-contained on purpose: a Terms page that depends on a third-party CDN
// is blank whenever that CDN is. Pure (string in, string out) and tested in
// tests/legal.test.js.
//
// Supported: # headings, paragraphs, **bold**, *italic* / _italic_, `code`,
// [links](url), bare URLs and email addresses, - / * / 1. lists (nested by
// indentation), > quotes, --- rules, GFM pipe tables, and a line ending in
// two spaces or a backslash as a line break. Raw HTML is NOT passed through:
// every character of the document is escaped, so the text can never inject
// markup or script. Links are limited to http(s), mailto and relative paths.
(function (root) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const slug = s => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const safeUrl = u => {
    const t = String(u || '').trim();
    if (/^(https?:|mailto:)/i.test(t)) return t;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null;      // javascript:, data:, …
    return t;                                              // relative / #anchor
  };

  // Inline: code spans first (their content is literal), then links, then
  // emphasis, then bare URLs / emails in what is left.
  function inline(text) {
    const slots = [];
    const hold = html => '\u0000' + (slots.push(html) - 1) + '\u0000';
    let s = String(text);
    s = s.replace(/`([^`]+)`/g, (_, c) => hold('<code>' + esc(c) + '</code>'));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, label, url) => {
      const u = safeUrl(url);
      if (!u) return hold(esc(label));
      const ext = /^https?:/i.test(u);
      return hold(`<a href="${esc(u)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${inline(label)}</a>`);
    });
    s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (_, u) => hold(`<a href="${esc(u)}">${esc(u.replace(/^mailto:/, ''))}</a>`));
    s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => hold(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`));
    s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, e => hold(`<a href="mailto:${esc(e)}">${esc(e)}</a>`));
    s = esc(s);
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*(?=\S)([^*]*?\S)\*/g, '$1<em>$2</em>').replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(?: {2,}|\\)\n/g, '<br>\n');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
  }

  const isTableSep = l => /\|/.test(l) && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  const listItem = l => /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);

  function render(md) {
    // HTML comments are notes to editors (e.g. a placeholder marker), never shown
    const lines = String(md || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    const out = [];
    let i = 0;
    const blank = l => !l || !l.trim();
    const startsBlock = l => /^\s{0,3}(#{1,6}\s|>|---+\s*$|\*\*\*+\s*$)/.test(l) || !!listItem(l) || /^\s*\|/.test(l);

    // A list, with nesting by indentation: items deeper than the first
    // item's indent belong to the item above them.
    function list(base) {
      const first = listItem(lines[i]);
      const ordered = /\d/.test(first[2]);
      const start = ordered ? parseInt(first[2], 10) : 1;
      let html = ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>` : '<ul>';
      while (i < lines.length) {
        const m = listItem(lines[i]);
        if (!m || m[1].length !== base) break;
        let text = m[3];
        i++;
        // continuation lines of the same item
        while (i < lines.length && !blank(lines[i]) && !listItem(lines[i]) && /^\s+/.test(lines[i])) { text += '\n' + lines[i].trim(); i++; }
        let inner = inline(text);
        // a blank line followed by deeper content still belongs to this item
        let j = i;
        while (j < lines.length && blank(lines[j])) j++;
        const deeper = j < lines.length && listItem(lines[j]) && listItem(lines[j])[1].length > base;
        if (deeper) { i = j; inner += list(listItem(lines[i])[1].length); }
        html += `<li>${inner}</li>`;
        j = i;
        while (j < lines.length && blank(lines[j])) j++;
        if (j < lines.length && listItem(lines[j]) && listItem(lines[j])[1].length === base && /\d/.test(listItem(lines[j])[2]) === ordered) i = j;
        else break;
      }
      return html + (ordered ? '</ol>' : '</ul>');
    }

    while (i < lines.length) {
      const l = lines[i];
      if (blank(l)) { i++; continue; }
      let m;
      if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) {
        const n = m[1].length, body = inline(m[2]);
        out.push(`<h${n} id="${slug(body)}">${body}</h${n}>`); i++; continue;
      }
      if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^\s{0,3}>/.test(l)) {
        const q = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { q.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
        out.push('<blockquote>' + render(q.join('\n')) + '</blockquote>'); continue;
      }
      if (/\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(l);
        const align = cells(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '');
        i += 2;
        const rows = [];
        while (i < lines.length && !blank(lines[i]) && /\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
        out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c, k) => td('th', c, k)).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, k) => td('td', r[k] || '', k)).join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if (listItem(l)) { out.push(list(listItem(l)[1].length)); continue; }
      const p = [];
      while (i < lines.length && !blank(lines[i]) && (p.length === 0 || !startsBlock(lines[i]))) { p.push(lines[i].replace(/^\s+/, '')); i++; }
      out.push('<p>' + inline(p.join('\n')) + '</p>');
    }
    return out.join('\n');
  }

  // 'YYYY-MM-DD' → '20 October 2026' (the document's own date, never today's)
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function longDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m && MONTHS[+m[2] - 1] ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(iso || '');
  }

  const api = { render, inline, longDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.wpLegalMd = api;
})(typeof window !== 'undefined' ? window : this);
