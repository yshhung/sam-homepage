// 首頁只負責「看」：資料都從原本的地方讀（Outlook、TickTick 同步檔、和果與沁耘的數字檔），
// 不寫入任何東西。新增、完成待辦一律在 Claude App 或 TickTick 裡做。
import { CONFIG } from '../config.js';
import { getAccount, initAuth, isConfigured, login, logout } from './auth.js';
import { DemoStore, ExcelStore } from './store.js';
import {
  demoCalendar, demoCompany, demoHecho, demoMail, demoTickTick,
  getCalendar, getCompany, getFx, getHecho, getMail, getTickTick, getWeather, hechoSummary,
} from './sources.js';
import { dateStr, diffDays, el, relDay, shortDate, timeStr } from './util.js';

const $ = (id) => document.getElementById(id);

const DOMAINS = ['工作', '沁耘', '和果', '投資', '生活'];
// 沁耘是公司（網站、曝光、課程），和果是日照中心
const DOMAIN_OF = { 和果: '和果', 沁耘: '沁耘', 網站: '沁耘', 社群: '沁耘', 課程: '沁耘', 信件: '工作', 行程: '工作', 投資: '投資', 天氣: '生活' };
// TickTick 清單 → 卡片（清單定義見「待辦行程分流」技能）
const LIST_DOMAIN = { '💼公司營運': '沁耘', '🦄未來拓展': '沁耘', '🏫社區長照營運': '和果', '🏠我的家庭': '生活', '🏃我的生活': '生活', '📦生活瑣事': '生活' };
const TICKTICK_WEB = 'https://ticktick.com/webapp/';

const state = {
  store: null,
  cards: [], settings: { ...CONFIG.defaults },
  events: [], weather: null, fx: null, mail: [], hecho: null, company: null, ticktick: null,
  errors: {}, syncedAt: null, loading: false,
  showUpcoming: false,
};

// ---------- 組出今日重點 ----------

function domainOf(e) {
  return e.domain || DOMAIN_OF[e.cat] || '工作';
}

// TickTick：逾期、今天、幾天內到期放今日重點，其他放「之後」
function tickTickEntries(today) {
  const t = state.ticktick;
  const focus = [];
  const upcoming = [];
  if (!t) return { focus, upcoming };
  const lead = state.settings.提前提醒天數;
  for (const task of t.tasks || []) {
    if (!task.due) continue;
    const n = diffDays(task.due, today);
    const meta = [`${relDay(task.due, today)} · ${shortDate(task.due)}${task.time ? ` ${task.time}` : ''}`];
    if (task.priority === 5) meta.push('高優先');
    const e = {
      key: `tt:${task.id}`, cat: task.list.replace(/^\p{Extended_Pictographic}️?/u, '') || 'TickTick',
      domain: LIST_DOMAIN[task.list] || '工作', title: task.title, meta: meta.join(' · '),
      level: n < 0 ? 'bad' : n === 0 ? 'warn' : 'info', link: TICKTICK_WEB, linkLabel: '打開 TickTick',
      sort: n + (task.time ? Number(task.time.slice(0, 2)) / 100 : 0.5), when: task.due, overdue: n < 0,
    };
    (n <= lead ? focus : upcoming).push(e);
  }
  const age = t.updated ? diffDays(today, t.updated.slice(0, 10)) : 99;
  if (age >= 2) focus.push({ key: 'tt:stale', cat: 'TickTick', domain: '工作', title: `TickTick 待辦 ${age} 天沒同步`, meta: '在 Claude App 改過待辦，或等每天 07:30 的備援同步', level: 'info', sort: 0.85 });
  return { focus, upcoming };
}

function autoEntries(today) {
  const out = [];
  const s = state.settings;
  const now = `${today}T${timeStr()}`;

  for (const ev of state.events) {
    const day = ev.start.slice(0, 10);
    if (day === today && !ev.allDay && ev.end < now) continue;
    const time = ev.allDay ? '整天' : `${ev.start.slice(11)}–${ev.end.slice(11)}`;
    out.push({
      key: `cal:${ev.id}`, cat: '行程', title: ev.subject,
      meta: [day === today ? '今天' : '明天', time, ev.location].filter(Boolean).join(' · '),
      level: day === today ? 'warn' : 'info', link: ev.link, linkLabel: '打開 Outlook',
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
    return { key: `wx:${type}`, cat: '天氣', title, meta, level: 'warn', sort: 0.05 };
  }

  const fx = state.fx;
  if (fx && Math.abs(fx.change) >= s.匯率變動門檻) {
    out.push({
      key: 'fx', cat: '投資',
      title: `美元兌台幣 ${fx.rate.toFixed(2)}（${fx.change > 0 ? '+' : ''}${fx.change.toFixed(2)}%）`,
      meta: `超過你設的 ${s.匯率變動門檻}% 門檻`, level: 'info', sort: 0.9,
    });
  }

  // 在 Outlook 取消旗標或標成完成，下次同步就會消失
  for (const m of state.mail) {
    const at = new Date(m.received);
    out.push({
      key: `mail:${m.id}`, cat: '信件', title: m.subject,
      meta: [m.from, `${shortDate(dateStr(at))} ${timeStr(at)}`, m.flagged ? '已加旗標' : '重要・未讀'].filter(Boolean).join(' · '),
      level: m.flagged ? 'warn' : 'info', link: m.link, linkLabel: '打開 Outlook', sort: m.flagged ? 0.6 : 0.7,
    });
  }

  out.push(...hechoEntries(today));
  out.push(...companyEntries(today));
  return out;
}

// 沁耘：兩週沒有新內容就提醒；數字太久沒更新也提醒（排程只在這台電腦開著時跑）
function companyEntries(today) {
  const c = state.company;
  if (!c) return [];
  const out = [];
  const ck = (type, cat, title, meta, level, sort) => ({ key: `company:${type}`, cat, title, meta, level, sort });
  const age = c.updated ? diffDays(today, c.updated.slice(0, 10)) : 99;
  if (age >= 3) out.push(ck('stale', '沁耘', `網站與社群數字 ${age} 天沒更新`, '辦公室電腦的 Claude 開著時，排程才會更新', 'info', 0.8));
  const w = c.website || {};
  const s = c.social || {};
  if (w.posts14d === 0) out.push(ck('web', '網站', '網站兩週沒有新文章', `${w.domain || '網站'}：近 14 天瀏覽 ${w.views14d ?? '—'} 次`, 'info', 0.75));
  if (s.igContent14d === 0 && s.fbContent14d === 0) out.push(ck('social', '社群', 'IG 和 FB 兩週沒有發文', `IG ${s.igFollowers ?? '—'} 人追蹤、FB ${s.fbFollowers ?? '—'} 人追蹤`, 'info', 0.76));
  else if (s.igContent14d === 0) out.push(ck('ig', '社群', 'IG 兩週沒有發文', `目前 ${s.igFollowers ?? '—'} 人追蹤`, 'info', 0.76));
  else if (s.fbContent14d === 0) out.push(ck('fb', '社群', 'FB 兩週沒有發文', `目前 ${s.fbFollowers ?? '—'} 人追蹤`, 'info', 0.76));
  return out;
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
  const hk = (type, title, meta, level, sort) => ({ key: `hecho:${type}`, cat: '和果', title, meta, level, sort });

  if (age <= 3) {
    if (L.incidents > 0) out.push(hk('incident', `和果${label}有 ${L.incidents} 件異常事件`, '請看交班紀錄的特殊事項', 'bad', -1));
    // 實到是空的：多半是 WorkLog 還沒點名，不當成出席率異常
    if (L.expected && !L.present) {
      out.push(hk('unfilled', `和果${label}還沒點名`, `應到 ${L.expected} 人，WorkLog 出勤表還是「○」，請同仁改成「V」`, 'info', 0.35));
    } else if (L.expected && L.present !== null) {
      const rate = Math.round((L.present / L.expected) * 100);
      if (rate < s.出席率門檻) out.push(hk('rate', `和果${label}出席率 ${rate}%`, `實到 ${L.present}／應到 ${L.expected}，低於 ${s.出席率門檻}%`, 'warn', 0.2));
    }
    if (L.staffLeave >= s.員工請假門檻) out.push(hk('staff', `和果${label}員工請假 ${L.staffLeave} 人`, `上班 ${L.staffOn ?? '—'} 人`, 'warn', 0.25));
  }

  // 平日 18:00 後還沒有今天的交班紀錄
  const dow = new Date(`${today}T12:00:00+08:00`).getUTCDay();
  if (dow >= 1 && dow <= 5 && timeStr() >= '18:00' && L.date < today) {
    out.push(hk('missing', '和果今天的交班紀錄還沒匯出', `最新一筆是 ${shortDate(L.date)}`, 'warn', 0.3));
  }
  return out;
}

function buildFocus() {
  const today = dateStr();
  const tt = tickTickEntries(today);
  const focus = [...tt.focus, ...autoEntries(today)].sort((a, b) => a.sort - b.sort);
  const upcoming = tt.upcoming.sort((a, b) => a.sort - b.sort);
  return { focus, upcoming };
}

// ---------- 畫面 ----------

function render() {
  const today = dateStr();
  const hour = Number(timeStr().slice(0, 2));
  $('greeting').textContent = `${hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安'}，Sam`;

  const { focus, upcoming } = buildFocus();
  const overdue = focus.filter((e) => e.overdue).length;
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
  if (state.ticktick?.updated) foot.push(document.createTextNode(`TickTick 更新於 ${state.ticktick.updated.slice(5)}`));
  if (state.store?.webUrl) foot.push(el('a', { href: state.store.webUrl, target: '_blank', rel: 'noopener' }, '在 Excel 改卡片與門檻'));
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
      ? '還沒登入：現在顯示示範資料。按右上角「登入」看你自己的資料。'
      : '示範模式：還沒設定 Microsoft 登入。設定步驟請見 SETUP.md。';
  } else if (errs.length) {
    banner.hidden = false;
    banner.textContent = errs.join('；');
  } else banner.hidden = true;
}

// 只能看：打開原本的地方，或帶到 Claude 處理
function focusRow(e) {
  const actions = [];
  if (e.link) actions.push(el('a', { class: 'act', href: e.link, target: '_blank', rel: 'noopener' }, e.linkLabel || '打開'));
  actions.push(el('button', { class: 'act primary', type: 'button', title: '複製給 Claude', onclick: () => toClaude(e) }, '問 Claude'));
  const body = el('div', { class: 'f-body' },
    el('div', { class: 'f-top' }, el('span', { class: 'chip' }, e.cat), el('span', { class: 'f-title' }, e.title)),
    e.meta ? el('div', { class: 'f-meta' }, e.meta) : null);
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

  const tasks = state.ticktick?.tasks || [];
  const overdue = tasks.filter((t) => t.due && t.due < today).length;
  const dueToday = tasks.filter((t) => t.due === today).length;
  tiles.push(tile('TickTick', state.ticktick ? `今天 ${dueToday} 件` : '—',
    state.ticktick ? (overdue ? `${overdue} 件逾期` : '沒有逾期') : state.errors.ticktick ? '抓不到' : '還沒同步', overdue ? 'down' : ''));

  $('strip').replaceChildren(...tiles);
}

function tile(k, v, s, tone = '') {
  return el('div', { class: 'tile' }, el('div', { class: 'k' }, k), el('div', { class: `v ${tone}` }, v), el('div', { class: 's' }, s));
}

function renderDomains(focus) {
  const cards = DOMAINS.map((d) => {
    const c = state.cards.find((x) => x.領域 === d) || { 領域: d, 數字: '—', 說明: '' };
    const n = focus.filter((e) => domainOf(e) === d).length;
    const auto = autoCard(d);
    return el('article', { class: 'domain' },
      el('div', { class: 'd-head' }, el('h2', {}, d)),
      el('div', { class: 'd-num' }, auto?.num || c.數字 || '—'),
      auto ? el('p', { class: 'd-text auto' }, auto.text) : null,
      c.說明 && !c.說明.startsWith('在這裡寫一句') ? el('p', { class: 'd-text' }, c.說明) : null,
      d === '和果' && state.hecho ? el('button', { class: 'act d-ask', type: 'button', title: '複製最近的數字（沒有姓名），打開 Claude', onclick: askHecho }, '問 AI') : null,
      el('div', { class: 'd-foot' },
        el('span', { class: n ? 'pill on' : 'pill' }, n ? `${n} 件重點` : '沒有重點'),
        el('a', { href: CONFIG.detailLinks[d], target: '_blank', rel: 'noopener' }, '詳細 ↗')));
  });
  $('domains').replaceChildren(...cards);
}

// 有即時資料的領域，數字自動填；Excel「卡片」表寫的說明照樣顯示在下面
function autoCard(domain) {
  if (domain === '沁耘' && state.company?.website) {
    const { website: w, social: s = {} } = state.company;
    const parts = [`網站本月 ${w.visitors} 位訪客、${w.posts} 篇文章（上月瀏覽 ${w.prevViews}）`];
    parts.push(`IG ${s.igFollowers ?? '—'}・FB ${s.fbFollowers ?? '—'} 人追蹤`);
    return { num: `${w.views} 瀏覽`, text: parts.join('；') };
  }
  if (domain === '和果' && state.hecho?.month?.rate) {
    const { month, latest } = state.hecho;
    const parts = [`和果 ${month.label} 出席率 · 每日平均 ${month.avg} 人`];
    if (latest?.expected) parts.push(`${shortDate(latest.date)} 實到 ${latest.present ?? '未點名'}／${latest.expected}`);
    return { num: `${Math.round(month.rate * 100)}%`, text: parts.join('；') };
  }
  if (domain === '工作' && state.mail.length) {
    const flagged = state.mail.filter((m) => m.flagged).length;
    return { num: `${state.mail.length} 封`, text: `待回覆信件（${flagged} 封加旗標）` };
  }
  return null;
}

// ---------- 帶到 Claude ----------

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function toClaude(e) {
  const lines = [`請幫我處理這件事：${e.title}`, `類別：${e.cat}`];
  if (e.meta) lines.push(`補充：${e.meta}`);
  if (e.key.startsWith('tt:') && e.key !== 'tt:stale') lines.push('（這是 TickTick 的待辦；做完請幫我在 TickTick 標成完成，並更新首頁的 TickTick 同步檔）');
  if (e.cat === '和果' && state.hecho) lines.push('', '和果最近的數字（只有統計）：', hechoSummary(state.hecho));
  copyAndOpenClaude(lines.join('\n'));
}

// 和果卡片的「問 AI」：把最近的交班數字（沒有任何姓名）複製起來，打開 Claude 貼上就能問
function askHecho() {
  copyAndOpenClaude([
    '以下是土城和果日照最近的營運數字（只有統計，沒有個案或員工姓名）。',
    '請幫我看有沒有需要注意的地方，並列出我該追的事。',
    '',
    hechoSummary(state.hecho),
  ].join('\n'));
}

const UA = navigator.userAgent;
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(UA);
const CLAUDE_WEB = 'https://claude.ai/new';

// 複製要在按下的當下就開始（iPhone 規定），不能等打開 Claude 之後
function copyAndOpenClaude(text) {
  const copied = navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false);
  copied.then((ok) => toast(ok ? '已複製，到 Claude 貼上就好' : '無法複製，請手動告訴 Claude'));
  openClaude();
}

// 盡量直接打開 Claude App（已經登入），不要開在不共用登入的小瀏覽器裡
function openClaude() {
  if (IS_ANDROID) {
    // 有裝 Claude App 就打開 App，沒裝才開網頁
    location.href = `intent://claude.ai/new#Intent;scheme=https;package=com.anthropic.claude;S.browser_fallback_url=${encodeURIComponent(CLAUDE_WEB)};end`;
    return;
  }
  if (IS_IOS) {
    // iPhone 主畫面 App 裡的一般連結會開在小瀏覽器；claude:// 會直接叫出 Claude App。
    // 1.5 秒後畫面還在（沒裝 App）才改開網頁
    const fallback = setTimeout(() => {
      if (document.visibilityState === 'visible' && !window.open(CLAUDE_WEB, '_blank', 'noopener')) toast('請打開 Claude App 貼上');
    }, 1500);
    document.addEventListener('visibilitychange', () => clearTimeout(fallback), { once: true });
    location.href = 'claude://claude.ai/new';
    return;
  }
  // 電腦：瀏覽器分頁跟 claude.ai 共用登入，直接開新分頁
  window.open(CLAUDE_WEB, '_blank', 'noopener');
}

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
      data: `卡片與門檻：${err.message}`, calendar: '行事曆抓不到', weather: '天氣抓不到', fx: '匯率抓不到',
      mail: '信件抓不到', hecho: `和果資料抓不到（${err.message}）`, company: '網站與社群數字抓不到', ticktick: 'TickTick 同步檔抓不到',
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
  const [db, events, weather, fx, mail, hecho, company, ticktick] = await Promise.all([
    settle('data', state.store.load()),
    live ? settle('calendar', getCalendar()) : Promise.resolve(demoCalendar()),
    settle('weather', getWeather()),
    settle('fx', getFx()),
    live ? settle('mail', getMail()) : Promise.resolve(demoMail()),
    live ? settle('hecho', getHecho()) : Promise.resolve(demoHecho()),
    live ? settle('company', getCompany()) : Promise.resolve(demoCompany()),
    live ? settle('ticktick', getTickTick()) : Promise.resolve(demoTickTick()),
  ]);
  if (db) Object.assign(state, db);
  if (events) state.events = events;
  if (weather) state.weather = weather;
  if (fx) state.fx = fx;
  if (mail) state.mail = mail;
  if (hecho) state.hecho = hecho;
  if (company !== undefined) state.company = company;
  if (ticktick !== undefined) state.ticktick = ticktick;
  state.syncedAt = timeStr();
  state.loading = false;
  render();
}

// 在別的地方改過資料：切回這個畫面時自動重新讀
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
