// 舊版「Sam的投資儀表板」的頁面程式，原樣搬過來；資料改由 js/invest/shim.js 提供（讀 OneDrive）
(() => {
(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const tz = { timeZone: 'Asia/Taipei' };
  const stamp = (at) => { if (!at) return ''; const d = new Date(at); if (isNaN(d)) return ''; return new Intl.DateTimeFormat('zh-TW', { ...tz, month: 'numeric', day: 'numeric' }).format(d) + ' ' + new Intl.DateTimeFormat('zh-TW', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d); };
  const n = (v) => (v === null || v === undefined || v === '' ? null : (typeof v === 'number' ? v : (isNaN(Number(v)) ? v : Number(v))));
  const fmtV = (v, d) => { v = n(v); if (v === null) return '—'; if (typeof v !== 'number') return String(v); const dd = n(d); const k = typeof dd === 'number' ? dd : (Math.abs(v) >= 1000 ? 2 : 2); return d3.format(',.' + k + 'f')(v); };
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const link = (text, url) => { if (!url) return el('span', null, text); const a = el('a', null, text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const latest = (rows) => rows.map((r) => r.at).filter(Boolean).sort().at(-1);
  const ORDER = ['美股盤前', '台股收盤', '美股收盤', '台股盤前'];
  const TT = (s) => s;

  // tabs
  const tabs = [...document.querySelectorAll('#tabs button')];
  const show = (pane) => {
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pane === pane)));
    ['mine', 'hold', 'plans', 'cal', 'market', 'trades'].forEach((k) => { const p = document.getElementById('pane-' + k); if (p) p.hidden = pane !== k; });
    if (pane !== 'market') window.dispatchEvent(new Event('resize'));
  };
  tabs.forEach((b) => b.addEventListener('click', () => { show(b.dataset.pane); dash.setLink(b.dataset.pane); }));
  { const h = location.hash.slice(1); if (['mine', 'hold', 'plans', 'cal', 'market', 'trades'].includes(h)) show(h); }

  // 綠漲紅跌：把台式「收紅／收黑」等顏色說法改成漲跌，避免和頁面顏色衝突
  const UD = [['收紅', '收漲'], ['收黑', '收跌'], ['收綠', '收跌'], ['翻紅', '翻漲'], ['翻黑', '翻跌'], ['翻綠', '翻跌'], ['開紅', '開高'], ['開黑', '開低'], ['開綠', '開低'], ['紅盤', '漲勢'], ['黑盤', '跌勢'], ['綠盤', '跌勢'], ['一片紅', '全面上漲'], ['一片綠', '全面下跌'], ['一片黑', '全面下跌']];
  const cw = (t) => UD.reduce((s, [a, b]) => s.split(a).join(b), String(t == null ? '' : t));
  dash.onData(() => {
    // brief
    const B = rowsOf('inv_brief'), bb = $('#mk-briefs');
    if (bb && B) {
      bb.textContent = '';
      const all = [...B].filter((r) => r && r.text).sort((a, b) => (a.at < b.at ? -1 : 1));
      let k = -1; for (let i = all.length - 1; i >= 0; i--) { if (all[i].slot === '午報') { k = i; break; } }
      const show = (k >= 0 ? all.slice(k) : all.slice(-4)).reverse();
      const SL = {};
      if (!show.length) bb.appendChild(el('p', 'mk-brief', '下一份報告寫入後顯示。'));
      show.forEach((r, i) => {
        const it = el('div', 'mk-bi' + (i ? '' : ' latest'));
        it.appendChild(el('div', 'mk-bh', stamp(r.at) + ' · ' + (SL[r.slot] || r.slot || '')));
        const p = el('p', 'mk-brief', cw(r.text)); if (cw(r.text) === r.text) { p.setAttribute('data-field', 'text'); p.setAttribute('data-where', 'at=' + encodeURIComponent(r.at)); }
        it.appendChild(p); bb.appendChild(it);
      });
    }

    // tiles by group
    const T = rowsOf('mk_tiles'), box = $('#mk-groups');
    if (T) {
      const gt = (g) => { const t = Date.parse(latest(T.filter((r) => r.group === g)) || ''); return isNaN(t) ? 0 : t; };
      const groups = [...new Set(T.map((r) => r.group))].sort((a, b) => { const d = gt(b) - gt(a); if (d) return d; const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
      const N = rowsOf('mk_notes') || [];
      box.replaceChildren(...groups.map((g) => {
        const rows = T.filter((r) => r.group === g);
        const card = el('section', 'sd-card'); card.id = 'mk-g-' + groups.indexOf(g);
        card.appendChild(el('h2', null, TT(g)));
        const at = latest(rows); const by = (rows.find((r) => r.at === at) || {}).by || '';
        card.appendChild(el('p', 'sd-note', '更新：' + stamp(at) + ' ' + by));
        const grid = el('div', 'mk-tiles');
        rows.forEach((r) => {
          const t = el('div', 'mk-tile');
          t.appendChild(el('div', 'n', r.name));
          const v = el('div', 'v', fmtV(r.value, r.d));
          v.setAttribute('data-source', 'mk_tiles'); v.setAttribute('data-field', 'value'); v.setAttribute('data-where', 'group=' + encodeURIComponent(r.group) + '&name=' + encodeURIComponent(r.name));
          t.appendChild(v);
          const p = n(r.pct);
          if (typeof p === 'number') { const pe = el('div', 'p ' + (p > 0 ? 'up' : p < 0 ? 'down' : 'mut'), (p > 0 ? '+' : '') + d3.format('.2f')(p) + '%'); t.appendChild(pe); }
          else if (r.chip) { t.appendChild(el('div', 'p ' + (r.tone === 'up' ? 'up' : r.tone === 'down' ? 'down' : 'mut'), r.chip)); }
          if (r.sub) t.appendChild(el('div', 'sb', r.sub));
          grid.appendChild(t);
        });
        card.appendChild(grid);
        N.filter((x) => x.section === g).forEach((x) => card.appendChild(el('p', 'mk-sum', cw(x.p))));
        return card;
      }));
    }

    // notes: watch items (with lvl) and other sections
    const N = rowsOf('mk_notes');
    if (N) {
      const tileGroups = new Set((T || []).map((r) => r.group));
      const isWatch = (x) => /觀察|注意/.test(x.section || '');
      const list = $('#mk-watch-list');
      const W = N.filter(isWatch);
      if (!W.length) list.replaceChildren(el('div', 'sd-empty', '目前沒有需要留意的項目'));
      else list.replaceChildren(...W.map((x) => {
        const it = el('div', 'sd-item mk-item ' + (x.lvl || ''));
        const t = el('div', 't'); t.appendChild(el('b', null, x.section)); t.appendChild(el('span', 'sd-chip', (x.by || '') + ' ' + stamp(x.at))); it.appendChild(t);
        const m = el('div', 'm', cw(x.p)); if (cw(x.p) === x.p) { m.setAttribute('data-source', 'mk_notes'); m.setAttribute('data-field', 'p'); m.setAttribute('data-where', 'id=' + encodeURIComponent(x.id)); } it.appendChild(m);
        return it;
      }));
      const cc = N.filter((x) => x.section === 'Cover Call 參考');
      if (cc.length) $('#mk-cc-note').textContent = cc.map((x) => x.p).join(' ');
      const rest = N.filter((x) => !isWatch(x) && !tileGroups.has(x.section) && x.section !== 'Cover Call 參考');
      const secs = [...new Set(rest.map((x) => x.section))];
      $('#mk-other').replaceChildren(...secs.map((s, i) => {
        const rows = rest.filter((x) => x.section === s);
        const card = el('section', 'sd-card'); card.id = 'mk-s-' + i;
        card.appendChild(el('h2', null, TT(s)));
        const at = latest(rows); card.appendChild(el('p', 'sd-note', '更新：' + stamp(at) + ' ' + ((rows.find((r) => r.at === at) || {}).by || '')));
        const l = el('div', 'sd-list');
        rows.forEach((x) => {
          const it = el('div', 'sd-item');
          if (x.h) { const t = el('div', 't'); t.appendChild(el('b', null, x.h)); it.appendChild(t); }
          const m = el('div', 'm', cw(x.p)); m.style.whiteSpace = 'normal'; if (cw(x.p) === x.p) { m.setAttribute('data-source', 'mk_notes'); m.setAttribute('data-field', 'p'); m.setAttribute('data-where', 'id=' + encodeURIComponent(x.id)); } it.appendChild(m);
          l.appendChild(it);
        });
        card.appendChild(l);
        return card;
      }));
    }

    // news
    const F = rowsOf('fin_news');
    if (F) {
      const tb = $('#mk-news-tbl').tBodies[0];
      tb.replaceChildren(...[...F].sort((a, b) => (a.at < b.at ? 1 : -1)).map((r) => {
        const tr = document.createElement('tr'); tr.dataset.key = r.title;
        const a = el('td', 'l'); a.appendChild(link(r.title, r.url)); a.appendChild(el('span', 's', [r.src, (r.by || '') + ' ' + stamp(r.at)].filter(Boolean).join('｜')));
        tr.append(a, el('td', 'l', r.rel || ''));
        return tr;
      }));
    }

    // cover call
    const C = rowsOf('cc_ref');
    if (C) {
      const tb = $('#mk-cc-tbl').tBodies[0];
      tb.replaceChildren(...C.map((r) => {
        const tr = document.createElement('tr'); tr.dataset.key = r.code;
        tr.append(el('td', 'l', r.code), el('td', null, r.iv || '—'), el('td', null, r.wk || '—'), el('td', null, r.mo || '—'), el('td', null, r.p5 || '—'), el('td', null, r.p10 || '—'), el('td', 'l', r.note || ''));
        return tr;
      }));
    }
  });
})();
})();
