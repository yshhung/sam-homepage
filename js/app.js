// 首頁只負責「看」：資料都從原本的地方讀（Outlook、TickTick 同步檔、和果與沁耘的數字檔），
// 不寫入任何東西。新增、完成待辦一律在 Claude App 或 TickTick 裡做。
import { CONFIG } from '../config.js';
import { getAccount, initAuth, isConfigured, login, logout } from './auth.js';
import { DemoStore, ExcelStore } from './store.js';
import {
  demoCalendar, demoCompany, demoHecho, demoInvest, demoLife, demoMail, demoMonthDays, demoNews, demoTickTick,
  alertsView, demoAlerts, getAlerts, getCalendar, getCompany, getFx, getHecho, getInvest, getLife, getLocation, getMail, getMonthDays, getNews, getTickTick, getWeather, hechoSummary,
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
const TICKTICK_WEB = 'https://ticktick.com/webapp/';

const state = {
  store: null,
  cards: [], settings: { ...CONFIG.defaults },
  events: [], alerts: [], monthDays: [], weather: null, fx: null, mail: [], hecho: null, company: null, ticktick: null, invest: null, life: null, news: [], digests: [],
  errors: {}, syncedAt: null, loading: false,
  showUpcoming: false, showAllNews: false, showAllFocus: false, showNewsList: false, openMore: new Set(),
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
  if (age >= 2) focus.push({ key: 'tt:stale', cat: 'TickTick', domain: '工作', title: `TickTick 待辦 ${age} 天沒同步`, meta: '在 Claude App 改過待辦，或等下一次同步（每天 07:30、12:00、15:00、18:00、21:00 前後）', level: 'info', sort: 0.85 });
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

  renderStatus();
  renderCal(today);

  const list = $('focus-list');
  const shownFocus = state.showAllFocus ? focus : focus.slice(0, FOCUS_FIRST);
  list.replaceChildren(...(focus.length ? shownFocus.map(focusRow) : [el('li', { class: 'empty' }, '✓ 今天沒有重點，放心做別的事')]));
  $('focus-count').textContent = focus.length ? String(focus.length) : '';
  const focusMore = $('btn-focus-more');
  focusMore.hidden = focus.length <= FOCUS_FIRST;
  focusMore.textContent = state.showAllFocus ? '▾ 收起' : `▸ 再看 ${focus.length - FOCUS_FIRST} 件`;

  const upBtn = $('btn-upcoming');
  upBtn.hidden = upcoming.length === 0;
  upBtn.textContent = `${state.showUpcoming ? '▾' : '▸'} 之後還有 ${upcoming.length} 件`;
  const upList = $('upcoming-list');
  upList.hidden = !state.showUpcoming || upcoming.length === 0;
  upList.replaceChildren(...upcoming.map(focusRow));

  renderStrip(today);
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
  const actions = [];
  if (e.link) actions.push(el('a', { class: 'act', href: e.link, target: '_blank', rel: 'noopener' }, e.linkLabel || '打開'));
  actions.push(el('button', { class: 'act primary', type: 'button', title: '複製給 Claude', onclick: () => toClaude(e) }, '問 Claude'));
  const body = el('div', { class: 'f-body' },
    el('div', { class: 'f-top' }, el('span', { class: 'chip' }, e.cat), el('span', { class: 'f-title' }, e.title)),
    e.meta ? el('div', { class: 'f-meta' }, e.meta) : null);
  return el('li', { class: `f-row ${e.level}` }, body, el('div', { class: 'f-acts' }, actions));
}

// 日曆卡片：左邊今天的日期、農曆、節氣、宜忌；右邊本月月曆，有 Outlook 行程的日子打點
function renderCal(today) {
  const [y, m, d] = today.split('-').map(Number);
  const a = almanac(today, 6);
  const left = el('div', { class: 'cal-today' },
    el('div', { class: 'cal-ym' }, `${y} 年 · 星期${weekday(today)}`),
    el('div', { class: 'cal-day' }, `${m}/${d}`),
    a ? el('div', { class: 'cal-lunar' }, `農曆${a.lunar}`, a.term ? el('span', { class: 'chip' }, a.term) : null) : null,
    a?.yi.length ? el('div', { class: 'cal-yj yi' }, el('b', {}, '宜'), el('span', {}, a.yi.join('、'))) : null,
    a?.ji.length ? el('div', { class: 'cal-yj ji' }, el('b', {}, '忌'), el('span', {}, a.ji.join('、'))) : null,
    calWeather(today));

  const days = new Set([...state.monthDays, ...state.events.map((ev) => ev.start.slice(0, 10))]);
  const first = `${today.slice(0, 7)}-01`;
  const lead = new Date(`${first}T12:00:00+08:00`).getUTCDay();
  const cells = ['日', '一', '二', '三', '四', '五', '六'].map((w, i) => el('div', { class: `cal-w${i === 0 || i === 6 ? ' we' : ''}` }, w));
  for (let i = 0; i < lead; i++) cells.push(el('div', { class: 'cal-c blank' }));
  for (let dt = first; dt.slice(0, 7) === first.slice(0, 7); dt = addDays(dt, 1)) {
    const dow = new Date(`${dt}T12:00:00+08:00`).getUTCDay();
    const cls = ['cal-c', dt === today && 'today', dt < today && 'past', (dow === 0 || dow === 6) && 'we', days.has(dt) && 'has'].filter(Boolean).join(' ');
    cells.push(el('div', { class: cls, title: days.has(dt) ? '有行程' : null },
      el('span', { class: 'n' }, String(Number(dt.slice(8)))), el('span', { class: 'l' }, lunarDay(dt))));
  }
  const grid = el('div', { class: 'cal-month' },
    el('a', { class: 'cal-open', href: 'https://outlook.office.com/calendar/view/month', target: '_blank', rel: 'noopener' }, '打開 Outlook 行事曆 ›'),
    el('div', { class: 'cal-grid' }, cells));
  $('cal').replaceChildren(left, grid);
}

// 日曆卡片裡的天氣：現在溫度＋今天高低溫與降雨，再加明天、後天
function calWeather(today) {
  const w = state.weather;
  const head = el('div', { class: 'cal-wx-k', title: w?.here ? '依這台裝置的目前位置' : '沒有取得目前位置，用預設地點' },
    `天氣 · ${w?.place || CONFIG.weather.name}${w?.here ? ' 📍' : ''}`);
  if (!w) return el('div', { class: 'cal-wx' }, head, el('div', { class: 'cal-wx-s' }, state.errors.weather ? '抓不到' : '載入中'));
  const s = state.settings;
  const rainy = (d) => d.rain >= s.雨機率門檻;
  const wt = w.days.find((d) => d.date === today);
  const rest = w.days.filter((d) => d.date > today).slice(0, 2);
  return el('div', { class: 'cal-wx' }, head,
    el('div', { class: 'cal-wx-now' },
      el('span', { class: 'cal-wx-t' }, `${w.now}°`),
      el('span', {}, w.text, wt ? el('span', { class: 'cal-wx-s' }, ` · ${wt.min}–${wt.max}° · `, el('span', { class: rainy(wt) ? 'rain' : '' }, `雨 ${wt.rain}%`)) : null)),
    rest.length ? el('div', { class: 'cal-wx-next' }, rest.map((d) =>
      el('span', {}, `${diffDays(d.date, today) === 1 ? '明天' : '後天'} ${d.text} ${d.min}–${d.max}° `, el('span', { class: rainy(d) ? 'rain' : '' }, `雨 ${d.rain}%`)))) : null);
}

function renderStrip(today) {
  const tiles = [];
  tiles.push(assetTile(today));

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

// 總資產：台股＋美股合計（invest.json）；今日變動用美股習慣：漲綠、跌紅
function assetTile(today) {
  const inv = state.invest;
  if (!inv?.totalTwd) return tile('總資產', '—', state.errors.invest ? '抓不到' : state.loading ? '載入中' : '還沒同步');
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const pct = (v) => (typeof v === 'number' ? `${sign(v)}${Math.abs(v).toFixed(2)}%` : '—');
  const big = `${(inv.totalTwd / 10000).toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} 萬`;
  const age = inv.updated ? diffDays(today, inv.updated.slice(0, 10)) : 99;
  const lines = [];
  if (typeof inv.dayPct === 'number') {
    const amt = Math.round(inv.totalTwd * inv.dayPct / (100 + inv.dayPct));
    const a = Math.abs(amt);
    const amtText = a >= 10000 ? `${(a / 10000).toFixed(1)} 萬` : a.toLocaleString('en-US');
    lines.push(el('span', { class: `ln ${tone(inv.dayPct)}` }, `今日 ${sign(amt)}${amtText}（${pct(inv.dayPct)}）`));
  }
  if (age >= 3) lines.push(el('span', { class: 'ln' }, `${age} 天沒更新`));
  else if (typeof inv.cathayDayPct === 'number' || typeof inv.schwabDayPct === 'number') {
    lines.push(el('span', { class: 'ln split' },
      el('span', {}, '台股 ', el('b', { class: tone(inv.cathayDayPct) }, pct(inv.cathayDayPct))), ' ',
      el('span', {}, '美股 ', el('b', { class: tone(inv.schwabDayPct) }, pct(inv.schwabDayPct)))));
  }
  return el('div', { class: 'tile asset' }, el('div', { class: 'k' }, '總資產（NT$）'), el('div', { class: 'v' }, big), el('div', { class: 's' }, ...lines));
}

function tile(k, v, s, tone = '') {
  return el('div', { class: 'tile' }, el('div', { class: 'k' }, k), el('div', { class: `v ${tone}` }, v), el('div', { class: 's' }, s));
}

function renderDomains(focus) {
  const cards = DOMAINS.map((d) => {
    const rows = (CARD_ROWS[d] || [d]).map((k) => state.cards.find((x) => x.領域 === k)).filter(Boolean);
    const notes = rows.map((r) => r.說明).filter((t) => t && !t.startsWith('在這裡寫一句'));
    const n = focus.filter((e) => domainOf(e) === d).length;
    const auto = autoCard(d);
    const link = auto?.link || CONFIG.detailLinks[d];
    return el('article', { class: 'domain' },
      el('div', { class: 'd-head' }, el('h2', {}, d)),
      auto?.stats
        ? el('div', { class: 'd-stats' }, ...auto.stats.map((x) => el('div', { class: 'd-stat' }, el('div', { class: 'd-num' }, x.v), el('div', { class: 'd-k' }, x.k))))
        : el('div', { class: 'd-num' }, auto?.num || rows[0]?.數字 || '—'),
      auto?.text ? el('p', { class: 'd-text auto' }, auto.text) : null,
      // 手機上卡片窄，四池只顯示「⚠️ 四池」，有問題才出現
      auto?.plan ? el('a', { class: `d-plan ${auto.plan.warn ? 'warn' : 'ok'}`, href: 'invest.html#plans' },
        el('span', { class: 'd-long' }, auto.plan.text), el('span', { class: 'd-short' }, '⚠️ 四池')) : null,
      ...notes.map((t) => el('p', { class: 'd-text' }, t)),
      d === '工作' && state.hecho ? el('button', { class: 'act d-ask', type: 'button', title: '複製最近的數字（沒有姓名），打開 Claude', onclick: askHecho }, '問 AI') : null,
      el('div', { class: 'd-foot' },
        el('span', { class: n ? 'pill on' : 'pill' }, n ? `${n} 件重點` : '沒有重點'),
        // 首頁自己的頁面（例如投資頁）在同一個畫面打開；外部連結開新分頁
        link ? (/^https?:/.test(link) ? el('a', { href: link, target: '_blank', rel: 'noopener' }, '詳細 ↗') : el('a', { href: link }, '詳細 →'))
          : el('span', { 'aria-hidden': 'true' }, '\u00a0'))); // 沒有連結也留位置，三張的最下面一行才對齊
  });
  $('domains').replaceChildren(...cards);
}

// 新聞：早報、晚報整理的，點標題開原文（新分頁）
const NEWS_FIRST = 6;
const FOCUS_FIRST = 5;
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
    if (v) return { num: v.num, text: v.text, plan: planView(state.invest, dateStr())?.summary };
  }
  if (domain === '生活') {
    const v = lifeView(state.life, state.ticktick, dateStr());
    if (v) return { num: v.num, text: v.text, link: v.link };
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
      mail: '信件抓不到', hecho: `和果資料抓不到（${err.message}）`, company: '網站與社群數字抓不到', ticktick: 'TickTick 同步檔抓不到',
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
  const [db, events, weather, fx, mail, hecho, company, ticktick, invest, life, news, monthDays, alerts] = await Promise.all([
    settle('data', state.store.load()),
    live ? settle('calendar', getCalendar()) : Promise.resolve(demoCalendar()),
    settle('weather', getLocation().then(getWeather)),
    settle('fx', getFx()),
    live ? settle('mail', getMail()) : Promise.resolve(demoMail()),
    live ? settle('hecho', getHecho()) : Promise.resolve(demoHecho()),
    live ? settle('company', getCompany()) : Promise.resolve(demoCompany()),
    live ? settle('ticktick', getTickTick()) : Promise.resolve(demoTickTick()),
    live ? settle('invest', getInvest()) : Promise.resolve(demoInvest()),
    live ? settle('life', getLife()) : Promise.resolve(demoLife()),
    live ? settle('news', getNews()) : Promise.resolve(demoNews()),
    live ? settle('month', getMonthDays()) : Promise.resolve(demoMonthDays()),
    live ? settle('alerts', getAlerts()) : Promise.resolve(demoAlerts()),
  ]);
  if (db) Object.assign(state, db);
  if (events) state.events = events;
  if (monthDays) state.monthDays = monthDays;
  if (alerts) state.alerts = alerts;
  if (weather) state.weather = weather;
  if (fx) state.fx = fx;
  if (mail) state.mail = mail;
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
