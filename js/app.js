import { CONFIG } from '../config.js';
import { getAccount, initAuth, isConfigured, login, logout } from './auth.js';
import { DemoStore, ExcelStore } from './store.js';
import { completeMail, demoCalendar, demoHecho, demoMail, getCalendar, getFx, getHecho, getMail, getWeather } from './sources.js';
import { addDays, dateStr, diffDays, el, nextMonday, nowStamp, relDay, shortDate, timeStr, uid } from './util.js';

const $ = (id) => document.getElementById(id);

const DOMAINS = ['工作', '沁耘', '投資', '生活'];
const DOMAIN_OF = { 沁耘: '沁耘', 待辦: '工作', 信件: '工作', 行程: '工作', 投資: '投資', 帳單: '生活', 旅行: '生活', 天氣: '生活', 其他: '生活' };
const CLOSED = new Set(['完成', '已處理']);

const state = {
  store: null,
  items: [], cards: [], settings: { ...CONFIG.defaults },
  events: [], weather: null, fx: null, mail: [], hecho: null,
  errors: {}, syncedAt: null, loading: false,
  showUpcoming: false,
};

// ---------- 組出今日重點 ----------

// 自動產生的重點（行程、天氣、匯率）按「已處理」後，存成 ID 為 auto:… 的一列
function dismissedKeys() {
  return new Set(state.items.filter((o) => o.ID.startsWith('auto:') && CLOSED.has(o.狀態)).map((o) => o.ID.slice(5)));
}

function manualEntries(today) {
  const lead = state.settings.提前提醒天數;
  const focus = [];
  const upcoming = [];
  for (const o of state.items) {
    if (o.ID.startsWith('auto:') || CLOSED.has(o.狀態)) continue;
    if (o.延後至 && o.延後至 > today) { upcoming.push(entryFromItem(o, today, o.延後至)); continue; }
    const e = entryFromItem(o, today, o.到期日);
    if (!o.到期日 || diffDays(o.到期日, today) <= lead) focus.push(e);
    else upcoming.push(e);
  }
  return { focus, upcoming };
}

function entryFromItem(o, today, when) {
  const n = when ? diffDays(when, today) : null;
  const level = n === null ? 'calm' : n < 0 ? 'bad' : n === 0 ? 'warn' : 'info';
  const meta = [];
  if (o.延後至 && o.延後至 > today) meta.push(`延後到 ${shortDate(o.延後至)}`);
  else if (o.到期日) meta.push(`${relDay(o.到期日, today)} · ${shortDate(o.到期日)}`);
  if (o.備註) meta.push(o.備註);
  return {
    key: o.ID, kind: 'item', item: o, cat: o.類別 || '其他', title: o.標題, meta: meta.join(' · '),
    level, link: o.連結, sort: n === null ? 50 : n, when,
  };
}

function autoEntries(today) {
  const out = [];
  const s = state.settings;
  const now = `${today}T${timeStr()}`;
  const tomorrow = addDays(today, 1);

  for (const ev of state.events) {
    const day = ev.start.slice(0, 10);
    if (day === today && !ev.allDay && ev.end < now) continue;
    const time = ev.allDay ? '整天' : `${ev.start.slice(11)}–${ev.end.slice(11)}`;
    out.push({
      key: `cal:${ev.id}`, kind: 'auto', cat: '行程', title: ev.subject,
      meta: [day === today ? '今天' : '明天', time, ev.location].filter(Boolean).join(' · '),
      level: day === today ? 'warn' : 'info', link: ev.link,
      sort: day === today ? 0.1 + Number(ev.start.slice(11, 13)) / 100 : 1.5,
    });
  }

  const w = state.weather?.days?.find((d) => d.date === today);
  if (w) {
    if (w.rain >= s.雨機率門檻) out.push(wx('rain', `今天降雨機率 ${w.rain}%，記得帶傘`, `${w.text} · ${w.min}–${w.max}°C`));
    if (w.max >= s.高溫門檻) out.push(wx('hot', `今天高溫 ${w.max}°C`, '注意長輩補水與防曬'));
    if (w.min <= s.低溫門檻) out.push(wx('cold', `今天低溫 ${w.min}°C`, '注意長輩保暖'));
  }
  function wx(type, title, meta) {
    return { key: `wx:${today}:${type}`, kind: 'auto', cat: '天氣', title, meta, level: 'warn', sort: 0.05 };
  }

  const fx = state.fx;
  if (fx && Math.abs(fx.change) >= s.匯率變動門檻) {
    out.push({
      key: `fx:${fx.date}`, kind: 'auto', cat: '投資',
      title: `美元兌台幣 ${fx.rate.toFixed(2)}（${fx.change > 0 ? '+' : ''}${fx.change.toFixed(2)}%）`,
      meta: `超過你設的 ${s.匯率變動門檻}% 門檻`, level: 'info', sort: 0.9,
    });
  }

  for (const m of state.mail) {
    const at = new Date(m.received);
    out.push({
      key: `mail:${m.id}`, kind: 'auto', cat: '信件', title: m.subject,
      meta: [m.from, `${shortDate(dateStr(at))} ${timeStr(at)}`, m.flagged ? '已加旗標' : '重要・未讀'].filter(Boolean).join(' · '),
      level: m.flagged ? 'warn' : 'info', link: m.link, sort: m.flagged ? 0.6 : 0.7,
      ...(m.flagged ? { doneLabel: '已回覆', onDone: () => mailDone(m.id) } : {}),
    });
  }

  out.push(...hechoEntries(today));

  const gone = dismissedKeys();
  return out.filter((e) => !gone.has(e.key));
}

// 和果：最新一天的交班統計（只用數字），太舊的資料不提醒
function hechoEntries(today) {
  const h = state.hecho;
  const s = state.settings;
  const out = [];
  if (!h?.latest) return out;
  const L = h.latest;
  const age = diffDays(today, L.date);
  const label = age === 0 ? '今天' : shortDate(L.date);
  const hk = (type, title, meta, level, sort) =>
    ({ key: `hecho:${L.date}:${type}`, kind: 'auto', cat: '沁耘', title, meta, level, sort });

  if (age <= 3) {
    if (L.incidents > 0) out.push(hk('incident', `和果${label}有 ${L.incidents} 件異常事件`, '請看交班紀錄的特殊事項', 'bad', -1));
    // 實到 0 人多半是統計還沒填完，不當成出席率異常
    if (L.expected && L.present === 0) {
      out.push(hk('unfilled', `和果${label}交班統計的實到是 0 人`, `應到 ${L.expected} 人，可能還沒填完`, 'info', 0.35));
    } else if (L.expected && L.present !== null) {
      const rate = Math.round((L.present / L.expected) * 100);
      if (rate < s.出席率門檻) out.push(hk('rate', `和果${label}出席率 ${rate}%`, `實到 ${L.present}／應到 ${L.expected}，低於 ${s.出席率門檻}%`, 'warn', 0.2));
    }
    if (L.staffLeave >= s.員工請假門檻) out.push(hk('staff', `和果${label}員工請假 ${L.staffLeave} 人`, `上班 ${L.staffOn ?? '—'} 人`, 'warn', 0.25));
  }

  // 平日 18:00 後還沒有今天的交班紀錄
  const dow = new Date(`${today}T12:00:00+08:00`).getUTCDay();
  if (dow >= 1 && dow <= 5 && timeStr() >= '18:00' && L.date < today) {
    out.push({ key: `hecho:${today}:missing`, kind: 'auto', cat: '沁耘', title: '和果今天的交班紀錄還沒匯出', meta: `最新一筆是 ${shortDate(L.date)}`, level: 'warn', sort: 0.3 });
  }
  return out;
}

function buildFocus() {
  const today = dateStr();
  const manual = manualEntries(today);
  const focus = [...manual.focus, ...autoEntries(today)].sort((a, b) => a.sort - b.sort);
  const upcoming = manual.upcoming.sort((a, b) => (a.when || '').localeCompare(b.when || ''));
  return { focus, upcoming };
}

// ---------- 畫面 ----------

function render() {
  const today = dateStr();
  const hour = Number(timeStr().slice(0, 2));
  $('greeting').textContent = `${hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安'}，Sam`;

  const { focus, upcoming } = buildFocus();
  const overdue = focus.filter((e) => e.kind === 'item' && e.level === 'bad').length;
  $('today-line').textContent = `${shortDate(today)} · ${focus.length ? `${focus.length} 件重點${overdue ? `，其中 ${overdue} 件逾期` : ''}` : '今天沒有需要處理的事'}`;

  renderStatus();

  const list = $('focus-list');
  list.replaceChildren(...(focus.length ? focus.map(focusRow) : [el('li', { class: 'empty' }, '✓ 今天沒有重點，放心做別的事')]));
  $('focus-count').textContent = focus.length ? String(focus.length) : '';

  const upBtn = $('btn-upcoming');
  upBtn.hidden = upcoming.length === 0;
  upBtn.textContent = `${state.showUpcoming ? '▾' : '▸'} 之後還有 ${upcoming.length} 件`;
  const upList = $('upcoming-list');
  upList.hidden = !state.showUpcoming || upcoming.length === 0;
  upList.replaceChildren(...upcoming.map(focusRow));

  renderStrip(today);
  renderDomains(focus);

  const foot = [];
  if (state.store?.webUrl) foot.push(el('a', { href: state.store.webUrl, target: '_blank', rel: 'noopener' }, '在 Excel 打開資料'));
  foot.push(el('a', { href: CONFIG.detailLinks.工作, target: '_blank', rel: 'noopener' }, '舊版 Homepage'));
  $('foot').replaceChildren(...foot.flatMap((a, i) => (i ? [' · ', a] : [a])));
}

function renderStatus() {
  const box = $('status');
  const errs = Object.values(state.errors);
  let cls;
  let text;
  if (state.loading) { cls = 'loading'; text = '同步中…'; }
  else if (state.store?.mode === 'demo') { cls = 'demo'; text = '示範模式'; }
  else if (errs.length) { cls = 'bad'; text = '部分資料沒抓到'; }
  else { cls = 'live'; text = state.syncedAt ? `已同步 ${state.syncedAt}` : '已連線'; }
  box.className = `wk-status ${cls}`;
  $('status-text').textContent = text;
  box.title = errs.join('\n');

  const acc = getAccount();
  $('btn-account').textContent = acc ? '登出' : '登入';
  $('btn-account').hidden = !isConfigured();

  const banner = $('banner');
  if (state.store?.mode === 'demo') {
    banner.hidden = false;
    banner.textContent = isConfigured()
      ? '還沒登入：現在顯示示範資料，只存在這台裝置。按右上角「登入」改用你 OneDrive 裡的資料。'
      : '示範模式：還沒設定 Microsoft 登入，資料只存在這台裝置。設定步驟請見 SETUP.md。';
  } else if (errs.length) {
    banner.hidden = false;
    banner.textContent = errs.join('；');
  } else banner.hidden = true;
}

function focusRow(e) {
  const actions = [];
  if (e.kind === 'item') {
    actions.push(el('button', { class: 'act primary', type: 'button', onclick: () => closeItem(e.item.ID, '完成') }, '完成'));
    actions.push(el('button', { class: 'act', type: 'button', onclick: () => snooze(e.item) }, '延後'));
  } else {
    actions.push(el('button', { class: 'act primary', type: 'button', onclick: () => (e.onDone ? e.onDone() : dismissAuto(e)) }, e.doneLabel || '已處理'));
  }
  if (e.link) actions.push(el('a', { class: 'act', href: e.link, target: '_blank', rel: 'noopener' }, '打開'));
  actions.push(el('button', { class: 'act', type: 'button', title: '複製給 Claude', onclick: () => toClaude(e) }, '問 Claude'));

  const body = el('div', { class: 'f-body' },
    el('div', { class: 'f-top' }, el('span', { class: 'chip' }, e.cat), el('span', { class: 'f-title' }, e.title)),
    e.meta ? el('div', { class: 'f-meta' }, e.meta) : null);
  if (e.kind === 'item') {
    body.classList.add('editable');
    body.addEventListener('click', () => openItemDialog(e.item));
  }
  return el('li', { class: `f-row ${e.level}` }, body, el('div', { class: 'f-acts' }, actions));
}

function renderStrip(today) {
  const tiles = [];
  const w = state.weather;
  const wt = w?.days?.find((d) => d.date === today);
  tiles.push(tile(`天氣 · ${CONFIG.weather.name}`, w ? `${w.now}°C` : '—', wt ? `${w.text} · ${wt.min}–${wt.max}° · 雨 ${wt.rain}%` : state.errors.weather ? '抓不到' : '載入中'));

  const fx = state.fx;
  tiles.push(tile('美元 / 台幣', fx ? fx.rate.toFixed(2) : '—',
    fx ? `${fx.change > 0 ? '▲' : fx.change < 0 ? '▼' : ''} ${Math.abs(fx.change).toFixed(2)}% · ${fx.date.slice(5)}` : state.errors.fx ? '抓不到' : '載入中',
    fx && fx.change !== 0 ? (fx.change > 0 ? 'up' : 'down') : ''));

  const todays = state.events.filter((ev) => ev.start.slice(0, 10) === today);
  const next = todays.find((ev) => ev.allDay || ev.end >= `${today}T${timeStr()}`);
  tiles.push(tile('今日行程', state.errors.calendar ? '—' : `${todays.length} 個`,
    next ? `下一個 ${next.allDay ? '整天' : next.start.slice(11)} ${next.subject}` : todays.length ? '今天的行程都結束了' : '今天沒有行程'));

  const open = state.items.filter((o) => !o.ID.startsWith('auto:') && !CLOSED.has(o.狀態));
  const overdue = open.filter((o) => o.到期日 && o.到期日 < today && !(o.延後至 > today));
  tiles.push(tile('待辦', `${open.length} 件`, overdue.length ? `${overdue.length} 件逾期` : '沒有逾期', overdue.length ? 'down' : ''));

  $('strip').replaceChildren(...tiles);
}

function tile(k, v, s, tone = '') {
  return el('div', { class: 'tile' }, el('div', { class: 'k' }, k), el('div', { class: `v ${tone}` }, v), el('div', { class: 's' }, s));
}

function renderDomains(focus) {
  const cards = DOMAINS.map((d) => {
    const c = state.cards.find((x) => x.領域 === d) || { 領域: d, 數字: '—', 說明: '' };
    const n = focus.filter((e) => DOMAIN_OF[e.cat] === d).length;
    const auto = autoCard(d);
    return el('article', { class: 'domain' },
      el('div', { class: 'd-head' },
        el('h2', {}, d),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': `編輯${d}卡片`, onclick: () => openCardDialog(c) }, '✎')),
      el('div', { class: 'd-num' }, auto?.num || c.數字 || '—'),
      auto ? el('p', { class: 'd-text auto' }, auto.text) : null,
      c.說明 ? el('p', { class: 'd-text' }, c.說明) : null,
      el('div', { class: 'd-foot' },
        el('span', { class: n ? 'pill on' : 'pill' }, n ? `${n} 件重點` : '沒有重點'),
        el('a', { href: CONFIG.detailLinks[d], target: '_blank', rel: 'noopener' }, '詳細 ↗')));
  });
  $('domains').replaceChildren(...cards);
}

// 有即時資料的領域，數字自動填；你寫的說明照樣顯示在下面
function autoCard(domain) {
  if (domain === '沁耘' && state.hecho?.month?.rate) {
    const { month, latest } = state.hecho;
    const parts = [`和果 ${month.label} 出席率 · 每日平均 ${month.avg} 人`];
    if (latest?.expected) parts.push(`${shortDate(latest.date)} 實到 ${latest.present}／${latest.expected}`);
    return { num: `${Math.round(month.rate * 100)}%`, text: parts.join('；') };
  }
  if (domain === '工作' && state.mail.length) {
    const flagged = state.mail.filter((m) => m.flagged).length;
    return { num: `${state.mail.length} 封`, text: `待回覆信件（${flagged} 封加旗標）` };
  }
  return null;
}

// ---------- 動作 ----------

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// 先改畫面再寫資料，寫失敗就重新讀一次
async function mutate(localChange, remote, okMsg) {
  localChange();
  render();
  try {
    await remote();
    if (okMsg) toast(okMsg);
  } catch (err) {
    console.error(err);
    toast(`沒存到：${err.message}`);
    await refresh();
  }
}

function closeItem(id, status) {
  const patch = { 狀態: status, 完成: nowStamp() };
  mutate(() => { state.items = state.items.map((o) => (o.ID === id ? { ...o, ...patch } : o)); },
    () => state.store.updateItem(id, patch), `已${status}`);
}

function dismissAuto(e) {
  const row = { ID: `auto:${e.key}`, 類別: e.cat, 標題: e.title, 備註: e.meta || '', 到期日: '', 狀態: '已處理', 延後至: '', 連結: '', 建立: nowStamp(), 完成: nowStamp() };
  mutate(() => { state.items = [...state.items, row]; }, () => state.store.addItem(row), '已處理');
}

function mailDone(id) {
  mutate(() => { state.mail = state.mail.filter((m) => m.id !== id); },
    () => (state.store.mode === 'live' ? completeMail(id) : Promise.resolve()), '已在 Outlook 標成完成');
}

let snoozeTarget = null;
function snooze(item) {
  snoozeTarget = item;
  $('snooze-date').value = addDays(dateStr(), 1);
  $('snooze-dialog').returnValue = '';
  $('snooze-dialog').showModal();
}

$('snooze-dialog').addEventListener('close', () => {
  const v = $('snooze-dialog').returnValue;
  const item = snoozeTarget;
  snoozeTarget = null;
  if (!item || !v || v === 'cancel') return;
  const today = dateStr();
  const to = v === 'mon' ? nextMonday(today) : v === 'date' ? $('snooze-date').value : addDays(today, Number(v));
  if (!to || to <= today) return;
  const patch = { 延後至: to };
  mutate(() => { state.items = state.items.map((o) => (o.ID === item.ID ? { ...o, ...patch } : o)); },
    () => state.store.updateItem(item.ID, patch), `延後到 ${shortDate(to)}`);
});

async function toClaude(e) {
  const lines = [`請幫我處理這件事：${e.title}`, `類別：${e.cat}`];
  if (e.meta) lines.push(`補充：${e.meta}`);
  if (e.item?.到期日) lines.push(`期限：${e.item.到期日}`);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    toast('已複製，到 Claude 貼上就好');
  } catch {
    toast('無法複製，請手動告訴 Claude');
  }
  window.open('https://claude.ai/new', '_blank', 'noopener');
}

// 新增 / 編輯
let editing = null;
function openItemDialog(item = null) {
  editing = item;
  const f = $('item-form');
  f.reset();
  $('item-dialog-title').textContent = item ? '編輯重點' : '新增重點';
  $('item-delete').hidden = !item;
  if (item) for (const k of ['類別', '標題', '到期日', '備註', '連結']) f.elements[k].value = item[k] || '';
  $('item-dialog').showModal();
  setTimeout(() => f.elements.標題.focus(), 50);
}

$('item-form').addEventListener('submit', () => {
  const f = $('item-form');
  const data = Object.fromEntries(['類別', '標題', '到期日', '備註', '連結'].map((k) => [k, f.elements[k].value.trim()]));
  if (!data.標題) return;
  if (editing) {
    const id = editing.ID;
    mutate(() => { state.items = state.items.map((o) => (o.ID === id ? { ...o, ...data } : o)); },
      () => state.store.updateItem(id, data), '已儲存');
  } else {
    const row = { ID: uid(), ...data, 狀態: '待辦', 延後至: '', 建立: nowStamp(), 完成: '' };
    mutate(() => { state.items = [...state.items, row]; }, () => state.store.addItem(row), '已新增');
  }
  editing = null;
});

$('item-cancel').addEventListener('click', () => $('item-dialog').close());
$('item-delete').addEventListener('click', () => {
  if (!editing || !confirm(`刪除「${editing.標題}」？`)) return;
  const id = editing.ID;
  $('item-dialog').close();
  editing = null;
  mutate(() => { state.items = state.items.filter((o) => o.ID !== id); }, () => state.store.deleteItem(id), '已刪除');
});

let editingCard = null;
function openCardDialog(card) {
  editingCard = card;
  const f = $('card-form');
  $('card-dialog-title').textContent = `編輯「${card.領域}」卡片`;
  f.elements.數字.value = card.數字 === '—' ? '' : card.數字 || '';
  f.elements.說明.value = card.說明 || '';
  $('card-dialog').showModal();
}

$('card-form').addEventListener('submit', () => {
  const f = $('card-form');
  const d = editingCard.領域;
  const patch = { 數字: f.elements.數字.value.trim() || '—', 說明: f.elements.說明.value.trim(), 更新: nowStamp() };
  mutate(() => { state.cards = state.cards.map((c) => (c.領域 === d ? { ...c, ...patch } : c)); },
    () => state.store.updateCard(d, patch), '已儲存');
});
$('card-cancel').addEventListener('click', () => $('card-dialog').close());

$('btn-add').addEventListener('click', () => openItemDialog());
$('btn-refresh').addEventListener('click', () => refresh());
$('btn-upcoming').addEventListener('click', () => { state.showUpcoming = !state.showUpcoming; render(); });
$('btn-account').addEventListener('click', () => (getAccount() ? logout() : login()));

// ---------- 讀資料 ----------

async function settle(name, p) {
  try {
    const v = await p;
    delete state.errors[name];
    return v;
  } catch (err) {
    console.error(name, err);
    state.errors[name] = {
      data: `OneDrive 資料：${err.message}`, calendar: '行事曆抓不到', weather: '天氣抓不到', fx: '匯率抓不到',
      mail: '信件抓不到', hecho: `和果資料抓不到（${err.message}）`,
    }[name];
    return undefined;
  }
}

let lastRefresh = 0;
async function refresh() {
  if (state.loading) return;
  state.loading = true;
  lastRefresh = Date.now();
  renderStatus();
  const live = state.store.mode === 'live';
  const [db, events, weather, fx, mail, hecho] = await Promise.all([
    settle('data', state.store.load()),
    live ? settle('calendar', getCalendar()) : Promise.resolve(demoCalendar()),
    settle('weather', getWeather()),
    settle('fx', getFx()),
    live ? settle('mail', getMail()) : Promise.resolve(demoMail()),
    live ? settle('hecho', getHecho()) : Promise.resolve(demoHecho()),
  ]);
  if (db) Object.assign(state, db);
  if (events) state.events = events;
  if (weather) state.weather = weather;
  if (fx) state.fx = fx;
  if (mail) state.mail = mail;
  if (hecho) state.hecho = hecho;
  state.syncedAt = timeStr();
  state.loading = false;
  render();
}

// 從別台裝置改過資料：切回這個畫面時自動重新讀
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 30000) refresh();
});
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 5 * 60 * 1000);

async function start() {
  let account = null;
  try {
    account = await initAuth();
  } catch (err) {
    console.error(err);
    state.errors.auth = `登入失敗：${err.message}`;
  }
  state.store = account ? new ExcelStore() : new DemoStore();
  render();
  await refresh();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
}

start();
