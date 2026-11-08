// 生活頁：足跡地圖（去過的地方）、下一趟旅行、生活待辦。資料都在你的 OneDrive「Sam Homepage」
import { CONFIG } from '../config.js';
import { getAccount, initAuth, isConfigured, login } from './auth.js';
import { demoLife, demoTickTick, demoTravels, getTickTick, lifeTasks, oneDriveJson } from './sources.js';
import { dateStr, diffDays, el, relDay, shortDate } from './util.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// 世界地圖：去過的國家上色；香港、新加坡這類太小或沒有獨立輪廓的，靠地點小點標出
async function drawMap(travels) {
  const places = travels?.places || [];
  const seen = new Set(places.map((p) => p.iso).filter(Boolean));
  const world = await (await fetch('vendor/world-110m.json')).json();
  const W = 640;
  const proj = d3.geoNaturalEarth1().fitWidth(W, { type: 'Sphere' });
  const path = d3.geoPath(proj);
  // 南極沒有放，所以只量陸地的範圍，下面不留空白
  const [[x0, y0], [x1, y1]] = path.bounds(world);
  const s = svg('svg', { viewBox: `${(x0 - 4).toFixed(1)} ${(y0 - 4).toFixed(1)} ${(x1 - x0 + 8).toFixed(1)} ${(y1 - y0 + 8).toFixed(1)}` });
  for (const f of world.features) s.append(svg('path', { class: `land${seen.has(String(f.id)) ? ' seen' : ''}`, d: path(f) }));
  const dot = (p, cls, r) => { const xy = proj([p.lon, p.lat]); if (xy) s.append(svg('circle', { class: cls, cx: xy[0].toFixed(1), cy: xy[1].toFixed(1), r })); };
  if (travels?.home) dot(travels.home, 'home', 3.5);
  for (const p of places) dot(p, 'pin', 3);
  $('map').replaceChildren(s);
}

function render(travels, life, tasks, today) {
  const places = travels?.places || [];
  const countries = [...new Set(places.map((p) => p.country))];
  $('take').textContent = places.length ? `去過 ${countries.length} 個國家／地區、${places.length} 個地點` : '還沒有足跡資料';

  const trips = (life?.trips || []).filter((t) => t.start && (t.end || t.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
  const trip = trips.find((t) => t.status !== 'planning') || trips[0] || null;
  const n = trip ? diffDays(trip.start, today) : null;
  const overdue = tasks.filter((t) => t.due < today).length;
  // 地圖下面一行三個數字，取代原本四張大卡
  $('stats').replaceChildren(
    ...[[String(countries.length), '個國家／地區'], [String(places.length), '個地點']].map(([v, k]) => el('div', { class: 'lf-stat' }, el('b', {}, v), el('span', {}, k))));
  $('map-note').textContent = places.length ? '藍＝去過的國家，黃點＝地點' : '';
  $('trip-note').textContent = trip ? (n <= 0 ? '旅行中' : `還有 ${n} 天`) : '';

  const byCountry = new Map();
  for (const p of places) byCountry.set(p.country, [...(byCountry.get(p.country) || []), p]);
  $('places').replaceChildren(...(byCountry.size ? [...byCountry].map(([c, ps]) => el('div', { class: 'lf-country' },
    el('span', { class: 'cn' }, c),
    el('span', { class: 'ps' }, ps.map((x) => (x.year ? `${x.name} ${x.year}` : x.name)).join('、')))) : [el('p', { class: 'cp-note' }, '還沒有資料')]));

  $('trip').replaceChildren(...(trip ? [el('div', { class: 'lf-trip' },
    el('div', { class: 'big' }, trip.name),
    el('div', { class: 'cp-note' }, `${shortDate(trip.start)}${trip.end && trip.end !== trip.start ? ` – ${shortDate(trip.end)}` : ''}${trip.place ? ` · ${trip.place}` : ''}${trip.status === 'planning' ? ' · 規劃中' : ''}`),
    trip.note ? el('div', { class: 'cp-note' }, trip.note) : null,
    trip.url ? el('a', { href: trip.url, target: '_blank', rel: 'noopener' }, '打開行程 ↗') : null)]
    : [el('p', { class: 'cp-note' }, '目前沒有確定的旅行。確定之後告訴 Claude，這裡會出現。')]));

  const shown = tasks.slice(0, 8);
  $('todo-note').textContent = overdue ? `${overdue} 件逾期` : tasks.length > shown.length ? `最近 ${shown.length} 件，共 ${tasks.length} 件` : '';
  $('todo').replaceChildren(...(shown.length ? shown.map((t) => el('li', { class: `f-row ${t.due < today ? 'bad' : t.due === today ? 'warn' : 'info'}` },
    el('div', { class: 'f-top' }, el('span', { class: 'chip' }, t.list.replace(/^\p{Extended_Pictographic}️?/u, '')), el('span', { class: 'f-title' }, t.title)),
    el('div', { class: 'f-meta' }, `${relDay(t.due, today)} · ${shortDate(t.due)}${t.time ? ` ${t.time}` : ''}`))) : [el('li', { class: 'empty' }, '✓ 生活待辦都處理好了')]));
  $('foot').textContent = travels?.updated ? `足跡更新於 ${String(travels.updated).slice(0, 10)}　要新增去過的地方，告訴 Claude 就好` : '';
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

async function show(travels, life, tt) {
  render(travels, life, lifeTasks(tt), dateStr());
  try { await drawMap(travels); } catch (e) { console.error(e); $('map').textContent = '地圖載入失敗'; }
}

async function start() {
  if (!isConfigured()) {
    await show(demoTravels(), demoLife(), demoTickTick());
    status('demo', '示範模式');
    banner('示範模式：還沒設定 Microsoft 登入，下面是示範資料。');
    return;
  }
  try { await initAuth(); } catch (e) { status('bad', '登入失敗'); banner(`登入失敗：${e.message}`); return; }
  if (!getAccount()) {
    status('demo', '未登入');
    banner('請先登入，才能讀你 OneDrive 裡的足跡與待辦。', el('button', { class: 'btn', type: 'button', onclick: () => login() }, '登入'));
    return;
  }
  status('loading', '讀取中');
  try {
    const [travels, life, tt] = await Promise.all([oneDriveJson(CONFIG.travelsPath), oneDriveJson(CONFIG.lifePath), getTickTick()]);
    await show(travels || { places: [] }, life, tt);
    if (!travels) banner('OneDrive 的「Sam Homepage/travels.json」還沒有。告訴 Claude 你去過哪些地方，就會建立。');
    status('live', '已同步');
  } catch (e) {
    console.error(e);
    status('bad', '讀取失敗');
    banner(`讀不到資料：${e.message}`);
  }
}

start();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
