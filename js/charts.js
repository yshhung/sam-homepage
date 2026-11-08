// 折線圖、長條圖（沁耘頁、和果頁共用）：純 SVG，寬度固定 640 用 viewBox 縮放
import { el, shortDate } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};
export const fmt = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US'));

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
export function lineChart(box, series, { fromZero = false, label = (d) => shortDate(d).replace(/（.）/, '') } = {}) {
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
  for (const d of [dates[0], dates[dates.length - 1]]) s.append(svg('text', { x: x(d), y: H - 6, 'text-anchor': d === dates[0] ? 'start' : 'end' }, label(d)));
  box.replaceChildren(s);
}

// 長條：groups = [{label, bars:[{cls, value}]}]
export function barChart(box, groups, label = (l) => l.slice(5).replace(/^0/, '') + ' 月') {
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
    s.append(svg('text', { x: PAD.l + slot * i + slot / 2, y: H - 6, 'text-anchor': 'middle' }, label(g.label)));
  });
  box.replaceChildren(s);
}

