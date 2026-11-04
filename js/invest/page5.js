// 舊版「Sam的投資儀表板」的頁面程式，原樣搬過來；資料改由 js/invest/shim.js 提供（讀 OneDrive）
(() => {
dash.calc('cathay_stats', {
  inputs: ['cathay_bal'],
  title: '國泰台股統計',
  description: '最新台股市值，以及扣掉買賣資金進出、計入現金股利後的時間加權報酬（近一年、全期間、年化）與最大回落；另列期間淨投入與股利合計',
  fn: (cathay_bal) => {
    const r = [...cathay_bal].map((x) => ({ date: String(x.date).slice(0, 10), v: Number(x.twd), f: Number(x.flow) || 0, d: Number(x.div) || 0 })).filter((x) => x.v > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (r.length < 2) return [];
    const idx = [1]; let peak = 1, mdd = 0;
    for (let i = 1; i < r.length; i++) { const v = idx[i - 1] * (r[i].v - r[i].f + r[i].d) / r[i - 1].v; idx.push(v); peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
    const last = r[r.length - 1], first = r[0];
    const ago = new Date(last.date + 'T00:00:00Z'); ago.setUTCFullYear(ago.getUTCFullYear() - 1); const agoS = ago.toISOString().slice(0, 10);
    let i1 = 0; r.forEach((x, i) => { if (x.date <= agoS) i1 = i; });
    const tot = idx[idx.length - 1] - 1, yrs = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 864e5);
    return [
      { k: 'last', label: '最新 ' + last.date, v: last.v },
      { k: 'y1', label: '近一年報酬', v: idx[idx.length - 1] / idx[i1] - 1 },
      { k: 'all', label: '全期間報酬 ' + first.date + ' 起', v: tot },
      { k: 'ann', label: '年化', v: yrs > 0 ? Math.pow(1 + tot, 1 / yrs) - 1 : null },
      { k: 'mdd', label: '最大回落', v: mdd },
      { k: 'flow', label: '期間淨投入', v: r.reduce((s, x) => s + x.f, 0) },
      { k: 'div', label: '現金股利合計', v: r.reduce((s, x) => s + x.d, 0) }
    ];
  }
});
function drawTrendStats() {
  const box = document.getElementById('trend-stats'), note = document.getElementById('trend-stats-note'); if (!box) return; box.replaceChildren();
  const pc = (v) => (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%', ntM = (v) => (v < 0 ? '−' : '') + 'NT$' + d3.format(',.0f')(Math.abs(v)), fU = (v) => 'US$' + d3.format(',.2f')(v);
  const get = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const sc = get('sch_stats'), ct = get('cathay_stats');
  const put = (src, x, label, money) => {
    const it = document.createElement('div'); it.textContent = label || x.label;
    const b = document.createElement('b'); b.textContent = x.v == null ? '—' : money ? money(x.v) : pc(x.v);
    if (!money) b.className = x.v > 0 ? 'up' : x.v < 0 ? 'down' : '';
    b.setAttribute('data-source', src); b.setAttribute('data-field', 'v'); b.setAttribute('data-where', 'k=' + x.k);
    it.appendChild(b); box.appendChild(it);
  };
  const S = window.TREND_SER || 'all';
  const hd = document.getElementById('trend-stats-h');
  if (hd) { const t = S === 'tw' ? '國泰歷史' : S === 'us' ? '嘉信歷史' : ''; hd.textContent = t; hd.hidden = !t; }
  if (S === 'tw') {
    if (!ct) { box.textContent = '—'; return; }
    ct.forEach((x) => put('cathay_stats', x, null, (x.k === 'last' || x.k === 'flow' || x.k === 'div') ? ntM : null));
    note.textContent = '國泰統計：報酬率已扣掉買進賣出的資金進出、現金股利算進報酬（時間加權）；期間淨投入含股息再投入';
  } else if (S === 'us') {
    if (!sc) { box.textContent = '—'; return; }
    sc.forEach((x) => put('sch_stats', x, null, (x.k === 'last' || x.k === 'flow') ? fU : null));
    note.textContent = '嘉信統計：最新為帳戶實際總值；報酬率扣掉入金出金（時間加權）';
  } else {
    const pick = (rows, k) => (rows || []).find((x) => x.k === k);
    [['cathay_stats', ct, 'y1', 'TW 近一年'], ['cathay_stats', ct, 'all', 'TW 全期間'], ['sch_stats', sc, 'twr1y', 'US 近一年'], ['sch_stats', sc, 'twrall', 'US 全期間']].forEach(([src, rows, k, lab]) => { const x = pick(rows, k); if (x) put(src, x, lab); });
    note.textContent = '報酬率都已扣掉資金進出（時間加權），2024/10/22 起；點 TW 或 US 看完整統計';
  }
}
window.drawTrendStats = drawTrendStats;
dash.onData(() => { drawTrendStats(); });
})();
