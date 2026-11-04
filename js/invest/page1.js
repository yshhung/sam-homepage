// 舊版「Sam的投資儀表板」的頁面程式，原樣搬過來；資料改由 js/invest/shim.js 提供（讀 OneDrive）
(() => {
const PAL = ['#38bdf8', '#2fd47a', '#a78bfa', '#f5b942', '#f472b6', '#22d3ee', '#fb923c', '#84cc16'];
const MUTED = CV('--dim');
const nt = v => 'NT$' + d3.format(',.0f')(v);
const usd = (v, d = 2) => 'US$' + d3.format(',.' + d + 'f')(v);
const pct = (v, d = 1) => (v > 0 ? '+' : '') + d3.format('.' + d + '%')(v);
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '');
const ntS = v => sgn(v) + 'NT$' + d3.format(',.0f')(Math.abs(v));
const num = (v, d = 2) => d3.format(',.' + d + 'f')(v);
const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const rows = id => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
const setTxt = (el, t, c) => { el.textContent = t; el.classList.remove('dash-skeleton', 'up', 'down'); if (c) el.classList.add(c); };
// 更新時間：美股收盤報 夏令 04:15／冬令 05:15（週二至週六）、早報 08:50（週一至週六）、午報 17:15（週一至週五）、晚報美國夏令 21:05／冬令 22:05（每天），台北時間
const upMd = (ymd) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(ymd + 'T12:00:00+08:00'));
const upYmd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const upDst = (d) => (new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName') || {}).value === 'GMT-4';
const upSlot = (s) => s || '更新';
const upMdEn = (ymd) => { const d = new Date(ymd + 'T12:00:00+08:00'); return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(d) + '（' + new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'narrow' }).format(d) + '）'; };
const drawNextUp = () => {
  const now = new Date(); let out = '—';
  for (let i = 0; i < 8 && out === '—'; i++) {
    const ymd = upYmd(new Date(now.getTime() + i * 864e5)), wd = new Date(ymd + 'T12:00:00+08:00').getUTCDay();
    const at = (h) => new Date(ymd + 'T' + h + ':00+08:00');
    const s = [];
    if (wd >= 2 && wd <= 6) s.push(['收盤報', upDst(at('04:15')) ? '04:15' : '05:15']);
    if (wd !== 0) s.push(['早報', '08:50']);
    if (wd >= 1 && wd <= 5) s.push(['午報', '17:15']);
    s.push(['晚報', upDst(at('21:05')) ? '21:05' : '22:05']);
    const hit = s.find(([, h]) => at(h) > now);
    if (hit) out = upMdEn(ymd) + '\n' + upSlot(hit[0]) + ' ' + hit[1];
  }
  const b = document.querySelector('#nextupdate b'); if (b) b.textContent = out;
};

const today = () => { const n = new Date(Date.now() + 8 * 3600e3); return n.toISOString().slice(0, 10); };

dash.calc('positions', {
  inputs: ['holdings', 'fx'],
  title: '各檔市值、損益與今日變動',
  description: '市值＝股數×現價（賣出的選擇權股數為負，市值為負＝買回成本）；損益＝市值−成本；今日變動＝(現價−前收)×股數；美股乘匯率換算台幣',
  fn: (holdings, fx) => {
    const rate = Number(fx[0].rate);
    return holdings.map(h => {
      const shares = Number(h.shares), price = Number(h.price);
      const isCash = h.code === 'CASH' || h.code === 'TWCASH';
      const cost = (h.cost === null || h.cost === '' || isCash) ? null : Number(h.cost);
      const value = shares * price, k = h.currency === 'USD' ? rate : 1;
      const pnl = cost === null ? null : value - cost;
      const prev = (h.prev_price === null || h.prev_price === undefined || h.prev_price === '') ? null : Number(h.prev_price);
      const day = (!isCash && prev) ? (price - prev) * shares : null;
      return {code: h.code, name: h.name, market: h.market, currency: h.currency, shares, price, value,
        pnl, pnl_pct: cost ? pnl / Math.abs(cost) : null, avg: h.avg === null ? null : Number(h.avg), cost,
        value_twd: value * k, pnl_twd: pnl === null ? null : pnl * k,
        day_pct: (day !== null && prev) ? price / prev - 1 : null, day_twd: day === null ? null : day * k, day_native: day,
        price_date: h.price_date, prev_date: h.prev_date || null};
    });
  }
});
dash.calc('totals', {
  inputs: ['positions'],
  title: '總資產彙總',
  description: '台股、美股（含嘉信現金）市值換算台幣後加總，以及未實現損益與今日變動合計',
  fn: (positions) => {
    const s = f => positions.reduce((a, r) => a + (f(r) || 0), 0);
    const total = s(r => r.value_twd), tw = s(r => r.market === '台股' ? r.value_twd : 0);
    const cost = s(r => r.pnl_twd === null ? 0 : r.value_twd - r.pnl_twd);
    const pnl = s(r => r.pnl_twd);
    const dayRows = positions.filter(r => r.day_twd !== null);
    const day = dayRows.reduce((a, r) => a + r.day_twd, 0);
    return [{total_twd: total, tw_twd: tw, us_twd: total - tw, tw_share: tw / total, us_share: 1 - tw / total,
      us_stock_usd: s(r => r.market === '美股' && r.code !== 'CASH' ? r.value : 0),
      us_cash_usd: s(r => r.code === 'CASH' ? r.value : 0),
      tw_cash_twd: s(r => r.code === 'TWCASH' ? r.value : 0),
      cash_twd: s(r => r.code === 'CASH' || r.code === 'TWCASH' ? r.value_twd : 0),
      pnl_twd: pnl, pnl_pct: cost ? pnl / cost : null,
      day_twd: dayRows.length ? day : null, day_pct: dayRows.length ? day / (total - day) : null, day_n: dayRows.length}];
  }
});

const EXCL = c => c === 'CASH' || c === 'TWCASH' || (window.INV_CFG.exclude || []).includes(c);
const secRows = (sectors, code, kinds) => sectors.filter(s => s.code === code && kinds.includes(s.kind));
dash.calc('sector_mix', {
  inputs: ['positions', 'sectors'],
  title: '產業占比（ETF 穿透）',
  description: '個股依產業分類；ETF 依成分產業權重拆分；不含嘉信現金與零股殘值；沒有分類的持股列為未分類',
  fn: (positions, sectors) => {
    const acc = new Map();
    const inv = positions.filter(p => !EXCL(p.code) && p.value_twd > 0);
    const total = inv.reduce((a, p) => a + p.value_twd, 0);
    inv.forEach(p => {
      let m = secRows(sectors, p.code, ['stock', 'etf']);
      if (!m.length) m = [{sector: '未分類', w: 1, ai: false}];
      m.forEach(s => {
        const v = p.value_twd * Number(s.w);
        const o = acc.get(s.sector) || {sector: s.sector, value_twd: 0, ai_twd: 0, members: []};
        o.value_twd += v; if (s.ai === true || s.ai === 'true') o.ai_twd += v;
        o.members.push({code: p.code, name: p.name, v, etf: s.kind === 'etf'});
        acc.set(s.sector, o);
      });
    });
    return [...acc.values()].sort((a, b) => b.value_twd - a.value_twd)
      .map(o => ({sector: o.sector, value_twd: o.value_twd, share: total ? o.value_twd / total : 0, ai_twd: o.ai_twd,
        members: JSON.stringify(o.members.sort((a, b) => b.v - a.v))}));
  }
});
const p1 = x => (x * 100).toFixed(1) + '%';
dash.calc('concentration', {
  inputs: ['positions', 'sectors', 'sector_mix'],
  title: '集中度指標',
  description: '分母為投資部位（不含嘉信現金與零股殘值）；AI／半導體主題含標記為 AI 的個股與 ETF 的半導體部分；台積電曝險含 ADR 與 ETF 內的台積電權重',
  fn: (positions, sectors, mix) => {
    const inv = positions.filter(p => !EXCL(p.code) && p.value_twd > 0).sort((a, b) => b.value_twd - a.value_twd);
    const total = inv.reduce((a, p) => a + p.value_twd, 0);
    if (!total) return [];
    const nm = p => p.code + ' ' + p.name;
    const top3 = inv.slice(0, 3);
    let ai = 0; const aiNames = [];
    inv.forEach(p => secRows(sectors, p.code, ['stock', 'etf']).forEach(s => {
      if (s.ai === true || s.ai === 'true') { ai += p.value_twd * Number(s.w); aiNames.push(s.kind === 'etf' ? p.code + '（半導體部分）' : p.code); }
    }));
    let tsmc = 0; const tsParts = [];
    inv.forEach(p => secRows(sectors, p.code, ['top']).filter(s => s.sector === '台積電').forEach(s => {
      const v = p.value_twd * Number(s.w); tsmc += v; tsParts.push(p.code + ' ' + p1(v / total));
    }));
    const tw = inv.filter(p => p.market === '台股').reduce((a, p) => a + p.value_twd, 0);
    const big = mix[0];
    return [
      {key: 'top3', label: '前三大合計', share: top3.reduce((a, p) => a + p.value_twd, 0) / total, value_twd: top3.reduce((a, p) => a + p.value_twd, 0), note: top3.map(p => p.code).join('、')},
      {key: 'sector', label: '最大產業', share: big ? Number(big.share) : null, value_twd: big ? Number(big.value_twd) : null, note: big ? big.sector + '（含 ETF 穿透）' : ''},
      {key: 'ai', label: 'AI／半導體主題', share: ai / total, value_twd: ai, note: [...new Set(aiNames)].join('、')},
      {key: 'tsmc', label: '台積電穿透曝險', share: tsmc / total, value_twd: tsmc, note: tsParts.join('＋')}
    ];
  }
});

function tipAt(tip, box, ev, html) {
  tip.innerHTML = ''; html.forEach((t, i) => { const s = document.createElement('span'); s.textContent = t; if (i === 0) s.className = 'mut'; else s.style.display = 'block'; tip.appendChild(s); });
  tip.style.display = 'block';
  const r = box.getBoundingClientRect();
  tip.style.left = Math.max(0, Math.min(ev.clientX - r.left + 12, r.width - tip.offsetWidth - 4)) + 'px';
  tip.style.top = Math.max(0, ev.clientY - r.top - tip.offsetHeight - 10) + 'px';
}

function fillHeader() {
  const t = rows('totals'), f = rows('fx'), h = rows('history');
  document.querySelectorAll('.sd-head [data-source="totals"]').forEach(el => {
    if (!t || !t.length) return; const v = t[0][el.dataset.field];
    setTxt(el, el.dataset.field === 'total_twd' ? nt(v) : d3.format('.1%')(v));
  });
  const lu = rows('lastupdate'), luEl = document.querySelector('#lastupdate b');
  if (lu && lu.length) { const u = lu[0], m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(String(u.at || '')); setTxt(luEl, m ? upMdEn(m[1]) + '\n' + upSlot(String(u.by || '')) + ' ' + m[2] : String(u.label)); }
  drawNextUp();
  const k = document.querySelectorAll('#kpis .sd-v');
  if (!t || !t.length) return;
  const T = t[0];
  // 前一天＝台北今天以前最後一筆 history；綠漲紅跌
  const todayTP = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const PV = (h || []).filter(e => e && e.date < todayTP).pop() || null;
  const fxNow = f && f.length ? Number(f[0].rate) : (PV ? PV.fx : null);
  const dc = (a, b) => (a === null || a === undefined || b === null || b === undefined) ? '' : cls(Math.round((a - b) * 100) / 100);
  setTxt(k[0], nt(T.total_twd), PV ? dc(T.total_twd, PV.total_twd) : '');
  { const ks = document.getElementById('kpi-total-s'); ks.textContent = '';
    const usUsdNow = fxNow ? T.us_twd / fxNow : null;
    [['TW', T.tw_twd, PV ? dc(T.tw_twd, PV.tw_twd) : ''], ['US', T.us_twd, PV ? dc(usUsdNow, PV.us_usd) : '']].forEach(([mk, v, c]) => { const sp = document.createElement('span'); sp.style.display = 'block'; sp.textContent = mk + ' NT$' + d3.format(',.3f')(Number(v) / 1e6) + 'M'; if (c) sp.className = c; ks.appendChild(sp); }); }
  const prevPt = h && h.length > 1 ? h[h.length - 2] : null;
  if (T.day_twd === null) { setTxt(k[1], '等待前收價'); k[1].classList.add('pending'); document.getElementById('kpi-day-s').textContent = '台股、美股各自以最近一個交易日收盤對前一交易日計算'; }
  else {
    setTxt(k[1], ntS(T.day_twd), cls(T.day_twd)); k[1].classList.remove('pending'); const sm = document.createElement('small'); sm.textContent = pct(T.day_pct, 2); k[1].appendChild(sm);
    const s = document.getElementById('kpi-day-s'); s.className = 'sd-s'; s.textContent = '';
    const P = rows('positions') || [];
    ['台股', '美股'].forEach((mk, i) => {
      const rs = P.filter(r => r.market === mk && r.day_twd !== null);
      const sp = document.createElement('span'); sp.style.display = 'block';
      const lb = mk === '台股' ? 'TW' : 'US';
      if (!rs.length) { sp.textContent = lb + ' 待更新'; sp.className = 'mut'; }
      else {
        const v = rs.reduce((a, r) => a + r.day_native, 0), base = rs.reduce((a, r) => a + r.value - r.day_native, 0);
        const d = rs.map(r => r.price_date).filter(Boolean).sort().pop() || '';
        const amt = mk === '美股' ? sgn(v) + 'US$' + d3.format(',.0f')(Math.abs(v)) : ntS(v);
        sp.textContent = lb + ' ' + (base ? pct(v / base, 2) : '') + '｜' + amt; sp.className = cls(v);
      }
      s.appendChild(sp);
    });
  }
  // 未實現損益相較前一天的變動＝今日價格變動
  const pc = T.day_twd === null ? '' : cls(T.day_twd);
  setTxt(k[2], ntS(T.pnl_twd), pc);
  const ps = document.getElementById('kpi-pnl-s'); ps.textContent = T.pnl_pct === null ? '' : 'Return ' + pct(T.pnl_pct, 1); ps.className = 'sd-s ' + pc;
  // 現金相較前一天：用今天的異動紀錄反推（買進扣、賣出加、入金加、出金減、賣出開倉收權利金）
  let dTW = 0, dUS = 0, twNA = false;
  (rows('changes') || []).filter(r => r && r.date === todayTP).forEach(r => {
    const c = String(r.code || ''), a = String(r.action || ''), amt = Number(r.qty) * Number(r.price) || 0;
    if (c === 'TWCASH' && a.indexOf('起算') >= 0) { twNA = true; return; }
    const isTW = c === 'TWCASH' || /^\d{4,6}[A-Z]?$/.test(c), isOpt = /\s/.test(c) && /[CP]$/.test(c);
    let v = 0;
    if (a === '入金') v = amt; else if (a === '出金') v = -amt;
    else if (isOpt) v = (a.indexOf('賣出') >= 0 ? 1 : a.indexOf('買') >= 0 ? -1 : 0) * amt * 100;
    else if (a === '買進') v = -amt; else if (a === '賣出') v = amt;
    if (isTW) dTW += v; else dUS += v;
  });
  const twC = twNA ? '' : cls(Math.round(dTW)), usC = cls(Math.round(dUS * 100) / 100);
  const cashC = (twNA || !PV || !fxNow) ? '' : dc(T.cash_twd, (T.tw_cash_twd - dTW) + (T.us_cash_usd - dUS) * PV.fx);
  setTxt(k[3], nt(T.cash_twd), cashC);
  { const cs = document.getElementById('kpi-fx-s'); cs.textContent = '';
    const l1 = document.createElement('span'); l1.style.display = 'block'; l1.textContent = 'TW ' + nt(T.tw_cash_twd); if (twC) l1.className = twC; cs.appendChild(l1);
    const l2 = document.createElement('span'); l2.style.display = 'block'; l2.textContent = 'US ' + usd(T.us_cash_usd); if (usC) l2.className = usC; cs.appendChild(l2);
    const fxe = document.getElementById('kpi-cash-fx'); if (fxe) { fxe.textContent = f && f.length ? Number(f[0].rate).toFixed(3) : ''; fxe.className = (PV && f && f.length) ? dc(Number(f[0].rate), PV.fx) : ''; } }
  { const tl = document.querySelector('#kpi-fx-s span'); if (tl && T.tw_cash_twd < 0) { tl.className = 'down'; tl.textContent = 'TW ' + nt(T.tw_cash_twd) + '｜待補交割款'; } }
}

dash.calc('trend_series', {
  inputs: ['cathay_bal', 'schwab_bal', 'schwab_flows', 'changes', 'fx_hist', 'history'],
  title: '每日資產走勢',
  description: '國泰台股每日市值與嘉信每日總值（扣掉起算後累計入金，出金加回），加上台銀匯率換算的合計；匯出檔最後一天之後改用排程的每日最後一筆紀錄',
  fn: (cathay_bal, schwab_bal, schwab_flows, changes, fx_hist, history) => {
    const D = (x) => String(x).slice(0, 10), N = Number;
    const tw = {}, us = {}, fx = {};
    (cathay_bal || []).forEach((r) => { if (N(r.twd) > 0) tw[D(r.date)] = N(r.twd); });
    (schwab_bal || []).forEach((r) => { if (N(r.usd) > 0) us[D(r.date)] = N(r.usd); });
    (fx_hist || []).forEach((r) => { if (N(r.rate) > 0) fx[D(r.date)] = N(r.rate); });
    const lastK = (o) => Object.keys(o).sort().pop() || '';
    const lt = lastK(tw), lu = lastK(us), lf = lastK(fx);
    [...(history || [])].sort((a, b) => String(a.at).localeCompare(String(b.at))).forEach((r) => {
      const d = D(r.date);
      if (d > lt && N(r.tw_twd) > 0) tw[d] = N(r.tw_twd);
      if (d > lu && N(r.us_usd) > 0) us[d] = N(r.us_usd);
      if (d > lf && N(r.fx) > 0) fx[d] = N(r.fx);
    });
    const fl = {}, seen = new Set();
    const add = (d, v) => { const k = d + '|' + v.toFixed(2); if (seen.has(k)) return; seen.add(k); fl[d] = (fl[d] || 0) + v; };
    (schwab_flows || []).forEach((x) => add(D(x.date), N(x.usd)));
    (changes || []).forEach((x) => { const a = String(x.action || ''), c = String(x.code || ''); if ((a === '入金' || a === '出金') && !/^\d{4,6}[A-Z]?$/.test(c) && c !== 'TWCASH') add(D(x.date), (a === '入金' ? 1 : -1) * N(x.qty) * N(x.price)); });
    const days = [...new Set([...Object.keys(tw), ...Object.keys(us)])].sort();
    if (!days.length) return [];
    const d0 = days[0];
    let T = null, U = null, F = null, cum = 0;
    const fd = Object.keys(fl).sort(); let fi = 0;
    const fk = Object.keys(fx).sort(); let xi = 0;
    while (fi < fd.length && fd[fi] <= d0) fi++;
    return days.map((d) => {
      if (tw[d] != null) T = tw[d];
      if (us[d] != null) U = us[d];
      while (xi < fk.length && fk[xi] <= d) { F = fx[fk[xi]]; xi++; }
      while (fi < fd.length && fd[fi] <= d) { cum += fl[fd[fi]]; fi++; }
      return { date: d, tw: T, us: U, dep: Math.round(cum * 100) / 100, us_adj: U == null ? null : Math.round((U - cum) * 100) / 100, fx: F, total: T != null && U != null && F ? Math.round(T + U * F) : null };
    });
  }
});

let RANGE = 0;
let SER = 'all';
document.querySelectorAll('#trend-ser button').forEach(b => b.addEventListener('click', () => {
  SER = b.dataset.s; document.querySelectorAll('#trend-ser button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); drawTrend(); window.TREND_SER = SER; if (window.drawTrendStats) window.drawTrendStats();
}));
document.querySelectorAll('#trend-seg button').forEach(b => b.addEventListener('click', () => {
  RANGE = Number(b.dataset.r); document.querySelectorAll('#trend-seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); drawTrend();
}));
function drawTrend() {
  const svg = d3.select('#trend-svg'); svg.selectAll('*').remove();
  const box = svg.node().parentNode, tip = box.querySelector('.sd-tip'), hl = document.getElementById('trend-hilo');
  if (hl) hl.replaceChildren();
  const all = rows('trend_series'); if (!all || !all.length) { if (hl) hl.textContent = '—'; return; }
  const fM = v => 'NT$' + d3.format(',.3f')(v / 1e6) + 'M', fU = v => 'US$' + d3.format(',.0f')(v);
  const S = {all: {k: 'total', c: '#38bdf8', f: fM}, tw: {k: 'tw', c: '#f5b942', f: fM}, us: {k: 'us_adj', c: '#a78bfa', f: fU}}[SER] || {k: 'total', c: '#38bdf8', f: fM};
  let R = all;
  if (RANGE) { const cut = new Date(Date.parse(all[all.length - 1].date) - RANGE * 864e5).toISOString().slice(0, 10); R = all.filter(r => r.date >= cut); }
  // 最高／最低：TW、US（扣入金）
  const hilo = (k) => { const v = R.filter(r => r[k] != null); if (!v.length) return null; let hi = v[0], lo = v[0]; v.forEach(r => { if (r[k] > hi[k]) hi = r; if (r[k] < lo[k]) lo = r; }); return {hi, lo}; };
  [['tw', 'TW', fM], ['us_adj', 'US（扣入金）', fU]].forEach(([k, lab, f]) => {
    const h = hilo(k); if (!h || !hl) return;
    [['最高', h.hi, 'up'], ['最低', h.lo, 'down']].forEach(([w, r, cls]) => {
      const it = document.createElement('div'); it.textContent = lab + ' ' + w + ' ' + r.date.replace(/-/g, '/');
      const b = document.createElement('b'); b.textContent = f(r[k]); b.className = cls;
      b.setAttribute('data-source', 'trend_series'); b.setAttribute('data-field', k); b.setAttribute('data-where', 'date=' + r.date);
      it.appendChild(b); hl.appendChild(it);
    });
  });
  let pts = R.filter(r => r[S.k] != null).map(r => ({s: r.date, t: new Date(r.date + 'T00:00:00Z'), v: Number(r[S.k]), r}));
  if (!pts.length) return;
  const W = box.clientWidth || 600, H = 220, m = {t: 18, r: 16, b: 26, l: 8};
  svg.attr('viewBox', `0 0 ${W} ${H}`);
  const ext = d3.extent(pts, p => p.v), pad = Math.max((ext[1] - ext[0]) * 0.15, ext[1] * 0.01);
  const y = d3.scaleLinear([ext[0] - pad, ext[1] + pad], [H - m.b, m.t]);
  const yt = y.ticks(4);
  const yf = SER === 'us' ? (v => 'US$' + d3.format(',.0f')(v / 1e3) + 'k') : (v => d3.format(',.2~f')(v / 1e6) + 'M');
  const probe = svg.append('text').style('font-size', '11px').text(yf(yt[yt.length - 1] || ext[1]));
  m.l = probe.node().getComputedTextLength() + 10; probe.remove();
  const x = d3.scaleUtc(d3.extent(pts, p => p.t), [m.l, W - m.r]);
  svg.append('g').selectAll('line').data(yt).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', CV('--line'));
  svg.append('g').selectAll('text').data(yt).join('text').attr('x', m.l - 6).attr('y', d => y(d) + 4).attr('text-anchor', 'end').attr('fill', CV('--dim')).style('font-size', '11px').text(yf);
  const span = +pts[pts.length - 1].t - +pts[0].t, xf = span > 200 * 864e5 ? d3.utcFormat('%Y/%-m') : d3.utcFormat('%-m/%-d');
  svg.append('g').selectAll('text').data(x.ticks(Math.max(2, Math.min(6, Math.floor(W / 110))))).join('text').attr('x', x).attr('y', H - 6).attr('text-anchor', 'middle').attr('fill', CV('--dim')).style('font-size', '11px').text(xf);
  const gr = svg.append('defs').append('linearGradient').attr('id', 'tg').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  [[0, .32], [.5, .1], [1, 0]].forEach(([o, a]) => gr.append('stop').attr('offset', o).style('stop-color', S.c).style('stop-opacity', a));
  svg.append('path').datum(pts).attr('fill', 'url(#tg)').attr('d', d3.area().x(p => x(p.t)).y0(H - m.b).y1(p => y(p.v)));
  svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', S.c).attr('stroke-width', 1.8).attr('stroke-linejoin', 'round').attr('d', d3.line().x(p => x(p.t)).y(p => y(p.v)));
  // 標出區間最高與最低
  let hi = pts[0], lo = pts[0]; pts.forEach(p => { if (p.v > hi.v) hi = p; if (p.v < lo.v) lo = p; });
  [[hi, '#2fd47a', -8], [lo, '#ff5c5c', 16]].forEach(([p, c, dy]) => {
    svg.append('circle').attr('cx', x(p.t)).attr('cy', y(p.v)).attr('r', 4).attr('fill', c).attr('stroke', CV('--panel')).attr('stroke-width', 1.5);
    const tx = x(p.t), anc = tx > W - 90 ? 'end' : tx < m.l + 90 ? 'start' : 'middle';
    svg.append('text').attr('x', tx).attr('y', Math.max(11, Math.min(H - m.b - 2, y(p.v) + dy))).attr('text-anchor', anc).attr('fill', c).style('font-size', '11px').text(S.f(p.v));
  });
  const last = pts[pts.length - 1];
  svg.append('circle').attr('cx', x(last.t)).attr('cy', y(last.v)).attr('r', 4.5).attr('fill', S.c).attr('stroke', CV('--panel')).attr('stroke-width', 2);
  const dot = svg.append('circle').attr('r', 4).attr('fill', CV('--fg')).style('display', 'none');
  const bis = d3.bisector(p => p.t).center;
  svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
    .on('pointermove', ev => {
      const p = pts[bis(pts, x.invert(d3.pointer(ev)[0]))];
      dot.style('display', null).attr('cx', x(p.t)).attr('cy', y(p.v));
      const L = [p.s.replace(/-/g, '/'), S.f(p.v)];
      if (SER === 'us') { L.push('帳戶實際 ' + usd(p.r.us)); if (p.r.dep) L.push('起算後累計入金 ' + usd(p.r.dep)); }
      if (SER === 'all') { if (p.r.tw != null) L.push('TW ' + fM(p.r.tw)); if (p.r.us != null) L.push('US ' + usd(p.r.us) + ' × ' + p.r.fx); }
      tipAt(tip, box, ev, L);
    }).on('pointerleave', () => { tip.style.display = 'none'; dot.style('display', 'none'); });
}

function drawHeat(pos) {
  const svg = d3.select('#heat-svg'); svg.selectAll('*').remove();
  if (!pos) return;
  const box = svg.node().parentNode, tip = box.querySelector('.sd-tip');
  const W = box.clientWidth || 500, H = 260; svg.attr('viewBox', `0 0 ${W} ${H}`);
  const items = pos.filter(r => r.code !== 'CASH' && r.code !== 'TWCASH' && r.value_twd > 1000);
  const root = d3.hierarchy({children: items}).sum(d => d.value_twd || 0).sort((a, b) => b.value - a.value);
  d3.treemap().size([W, H]).paddingInner(3).round(true)(root);
  const up = d3.interpolateRgb(CV('--panel'), '#1f9d5c'), dn = d3.interpolateRgb(CV('--panel'), '#d23f3f');
  const col = d => d.day_pct === null ? CV('--line') : d.day_pct >= 0 ? up(Math.min(d.day_pct / 0.05, 1) * .85 + .15) : dn(Math.min(-d.day_pct / 0.05, 1) * .85 + .15);
  const g = svg.selectAll('g').data(root.leaves()).join('g').attr('transform', d => `translate(${d.x0},${d.y0})`);
  g.append('rect').attr('width', d => d.x1 - d.x0).attr('height', d => d.y1 - d.y0).attr('rx', 6).attr('fill', d => col(d.data))
    .on('pointermove', (ev, d) => tipAt(tip, box, ev, [d.data.code + ' ' + d.data.name, '市值 ' + nt(d.data.value_twd), d.data.day_pct === null ? '今日漲跌：待更新' : '今日 ' + pct(d.data.day_pct, 2) + '（' + ntS(d.data.day_twd) + '）']))
    .on('pointerleave', () => { tip.style.display = 'none'; });
  g.filter(d => d.x1 - d.x0 > 46 && d.y1 - d.y0 > 30).each(function (d) {
    const s = d3.select(this), w = d.x1 - d.x0, big = w > 90 && d.y1 - d.y0 > 52;
    s.append('text').attr('x', 8).attr('y', big ? 22 : 18).attr('fill', CV('--fg')).style('font-size', big ? '14px' : '11px').style('font-weight', 500).style('pointer-events', 'none').text(d.data.code);
    s.append('text').attr('x', 8).attr('y', big ? 40 : 31).attr('fill', CV('--fg')).attr('opacity', .85).style('font-size', big ? '12px' : '10px').style('pointer-events', 'none').text(d.data.day_pct === null ? '—' : pct(d.data.day_pct, 2));
  });
}

function drawContrib(pos) {
  const svg = d3.select('#contrib-svg'); svg.selectAll('*').remove();
  if (!pos) return;
  const box = svg.node().parentNode, tip = box.querySelector('.sd-tip');
  const items = pos.filter(r => r.pnl_twd !== null && r.code !== 'CASH' && r.code !== 'TWCASH').sort((a, b) => b.pnl_twd - a.pnl_twd);
  const W = box.clientWidth || 500, rowH = 22, H = Math.max(120, items.length * rowH + 10); svg.attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  const lab = 64, valW = 92;
  const mx = d3.max(items, r => Math.abs(r.pnl_twd)) || 1, hasNeg = items.some(r => r.pnl_twd < 0);
  const x0 = hasNeg ? lab + (W - lab - valW) * 0.28 : lab;
  const sc = d3.scaleLinear([0, mx], [0, W - valW - x0]);
  const scN = d3.scaleLinear([0, mx], [0, x0 - lab]);
  svg.append('line').attr('x1', x0).attr('x2', x0).attr('y1', 0).attr('y2', H).attr('stroke', CV('--line'));
  const g = svg.selectAll('g.r').data(items).join('g').attr('class', 'r').attr('transform', (d, i) => `translate(0,${i * rowH + 4})`);
  g.append('text').attr('x', 0).attr('y', 13).attr('fill', CV('--fg')).style('font-size', '12px').text(d => d.code);
  g.append('rect').attr('y', 3).attr('height', 13).attr('rx', 4)
    .attr('x', d => d.pnl_twd >= 0 ? x0 : x0 - scN(-d.pnl_twd)).attr('width', d => Math.max(2, d.pnl_twd >= 0 ? sc(d.pnl_twd) : scN(-d.pnl_twd)))
    .attr('fill', d => d.pnl_twd >= 0 ? '#2fd47a' : '#ff5c5c').attr('opacity', .85)
    .on('pointermove', (ev, d) => tipAt(tip, box, ev, [d.code + ' ' + d.name, ntS(d.pnl_twd), 'Return ' + pct(d.pnl_pct, 1)])).on('pointerleave', () => { tip.style.display = 'none'; });
  g.append('text').attr('x', d => d.pnl_twd >= 0 ? x0 + sc(d.pnl_twd) + 6 : x0 + 6).attr('y', 13).attr('fill', d => d.pnl_twd >= 0 ? '#2fd47a' : '#ff5c5c').style('font-size', '11px').text(d => ntS(d.pnl_twd));
}

function drawDonut(key, items, fmt) {
  const svg = d3.select('#donut-' + key), legend = d3.select('#legend-' + key);
  const box = svg.node().parentNode, tip = box.querySelector('.sd-tip');
  svg.selectAll('*').remove(); legend.selectAll('*').remove();
  if (items) items = items.filter(r => r.v > 0);
  if (!items || !items.length) return;
  const sorted = items.slice().sort((a, b) => b.v - a.v), total = d3.sum(sorted, r => r.v);
  if (!(total > 0)) return;
  const top = sorted.slice(0, 8); const rest = d3.sum(sorted.slice(8), r => r.v);
  if (rest > 0) top.push({label: '其他', v: rest});
  const color = (d, i) => d.label === '其他' ? MUTED : PAL[i % PAL.length];
  const arcs = d3.pie().sort(null).value(d => d.v)(top);
  const arc = d3.arc().innerRadius(62).outerRadius(94).padAngle(0.015).cornerRadius(3);
  const g = svg.append('g').attr('transform', 'translate(100,100)');
  g.selectAll('path').data(arcs).join('path').attr('d', arc).attr('fill', (d, i) => color(d.data, i))
    .on('pointermove', (ev, d) => tipAt(tip, box, ev, [d.data.label, d3.format('.1%')(d.data.v / total) + '　' + fmt(d.data.v)])).on('pointerleave', () => { tip.style.display = 'none'; });
  g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.3em').attr('fill', CV('--mut')).style('font-size', '11px').text('合計');
  g.append('text').attr('text-anchor', 'middle').attr('dy', '1.1em').attr('fill', CV('--fg')).style('font-family', 'var(--sans)').style('font-weight', 600).style('font-size', '15px').text(fmt(total));
  const li = legend.selectAll('li').data(top).join('li');
  li.append('span').attr('class', 'sw').style('background', (d, i) => color(d, i));
  li.append('span').text(d => d.label);
  li.append('span').attr('class', 'lv').text(d => d3.format('.1%')(d.v / total));
}
function drawDonuts(pos) {
  if (!pos) { ['all', 'tw', 'us'].forEach(k => drawDonut(k, null)); return; }
  const usd0 = v => 'US$' + d3.format(',.0f')(v), lab = r => r.code === 'CASH' ? '嘉信現金' : r.code === 'TWCASH' ? '國泰現金' : r.code + ' ' + r.name;
  drawDonut('all', pos.map(r => ({label: lab(r), v: r.value_twd})), v => nt(v));
  drawDonut('tw', pos.filter(r => r.market === '台股').map(r => ({label: lab(r), v: r.value})), v => nt(v));
  drawDonut('us', pos.filter(r => r.market === '美股').map(r => ({label: lab(r), v: r.value})), usd0);
}


dash.calc('goal_pace', {
  inputs: ['goals', 'totals'],
  title: '資產目標進度線',
  description: '用起始資產與每年投入，反推 10 年到目標所需年化報酬率；台股、美股用同一報酬率、各自的起始資產與投入，算出今天與各年度檢查點應有的金額；超前月數＝照進度線要再過幾個月才會到現在的金額（負數＝落後）',
  fn: (goals, totals) => {
    const g = goals[0], t = totals[0], N = Number(g.years), TG = Number(g.target_twd);
    const fv = (p, c, r, y) => p * Math.pow(1 + r, y) + c * (Math.pow(1 + r, y) - 1) / r;
    let lo = 1e-6, hi = 1; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (fv(Number(g.start_total_twd), Number(g.annual_contrib_twd), m, N) < TG) lo = m; else hi = m; }
    const r = (lo + hi) / 2, t0 = Date.parse(g.start_date + 'T00:00:00+08:00');
    const yrs = Math.max(0, (Date.now() - t0) / (365.25 * 864e5));
    const arr = v => (typeof v === 'string' ? JSON.parse(v) : (v || [])).map(Number);
    const eta = (p, c, m) => { let a = 0, b = 80; for (let i = 0; i < 60; i++) { const x = (a + b) / 2; if (fv(p, c, r, x) < m) a = x; else b = x; } return new Date(t0 + b * 365.25 * 864e5).toISOString().slice(0, 7); };
    const cps = arr(g.market_checkpoint_years);
    const one = (scope, label, p, c, cur, mil) => {
      const pace = fv(p, c, r, yrs), nx = mil.find(m => m > cur) || null;
      const checkpoints = scope === 'total' ? [] : cps.map(y => ({year: y, date: new Date(t0 + y * 365.25 * 864e5).toISOString().slice(0, 7), pace: fv(p, c, r, y), passed: yrs >= y}));
      let a = -30, b = 80; for (let i = 0; i < 60; i++) { const x = (a + b) / 2; if (fv(p, c, r, x) < cur) a = x; else b = x; }
      const ahead_months = (b - yrs) * 12;
      return {scope, label, current: cur, pace, diff: cur - pace, diff_pct: (cur - pace) / pace, ahead_months, years_elapsed: yrs, rate: r, start: p, annual_contrib: c,
        target_end: fv(p, c, r, N), next_milestone: nx, next_eta: nx ? eta(p, c, nx) : null, checkpoints};
    };
    return [one('total', '總資產', Number(g.start_total_twd), Number(g.annual_contrib_twd), Number(t.total_twd), arr(g.total_milestones)),
      one('tw', '台股', Number(g.tw_start_twd), Number(g.tw_annual_contrib_twd), Number(t.tw_twd), []),
      one('us', '美股', Number(g.us_start_twd), Number(g.us_annual_contrib_twd), Number(t.us_twd), [])];
  }
});
dash.calc('goal_catchup', {
  inputs: ['goal_pace', 'positions', 'watchlist', 'fx'],
  title: '落後時的補進度建議',
  description: '落後金額＝應有−現在；台股、美股各換算成設定的補進度標的股數（用最新價）；另算到下個檢查點前每月要多投入多少（同年化報酬率）；落後不到 3% 視為正常波動',
  fn: (goal_pace, positions, watchlist, fx) => {
    const rate = Number(fx[0].rate);
    const px = code => { const p = positions.find(r => r.code === code); if (p) return p.price; const w = watchlist.find(r => r.code === code); return w && w.price !== null ? Number(w.price) : null; };
    return goal_pace.filter(g => g.scope !== 'total').map(g => {
      const tw = g.scope === 'tw', code = tw ? window.INV_CFG.catchupTw : window.INV_CFG.catchupUs, price = px(code);
      const gap = Math.max(0, -g.diff), r = g.rate;
      let cp = g.checkpoints; if (typeof cp === 'string') cp = JSON.parse(cp); cp = cp || [];
      const nx = cp.find(c => !c.passed);
      let extra_monthly = null, months_left = null;
      if (nx && gap > 0) {
        const tl = Math.max(1 / 12, nx.year - Number(g.years_elapsed));
        months_left = Math.max(1, Math.round(tl * 12));
        const grow = Math.pow(1 + r, tl), ann = (grow - 1) / r;
        const fvNow = g.current * grow + g.annual_contrib * ann;
        extra_monthly = Math.max(0, (nx.pace - fvNow) / ann / 12);
      }
      const gap_native = tw ? gap : gap / rate;
      return {scope: g.scope, code, price, gap_twd: gap, gap_pct: gap / g.pace, level: gap === 0 ? 'ahead' : gap / g.pace < 0.03 ? 'normal' : 'act',
        shares: price ? Math.ceil(gap_native / price) : null, tranches: tw && window.INV_CFG.trancheTwd ? Math.ceil(gap / window.INV_CFG.trancheTwd) : null,
        extra_monthly_twd: extra_monthly, months_left, checkpoint: nx ? nx.date : null};
    });
  }
});
dash.calc('plan_next', {
  inputs: ['plans', 'positions', 'watchlist'],
  title: '離觸發最近的計畫價',
  description: '每條計畫價與現價的距離（計畫價÷現價−1）；停損、加碼、買點在現價以上、或停利、掛單、突破線在現價以下＝已到價；路線B標的以前收×0.97 當觸發價',
  fn: (plans, positions, watchlist) => {
    const q = {};
    positions.forEach(r => { q[r.code] = {price: r.price, prev: r.day_pct === null ? null : r.price / (1 + r.day_pct)}; });
    watchlist.forEach(w => { if (!q[w.code] && w.price !== null && w.price !== undefined) q[w.code] = {price: Number(w.price), prev: w.prev_price === null || w.prev_price === undefined ? null : Number(w.prev_price)}; });
    const out = [];
    plans.forEach(p => {
      const x = q[p.code]; if (!x || !x.price) return;
      let mk = p.marks; if (typeof mk === 'string') mk = JSON.parse(mk); mk = mk || [];
      const push = (label, kind, v, dir) => { const dist = v / x.price - 1; const below = dir ? dir === 'below' : (kind === 'stop' || kind === 'add');
        out.push({id: p.code + '|' + label + '|' + v, code: p.code, label, kind, value: v, price: x.price, dist, hit: below ? dist >= 0 : dist <= 0}); };
      mk.forEach(m => push(m.label, m.kind, Number(m.value), m.dir));
      if (p.day_trigger !== null && p.day_trigger !== undefined && x.prev) push('路線B 觸發', 'add', Math.round(x.prev * (1 + Number(p.day_trigger)) * 100) / 100);
    });
    return out.sort((a, b) => (b.hit - a.hit) || Math.abs(a.dist) - Math.abs(b.dist));
  }
});
dash.calc('rule_usage', {
  inputs: ['rules', 'positions', 'totals'],
  title: '部位上限使用率',
  description: '各題材或個股市值（台幣）÷總資產或美股帳戶（含嘉信現金、扣賣出選擇權）；次數與金額型規則照紀錄',
  fn: (rules, positions, totals) => {
    const t = totals[0];
    return rules.map(r => {
      let codes = r.codes; if (typeof codes === 'string') codes = JSON.parse(codes); codes = codes || [];
      if (r.kind === 'cap') {
        const v = positions.filter(p => codes.includes(p.code)).reduce((a, p) => a + p.value_twd, 0);
        const base = r.base === 'us' ? t.us_twd : t.total_twd, share = v / base;
        return {key: r.key, label: r.label, kind: r.kind, value_twd: v, share, cap: Number(r.cap), cap_final: r.cap_final === null || r.cap_final === undefined ? null : Number(r.cap_final), note: r.note || ''};
      }
      return {key: r.key, label: r.label, kind: r.kind, used: r.used === undefined ? null : Number(r.used), limit: r.limit === undefined ? null : Number(r.limit), month: r.month || null, amount_twd: r.amount_twd === undefined ? null : Number(r.amount_twd), note: r.note || ''};
    });
  }
});
const wan = v => d3.format(',.3f')(v / 1e6) + 'M';
const wan0 = v => d3.format(',.2~f')(v / 1e6) + 'M';
function drawGoals() {
  const G = rows('goal_pace'), RG = rows('goals');
  const box = document.getElementById('goal-total'), mk = document.getElementById('goal-markets'), note = document.getElementById('goal-note');
  box.textContent = ''; mk.textContent = '';
  if (!G || !G.length || !RG || !RG.length) return;
  const g = RG[0], tot = G.find(x => x.scope === 'total');
  let ms = g.total_milestones, mm = g.market_milestones;
  if (typeof ms === 'string') { try { ms = JSON.parse(ms); } catch (e) { ms = []; } }
  if (typeof mm === 'string') { try { mm = JSON.parse(mm); } catch (e) { mm = []; } }
  ms = (ms || []).map(Number); mm = (mm || []).map(Number);
  const TG = Number(g.target_twd), N = Number(g.years), cur = tot.current, pace = tot.pace, diff = tot.diff;
  note.textContent = '計畫：' + String(g.start_date).replace(/-/g, '/') + ' 起算 ' + N + ' 年到 ' + wan0(TG) + '；每年投入 ' + wan0(Number(g.annual_contrib_twd)) + '（台股 ' + wan0(Number(g.tw_annual_contrib_twd)) + '＋美股 ' + wan0(Number(g.us_annual_contrib_twd)) + '，年終分紅未計），需年化約 ' + d3.format('.1%')(tot.rate) + '。黃線＝照計畫今天應有的位置；台股、美股用同一報酬率，兩條進度線加起來＝總資產進度線，下方是第 1／3／5／10 年檢查點';
  const max = ms.find(m => m >= Math.max(cur, pace) * 1.02 && m >= TG) || ms[ms.length - 1] || TG;
  const x = v => Math.min(100, v / max * 100) + '%';
  const bar = document.createElement('div'); bar.className = 'sd-gbar';
  const fill = document.createElement('div'); fill.className = 'fill'; fill.style.width = x(cur); bar.appendChild(fill);
  ms.filter(m => m <= max).forEach(m => { const k = document.createElement('div'); k.className = 'tick' + (cur >= m ? ' done' : '') + (m === max ? ' last' : ''); k.style.left = x(m); const sp = document.createElement('span'); sp.textContent = (cur >= m ? '✓ ' : '') + wan0(m); k.appendChild(sp); bar.appendChild(k); });
  const pc = document.createElement('div'); pc.className = 'pace'; pc.style.left = x(pace); bar.appendChild(pc);
  const lg = document.createElement('div'); lg.className = 'sd-glg';
  [['#2fd47a', '現在 ' + wan(cur)], ['#f5b942', '照計畫應有 ' + wan(pace)]].forEach(([c, tx]) => { const sp = document.createElement('span'); const i = document.createElement('i'); i.style.background = c; sp.append(i, tx); lg.appendChild(sp); });
  box.append(lg, bar);
  const status = (d, p) => Math.abs(d) < p * 0.005 ? ['對照計畫', '符合進度', ''] : [d >= 0 ? '超前計畫' : '落後計畫', (d >= 0 ? '+' : '−') + wan(Math.abs(d)) + '（' + d3.format('+.1%')(d / p) + '）', d >= 0 ? 'up' : 'down'];
  const line = document.createElement('div'); line.className = 'sd-gline';
  const parts = [['總資產', wan(cur)], status(diff, pace)];
  if (tot.next_milestone) parts.push(['距 ' + wan0(tot.next_milestone), '還差 ' + wan(tot.next_milestone - cur) + '（' + d3.format('.0%')(cur / tot.next_milestone) + '）']);
  if (tot.next_eta) parts.push(['照計畫到 ' + wan0(tot.next_milestone), tot.next_eta.replace('-', '/')]);
  parts.forEach(([a, b, c]) => { const sp = document.createElement('span'); sp.textContent = a + ' '; const bb = document.createElement('b'); bb.textContent = b; if (c) bb.className = c; sp.appendChild(bb); line.appendChild(sp); });
  box.appendChild(line);
  G.filter(x => x.scope !== 'total').forEach(m => {
    const v = m.current, d = document.createElement('div');
    let cp = m.checkpoints; if (typeof cp === 'string') { try { cp = JSON.parse(cp); } catch (e) { cp = []; } } cp = cp || [];
    const h = document.createElement('h3'); h.textContent = m.scope === 'tw' ? '台股' : '美股（含嘉信現金，台幣）';
    const nx = cp.find(c => !c.passed);
    const vv = document.createElement('div'); vv.className = 'v'; vv.textContent = 'NT$' + wan(v);
    const mini = document.createElement('div'); mini.className = 'mini'; mini.style.position = 'relative'; const i = document.createElement('i'); i.style.width = (nx ? Math.min(100, v / nx.pace * 100) : 100) + '%'; mini.appendChild(i);
    if (nx) { const pm = document.createElement('em'); pm.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:#f5b942;left:' + Math.min(100, m.pace / nx.pace * 100) + '%'; mini.appendChild(pm); }
    const st = status(m.diff, m.pace);
    const pace = document.createElement('div'); pace.className = 'pace';
    const add = (a, b, c) => { const sp = document.createElement('span'); sp.textContent = a + ' '; const bb = document.createElement('b'); bb.textContent = b; if (c) bb.className = c; sp.appendChild(bb); pace.appendChild(sp); pace.appendChild(document.createTextNode('　')); };
    add('照計畫應有', wan(m.pace)); add(st[0], st[1], st[2]);
    if (nx) add('下個檢查點 ' + nx.date.replace('-', '/'), wan(nx.pace) + '（' + d3.format('.0%')(v / nx.pace) + '）');
    const pace2 = document.createElement('div'); pace2.className = 'pace';
    pace2.textContent = '起始 ' + wan(m.start) + '｜每年投入 ' + wan0(m.annual_contrib) + '｜年化 ' + d3.format('.1%')(m.rate);
    const pills = document.createElement('div'); pills.className = 'sd-pills'; pills.style.marginTop = '8px';
    cp.forEach(c => { const sp = document.createElement('span'); sp.className = c.passed ? 'done' : (c === nx ? 'next' : ''); sp.textContent = '第' + c.year + '年 ' + c.date.replace('-', '/') + '　' + wan0(Math.round(c.pace / 1e4) * 1e4); pills.appendChild(sp); });
    d.append(h, vv, mini, pace, pace2, pills); mk.appendChild(d);
  });
}

function drawGoalStatus() {
  const list = document.getElementById('goal-status-list'), note = document.getElementById('goal-status-note');
  list.textContent = '';
  const G = rows('goal_pace'), RG = rows('goals'); if (!G || !G.length) { note.textContent = '—'; return; }
  const g = RG && RG[0];
  note.textContent = '對照 10 年 ' + (g ? wan0(Number(g.target_twd)) : '千萬') + ' 計畫的進度線（年化約 ' + d3.format('.1%')(G[0].rate) + '）；超前／落後月數＝照進度要再過多久才會到現在的金額';
  const mo = m => { const a = Math.abs(m); return a >= 12 ? d3.format('.1f')(a / 12) + ' 年' : d3.format('.1f')(a) + ' 個月'; };
  G.forEach(x => {
    const d = document.createElement('div');
    const k = document.createElement('div'); k.className = 'k'; k.textContent = x.scope === 'total' ? '合計' : x.scope === 'tw' ? '台股' : '美股';
    const on = Math.abs(x.diff) < x.pace * 0.005;
    const st = document.createElement('div'); st.className = 'st ' + (on ? '' : x.diff >= 0 ? 'up' : 'down');
    st.textContent = on ? '符合進度' : (x.diff >= 0 ? '超前 ' : '落後 ') + mo(x.ahead_months);
    const sm = document.createElement('small'); sm.textContent = (x.diff >= 0 ? '+' : '−') + wan(Math.abs(x.diff)) + '（' + d3.format('+.1%')(x.diff_pct) + '）'; st.appendChild(sm);
    const p = document.createElement('p');
    const b1 = document.createElement('b'); b1.textContent = wan(x.current); const b2 = document.createElement('b'); b2.textContent = wan(x.pace);
    p.append('現在 ', b1, '　應有 ', b2);
    let cp = x.checkpoints; if (typeof cp === 'string') { try { cp = JSON.parse(cp); } catch (e) { cp = []; } }
    const nx = (cp || []).find(c => !c.passed);
    const p2 = document.createElement('p');
    if (x.scope === 'total' && x.next_milestone) p2.textContent = '下一關 ' + wan0(x.next_milestone) + '：照進度 ' + String(x.next_eta).replace('-', '/') + ' 到';
    else if (nx) p2.textContent = '下個檢查點 ' + nx.date.replace('-', '/') + ' 應有 ' + wan0(Math.round(nx.pace / 1e4) * 1e4) + '（已達 ' + d3.format('.0%')(x.current / nx.pace) + '）';
    d.append(k, st, p, p2);
    const C = rows('goal_catchup'), cu = C && C.find(c => c.scope === x.scope);
    if (cu && cu.level !== 'ahead') {
      const p3 = document.createElement('p'); p3.className = 'cu ' + cu.level;
      const lump = cu.code === window.INV_CFG.catchupTw ? '一次補 ' + nt(cu.gap_twd) + ' ≈ ' + cu.code + ' ' + d3.format(',')(cu.shares) + ' 股（路線B每次上限 ' + d3.format(',')(window.INV_CFG.trancheTwd) + '，約分 ' + cu.tranches + ' 次）'
        : '一次補約 ' + usd(cu.gap_twd / Number((rows('fx') || [{rate: 1}])[0].rate), 0) + ' ≈ ' + cu.code + ' ' + d3.format(',')(cu.shares) + ' 股';
      const mon = cu.extra_monthly_twd !== null ? '；或到 ' + String(cu.checkpoint).replace('-', '/') + ' 前每月多投 ' + nt(Math.ceil(cu.extra_monthly_twd / 100) * 100) : '';
      p3.textContent = (cu.level === 'normal' ? '落後不到 3%，屬正常波動，可先不動。若要補：' : '補進度建議：') + lump + mon;
      d.appendChild(p3);
    }
    list.appendChild(d);
  });
}
document.getElementById('goal-status-link').addEventListener('click', () => { const t = document.getElementById('tab-plans'); if (t) t.click(); const el = document.getElementById('goals'); if (el) setTimeout(() => el.scrollIntoView({behavior: 'smooth', block: 'start'}), 50); });

function drawSectors() {
  const svg = d3.select('#sector-svg'), box = svg.node().parentNode, tip = box.querySelector('.sd-tip');
  svg.selectAll('*').remove();
  const M = rows('sector_mix'), S = rows('sectors'), C = rows('concentration');
  const note = document.getElementById('sector-note');
  const asOf = S ? [...new Set(S.filter(s => s.kind === 'etf' && s.as_of).map(s => s.code + ' ' + String(s.as_of).slice(5).replace('-', '/')))] : [];
  note.textContent = '不含嘉信現金；ETF 依成分產業拆分' + (asOf.length ? '（成分資料日：' + asOf.join('、') + '）' : '') + '；黃色為 AI／半導體相關部分，滑過看組成';
  const conc = document.getElementById('conc'); conc.textContent = '';
  if (C) C.forEach(c => {
    const d = document.createElement('div'); if (c.key === 'ai' || c.key === 'tsmc') d.className = 'ai';
    const k = document.createElement('span'); k.className = 'k'; k.textContent = c.label;
    const b = document.createElement('b'); b.textContent = c.share === null ? '—' : d3.format('.1%')(c.share);
    const p = document.createElement('p'); p.textContent = (c.value_twd !== null && c.key !== 'mkt' ? nt(c.value_twd) + '｜' : '') + c.note;
    d.append(k, b, p); conc.appendChild(d);
  });
  if (!M || !M.length) return;
  const W = Math.max(280, box.clientWidth), rowH = 26, H = M.length * rowH + 6;
  svg.attr('height', H).attr('viewBox', '0 0 ' + W + ' ' + H);
  const lw = 78, rw = 112, x = d3.scaleLinear().domain([0, d3.max(M, m => Number(m.share)) || 1]).range([0, W - lw - rw]);
  const g = svg.selectAll('g').data(M).join('g').attr('transform', (d, i) => 'translate(0,' + (i * rowH + 3) + ')');
  g.append('text').attr('x', 0).attr('y', 14).attr('fill', CV('--fg')).style('font-size', '12px').text(d => d.sector);
  g.append('rect').attr('x', lw).attr('y', 3).attr('height', 16).attr('rx', 3).attr('width', d => Math.max(1, x(Number(d.share)))).attr('fill', '#38bdf8').attr('opacity', .85);
  g.append('rect').attr('x', lw).attr('y', 3).attr('height', 16).attr('rx', 3).attr('width', d => Number(d.value_twd) ? x(Number(d.share)) * Number(d.ai_twd) / Number(d.value_twd) : 0).attr('fill', '#f5b942');
  g.append('text').attr('x', d => lw + x(Number(d.share)) + 6).attr('y', 15).attr('fill', CV('--mut')).style('font-size', '11px')
    .text(d => d3.format('.1%')(Number(d.share)) + '　' + d3.format(',.2f')(Number(d.value_twd) / 1e6) + 'M');
  g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH).attr('fill', 'transparent')
    .on('pointermove', (ev, d) => {
      let mem = d.members; if (typeof mem === 'string') { try { mem = JSON.parse(mem); } catch (e) { mem = []; } }
      tipAt(tip, box, ev, [d.sector + '　' + d3.format('.1%')(Number(d.share))].concat((mem || []).slice(0, 8).map(m => m.code + (m.etf ? '（ETF 拆分）' : '') + '　' + nt(m.v))));
    }).on('pointerleave', () => { tip.style.display = 'none'; });
}

const ST = {placed: '已掛單', unplaced: '未掛單', wait: '等條件', pending: '待決定', hold: '續抱'};
function drawPlans(pos) {
  const list = document.getElementById('plan-list'); list.textContent = '';
  const P = rows('plans'), W = rows('watchlist') || []; if (!P || !pos) return;
  const byCode = Object.fromEntries(pos.map(r => [r.code, r]));
  W.forEach(w => { if (!byCode[w.code] && w.price !== null && w.price !== undefined) byCode[w.code] = {code: w.code, price: Number(w.price), currency: w.market === '美股' ? 'USD' : 'TWD'}; });
  P.forEach(p => {
    const r = byCode[p.code];
    const row = document.createElement('div'); row.className = 'sd-plan';
    const pc = document.createElement('div'); pc.className = 'pc';
    const b = document.createElement('b'); b.textContent = p.code; pc.appendChild(b);
    const sp = document.createElement('span'); sp.textContent = (r ? (r.currency === 'USD' ? '$' : '') + num(r.price, r.price < 1000 ? 2 : 0) + '｜' : '') + p.role; pc.appendChild(sp);
    const chip = document.createElement('span'); chip.className = 'sd-chip st-' + (p.status || 'wait'); chip.textContent = (p.group === 'watch' ? '追蹤・' : '') + (ST[p.status] || p.status || ''); pc.appendChild(chip);
    row.appendChild(pc);
    const tr = document.createElement('div'); tr.className = 'sd-track';
    let mk0 = p.marks; if (typeof mk0 === 'string') { try { mk0 = JSON.parse(mk0); } catch (e) { mk0 = []; } } if (!Array.isArray(mk0)) mk0 = [];
    const marks = mk0.map(m => ({...m, value: Number(m.value)}));
    if (r && marks.length) {
      const vals = marks.map(m => m.value).concat([r.price]);
      const lo = d3.min(vals), hi = d3.max(vals), span = (hi - lo) || hi * 0.2;
      const a = lo - span * 0.12, z = hi + span * 0.12, X = v => ((v - a) / (z - a) * 100);
      const bar = document.createElement('div'); bar.className = 'sd-bar'; tr.appendChild(bar);
      marks.sort((m1, m2) => m1.value - m2.value).forEach((m, i) => {
        const mk = document.createElement('div'); mk.className = 'sd-mk k-' + m.kind; mk.style.left = X(m.value) + '%'; tr.appendChild(mk);
        const ml = document.createElement('div'); ml.className = 'sd-ml ' + (i % 2 ? 'b' : 't'); ml.style.left = Math.min(92, Math.max(8, X(m.value))) + '%';
        ml.textContent = m.label + ' ' + (m.value < 20 ? num(m.value, 2) : d3.format(',')(m.value)); tr.appendChild(ml);
      });
      const px = document.createElement('div'); px.className = 'sd-px'; px.style.left = X(r.price) + '%'; px.title = '現價 ' + r.price; tr.appendChild(px);
      row.appendChild(tr);
    } else { tr.style.height = 'auto'; row.appendChild(tr); }
    const note = document.createElement('div'); note.className = 'sd-pnote';
    const txt = (p.action || '') + (p.status_note ? '（' + p.status_note + '）' : '') + (p.decided ? '｜定案 ' + String(p.decided).slice(5).replace('-', '/') : '');
    if (r && marks.length) {
      const near = marks.reduce((x, y) => Math.abs(y.value / r.price - 1) < Math.abs(x.value / r.price - 1) ? y : x);
      const d = near.value / r.price - 1;
      const bb = document.createElement('b'); bb.textContent = '最近：' + near.label + ' ' + (d > 0 ? '還差 +' : '還差 ') + d3.format('.1%')(d);
      note.appendChild(bb); note.appendChild(document.createTextNode('　' + txt));
    } else note.textContent = txt;
    row.appendChild(note);
    list.appendChild(row);
  });
}

function drawNext() {
  const list = document.getElementById('next-list'); list.textContent = '';
  const N = rows('plan_next'); if (!N) return;
  const show = N.filter(n => n.hit || Math.abs(n.dist) <= 0.15);
  if (!show.length) { const e = document.createElement('div'); e.className = 'sd-empty'; e.textContent = '15% 以內沒有計畫價'; list.appendChild(e); return; }
  show.forEach(n => {
    const it = document.createElement('div'); it.className = 'sd-nx' + (n.hit ? ' hit' : Math.abs(n.dist) <= 0.05 ? ' near' : '');
    const b = document.createElement('b'); b.textContent = n.code;
    const l = document.createElement('span'); const i = document.createElement('i'); i.className = 'k-' + n.kind; i.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px';
    l.append(i, n.label + ' ' + (n.value < 20 ? num(n.value, 2) : d3.format(',.2~f')(n.value)));
    const d = document.createElement('span'); d.className = 'd'; d.textContent = n.hit ? '已到價' : (n.dist > 0 ? '+' : '') + d3.format('.1%')(n.dist);
    const m = document.createElement('span'); m.className = 'mut'; m.textContent = '現價 ' + (n.price < 20 ? num(n.price, 2) : d3.format(',.2~f')(n.price));
    it.append(b, l, d, m); list.appendChild(it);
  });
}

function drawDeadlines() {
  const list = document.getElementById('dl-list'); list.textContent = '';
  const P = rows('plans'), O = rows('options'); if (!P) return;
  const td = new Date(today() + 'T00:00:00+08:00');
  const items = [];
  P.forEach(p => { if (p.deadline) items.push({date: p.deadline, code: p.code, title: p.deadline_label || '', sub: p.action || ''}); });
  (O || []).forEach(o => { if (o.kind === 'option' && o.expiry && !items.some(x => x.code === o.code && x.date === o.expiry)) items.push({date: o.expiry, code: o.code, title: '選擇權到期', sub: o.title}); });
  items.forEach(x => { x.days = Math.round((new Date(x.date + 'T00:00:00+08:00') - td) / 864e5); });
  items.sort((a, b) => a.days - b.days);
  if (!items.length) { const e = document.createElement('div'); e.className = 'sd-empty'; e.textContent = '目前沒有有日期的計畫'; list.appendChild(e); return; }
  items.forEach(x => {
    const it = document.createElement('div'); it.className = 'sd-dl' + (x.days < 0 ? ' over' : x.days <= 7 ? ' soon' : '');
    const n = document.createElement('div'); n.className = 'n'; n.textContent = x.days < 0 ? '已過' : x.days; if (x.days >= 0) { const sm = document.createElement('small'); sm.textContent = '天'; n.appendChild(sm); }
    const t = document.createElement('div'); const b = document.createElement('b'); b.textContent = x.code + '　' + x.title; t.append(b, document.createTextNode('　' + x.date.slice(5).replace('-', '/')));
    const s2 = document.createElement('div'); s2.textContent = x.sub;
    it.append(n, t, s2); list.appendChild(it);
  });
}

function drawRules() {
  const list = document.getElementById('rule-list'); list.textContent = '';
  const R = rows('rule_usage'); if (!R) return;
  const ym = today().slice(0, 7);
  R.forEach(r => {
    const d = document.createElement('div');
    const k = document.createElement('div'); k.className = 'k'; k.textContent = r.label;
    const v = document.createElement('div'); v.className = 'v';
    const p = document.createElement('p');
    if (r.kind === 'cap') {
      const over = r.share > r.cap, warn = !over && (r.share > r.cap * 0.8 || (r.cap_final !== null && r.share > r.cap_final));
      d.className = over ? 'over' : warn ? 'warn' : '';
      v.textContent = d3.format('.1%')(r.share); const sm = document.createElement('small'); sm.textContent = '上限 ' + d3.format('.0%')(r.cap) + (over ? '・超過' : ''); v.appendChild(sm);
      const bar = document.createElement('div'); bar.className = 'bar'; const i = document.createElement('i'); i.style.width = Math.min(100, r.share / r.cap * 100) + '%'; bar.appendChild(i);
      if (r.cap_final !== null) { const em = document.createElement('em'); em.style.left = Math.min(100, r.cap_final / r.cap * 100) + '%'; bar.appendChild(em); }
      p.textContent = 'NT$' + wan(r.value_twd) + (r.note ? '｜' + r.note : '');
      d.append(k, v, bar, p);
    } else if (r.kind === 'count') {
      const used = r.month === ym ? r.used : 0;
      v.textContent = used + ' / ' + r.limit; const sm = document.createElement('small'); sm.textContent = ym.replace('-', '/') + (r.month === ym ? '' : '（新月份歸零）'); v.appendChild(sm);
      p.textContent = r.note; d.append(k, v, p);
    } else {
      v.textContent = r.amount_twd ? nt(r.amount_twd) : 'NT$0'; p.textContent = r.note; d.append(k, v, p);
    }
    list.appendChild(d);
  });
}

function drawOptions(pos) {
  const list = document.getElementById('opt-list'); list.textContent = '';
  const O = rows('options'); if (!O) return;
  const byCode = Object.fromEntries((pos || []).map(r => [r.code, r]));
  if (!O.length) { list.innerHTML = '<div class="sd-empty">目前沒有選擇權部位或掛單</div>'; return; }
  O.forEach(o => {
    const it = document.createElement('div'); it.className = 'sd-item';
    const t = document.createElement('div'); t.className = 't';
    const b = document.createElement('b'); b.textContent = o.title; t.appendChild(b);
    const c = document.createElement('span'); c.className = 'sd-chip ' + (o.kind === 'option' ? 'opt' : 'ord'); c.textContent = o.kind === 'option' ? '選擇權' : '掛單'; t.appendChild(c);
    it.appendChild(t);
    const m = document.createElement('div'); m.className = 'm';
    const bits = [o.status];
    const r = byCode[o.code];
    if (o.strike && r) bits.push('現價 ' + num(r.price) + '，距 ' + pct(o.strike / r.price - 1, 1));
    if (o.expiry) { const dd = Math.round((new Date(o.expiry + 'T00:00:00+08:00') - new Date(today() + 'T00:00:00+08:00')) / 864e5); bits.push((o.kind === 'option' ? '到期 ' : '期限 ') + o.expiry.slice(5).replace('-', '/') + '（' + (dd >= 0 ? '剩 ' + dd + ' 天' : '已過') + '）'); }
    if (o.note) bits.push(o.note);
    m.textContent = bits.join('｜'); it.appendChild(m);
    list.appendChild(it);
  });
}

function drawEvents() {
  const cal = document.getElementById('ev-cal'), det = document.getElementById('ev-detail');
  cal.textContent = ''; det.textContent = '';
  const E = rows('events'); if (!E) return;
  const KIND = {earnings: '財報', option: '到期', plan: '計畫', dividend: '配息', macro: '總經'};
  const td = today(); const [ty, tm] = td.split('-').map(Number);
  const byDate = {}; E.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const short = e => (e.approx ? '~' : '') + (e.code ? e.code : String(e.title).replace(/（.*$/, '').slice(0, 4));
  const showDay = (ds) => {
    det.textContent = '';
    const list = byDate[ds] || []; if (!list.length) return;
    list.forEach(e => { const r = document.createElement('div'); r.className = 'row'; const b = document.createElement('b'); b.textContent = (e.approx ? '約 ' : '') + ds.slice(5).replace('-', '/'); const s = document.createElement('span'); s.textContent = e.title; r.append(b, s); det.appendChild(r); });
  };
  for (let k = 0; k < 3; k++) {
    let y = ty, m = tm + k; if (m > 12) { m -= 12; y += 1; }
    const box = document.createElement('div'); box.className = 'sd-mon';
    const h = document.createElement('h3'); h.textContent = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1] + ' ' + y; box.appendChild(h);
    const g = document.createElement('div'); g.className = 'sd-mgrid';
    '日一二三四五六'.split('').forEach(w => { const d = document.createElement('div'); d.className = 'sd-wd'; d.textContent = w; g.appendChild(d); });
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let i = 0; i < first; i++) { const d = document.createElement('div'); d.className = 'sd-day out'; g.appendChild(d); }
    for (let dd = 1; dd <= days; dd++) {
      const ds = y + '-' + String(m).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
      const cell = document.createElement('div'); cell.className = 'sd-day' + (ds === td ? ' today' : ds < td ? ' past' : '');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = dd; cell.appendChild(n);
      const list = byDate[ds] || [];
      if (list.length) {
        cell.classList.add('has'); cell.title = list.map(e => e.title).join('\n');
        list.slice(0, 3).forEach(e => { const c = document.createElement('span'); c.className = 'sd-ec ev-' + e.kind; c.textContent = short(e); cell.appendChild(c); });
        if (list.length > 3) { const c = document.createElement('span'); c.className = 'sd-ec'; c.textContent = '+' + (list.length - 3); cell.appendChild(c); }
        cell.addEventListener('click', () => showDay(ds)); cell.addEventListener('pointerenter', () => showDay(ds));
      }
      g.appendChild(cell);
    }
    box.appendChild(g); cal.appendChild(box);
  }
  const next = Object.keys(byDate).filter(d => d >= td).sort()[0]; if (next) showDay(next);
}

function drawWatch() {
  const body = document.getElementById('wl-body'); body.textContent = '';
  const L = rows('watchlist'); if (!L) return;
  L.forEach(w => {
    const tr = document.createElement('tr'); tr.dataset.key = w.code;
    const price = w.price === null || w.price === undefined ? null : Number(w.price);
    const prev = w.prev_price === null || w.prev_price === undefined ? null : Number(w.prev_price);
    const td = (t, c) => { const e = document.createElement('td'); e.textContent = t; if (c) e.className = c; tr.appendChild(e); return e; };
    td(w.code, 'l'); td(w.name, 'l nm');
    td(price === null ? '—' : num(price, 2), price === null ? 'nm' : '');
    const ch = price !== null && prev ? price / prev - 1 : null; td(ch === null ? '—' : pct(ch, 2), ch === null ? 'nm' : cls(ch));
    const zl = w.zone_low, zh = w.zone_high;
    td(zl ? d3.format(',')(zl) + (zh ? '～' + d3.format(',')(zh) : '') : '—', 'nm');
    const st = td('', '');
    if (zl && price !== null) {
      const top = zh || zl, p = document.createElement('span');
      if (price <= top && price >= zl * 0.97) { p.className = 'sd-pill in'; p.textContent = '在加碼區'; }
      else if (price > top) { const d = top / price - 1; p.className = 'sd-pill ' + (d > -0.05 ? 'near' : 'far'); p.textContent = '還差 ' + d3.format('.1%')(d); }
      else { p.className = 'sd-pill in'; p.textContent = '低於區間'; }
      st.appendChild(p);
    } else st.textContent = '—', st.className = 'nm';
    td(w.note || '', 'l nm');
    body.appendChild(tr);
  });
}

function fillTable(bodyId, noteId, list, fmtPx, fmtV) {
  const body = document.getElementById(bodyId); body.textContent = '';
  list.forEach(r => {
    const tr = document.createElement('tr'); tr.dataset.key = r.code;
    const td = (t, c) => { const e = document.createElement('td'); e.textContent = t; if (c) e.className = c; tr.appendChild(e); };
    td(r.code === 'CASH' ? 'CASH' : r.code, 'l'); td(r.name, 'l nm');
    td(fmtPx(r.price)); td(fmtV(r.value));
    td(r.pnl_pct === null ? '—' : pct(r.pnl_pct, 1), cls(r.pnl_pct));
    td(r.pnl === null ? '—' : (r.pnl > 0 ? '+' : r.pnl < 0 ? '−' : '') + fmtV(Math.abs(r.pnl)).replace(/^[−+]/, ''), cls(r.pnl));
    td(r.avg === null ? '—' : num(r.avg, 2)); td(r.cost === null ? '—' : fmtV(r.cost));
    td(num(r.shares, r.shares % 1 ? 4 : 0));
    body.appendChild(tr);
  });
  const isC = r => r.code === 'CASH' || r.code === 'TWCASH';
  const dates = [...new Set(list.filter(r => !isC(r)).map(r => r.price_date))].filter(Boolean);
  document.getElementById(noteId).textContent = list.length ? '價格日期：' + dates.join('、') + '　共 ' + list.filter(r => !isC(r)).length + ' 檔' : '—';
}

function fillChanges() {
  const body = document.getElementById('ch-body'); body.textContent = '';
  const c = rows('changes'); if (!c) return;
  c.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id) - Number(a.id)).forEach(r => {
    const tr = document.createElement('tr'); tr.dataset.key = String(r.id);
    [[String(r.id)], [r.date, 'l'], [r.code, 'l'], [r.action, 'l'], [num(Number(r.qty), Number(r.qty) % 1 ? 4 : 0)], [num(Number(r.price), 2)], [r.note || '', 'l nm']]
      .forEach(([t, cl]) => { const td = document.createElement('td'); td.textContent = t; if (cl) td.className = cl; tr.appendChild(td); });
    body.appendChild(tr);
  });
}


dash.onData(() => {
  fillHeader();
  drawGoals();
  drawGoalStatus();
  drawTrend();
  const pos = rows('positions');
  drawHeat(pos); drawContrib(pos); drawDonuts(pos); drawSectors(); drawPlans(pos); drawNext(); drawDeadlines(); drawRules(); drawOptions(pos);
  drawEvents(); drawWatch(); fillChanges();
  if (pos) {
    const by = m => pos.filter(r => r.market === m).sort((a, b) => /CASH$/.test(a.code) - /CASH$/.test(b.code) || b.value_twd - a.value_twd);
    fillTable('tw-body', 'tw-note', by('台股'), v => num(v, 2), v => d3.format(',.0f')(v));
    fillTable('us-body', 'us-note', by('美股'), v => num(v, v < 1 ? 4 : 2), v => d3.format(',.0f')(v));
  }
});
})();
