// 即時資料：Outlook 行事曆、天氣、匯率。每個來源只抓一次，再分給各區塊用。
import { CONFIG } from '../config.js';
import { graph, GraphError } from './auth.js';
import { addDays, dateStr, diffDays, relDay, shortDate } from './util.js';

export async function getCalendar() {
  const today = dateStr();
  const start = `${today}T00:00:00`;
  const end = `${addDays(today, 2)}T00:00:00`;
  const q = new URLSearchParams({
    startDateTime: start, endDateTime: end,
    $select: 'id,subject,start,end,isAllDay,location,webLink,isCancelled',
    $orderby: 'start/dateTime', $top: '50',
  });
  const r = await graph(`/me/calendarView?${q}`, { headers: { Prefer: 'outlook.timezone="Asia/Taipei"' } });
  return r.value.filter((e) => !e.isCancelled).map((e) => ({
    id: e.id,
    subject: e.subject || '（無標題）',
    start: e.start.dateTime.slice(0, 16),
    end: e.end.dateTime.slice(0, 16),
    allDay: e.isAllDay,
    location: e.location?.displayName || '',
    link: e.webLink,
  }));
}

export function demoCalendar() {
  const t = dateStr();
  const tm = addDays(t, 1);
  return [
    { id: 'd1', subject: '和果站週會', start: `${t}T10:00`, end: `${t}T11:00`, allDay: false, location: '土城和果', link: '' },
    { id: 'd2', subject: '社會局訪視', start: `${t}T15:00`, end: `${t}T16:30`, allDay: false, location: '沁耘辦公室', link: '' },
    { id: 'd3', subject: '會計師月結', start: `${tm}T09:30`, end: `${tm}T10:30`, allDay: false, location: '線上', link: '' },
  ];
}

// ---------- 需回覆信件 ----------

const MAIL_SELECT = 'id,subject,from,receivedDateTime,webLink,importance,isRead,flag';

function mailFrom(m) {
  return {
    id: m.id,
    subject: m.subject || '（無主旨）',
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
    received: m.receivedDateTime,
    link: m.webLink,
    flagged: m.flag?.flagStatus === 'flagged',
    due: m.flag?.dueDateTime?.dateTime?.slice(0, 10) || '',
  };
}

export async function getMail() {
  const since = new Date(Date.now() - CONFIG.mail.importantDays * 86400000).toISOString();
  const list = (filter) => graph(`/me/mailFolders/inbox/messages?${new URLSearchParams({ $filter: filter, $select: MAIL_SELECT, $top: '25' })}`);
  const [flagged, important] = await Promise.all([
    list("flag/flagStatus eq 'flagged'"),
    list(`isRead eq false and importance eq 'high' and receivedDateTime ge ${since}`),
  ]);
  const seen = new Set();
  return [...flagged.value, ...important.value].map(mailFrom).filter((m) => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => b.received.localeCompare(a.received));
}

export function demoMail() {
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  return [
    { id: 'm1', subject: 'Q3 財報補件', from: '會計師事務所', received: ago(20), link: '', flagged: true, due: '' },
    { id: 'm2', subject: '11 月家屬座談會時間', from: '王小姐（家屬）', received: ago(3), link: '', flagged: false, due: '' },
  ];
}

// ---------- 和果日照營運 ----------

function hechoFile(name) {
  const { driveId, folder } = CONFIG.hecho;
  const path = `${folder}/${name}`.split('/').map(encodeURIComponent).join('/');
  return graph(`/drives/${driveId}/root:/${path}:/content`, { raw: true });
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...data] = rows.filter((r) => r.some((c) => c !== ''));
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}

// 只讀「只有數字」的交班統計檔；完整交班檔（有長輩的照護紀錄）首頁一律不下載
async function handoverStats() {
  try {
    const r = await (await hechoFile(CONFIG.hecho.stats)).json();
    return { exported: r.exported || '', rows: r.rows || [] };
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) throw new Error('還沒有交班數字檔');
    throw e;
  }
}

export async function getHecho() {
  const [handover, monthly] = await Promise.all([
    handoverStats(),
    hechoFile(CONFIG.hecho.monthly).then((r) => r.text()).then(parseCsv),
  ]);
  const sorted = [...handover.rows].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const month = monthly[monthly.length - 1];
  return {
    exported: handover.exported,
    latest: latest || null,
    recent: sorted.slice(0, 7), // 最近 7 筆，給「問 AI」的摘要用（只有數字）
    month: month ? {
      label: `${month.年}/${month.月}`,
      rate: Number(month.出席率),
      avg: Number(month.每日平均出席),
      days: Number(month.服務日數),
      upTo: month.計算到,
    } : null,
  };
}

// 給「問 AI」貼上用的和果摘要：只放日期和數字，沒有任何姓名
export function hechoSummary(h) {
  if (!h) return '（和果資料還沒讀到）';
  const n = (v) => (v === null || v === undefined ? '—' : v);
  const lines = [];
  if (h.month) {
    lines.push(`本月（${h.month.label}，算到 ${h.month.upTo}）：出席率 ${Math.round(h.month.rate * 100)}%，每日平均出席 ${h.month.avg} 人，服務 ${h.month.days} 天`);
  }
  lines.push('最近幾天交班（日期｜應到｜實到｜個案請假｜員工上班｜員工請假｜異常事件）：');
  for (const r of h.recent || (h.latest ? [h.latest] : [])) {
    const present = r.present === null || r.present === undefined ? '還沒點名' : r.present;
    lines.push(`${r.date}｜${n(r.expected)}｜${present}｜${n(r.clientLeave)}｜${n(r.staffOn)}｜${n(r.staffLeave)}｜${n(r.incidents)}`);
  }
  if (h.exported) lines.push(`資料匯出時間：${h.exported}`);
  return lines.join('\n');
}

export function demoHecho() {
  const t = dateStr();
  return {
    exported: `${t} 13:30`,
    latest: { date: t, expected: 38, present: 31, clientLeave: 7, staffOn: 7, staffLeave: 2, incidents: 1 },
    recent: [
      { date: t, expected: 38, present: 31, clientLeave: 7, staffOn: 7, staffLeave: 2, incidents: 1 },
      { date: addDays(t, -1), expected: 39, present: 36, clientLeave: 3, staffOn: 8, staffLeave: 1, incidents: 0 },
    ],
    month: { label: `${t.slice(0, 4)}/${Number(t.slice(5, 7))}`, rate: 0.91, avg: 34.2, days: 3, upTo: t },
  };
}

// ---------- TickTick 同步檔 ----------
// Claude 每次改 TickTick 後會更新這個檔，每天 07:30 的排程也會再整理一次

async function oneDriveJson(relPath) {
  const path = relPath.split('/').map(encodeURIComponent).join('/');
  try {
    return await (await graph(`/me/drive/root:/${path}:/content`, { raw: true })).json();
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null; // 還沒同步過
    throw e;
  }
}

export function getTickTick() {
  return oneDriveJson(CONFIG.tickTickPath);
}

export function demoTickTick() {
  const t = dateStr();
  const d = (n) => addDays(t, n);
  return {
    updated: `${t} 08:10`,
    tasks: [
      { id: 'd1', title: '與護理師會談', list: '🏫社區長照營運', due: d(-2), time: '12:00', priority: 3 },
      { id: 'd2', title: '寄出上個月核銷資料', list: '🏫社區長照營運', due: t, time: '10:00', priority: 5 },
      { id: 'd3', title: '繳納房屋租賃所得稅扣繳', list: '💼公司營運', due: d(2), time: '10:00', priority: 5 },
      { id: 'd4', title: '預約雷射除毛', list: '🏠我的家庭', due: d(1), time: null, priority: 3 },
      { id: 'd5', title: '取消 LINE 收回功能', list: '📦生活瑣事', due: d(6), time: '09:00', priority: 0 },
    ],
  };
}

// ---------- 沁耘網站與社群 ----------

export function getCompany() {
  return oneDriveJson(CONFIG.companyStatsPath);
}

export function demoCompany() {
  return {
    updated: `${dateStr()} 07:30`,
    website: { domain: 'qinyunhealth.com', month: dateStr().slice(0, 7), views: 120, visitors: 48, posts: 1, prevViews: 436, prevVisitors: 129, views14d: 90, posts14d: 1 },
    social: { igFollowers: 66, igReach7d: 0, igContent14d: 0, fbFollowers: 103, fbViews7d: 8, fbContent14d: 2, gbpReach7d: null, gbpClicks7d: null },
  };
}

// ---------- 投資（只有彙總數字） ----------
// 每天 07:30 排程跑 tools/invest_sync.py 寫的；首頁拿不到股數、代號或帳號

export function getInvest() {
  return oneDriveJson(CONFIG.investPath);
}

export function demoInvest() {
  // 明顯是假的數字
  return {
    updated: `${dateStr()} 07:30`, asOf: { tw: addDays(dateStr(), -1), us: addDays(dateStr(), -1) },
    totalTwd: 1234567, cathayTwd: 234567, schwabUsd: 33333.33, schwabTwd: 1000000, fx: 30,
    dayPct: -2.5, cathayDayPct: -1.1, schwabDayPct: -3.0, monthPct: 1.2, monthBase: addDays(dateStr(), -10), stalePrices: 0,
  };
}

const signed = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
const wan = (twd) => `${(twd / 10000).toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} 萬`;

// 投資卡片的數字、說明，以及要列進今日重點的事
export function investView(inv, today, threshold) {
  if (!inv?.totalTwd) return null;
  const asOf = [inv.asOf?.tw, inv.asOf?.us].filter(Boolean).sort().pop() || inv.updated?.slice(0, 10);
  const text = [
    `國泰 ${wan(inv.cathayTwd)}・嘉信 US$${Math.round(inv.schwabUsd).toLocaleString('en-US')}`,
    `今日 ${signed(inv.dayPct)}、本月 ${signed(inv.monthPct)}`,
  ].join('；') + (asOf ? `（收盤價 ${shortDate(asOf)}）` : '');
  const alerts = [];
  const big = (v) => v !== null && v !== undefined && Math.abs(v) >= threshold;
  if (big(inv.dayPct)) {
    alerts.push({ type: 'day', title: `總資產單日 ${signed(inv.dayPct)}`, level: 'warn',
      meta: `國泰 ${signed(inv.cathayDayPct)}、嘉信 ${signed(inv.schwabDayPct)} · 超過你設的 ${threshold}% 門檻` });
  }
  if (big(inv.monthPct)) {
    alerts.push({ type: 'month', title: `總資產本月 ${signed(inv.monthPct)}`, level: 'info',
      meta: `跟 ${inv.monthBase ? shortDate(inv.monthBase) : '上月底'} 比，含入金出金 · 超過 ${threshold}% 門檻` });
  }
  const age = inv.updated ? diffDays(today, inv.updated.slice(0, 10)) : 99;
  if (age >= 3) alerts.push({ type: 'stale', title: `投資數字 ${age} 天沒更新`, level: 'info', meta: '辦公室電腦的 Claude 開著時，每天 07:30 的排程才會更新' });
  else if (inv.stalePrices > 0) alerts.push({ type: 'prices', title: `投資有 ${inv.stalePrices} 檔價格沒抓到`, level: 'info', meta: '沿用上一次的價格，總資產可能有落差' });
  return { num: wan(inv.totalTwd), text, alerts };
}

// ---------- 生活：旅行倒數＋TickTick 生活清單 ----------

export const LIFE_LISTS = ['🏠我的家庭', '🏃我的生活', '📦生活瑣事'];
const BILL = /扣款|扣繳|繳費|繳納|帳單|卡費|繳/;

export function getLife() {
  return oneDriveJson(CONFIG.lifePath);
}

export function demoLife() {
  return { updated: `${dateStr()} 08:00`, trips: [{ name: '示範旅行', start: addDays(dateStr(), 18), end: addDays(dateStr(), 20), place: '某地', status: 'confirmed', url: '' }] };
}

export function lifeView(life, ticktick, today) {
  const trips = (life?.trips || []).filter((t) => t.start && (t.end || t.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
  const trip = trips.find((t) => t.status !== 'planning') || trips[0] || null;
  const tasks = (ticktick?.tasks || []).filter((t) => LIFE_LISTS.includes(t.list) && t.due)
    .sort((a, b) => a.due.localeCompare(b.due) || (a.time || '99').localeCompare(b.time || '99'));
  if (!trip && !tasks.length) return null;

  const parts = [];
  let num = '—';
  if (trip) {
    const n = diffDays(trip.start, today);
    num = n <= 0 ? '旅行中' : `${n} 天`;
    parts.push(`${n <= 0 ? '' : '距離'}${trip.name}（${shortDate(trip.start)}${trip.status === 'planning' ? '，規劃中' : ''}）`);
  }
  const bills = tasks.filter((t) => BILL.test(t.title));
  const others = tasks.filter((t) => !BILL.test(t.title));
  if (bills.length) parts.push(`扣款／帳單：${bills.slice(0, 2).map((t) => `${t.title.split('：')[0]}（${relDay(t.due, today)}）`).join('、')}`);
  if (tasks.length) {
    const next = others[0] || tasks[0];
    parts.push(`生活待辦 ${tasks.length} 件${next ? `，下一件：${next.title}（${relDay(next.due, today)}）` : ''}`);
  }

  const alerts = [];
  for (const t of trips) {
    const n = diffDays(t.start, today);
    if (t.status === 'planning' && n >= 0 && n <= 21) {
      alerts.push({ type: `plan:${t.start}`, title: `${t.name}（${shortDate(t.start)}）還沒確定`, meta: t.note || '訂好後告訴 Claude，首頁會改成確定的倒數', level: 'info', link: t.url });
    } else if (t.status !== 'planning' && n >= 0 && n <= 7) {
      alerts.push({ type: `trip:${t.start}`, title: n === 0 ? `今天出發：${t.name}` : `${n} 天後出發：${t.name}`, meta: t.note || t.place || '', level: n <= 1 ? 'warn' : 'info', link: t.url });
    }
  }
  return { num, text: parts.join('；'), link: trip?.url || '', alerts };
}

// ---------- 新聞：早報、晚報整理的 ----------
// 雲端報告每次寫 投資資料/市場/<早報|晚報>/news_digest.json（各類別一段摘要，首頁只顯示最新一份），
// 另外每天寫 news_<星期幾>.json（新聞列表，下週同一天蓋掉，所以保留 7 天，收在摘要下面）。
// 檔沒變就用上次讀過的（記在這台裝置），每次重新整理只多 2 個列資料夾的請求。

const NEWS_DIRS = ['投資資料/市場/早報', '投資資料/市場/晚報'];
const NEWS_CACHE = 'sam.news.v2';

export async function getNews() {
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(NEWS_CACHE)) || {}; } catch { cache = {}; }
  const next = {};
  const lists = await Promise.all(NEWS_DIRS.map(async (dir) => {
    const path = dir.split('/').map(encodeURIComponent).join('/');
    try {
      return (await graph(`/me/drive/root:/${path}:/children?$select=id,name,lastModifiedDateTime&$top=200`)).value || [];
    } catch (e) {
      if (e instanceof GraphError && e.status === 404) return []; // 報告還沒跑過
      throw e;
    }
  }));
  const files = lists.flat().filter((f) => /^news_([1-7]|digest)\.json$/.test(f.name));
  const parts = await Promise.all(files.map(async (f) => {
    const k = `${f.id}@${f.lastModifiedDateTime}`;
    if (cache[k] === undefined) cache[k] = await (await graph(`/me/drive/items/${encodeURIComponent(f.id)}/content`, { raw: true })).json();
    next[k] = cache[k];
    return { digest: f.name === 'news_digest.json', data: next[k] };
  }));
  try { localStorage.setItem(NEWS_CACHE, JSON.stringify(next)); } catch { /* 存不了就下次重讀 */ }
  return {
    rows: parts.filter((p) => !p.digest && Array.isArray(p.data)).flatMap((p) => p.data),
    digests: parts.filter((p) => p.digest && p.data && typeof p.data === 'object').map((p) => p.data),
  };
}

export function demoNews() {
  const t = dateStr();
  const digest = {
    by: '早報', at: `${t}T08:50:00+08:00`,
    items: [
      { cat: '台股', text: '示範：某指數[收漲 1%](https://example.com/)，電子股帶動。' },
      { cat: '美股', text: '示範：某公司[公布財報](https://example.com/)，盤後上漲；另一檔持平。' },
      { cat: '總經', text: '示範：今晚公布某項經濟數據，市場預期持平。' },
      { cat: '生活', text: '示範：[某項長照補助上路](https://example.com/)，申請方式簡化。' },
    ],
  };
  return { digests: [digest], rows: [
    { title: '示範財經新聞：某指數收漲', src: '示範來源', url: 'https://example.com/', rel: '示範說明', cat: '財經', by: '早報', at: `${t}T08:50:00+08:00` },
    { title: '示範生活新聞：某項補助上路', src: '示範來源', url: 'https://example.com/', rel: '', cat: '生活', by: '早報', at: `${t}T08:50:00+08:00` },
    { title: '示範財經新聞：某公司公布財報', src: '示範來源', url: 'https://example.com/', rel: '', cat: '財經', by: '晚報', at: `${addDays(t, -1)}T22:05:00+08:00` },
  ] };
}

// 摘要：取最新一份（3 天內）；最新那份沒有的類別（例如晚報沒有生活），用 24 小時內另一份補上並標出是哪份；
// 類別照固定順序；[文字](網址) 拆成文字與連結（只認 http(s)）
const DIGEST_CATS = ['台股', '美股', '總經', '生活'];
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
export function digestView(digests, now = new Date()) {
  const all = (Array.isArray(digests) ? digests : [])
    .filter((x) => x && Array.isArray(x.items) && x.items.length && Date.parse(x.at) >= now.getTime() - 3 * 86400000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const d = all[0];
  if (!d) return null;
  const items = DIGEST_CATS.map((cat) => {
    const has = (x) => x.items.some((it) => it && it.cat === cat && String(it.text || '').trim());
    const src = has(d) ? d : all.find((x) => has(x) && Date.parse(d.at) - Date.parse(x.at) <= 86400000);
    if (!src) return null;
    const text = src.items.filter((it) => it && it.cat === cat).map((it) => String(it.text || '').trim()).filter(Boolean).join('\n')
      .replace(/\[([^\]\n]+)\]\((?!https?:\/\/)[^)\s]*\)/g, '$1');
    if (!text) return null;
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(LINK_RE)) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index) });
      parts.push({ text: m[1], url: m[2] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return { cat, parts, from: src === d ? '' : src.by || '' };
  }).filter(Boolean);
  if (!items.length) return null;
  const at = new Date(d.at);
  return { by: d.by || '', day: dateStr(at), time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`, items };
}

// 只留 7 天內、網址是 http(s) 的；同一個網址只留最新一次；新的在前
export function newsView(rows, now = new Date()) {
  const since = now.getTime() - 7 * 86400000;
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.title && /^https?:\/\//.test(r.url || '') && Date.parse(r.at) >= since)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((r) => {
      const k = r.url.replace(/[?#].*$/, '').replace(/\/$/, '') || r.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({ title: r.title, src: r.src || '', url: r.url, rel: r.rel || '', cat: r.cat || '財經', by: r.by || '', day: dateStr(new Date(r.at)) }));
}

const WX = {
  0: '晴', 1: '晴時多雲', 2: '多雲', 3: '陰', 45: '霧', 48: '霧', 51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
  61: '小雨', 63: '雨', 65: '大雨', 80: '陣雨', 81: '陣雨', 82: '強陣雨', 95: '雷雨', 96: '雷雨', 99: '雷雨',
};

export async function getWeather() {
  const { lat, lon } = CONFIG.weather;
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'Asia/Taipei', forecast_days: '3',
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
  });
  const r = await (await fetch(`https://api.open-meteo.com/v1/forecast?${q}`)).json();
  const days = r.daily.time.map((date, i) => ({
    date,
    max: Math.round(r.daily.temperature_2m_max[i]),
    min: Math.round(r.daily.temperature_2m_min[i]),
    rain: r.daily.precipitation_probability_max[i] ?? 0,
    text: WX[r.daily.weather_code[i]] || '',
  }));
  return { now: Math.round(r.current.temperature_2m), text: WX[r.current.weather_code] || '', days };
}

// 匯率資料每天更新一次；拿最新一天跟前一天比
async function usdRates(tag) {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.min.json`,
    `https://${tag}.currency-api.pages.dev/v1/currencies/usd.min.json`,
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.json();
    } catch { /* 換備用網址 */ }
  }
  throw new Error('匯率抓不到');
}

export async function getFx() {
  const latest = await usdRates('latest');
  const prev = await usdRates(addDays(latest.date, -1));
  const rate = latest.usd.twd;
  const change = ((rate - prev.usd.twd) / prev.usd.twd) * 100;
  return { date: latest.date, rate, change };
}
