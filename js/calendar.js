// 月曆頁：整個月的月曆（農曆、有行程的日子打點），點一天看那天的農曆宜忌與 Outlook 行程
import { getAccount, initAuth, isConfigured, login } from './auth.js';
import { demoCalendar, eventDays, getEvents } from './sources.js';
import { almanac, lunarDay } from './almanac.js';
import { addDays, dateStr, el, weekday } from './util.js';

const $ = (id) => document.getElementById(id);
const today = dateStr();
const S = { month: today.slice(0, 7), sel: today, events: [], live: false, cache: new Map() };

const monthRange = (ym) => {
  const first = `${ym}-01`;
  return { first, next: `${addDays(first, 32).slice(0, 7)}-01` };
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function loadMonth(ym) {
  if (S.cache.has(ym)) return S.cache.get(ym);
  const { first, next } = monthRange(ym);
  const evs = S.live ? await getEvents(first, next) : demoCalendar();
  S.cache.set(ym, evs);
  return evs;
}

function render() {
  const [y, m] = S.month.split('-').map(Number);
  $('mc-title').textContent = `${y} 年 ${m} 月`;
  const days = new Set(eventDays(S.events.map((e) => ({ start: e.start.slice(0, 10), end: e.end.slice(0, 16), allDay: e.allDay }))));
  const first = `${S.month}-01`;
  const lead = new Date(`${first}T12:00:00+08:00`).getUTCDay();
  const cells = ['日', '一', '二', '三', '四', '五', '六'].map((w, i) => el('div', { class: `cal-w${i === 0 || i === 6 ? ' we' : ''}` }, w));
  for (let i = 0; i < lead; i++) cells.push(el('div', { class: 'cal-c blank' }));
  for (let dt = first; dt.slice(0, 7) === S.month; dt = addDays(dt, 1)) {
    const dow = new Date(`${dt}T12:00:00+08:00`).getUTCDay();
    const cls = ['cal-c', dt === today && 'today', dt < today && 'past', dt === S.sel && 'sel', (dow === 0 || dow === 6) && 'we', days.has(dt) && 'has'].filter(Boolean).join(' ');
    cells.push(el('div', { class: cls, role: 'button', tabindex: '0', onclick: () => { S.sel = dt; render(); } },
      el('span', { class: 'n' }, String(Number(dt.slice(8)))), el('span', { class: 'l' }, lunarDay(dt))));
  }
  $('grid').replaceChildren(...cells);

  const a = almanac(S.sel, 6);
  const dayEvs = S.events.filter((e) => e.start.slice(0, 10) === S.sel || (e.start.slice(0, 10) < S.sel && e.end.slice(0, 10) > S.sel))
    .sort((p, q) => Number(p.allDay) - Number(q.allDay) || p.start.localeCompare(q.start)).reverse().reverse();
  const [, sm, sd] = S.sel.split('-').map(Number);
  $('detail').replaceChildren(
    el('div', { class: 'md-head' }, el('span', { class: 'md-day' }, `${sm}/${sd}`), el('span', { class: 'md-sub' }, `星期${weekday(S.sel)}${a ? ` · 農曆${a.lunar}` : ''}`), a?.term ? el('span', { class: 'chip' }, a.term) : null),
    a && (a.yi.length || a.ji.length) ? el('div', { class: 'md-yj' },
      a.yi.length ? el('span', { class: 'yi' }, el('b', {}, '宜'), a.yi.join('、')) : null,
      a.ji.length ? el('span', { class: 'ji' }, el('b', {}, '忌'), a.ji.join('、')) : null) : null,
    dayEvs.length ? el('div', { class: 'md-ev' }, ...dayEvs.map((e) => el('div', { class: 'e' },
      el('div', { class: 'tm' }, e.allDay ? '全天' : e.start.slice(11, 16)),
      el('div', {}, el(e.link ? 'a' : 'div', { class: 't', ...(e.link ? { href: e.link, target: '_blank', rel: 'noopener' } : {}) }, e.subject),
        e.location || (!e.allDay && e.end) ? el('div', { class: 's' }, [e.allDay ? '' : `到 ${e.end.slice(11, 16)}`, e.location].filter(Boolean).join(' · ')) : null))))
      : el('div', { class: 'md-empty' }, S.live || !isConfigured() ? '這天沒有行程' : '這天沒有行程'));
}

async function go(ym) {
  S.month = ym;
  if (S.sel.slice(0, 7) !== ym) S.sel = ym === today.slice(0, 7) ? today : `${ym}-01`;
  try { S.events = await loadMonth(ym); status('live', S.live ? '已同步' : '示範資料'); } catch (e) { console.error(e); S.events = []; status('bad', '行程讀不到'); }
  render();
}

function status(cls, text) { $('status').className = `wk-status ${cls}`; $('status-text').textContent = text; }
function banner(text, button) { const b = $('banner'); b.hidden = false; b.replaceChildren(text, ...(button ? [' ', button] : [])); }

async function start() {
  $('prev').addEventListener('click', () => go(shiftMonth(S.month, -1)));
  $('next').addEventListener('click', () => go(shiftMonth(S.month, 1)));
  $('today').addEventListener('click', () => { S.sel = today; go(today.slice(0, 7)); });
  if (isConfigured()) {
    try { await initAuth(); } catch (e) { status('bad', '登入失敗'); banner(`登入失敗：${e.message}`); }
    if (getAccount()) S.live = true;
    else banner('請先登入，才能看你的 Outlook 行程；現在顯示示範資料。', el('button', { class: 'btn', type: 'button', onclick: () => login() }, '登入'));
  } else banner('示範模式：還沒設定 Microsoft 登入。');
  await go(S.month);
}

start();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
