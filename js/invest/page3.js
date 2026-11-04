// 舊版「Sam的投資儀表板」的頁面程式，原樣搬過來；資料改由 js/invest/shim.js 提供（讀 OneDrive）
(() => {
dash.calc('day_records', {
  inputs: ['history', 'changes'],
  title: '單日最佳／最差紀錄',
  description: '每天取最後一筆資產紀錄與前一天相比，先扣掉當天的資金進出（台股買進賣出金額、嘉信入金出金），再找出台股、美股、合計各自漲最多與跌最多的一天',
  fn: (history, changes) => {
    const last = {};
    [...history].sort((a, b) => String(a.at).localeCompare(String(b.at))).forEach((r) => { last[String(r.date).slice(0, 10)] = r; });
    const days = Object.keys(last).sort();
    // 資金進出：嘉信有記現金，只有入金／出金才算；台股在「台股現金起算」那天之前沒有記現金，買進＝錢從外面流入、賣出＝流出，
    // 起算之後交割戶餘額也算進資產，就跟嘉信一樣只看入金／出金（起算當天的餘額本身也算一次流入）
    const cut = (changes || []).filter((r) => r.action === '台股現金起算').map((r) => String(r.date).slice(0, 10)).sort()[0] || null;
    const flow = {};
    (changes || []).forEach((r) => {
      const d = String(r.date || '').slice(0, 10), a = String(r.action || ''), v = Number(r.qty) * Number(r.price);
      if (!d || !isFinite(v)) return;
      const f = flow[d] || (flow[d] = { tw: 0, us: 0 });
      const code = String(r.code || ''), tw = code === 'TWCASH' || /^\d{4,6}[A-Z]?$/.test(code);
      if (a === '台股現金起算') f.tw += v;
      else if (a === '入金' || a === '出金') { const s = a === '入金' ? 1 : -1; if (tw) f.tw += s * v; else f.us += s * v; }
      else if (tw && code !== 'TWCASH' && (!cut || d < cut) && a === '買進') f.tw += v;
      else if (tw && code !== 'TWCASH' && (!cut || d < cut) && a === '賣出') f.tw -= v;
    });
    const fl = (d, key) => { const f = flow[d] || { tw: 0, us: 0 }; return key === 'tw_twd' ? f.tw : key === 'us_usd' ? f.us : f.tw + f.us * Number(last[d].fx || 0); };
    const defs = [['台股', 'tw_twd', 'TWD'], ['美股', 'us_usd', 'USD'], ['合計', 'total_twd', 'TWD']];
    return defs.map(([market, key, cur]) => {
      const ch = [];
      for (let i = 1; i < days.length; i++) {
        const p = Number(last[days[i - 1]][key]), c = Number(last[days[i]][key]);
        const g = c - p - fl(days[i], key);
        if (p > 0 && c > 0 && Math.abs(g) > 0.5) ch.push({ date: days[i], amt: g, pct: g / p });
      }
      const best = ch.filter((x) => x.pct > 0).reduce((m, x) => (!m || x.pct > m.pct ? x : m), null);
      const worst = ch.filter((x) => x.pct < 0).reduce((m, x) => (!m || x.pct < m.pct ? x : m), null);
      return [['最佳', best], ['最差', worst]].map(([kind, x]) => ({ market, kind, cur, days: ch.length,
        pct: x ? x.pct : null, amt: x ? x.amt : null, date: x ? x.date : null }));
    }).flat();
  }
});
dash.onData(() => {
  const d = dash.data('day_records'), body = document.getElementById('dayrec-body'), empty = document.getElementById('dayrec-empty');
  if (!body) return;
  body.replaceChildren();
  const rows = d.status === 'ok' && Array.isArray(d.data) ? d.data : [];
  const any = rows.some((r) => r.days > 0);
  empty.hidden = d.status !== 'ok' || any;
  if (!any) return;
  const pct = (v) => v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
  const amt = (v, cur) => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + (cur === 'USD' ? 'US$' : 'NT$') + Math.abs(Math.round(v)).toLocaleString('en-US');
  const md = (s) => s ? Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) : '—';
  const cls = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.dataset.key = encodeURIComponent(r.market) + ',' + encodeURIComponent(r.kind);
    if (r.kind === '最佳' && i > 0) tr.className = 'sd-grp';
    const cells = [[r.kind === '最佳' ? r.market : '', 'l'], [r.kind, 'l nm'], [pct(r.pct), cls(r.pct)], [amt(r.amt, r.cur), cls(r.amt)], [md(r.date), 'nm']];
    cells.forEach(([txt, c]) => { const td = document.createElement('td'); td.textContent = txt; if (c) td.className = c; tr.appendChild(td); });
    body.appendChild(tr);
  });
});
})();
