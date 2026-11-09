// 首頁只負責「看」：資料都從原本的地方讀（Outlook、TickTick 同步檔、和果與沁耘的數字檔），
// 不寫入任何東西。新增、完成待辦一律在 Claude App 或 TickTick 裡做。
import { CONFIG } from '../config.js';
import { getAccount, initAuth, isConfigured, login, logout } from './auth.js';
import { DemoStore, ExcelStore } from './store.js';
import {
  demoCalendar, demoCompany, demoHecho, demoInvest, demoLife, demoMail, demoNews, demoTickTick,
  alertsView, dayView, demoAlerts, getAlerts, getCalendar, getCompany, getFx, getHecho, getHolidayToday, getInbox, getInvest, getLife, getLocation, getMail, getNews, getTickTick, getWeather, hechoSummary,
  digestView, investView, lifeView, newsView, planView,
} from './sources.js';
import { addDays, dateStr, diffDays, el, relDay, shortDate, timeStr, weekday } from './util.js';
import { almanac, lunarDay } from './almanac.js';

const $ = (id) => document.getElementById(id);

// 三張一列：生活、投資、工作。工作＝沁耘（公司：網站、曝光、課程）＋和果（日照中心）＋信件、行程
const DOMAINS = ['生活', '投資', '工作'];
const DOMAIN_OF = { 和果: '工作', 沁耘: '工作', 網站: '工作', 社群: '工作', 課程: '工作', 信件: '工作', 行程: '工作', 投資: '投資', 天氣: '生活', 旅行: '生活' };
// TickTick 清單 → 卡片（清單定義見「待辦行程分流」技能）
const LIST_DOMAIN = { '💼公司營運': '工作', '🦄未來拓展': '工作', '🏫社區長照營運': '工作', '🏠我的家庭': '生活', '🏃我的生活': '生活', '📦生活瑣事': '生活' };
// Excel「卡片」表裡這幾列的說明都顯示在工作卡
const CARD_ROWS = { 工作: ['工作', '沁耘', '和果'] };
const CWA_WARN = 'https://www.cwa.gov.tw/'; // 檔案沒附網址時的備用：氣象署首頁（首頁最上面就是目前的警特報）
const TICKTICK_WEB = 'https://ticktick.com/webapp/';

const state = {
  store: null,
  cards: [], settings: { ...CONFIG.defaults },
  events: [], alerts: [], weather: null, fx: null, mail: [], inbox: null, hecho: null, company: null, ticktick: null, invest: null, life: null, news: [], digests: [],
  errors: {}, syncedAt: null, loading: false, holidayToday: false,
  showUpcoming: false, showAllNews: false, showAllFocus: false, showNewsList: false, openMore: new Set(), showAllDay: false, openRows: new Set(), filter: '全部',
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
  if (age >= 2) focus.push({ key: 'tt:stale', cat: 'TickTick', domain: '工作', title: `TickTick 待辦 ${age} 天沒同步`, meta: `在 Claude App 改過待辦，或等下一次同步（每天 ${CONFIG.syncTimes.join('、')} 前後）`, level: 'info', sort: 0.85 });
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
      key: `cal:${ev.id}`, cat: '行程', title: ev.subject, when: day,
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
  const inboxOk = state.inbox && ['ok', 'partial'].includes(state.inbox.status);
  for (const m of state.mail) {
    if (inboxOk && m.actionOnly) continue;
    const at = new Date(m.received);
    out.push({
      key: `mail:${m.id}`, cat: '信件', title: m.subject,
      meta: [m.from, `${shortDate(dateStr(at))} ${timeStr(at)}`, m.flagged ? '已加旗標' : '未讀'].filter(Boolean).join(' · '),
      level: m.flagged ? 'warn' : 'info', link: m.link, linkLabel: '打開 Outlook', sort: m.flagged ? 0.6 : 0.7,
    });
  }

  out.push(...inboxEntries(state.inbox, today));

  // 天氣與營運警報（颱風、停班停課、特報、停水停電、空品、疫情、道路）：紅的排最上面，黃的排在前面
  const al = alertsView(state.alerts, today);
  for (const a of al.entries) {
    out.push({ key: `alert:${a.key}`, cat: a.tag, domain: '工作', title: a.title, meta: [a.text, a.src].filter(Boolean).join(' · '), level: a.lvl === 'risk' ? 'bad' : 'warn', link: a.url || undefined, linkLabel: '看公告', sort: a.lvl === 'risk' ? -1.5 : 0.05 });
  }
  for (const f of al.stale) out.push({ key: `alert:stale:${f.name}`, cat: '警報', domain: '工作', title: `${f.name.includes('weather') ? '天氣' : '營運'}警報 ${f.hours} 小時沒更新`, meta: '下一次同步或報告會再更新；颱風期間請自己看氣象署公告', level: 'info', sort: 0.8 });
  out.push(...hechoEntries(today));
  out.push(...companyEntries(today));

  // 投資：總資產變動超過門檻、數字太久沒更新
  const inv = investView(state.invest, today, s.投資變動門檻);
  for (const a of inv?.alerts || []) out.push({ key: `invest:${a.type}`, cat: '投資', domain: '投資', title: a.title, meta: a.meta, level: a.level, sort: a.type === 'day' ? 0.4 : 0.88 });
  // 投資計畫書的觸發警報：觸發中就一直列著，條件解除自動消失
  for (const a of planView(state.invest, today)?.alerts || []) {
    out.push({ key: `plan:${a.key}`, cat: '投資', domain: '投資', title: a.isNew ? `🆕 ${a.title}` : a.title, meta: a.meta, level: a.lvl === 'risk' ? 'bad' : 'warn', sort: a.lvl === 'risk' ? 0.3 : 0.45 });
  }

  // 生活：旅行快到了、規劃中的旅行還沒訂
  const life = lifeView(state.life, state.ticktick, today);
  for (const a of life?.alerts || []) out.push({ key: `life:${a.type}`, cat: '旅行', domain: '生活', title: a.title, meta: a.meta, level: a.level, link: a.link || undefined, linkLabel: '打開行程', sort: 0.95 });
  return out;
}

// 沁耘：兩週沒有新內容就提醒；數字太久沒更新也提醒（雲端同步每天 07:30 更新）
function companyEntries(today) {
  const c = state.company;
  if (!c) return [];
  const out = [];
  const ck = (type, cat, title, meta, level, sort) => ({ key: `company:${type}`, cat, title, meta, level, sort });
  const age = c.updated ? diffDays(today, c.updated.slice(0, 10)) : 99;
  if (age >= 3) out.push(ck('stale', '沁耘', `網站與社群數字 ${age} 天沒更新`, '每天 07:30 的雲端同步會更新；連續沒更新請到排程頁看那一次的執行紀錄', 'info', 0.8));
  const w = c.website || {};
  const s = c.social || {};
  if (w.posts14d === 0) out.push(ck('web', '網站', '網站兩週沒有新文章', `${w.domain || '網站'}：近 14 天瀏覽 ${w.views14d ?? '—'} 次`, 'info', 0.75));
  if (s.igContent14d === 0 && s.fbContent14d === 0) out.push(ck('social', '社群', 'IG 和 FB 兩週沒有發文', `IG ${s.igFollowers ?? '—'} 人追蹤、FB ${s.fbFollowers ?? '—'} 人追蹤`, 'info', 0.76));
  else if (s.igContent14d === 0) out.push(ck('ig', '社群', 'IG 兩週沒有發文', `目前 ${s.igFollowers ?? '—'} 人追蹤`, 'info', 0.76));
  else if (s.fbContent14d === 0) out.push(ck('fb', '社群', 'FB 兩週沒有發文', `目前 ${s.fbFollowers ?? '—'} 人追蹤`, 'info', 0.76));
  return out;
}

// 和果：最新一天的交班統計（只用數字），太舊的資料不提醒
// 信箱分流排程（每天 12:10）寫的 inbox.json：需行動／需你決定／需回覆的信 + 1HR 待簽核件數
const INBOX_CAT = { action: '行動', decide: '決定', reply: '回覆' };
function inboxEntries(ib, today) {
  if (!ib || typeof ib !== 'object') return [];
  const out = [];
  const ageH = ib.updated ? (Date.now() - new Date(ib.updated).getTime()) / 3600000 : null;
  if (ib.status === 'error') out.push({ key: 'inbox:error', cat: '信箱', title: '信箱分流排程出錯', meta: ib.note || '看下一次排程是否恢復', level: 'info', sort: 0.8 });
  else if (ageH != null && ageH > 36) out.push({ key: 'inbox:stale', cat: '信箱', title: `信箱分流 ${Math.round(ageH)} 小時沒更新`, meta: '排程每天 12:10 執行', level: 'info', sort: 0.8 });
  for (const [box, name] of [['outlook', '工作信箱'], ['gmail', '私人信箱']]) {
    const b = ib[box];
    if (!b) continue;
    if (box === 'outlook' && b.pending_approvals_1hr > 0) {
      out.push({ key: 'inbox:1hr', cat: '信箱', title: `1HR 待簽核 ${b.pending_approvals_1hr} 件`, meta: `${name} · 以 1HR 系統為準`, level: 'info', sort: 0.65 });
    }
    for (const [i, it] of (b.items || []).entries()) {
      if (box === 'outlook' && /待簽核/.test(it.title || '') && b.pending_approvals_1hr > 0) continue;
      const left = it.deadline ? Math.round((new Date(`${it.deadline}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null;
      out.push({
        key: `inbox:${box}:${it.link || i}:${it.title}`, cat: '信箱',
        title: `${INBOX_CAT[it.category] || ''}${INBOX_CAT[it.category] ? '：' : ''}${it.title}`,
        meta: [name, it.org, it.deadline ? `期限 ${shortDate(it.deadline)}` : '', it.unsure ? '待確認' : ''].filter(Boolean).join(' · '),
        level: left != null && left <= 3 ? 'warn' : 'info', link: it.link || undefined, linkLabel: '打開信件', sort: left != null ? 0.5 + Math.max(left, 0) / 100 : 0.7,
      });
    }
  }
  return out;
}

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
  // 國定假日不提醒：Outlook「台灣假日」行事曆（config.holidayCalendars）今天有整天事件；備援：預設行事曆當天有標題含「休假、放假、補假、連假、國定假日」的整天事件就當成休息日
  const offDay = state.holidayToday || (state.events || []).some((e) => e.allDay && /休假|放假|補假|連假|國定假日/.test(e.subject || '')
    && e.start.slice(0, 10) <= today && addDays(e.end.slice(0, 10), -1) >= today);
  if (dow >= 1 && dow <= 5 && !offDay && timeStr() >= '18:00' && L.date < today) {
    out.push(hk('missing', '和果今天的交班紀錄還沒匯出', `最新一筆是 ${shortDate(L.date)}`, 'warn', 0.3));
  }
  return out;
}

// 「待處理」只放需要你做決定或動手的事：
// 今天以前到期的待辦、今天的行程、天氣（已在上方釘著）、營運警報（已在狀態列）不重複列
function pending(e, today) {
  if (e.key.startsWith('tt:') && e.key !== 'tt:stale') return !(e.when && e.when <= today);
  if (e.key.startsWith('cal:')) return !(e.when && e.when.slice(0, 10) <= today);
  if (e.key.startsWith('wx:')) return false;
  if (e.key.startsWith('alert:') && !e.key.startsWith('alert:stale:')) return false;
  return true;
}

function buildFocus() {
  const today = dateStr();
  const tt = tickTickEntries(today);
  const all = [...tt.focus, ...autoEntries(today)].sort((a, b) => a.sort - b.sort);
  const rank = { bad: 0, warn: 1 };
  // 紅的、黃的排前面，其餘（資訊性的）排後面，預設只露出前 3 件
  const focus = all.filter((e) => pending(e, today)).sort((a, b) => (rank[a.level] ?? 2) - (rank[b.level] ?? 2) || a.sort - b.sort);
  const upcoming = tt.upcoming.sort((a, b) => a.sort - b.sort);
  return { focus, upcoming };
}

// ---------- 畫面 ----------

function render() {
  const today = dateStr();
  const hour = Number(timeStr().slice(0, 2));
  $('greeting').textContent = `${hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安'}，Sam`;

  const { focus, upcoming } = buildFocus();

  renderStatus();
  renderPinned(today);
  renderDay(today);
  renderCal(today);

  renderFilter(focus);
  const shown0 = state.filter === '全部' ? focus : focus.filter((e) => domainOf(e) === state.filter);
  const list = $('focus-list');
  const shownFocus = state.showAllFocus ? shown0 : shown0.slice(0, FOCUS_FIRST);
  list.replaceChildren(...(shown0.length ? shownFocus.map(focusRow) : [el('li', { class: 'empty' }, '✓ 沒有待處理的事，放心做別的事')]));
  $('focus-count').textContent = shown0.length ? String(shown0.length) : '';
  const focusMore = $('btn-focus-more');
  focusMore.hidden = shown0.length <= FOCUS_FIRST;
  focusMore.textContent = state.showAllFocus ? '▾ 收起' : `▸ 再看 ${shown0.length - FOCUS_FIRST} 件`;

  const upBtn = $('btn-upcoming');
  upBtn.hidden = upcoming.length === 0;
  upBtn.textContent = `${state.showUpcoming ? '▾' : '▸'} 之後還有 ${upcoming.length} 件`;
  const upList = $('upcoming-list');
  upList.hidden = !state.showUpcoming || upcoming.length === 0;
  upList.replaceChildren(...upcoming.map(focusRow));

  renderDomains(focus);
  renderNews(today);

  const foot = [];
  if (state.ticktick?.updated) foot.push(document.createTextNode(`TickTick 更新於 ${state.ticktick.updated.slice(5)}`));
  if (state.store?.webUrl) foot.push(el('a', { href: state.store.webUrl, target: '_blank', rel: 'noopener' }, '在 Excel 改卡片與門檻'));
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
  // 預設只看一行（類別＋標題），點一下才展開說明與按鈕
  const open = state.openRows.has(e.key);
  const toggle = () => { if (open) state.openRows.delete(e.key); else state.openRows.add(e.key); render(); };
  const top = el('button', { class: 'f-top', type: 'button', 'aria-expanded': String(open), onclick: toggle },
    el('span', { class: 'chip' }, e.cat), el('span', { class: 'f-title' }, e.title), el('span', { class: 'f-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'));
  const kids = [top];
  if (open) {
    if (e.meta) kids.push(el('div', { class: 'f-meta' }, e.meta));
    const actions = [];
    if (e.link) actions.push(el('a', { class: 'act', href: e.link, target: '_blank', rel: 'noopener' }, e.linkLabel || '打開'));
    actions.push(el('button', { class: 'act primary', type: 'button', title: '複製給 Claude', onclick: () => toClaude(e) }, '問 Claude'));
    kids.push(el('div', { class: 'f-acts' }, actions));
  }
  return el('li', { class: `f-row ${e.level}` }, ...kids);
}

// 日期卡片（放在最上面）：今天的日期、星期、農曆、節氣、宜忌；整個月的月曆在「月曆」那一頁
function renderCal(today) {
  const [, m, d] = today.split('-').map(Number);
  const a = almanac(today, 4);
  $('cal').replaceChildren(
    el('div', { class: 'db-top' },
      el('div', { class: 'db-day' }, `${m}/${d}`),
      el('div', { class: 'db-meta' },
        el('div', { class: 'db-ym' }, `${today.slice(0, 4)} 年 · 星期${weekday(today)}`),
        a ? el('div', { class: 'db-lunar' }, `農曆${a.lunar}`, a.term ? el('span', { class: 'chip' }, a.term) : null) : null),
      el('a', { class: 'db-open', href: 'calendar.html' }, '月曆 ›')),
    a && (a.yi.length || a.ji.length) ? el('div', { class: 'db-yj' },
      a.yi.length ? el('span', { class: 'yi' }, el('b', {}, '宜'), a.yi.join('、')) : null,
      a.ji.length ? el('span', { class: 'ji' }, el('b', {}, '忌'), a.ji.join('、')) : null) : null);
}

// 固定在最上面的天氣列：現在溫度、今天高低溫與降雨，下面一行是警報（有的話）或明天、後天
function renderPinned(today) {
  const w = state.weather;
  const s = state.settings;
  const rainy = (d) => d.rain >= s.雨機率門檻;
  const wt = w?.days.find((d) => d.date === today);
  const al = alertsView(state.alerts, today).entries.filter((a) => a.tag !== '家屬提醒');
  const top = el('div', { class: 'wp-main' },
    el('span', { class: 'wp-t' }, w ? `${w.now}°` : '—'),
    el('span', { class: 'wp-d' }, w ? w.text : state.errors.weather ? '天氣抓不到' : '載入中',
      wt ? el('span', { class: 'wp-s' }, ` · ${wt.min}–${wt.max}° · `, el('span', { class: rainy(wt) ? 'rain' : '' }, `雨 ${wt.rain}%`)) : null));
  const rest = w ? w.days.filter((d) => d.date > today).slice(0, 2) : [];
  const place = el('span', { class: 'wp-p', title: w?.here ? '依這台裝置的目前位置' : '沒有取得目前位置，用預設地點' }, `${w?.place || CONFIG.weather.name}${w?.here ? ' 📍' : ''}`);
  const second = al.length
    ? el('div', { class: 'wp-al' }, place, ...al.map((a) => el(a.url ? 'a' : 'span', { class: `wp-chip ${a.lvl}`, ...(a.url ? { href: a.url, target: '_blank', rel: 'noopener' } : {}) }, `${a.tag} · ${a.title}`)))
    : el('div', { class: 'wp-next' }, place, ...rest.map((d) => el('span', {}, `${diffDays(d.date, today) === 1 ? '明天' : '後天'} ${d.text} ${d.min}–${d.max}° `, el('span', { class: rainy(d) ? 'rain' : '' }, `雨 ${d.rain}%`))));
  $('wxpin').className = `wx-pin ${al.some((a) => a.lvl === 'risk') ? 'bad' : al.length ? 'warn' : ''}`;
  $('wxpin').replaceChildren(top, second);
}

// 今天：一句話狀態＋時間軸（行程、有時間的待辦、警報、逾期）
const DAY_FIRST = 8;
function renderDay(today) {
  const al = alertsView(state.alerts, today).entries;
  const v = dayView({ events: state.events, tasks: state.ticktick?.tasks || [], alerts: al }, today, timeStr());
  $('day-fam').replaceChildren(...al.filter((a) => a.tag === '家屬提醒').map((a) => el('div', { class: 'fam' },
    el('div', { class: 'fam-h' }, el('span', { class: 'chip' }, '提醒家屬'), el('b', {}, a.title)),
    a.text ? el('div', { class: 'fam-s' }, a.text) : null,
    // 讓你自己查證：連到氣象署的公告；檔案裡沒有附網址時，連到氣象署首頁
    el('div', { class: 'fam-s' }, '查證：', el('a', { class: 'fam-src', href: a.url || CWA_WARN, target: '_blank', rel: 'noopener noreferrer' }, `${a.src || '中央氣象署'}${a.url ? '公告' : '首頁（看警特報）'} ↗`)))));
  $('day-status').className = `day-status ${v.tone}`;
  $('day-status').replaceChildren(el('b', {}, v.head), ...(v.detail ? [el('span', {}, v.detail)] : []));
  const shown = state.showAllDay ? v.items : v.items.slice(0, DAY_FIRST);
  const nodes = [];
  let timedSeen = 0;
  let placed = false;
  for (const it of shown) {
    // 現在線：插在第一個還沒到的定時項目前面；定時項目全都過了就插在它們後面
    if (!placed && v.nowAt >= 0 && timedSeen === v.nowAt) { nodes.push(el('div', { class: 'now', 'data-t': `現在 ${timeStr()}` })); placed = true; }
    if (it.group === 0) timedSeen++;
    nodes.push(el('div', { class: `it ${it.tone}${it.past ? ' past' : ''}` },
      el('div', { class: 'tm' }, it.time),
      el(it.link ? 'a' : 'div', { class: 'tt', ...(it.link ? { href: it.link, target: '_blank', rel: 'noopener' } : {}) }, it.title),
      it.meta ? el('div', { class: 's' }, it.meta) : null));
  }
  if (!placed && v.nowAt >= 0 && timedSeen === v.nowAt) nodes.push(el('div', { class: 'now', 'data-t': `現在 ${timeStr()}` }));
  $('day-tl').replaceChildren(...(nodes.length ? nodes : [el('div', { class: 's' }, '今天沒有行程，也沒有待辦')]));
  const more = $('btn-day-more');
  more.hidden = v.items.length <= DAY_FIRST;
  more.textContent = state.showAllDay ? '▾ 收起' : `▸ 再看 ${v.items.length - DAY_FIRST} 件`;
}

function setFilter(d) {
  state.filter = state.filter === d ? '全部' : d;
  state.showAllFocus = false;
  render();
}

function renderFilter(focus) {
  const count = (d) => (d === '全部' ? focus.length : focus.filter((e) => domainOf(e) === d).length);
  $('focus-filter').replaceChildren(...['全部', ...DOMAINS].map((d) => el('button', {
    class: `f-chip${state.filter === d ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.filter === d), onclick: () => setFilter(d),
  }, `${d} ${count(d)}`)));
}

function renderDomains(focus) {
  const cards = DOMAINS.map((d) => {
    const rows = (CARD_ROWS[d] || [d]).map((k) => state.cards.find((x) => x.領域 === k)).filter(Boolean);
    const notes = rows.map((r) => r.說明).filter((t) => t && !t.startsWith('在這裡寫一句'));
    const n = focus.filter((e) => domainOf(e) === d).length;
    const auto = autoCard(d);
    const link = auto?.link || CONFIG.detailLinks[d];
    const mine = focus.filter((e) => domainOf(e) === d);
    const lvl = mine.some((e) => e.level === 'bad') ? 'bad' : mine.some((e) => e.level === 'warn') ? 'warn' : '';
    return el('article', { class: `domain${state.filter === d ? ' sel' : ''}`, tabindex: '0', role: 'button', 'aria-pressed': String(state.filter === d),
      onclick: (ev) => { if (ev.target.closest('a,button')) return; setFilter(d); $('focus-h').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      onkeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); setFilter(d); } } },
      el('div', { class: 'd-head' }, el('h2', {}, d)),
      auto?.stats
        ? el('div', { class: 'd-stats' }, ...auto.stats.map((x) => el('div', { class: 'd-stat' }, el('div', { class: `d-num ${x.tone || ''}` }, x.v), el('div', { class: 'd-k' }, x.k))))
        : el('div', { class: 'd-num' }, auto?.num || rows[0]?.數字 || '—'),
      auto?.text ? el('p', { class: 'd-text auto' }, auto.text) : null,
      // 手機上卡片窄，四池只顯示「⚠️ 四池」，有問題才出現
      auto?.plan ? el('a', { class: `d-plan ${auto.plan.warn ? 'warn' : 'ok'}`, href: 'invest.html#plans' },
        el('span', { class: 'd-long' }, auto.plan.text), el('span', { class: 'd-short' }, auto.plan.short || '⚠️ 四池偏離')) : null,
      ...notes.map((t) => el('p', { class: 'd-text' }, t)),
      d === '工作' && state.hecho ? el('button', { class: 'act d-ask', type: 'button', title: '複製最近的數字（沒有姓名），打開 Claude', onclick: askHecho }, '問 AI') : null,
      el('div', { class: 'd-foot' },
        el('span', { class: n ? `pill on ${lvl}` : 'pill' }, n ? `${n} 件待處理` : '沒有待處理'),
        // 首頁自己的頁面（例如投資頁）在同一個畫面打開；外部連結開新分頁
        link ? (/^https?:/.test(link) ? el('a', { href: link, target: '_blank', rel: 'noopener' }, '詳細 ↗') : el('a', { href: link }, '詳細 →'))
          : el('span', { 'aria-hidden': 'true' }, '\u00a0'))); // 沒有連結也留位置，三張的最下面一行才對齊
  });
  $('domains').replaceChildren(...cards);
}

// 新聞：早報、晚報整理的，點標題開原文（新分頁）
const NEWS_FIRST = 6;
const FOCUS_FIRST = 3;
function renderNews(today) {
  const items = newsView(state.news);
  const dg = digestView(state.digests);
  $('news-sec').hidden = $('news').hidden = !items.length && !dg && !state.errors.news;
  const dayLabel = (d) => { const n = diffDays(today, d); return n === 0 ? '今天' : n === 1 ? '昨天' : shortDate(d); };
  // 有摘要：顯示最新一份摘要，新聞列表收在下面；還沒有摘要：照舊顯示列表
  $('news-h').textContent = dg ? '新聞摘要' : '早報、晚報整理的新聞';
  $('news-count').textContent = dg ? `${dg.by} · ${dayLabel(dg.day)} ${dg.time}` : items.length ? String(items.length) : '';
  $('news-digest').hidden = !dg;
  const linkNodes = (parts) => parts.map((p) => (p.url ? el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.text) : p.text));
  // 分類、順序、哪些先看都由早報／晚報指示決定；有「更多」的類別預設收起來，點了才展開（只記在這次畫面）
  $('news-digest').replaceChildren(...(dg ? dg.items.map((it) => {
    const open = state.openMore.has(it.cat);
    return el('div', { class: `n-dig ${it.tone}` },
      el('div', { class: 'n-chips' },
        el('span', { class: 'chip' }, it.from ? `${it.cat} · ${it.from}` : it.cat),
        it.tag ? el('span', { class: 'chip mine' }, it.tag) : null),
      el('p', {}, ...linkNodes(it.parts)),
      it.more && open ? el('p', { class: 'n-more' }, ...linkNodes(it.more)) : null,
      it.more ? el('button', { class: 'link-btn n-more-btn', type: 'button', onclick: () => { if (open) state.openMore.delete(it.cat); else state.openMore.add(it.cat); render(); } }, open ? '▾ 收起' : '▸ 更多') : null);
  }) : []));
  const listOpen = !dg || state.showNewsList;
  $('news-list').hidden = !listOpen;
  const toggle = $('btn-news-list');
  toggle.hidden = !dg || !items.length;
  toggle.textContent = state.showNewsList ? '▾ 收起新聞列表' : `▸ 看新聞列表（7 天內 ${items.length} 則）`;
  if (!listOpen) { $('btn-news-more').hidden = true; return; }
  const shown = state.showAllNews ? items : items.slice(0, NEWS_FIRST);
  $('news-list').replaceChildren(...(items.length ? shown.map((n) => el('li', { class: `n-row ${n.cat === '生活' ? 'life' : 'fin'}` },
    el('a', { class: 'n-title', href: n.url, target: '_blank', rel: 'noopener noreferrer' }, n.title),
    el('div', { class: 'f-meta' }, el('span', { class: 'chip' }, n.cat), ` ${[n.src, `${dayLabel(n.day)}${n.by}`, n.rel].filter(Boolean).join(' · ')}`)))
    : [el('li', { class: 'f-meta' }, state.errors.news)]));
  const more = $('btn-news-more');
  more.hidden = items.length <= NEWS_FIRST;
  more.textContent = state.showAllNews ? '▾ 收起' : `▸ 再看 ${items.length - NEWS_FIRST} 則（7 天內）`;
}

// 有即時資料的領域，數字自動填；Excel「卡片」表寫的說明照樣顯示在下面
function autoCard(domain) {
  // 工作：和果本月出席率、沁耘網站本月瀏覽並排；說明一行和果、一行沁耘
  if (domain === '工作' && (state.company?.website || state.hecho?.month?.rate)) {
    const stats = [];
    const parts = [];
    if (state.hecho?.month?.rate) {
      const { month, latest } = state.hecho;
      stats.push({ k: '和果出席', v: `${Math.round(month.rate * 100)}%` });
      parts.push(`和果 ${month.label} 每日平均 ${month.avg} 人${latest?.expected ? `，${shortDate(latest.date)} 實到 ${latest.present ?? '未點名'}／${latest.expected}` : ''}`);
    }
    if (state.company?.website) {
      const { website: w, social: so = {} } = state.company;
      stats.push({ k: '網站瀏覽', v: String(w.views) });
      parts.push(`沁耘網站 ${w.visitors} 位訪客、${w.posts} 篇文章；IG ${so.igFollowers ?? '—'}・FB ${so.fbFollowers ?? '—'} 人追蹤`);
    }
    return { stats, text: parts.join('；') };
  }
  if (domain === '投資') {
    const v = investView(state.invest, dateStr(), state.settings.投資變動門檻);
    // 四池只留一句狀態，點了打開投資頁「計畫」分頁看完整的四池與警報
    if (v) {
      const d = state.invest?.dayPct;
      const stats = [{ k: '總資產（萬）', v: v.num.replace(/\s*萬$/, '') }];
      if (typeof d === 'number') stats.push({ k: '今日', v: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(2)}%`, tone: d > 0 ? 'up' : d < 0 ? 'down' : '' });
      return { stats, text: v.text, plan: planView(state.invest, dateStr())?.summary };
    }
  }
  if (domain === '生活') {
    const v = lifeView(state.life, state.ticktick, dateStr());
    if (v) return { num: v.num, text: v.text };
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
$('btn-focus-more').addEventListener('click', () => { state.showAllFocus = !state.showAllFocus; render(); });
$('btn-day-more').addEventListener('click', () => { state.showAllDay = !state.showAllDay; render(); });
$('btn-news-list').addEventListener('click', () => { state.showNewsList = !state.showNewsList; render(); });
$('btn-news-more').addEventListener('click', () => { state.showAllNews = !state.showAllNews; render(); });
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
      mail: '信件抓不到', inbox: '信箱分流檔抓不到', hecho: `和果資料抓不到（${err.message}）`, company: '網站與社群數字抓不到', ticktick: 'TickTick 同步檔抓不到',
      invest: '投資數字抓不到', life: '旅行資料抓不到', news: '新聞抓不到', month: '本月行程抓不到', alerts: '天氣與營運警報抓不到',
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
  const dbP = settle('data', state.store.load());
  const [db, events, weather, fx, mail, inbox, hecho, company, ticktick, invest, life, news, alerts, holiday] = await Promise.all([
    dbP,
    live ? settle('calendar', getCalendar()) : Promise.resolve(demoCalendar()),
    settle('weather', dbP.then((d) => getLocation(!!d?.settings?.用目前位置)).then(getWeather)),
    settle('fx', getFx()),
    live ? settle('mail', getMail()) : Promise.resolve(demoMail()),
    live ? settle('inbox', getInbox()) : Promise.resolve(null),
    live ? settle('hecho', getHecho()) : Promise.resolve(demoHecho()),
    live ? settle('company', getCompany()) : Promise.resolve(demoCompany()),
    live ? settle('ticktick', getTickTick()) : Promise.resolve(demoTickTick()),
    live ? settle('invest', getInvest()) : Promise.resolve(demoInvest()),
    live ? settle('life', getLife()) : Promise.resolve(demoLife()),
    live ? settle('news', getNews()) : Promise.resolve(demoNews()),
    live ? settle('alerts', getAlerts()) : Promise.resolve(demoAlerts()),
    // 只有平日 18:00 後（和果交班提醒要判斷假日）才多問一次假日行事曆
    live && timeStr() >= '18:00' ? getHolidayToday() : Promise.resolve(false),
  ]);
  if (db) Object.assign(state, db);
  if (events) state.events = events;
  if (alerts) state.alerts = alerts;
  state.holidayToday = !!holiday;
  if (weather) state.weather = weather;
  if (fx) state.fx = fx;
  if (mail) state.mail = mail;
  if (inbox !== undefined) state.inbox = inbox;
  if (hecho) state.hecho = hecho;
  if (company !== undefined) state.company = company;
  if (ticktick !== undefined) state.ticktick = ticktick;
  if (invest !== undefined) state.invest = invest;
  if (life !== undefined) state.life = life;
  if (news) { state.news = news.rows; state.digests = news.digests; }
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
