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

// ---------- 沁耘／和果營運 ----------

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

// 交班紀錄的「統計」欄是一段文字；這裡只取數字，不取任何姓名
export function parseHandoverStats(stats = '') {
  const num = (re) => {
    const m = stats.match(re);
    return m && /^\d+$/.test(m[1]) ? Number(m[1]) : null;
  };
  return {
    expected: num(/應到(\d+)人/),
    present: num(/實到(\d+)人/),
    clientLeave: num(/實到\d+人、請假(\d+)人/),
    staffOn: num(/上班人數(\d+)人/),
    staffLeave: num(/請假人數(\d+)人/),
    incidents: num(/異常事件人數(\w+)人/),
  };
}

// 優先讀「只有數字」的統計檔；還沒有這個檔時，才退回讀完整交班檔（裡面有長輩的照護紀錄）
async function handoverStats() {
  try {
    const r = await (await hechoFile(CONFIG.hecho.stats)).json();
    return { exported: r.exported || '', rows: r.rows || [], source: 'stats' };
  } catch (e) {
    if (!(e instanceof GraphError) || e.status !== 404) throw e;
  }
  const r = await (await hechoFile(CONFIG.hecho.handover)).json();
  return {
    exported: r.exported || '',
    rows: (r.rows || []).map((row) => ({ date: row.date, ...parseHandoverStats(row.stats) })),
    source: 'handover',
  };
}

export async function getHecho() {
  const [handover, monthly] = await Promise.all([
    handoverStats(),
    hechoFile(CONFIG.hecho.monthly).then((r) => r.text()).then(parseCsv),
  ]);
  const latest = [...handover.rows].sort((a, b) => b.date.localeCompare(a.date))[0];
  const month = monthly[monthly.length - 1];
  return {
    exported: handover.exported,
    source: handover.source,
    latest: latest || null,
    month: month ? {
      label: `${month.年}/${month.月}`,
      rate: Number(month.出席率),
      avg: Number(month.每日平均出席),
      days: Number(month.服務日數),
      upTo: month.計算到,
    } : null,
  };
}

export function demoHecho() {
  const t = dateStr();
  return {
    exported: `${t} 13:30`,
    latest: { date: t, expected: 38, present: 31, clientLeave: 7, staffOn: 7, staffLeave: 2, incidents: 1 },
    month: { label: `${t.slice(0, 4)}/${Number(t.slice(5, 7))}`, rate: 0.91, avg: 34.2, days: 3, upTo: t },
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
