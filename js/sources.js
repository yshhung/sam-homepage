// 即時資料：Outlook 行事曆、天氣、匯率。每個來源只抓一次，再分給各區塊用。
import { CONFIG } from '../config.js';
import { graph, GraphError } from './auth.js';
import { addDays, dateStr } from './util.js';

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
