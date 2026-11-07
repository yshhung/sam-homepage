// 沁耘頁：登入後讀 OneDrive「Sam Homepage」的 company_history.json（只讀）與 company_stats.json，畫幾張圖
import { CONFIG } from '../config.js';
import { getAccount, initAuth, isConfigured, login } from './auth.js';
import { oneDriveJson } from './sources.js';
import { dailySeries, latestWithChange, sumLast, webSeries } from './company-data.js';
import { el, shortDate } from './util.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US'));

// 圖的外框：寬度固定 640、用 viewBox 縮放，手機上也看得清楚
const W = 640, H = 200, PAD = { l: 44, r: 12, t: 14, b: 26 };
function frame(max) {
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const top = Math.max(1, niceMax(max));
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + ((H - PAD.t - PAD.b) * i) / 4;
    s.append(svg('line', { class: i === 4 ? 'axis' : 'grid', x1: PAD.l, x2: W - PAD.r, y1: y, y2: y }));
    s.append(svg('text', { x: PAD.l - 6, y: y + 4, 'text-anchor': 'end' }, fmt(top - (top * i) / 4)));
  }
  return { s, top };
}
function niceMax(v) {
  if (!v || v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const yOf = (v, top) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / top);

// 折線：每條 {cls, points:[{date,value}]}，沒有數字的日子斷開；右端標最新值
function lineChart(box, series, { fromZero = false } = {}) {
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const vals = series.flatMap((s) => s.points.map((p) => p.value)).filter((v) => v !== null);
  if (!dates.length || !vals.length) { box.replaceChildren(el('p', { class: 'cp-note' }, '還沒有資料')); return; }
  let lo = fromZero ? 0 : Math.min(...vals), hi = Math.max(...vals);
  if (!fromZero) { const pad = Math.max(1, (hi - lo) * 0.2); lo = Math.max(0, lo - pad); hi += pad; }
  const { s, top } = frame(hi - lo);
  const x = (d) => PAD.l + ((W - PAD.l - PAD.r) * dates.indexOf(d)) / Math.max(1, dates.length - 1);
  const y = (v) => yOf(v - lo, top);
  // y 軸刻度是「值 − lo」，所以重寫一次標籤
  s.querySelectorAll('text').forEach((t, i) => { t.textContent = fmt(lo + top - (top * i) / 4); });
  for (const ln of series) {
    let d = '', pen = false;
    for (const p of ln.points) {
      if (p.value === null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`;
      pen = true;
    }
    s.append(svg('path', { class: `line ${ln.cls}`, d }));
    const last = [...ln.points].reverse().find((p) => p.value !== null);
    if (last) s.append(svg('text', { class: 'val', x: Math.min(W - 4, x(last.date) + 4), y: y(last.value) - 6, 'text-anchor': 'end' }, fmt(last.value)));
  }
  for (const d of [dates[0], dates[dates.length - 1]]) s.append(svg('text', { x: x(d), y: H - 6, 'text-anchor': d === dates[0] ? 'start' : 'end' }, shortDate(d).replace(/（.）/, '')));
  box.replaceChildren(s);
}

// 長條：groups = [{label, bars:[{cls, value}]}]
function barChart(box, groups) {
  const vals = groups.flatMap((g) => g.bars.map((b) => b.value)).filter((v) => v !== null);
  if (!groups.length || !vals.length) { box.replaceChildren(el('p', { class: 'cp-note' }, '還沒有資料')); return; }
  const { s, top } = frame(Math.max(...vals));
  const slot = (W - PAD.l - PAD.r) / groups.length;
  groups.forEach((g, i) => {
    const bw = Math.min(26, (slot - 8) / g.bars.length);
    g.bars.forEach((b, j) => {
      if (b.value === null) return;
      const bx = PAD.l + slot * i + (slot - bw * g.bars.length) / 2 + bw * j;
      const by = yOf(b.value, top);
      s.append(svg('rect', { class: b.cls, x: bx, y: by, width: bw - 2, height: Math.max(1, H - PAD.b - by), rx: 3 }));
      s.append(svg('text', { class: 'val', x: bx + (bw - 2) / 2, y: by - 4, 'text-anchor': 'middle' }, fmt(b.value)));
    });
    s.append(svg('text', { x: PAD.l + slot * i + slot / 2, y: H - 6, 'text-anchor': 'middle' }, g.label.slice(5).replace(/^0/, '') + ' 月'));
  });
  box.replaceChildren(s);
}

function kpi(k, v, sub, tone = '') {
  return el('div', { class: 'cp-kpi' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), el('div', { class: `s ${tone}` }, sub));
}
const delta = (c, unit = '') => (c === null ? '' : `${c > 0 ? '+' : c < 0 ? '−' : '±'}${fmt(Math.abs(c))}${unit}（近 30 天）`);

function render(history, stats) {
  const web = webSeries(history);
  const cur = web[web.length - 1];
  const ig = dailySeries(history, 'instagram', 'followers');
  const fb = dailySeries(history, 'facebook', 'followers');
  const igL = latestWithChange(dailySeries(history, 'instagram', 'followers', 120));
  const fbL = latestWithChange(dailySeries(history, 'facebook', 'followers', 120));
  const w = stats?.website;
  $('take').textContent = [
    cur ? `網站 ${cur.month} 瀏覽 ${fmt(w?.views ?? cur.views)}、訪客 ${fmt(w?.visitors ?? cur.visitors)}` : '',
    igL || fbL ? `追蹤 IG ${fmt(igL?.value ?? null)}・FB ${fmt(fbL?.value ?? null)}` : '',
  ].filter(Boolean).join(' · ') || '還沒有資料';
  $('kpis').replaceChildren(
    kpi('本月瀏覽', fmt(w?.views ?? cur?.views ?? null), cur ? `${cur.month} 累計` : ''),
    kpi('本月訪客', fmt(w?.visitors ?? cur?.visitors ?? null), `文章 ${fmt(w?.posts ?? cur?.posts ?? null)} 篇`),
    kpi('IG 追蹤', fmt(igL?.value ?? null), delta(igL?.change ?? null), igL?.change > 0 ? 'up' : igL?.change < 0 ? 'down' : ''),
    kpi('FB 追蹤', fmt(fbL?.value ?? null), delta(fbL?.change ?? null), fbL?.change > 0 ? 'up' : fbL?.change < 0 ? 'down' : ''),
  );
  barChart($('chart-web'), web.map((r) => ({ label: `${r.month}`, bars: [{ cls: 'b1', value: r.views }, { cls: 'b2', value: r.visitors }] })));
  $('web-note').textContent = cur ? `${cur.month} 是累計到今天` : '';
  lineChart($('chart-fol'), [{ cls: 'l1', points: ig }, { cls: 'l2', points: fb }]);
  lineChart($('chart-reach'), [{ cls: 'l1', points: dailySeries(history, 'instagram', 'views') }, { cls: 'l2', points: dailySeries(history, 'facebook', 'views') }], { fromZero: true });
  const gv = dailySeries(history, 'google', 'views');
  const gi = dailySeries(history, 'google', 'interactions');
  lineChart($('chart-gbp'), [{ cls: 'l1', points: gv }, { cls: 'l3', points: gi }], { fromZero: true });
  const g7 = sumLast(gv, 7), c7 = sumLast(gi, 7);
  $('foot').textContent = `${history?.updated ? `數字更新於 ${history.updated.slice(5)}` : ''}${g7 !== null ? `　Google 商家近 7 天：曝光 ${fmt(g7)}、點擊 ${fmt(c7)}` : ''}`;
}

function status(cls, text) {
  $('status').className = `wk-status ${cls}`;
  $('status-text').textContent = text;
}
function banner(text, button) {
  const b = $('banner');
  b.hidden = false;
  b.replaceChildren(text, ...(button ? [' ', button] : []));
}

async function start() {
  if (!isConfigured()) { status('demo', '未登入'); banner('還沒設定 Microsoft 登入，這一頁需要登入才能看。'); return; }
  try { await initAuth(); } catch (e) { status('bad', '登入失敗'); banner(`登入失敗：${e.message}`); return; }
  if (!getAccount()) {
    status('demo', '未登入');
    banner('請先登入，才能讀你 OneDrive 裡的網站與社群數字。', el('button', { class: 'btn', type: 'button', onclick: () => login() }, '登入'));
    return;
  }
  status('loading', '讀取中');
  try {
    const [history, stats] = await Promise.all([oneDriveJson(CONFIG.companyHistoryPath), oneDriveJson(CONFIG.companyStatsPath)]);
    if (!history && !stats) { status('bad', '沒有資料'); banner('OneDrive 的「Sam Homepage/company_history.json」還沒有。每日同步 07:30 跑過一次就會出現。'); return; }
    render(history || {}, stats);
    status('live', '已同步');
  } catch (e) {
    console.error(e);
    status('bad', '讀取失敗');
    banner(`讀不到資料：${e.message}`);
  }
}

start();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
