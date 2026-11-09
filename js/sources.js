// 即時資料：Outlook 行事曆、天氣、匯率。每個來源只抓一次，再分給各區塊用。
import { CONFIG } from '../config.js';
import { graph, GraphError } from './auth.js';
import { addDays, dateStr, diffDays, relDay, shortDate, timeStr } from './util.js';

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

// 月曆頁用：某段日期（含起、不含迄）的 Outlook 行程，有標題
export async function getEvents(fromDate, toDate) {
  const q = new URLSearchParams({
    startDateTime: `${fromDate}T00:00:00`, endDateTime: `${toDate}T00:00:00`,
    $select: 'id,subject,start,end,isAllDay,location,webLink,isCancelled',
    $orderby: 'start/dateTime', $top: '300',
  });
  const r = await graph(`/me/calendarView?${q}`, { headers: { Prefer: 'outlook.timezone="Asia/Taipei"' } });
  return r.value.filter((e) => !e.isCancelled).map((e) => ({
    id: e.id, subject: e.subject || '（無標題）', start: e.start.dateTime.slice(0, 16), end: e.end.dateTime.slice(0, 16),
    allDay: e.isAllDay, location: e.location?.displayName || '', link: e.webLink,
  }));
}

// 日曆卡片用：這個月有 Outlook 行程的日子（只拿日期，不拿標題）
export async function getMonthDays(today = dateStr()) {
  const first = `${today.slice(0, 7)}-01`;
  const next = addDays(first, 32).slice(0, 7);
  const q = new URLSearchParams({
    startDateTime: `${first}T00:00:00`, endDateTime: `${next}-01T00:00:00`,
    $select: 'start,end,isAllDay,isCancelled', $top: '300',
  });
  const r = await graph(`/me/calendarView?${q}`, { headers: { Prefer: 'outlook.timezone="Asia/Taipei"' } });
  return eventDays(r.value.filter((e) => !e.isCancelled).map((e) => ({
    start: e.start.dateTime.slice(0, 10), end: e.end.dateTime.slice(0, 16), allDay: e.isAllDay,
  })));
}

// 跨天的行程每天都算；整天行程的結束日是隔天 00:00，不算那天
export function eventDays(events) {
  const days = new Set();
  for (const e of events) {
    let last = e.end.slice(0, 10);
    if (e.allDay || e.end.slice(11) === '00:00') last = addDays(last, -1);
    if (last < e.start) last = e.start;
    for (let d = e.start, i = 0; d <= last && i < 62; d = addDays(d, 1), i++) days.add(d);
  }
  return [...days].sort();
}

export function demoMonthDays(today = dateStr()) {
  return [addDays(today, -3), today, addDays(today, 1), addDays(today, 6), addDays(today, 13)];
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

// 和果頁：每月一列的結構統計（只有人數，沒有姓名）加最近每天的交班數字
export async function getHechoDetail() {
  const [handover, monthly] = await Promise.all([
    handoverStats(),
    hechoFile(CONFIG.hecho.monthly).then((r) => r.text()).then(parseCsv),
  ]);
  return { exported: handover.exported, days: [...handover.rows].sort((a, b) => a.date.localeCompare(b.date)), months: monthly };
}

export function demoHechoDetail() {
  const t = dateStr();
  const months = [['2026', '6', 38, 41, 0.9, 33.1, 2, 1], ['2026', '7', 39, 42, 0.91, 34.0, 3, 2], ['2026', '8', 40, 43, 0.89, 33.6, 2, 1], ['2026', '9', 41, 44, 0.92, 35.2, 4, 1], ['2026', '10', 42, 45, 0.9, 35.8, 3, 2], ['2026', '11', 42, 44, 0.91, 34.2, 1, 1]]
    .map(([年, 月, 名, 服, 率, 均, 新, 未]) => ({ 年, 月, 名單人數: String(名), 服務個案數: String(服), 出席率: String(率), 每日平均出席: String(均), 新收_推算: String(新), 本月未再服務: String(未), 結案: '0', 暫停: '1', 男: '17', 女: '27', '未滿65': '4', '65-74': '10', '75-84': '19', '85以上': '11', 平均年齡: '78.4', 計算到: t, 服務日數: '20' }));
  const days = Array.from({ length: 14 }, (_, i) => ({ date: addDays(t, i - 13), expected: 38 + (i % 3), present: 30 + (i % 7), clientLeave: 4 + (i % 4), staffOn: 7, staffLeave: i % 3 ? 1 : 2, incidents: i === 12 ? 1 : 0 }));
  return { exported: `${t} 13:30`, days, months };
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
// Claude 每次改 TickTick 後會更新這個檔；雲端同步每天 07:30、12:30、15:30、18:30、21:30 也會整理一次

export async function oneDriveJson(relPath) {
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
    plan: {
      evaluated: dateStr(), evaluatedBy: '示範',
      pools: [
        { key: 'broad', label: '大盤', pct: 0.33, target: 0.4, band: 0.05, dev: -0.07, out: true, split: { us: 0.05, tw: 0.28 } },
        { key: 'conviction', label: '信念', pct: 0.44, target: 0.4, band: 0.05, dev: 0.04, out: false },
        { key: 'swing', label: '波段／待處理', pct: 0.1, target: 0.08, band: 0.03, dev: 0.02, out: false },
        { key: 'cash', label: '現金', pct: 0.13, target: 0.12, band: 0.03, dev: 0.01, out: false },
      ],
      alerts: [{ key: 'dd:DEMO', lvl: 'warn', title: '示範股 從 52 週高點 -26.0%', meta: '觸發兩步驟檢查', new: true, raised: dateStr(), since: dateStr() }],
      extras: { lotto: { limitUsd: 500, usedUsd: 0, leftUsd: 500, year: Number(dateStr().slice(0, 4)) }, usdAccum: { usd: null, threshold: 3000, ready: false },
        nextReview: `${dateStr().slice(0, 4)}-12-31`, sellPlan: { code: '示範', sold: 0, total: 60, batchesDone: 0, batches: 3, nextPrice: 100, deadline: '2027-06-30' } },
    },
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
  if (age >= 3) alerts.push({ type: 'stale', title: `投資數字 ${age} 天沒更新`, level: 'info', meta: '每天 07:30 與 15:30 的雲端同步會更新；連續沒更新請到排程頁看那一次的執行紀錄' });
  else if (inv.stalePrices > 0) alerts.push({ type: 'prices', title: `投資有 ${inv.stalePrices} 檔價格沒抓到`, level: 'info', meta: '沿用上一次的價格，總資產可能有落差' });
  return { num: wan(inv.totalTwd), text, alerts };
}

// 投資計畫書 v1：四池、觸發警報、小計（invest.json 的 plan，由 tools/invest_plan.py 算）
// 警報只在觸發時出現；new＝今天第一次觸發或升級（早報只推播這些）
const pp = (v, d = 1) => (typeof v === 'number' ? `${(v * 100).toFixed(d)}%` : '—');
const pt = (v) => (typeof v === 'number' ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(1)} 點` : '—');

const interimText = (x) => {
  const im = x.interim, parts = [];
  if (im.max !== undefined && im.max !== null) parts.push(`≤${pp(im.max, 0)}`);
  if (im.min !== undefined && im.min !== null) parts.push(`≥${pp(im.min, 0)}`);
  return `過渡目標 ${parts.join(' ')}${im.until ? `（到 ${im.until.slice(0, 4)}/${Number(im.until.slice(5, 7))}）` : ''}`;
};

export function planView(inv, today) {
  const p = inv?.plan;
  if (!p?.pools?.length) return null;
  const pools = p.pools.map((x) => ({
    key: x.key, label: x.label, pct: pp(x.pct), out: x.out,
    target: x.target === null || x.target === undefined ? '—' : `目標 ${pp(x.target, 0)}（±${Math.round((x.band || 0) * 100)}）`,
    dev: `偏離 ${pt(x.dev)}`, tone: x.out ? (x.dev > 0 ? 'over' : 'under') : '',
    sub: x.interim ? interimText(x) : x.split ? `SPYM ${pp(x.split.us)}・台股 ${pp(x.split.tw)}` : x.key === 'swing' ? '未歸池的持股暫列這裡' : '',
  }));
  const all = (p.alerts || []).map((a) => ({ key: a.key, title: a.title, meta: a.meta, lvl: a.lvl, isNew: !!a.new && a.raised === today, since: a.since,
    acked: !!a.acked, ackDate: a.ackDate, ackNote: a.ackNote }));
  // 已知悉的警報：投資頁照樣列（灰色），首頁待處理與投資卡的警報數都不算
  const alerts = all.filter((a) => !a.acked);
  const acked = all.filter((a) => a.acked);
  const ex = p.extras || {};
  const stats = [];
  if (ex.lotto) stats.push({ k: `樂透額度 ${ex.lotto.year}`, v: `US$${ex.lotto.leftUsd}`, s: `已用 US$${ex.lotto.usedUsd}／${ex.lotto.limitUsd}` });
  if (ex.usdAccum) {
    const u = ex.usdAccum;
    const th = (u.threshold || 0).toLocaleString('en-US');
    stats.push({ k: '美金累積', v: u.usd === null || u.usd === undefined ? '未回報' : `US$${Math.round(u.usd).toLocaleString('en-US')}`,
      s: u.ready ? `已達 US$${th}，可以電匯嘉信` : `滿 US$${th} 電匯嘉信${u.asOf ? `（${shortDate(u.asOf)}）` : ''}`, tone: u.ready ? 'go' : '' });
  }
  if (ex.nextReview) stats.push({ k: '下次半年檢查', v: shortDate(ex.nextReview), s: `剩 ${diffDays(ex.nextReview, today)} 天` });
  if (ex.sellPlan) {
    const s = ex.sellPlan;
    stats.push({ k: `${s.code} 賣出進度`, v: `${s.sold}／${s.total} 股`, s: s.nextPrice ? `第 ${s.batchesDone + 1} 批 $${s.nextPrice}・底線 ${shortDate(s.deadline)}` : '已賣完' });
  }
  if (ex.review) {
    const r = ex.review;
    stats.push({ k: '信念池 vs 上次檢查', v: `${pp(r.now)}`, s: `${shortDate(r.date)} 檢查時 ${pp(r.conviction)}・${r.down ? '比上次低，照進度' : '沒有比上次低'}`, tone: r.down ? 'go' : '' });
  }
  const highs = Object.entries(p.highs || {}).map(([code, h]) => ({ code, text: `52 週高 ${h.high52 < 20 ? h.high52.toFixed(2) : Math.round(h.high52 * 100) / 100}${h.highDate ? `（${shortDate(h.highDate)}）` : ''}・收 ${h.close < 20 ? h.close.toFixed(2) : Math.round(h.close * 100) / 100}（${pp(h.dd)}）` }));
  const age = p.evaluated ? diffDays(today, p.evaluated) : null;
  const by = p.evaluatedBy || '每日同步';
  const note = p.evaluated ? `警報判斷於 ${shortDate(p.evaluated)} ${by}（收盤價）${age >= 2 ? `・已 ${age} 天沒判斷` : ''}` : '警報還沒判斷過（下次每日同步）';
  // 首頁投資卡的一句話：有池子超出區間或有警報才標黃
  const off = p.pools.filter((x) => x.out);
  const parts = off.map((x) => `${x.label}${x.dev > 0 ? '偏高' : '偏低'} ${pt(x.dev)}`);
  if (alerts.length) parts.push(`${alerts.length} 個警報觸發中`);
  const summary = parts.length ? { text: `⚠️ 四池：${parts.join('、')}`, warn: true, short: alerts.length ? `⚠️ ${alerts.length} 警報` : '⚠️ 四池偏離' }
    : { text: acked.length ? `四池都在區間內，${acked.length} 個已知悉的警報` : '四池都在區間內，沒有警報', warn: false };
  return { pools, alerts, acked, highs, stats, note, summary };
}

// ---------- 天氣與營運警報 ----------
// 每日同步一天 5 次寫 alerts_weather.json（颱風、停班停課、氣象署特報）；早報、晚報寫 alerts_ops.json（停水停電、空品、疫情、道路）。
// 格式：{updated:"YYYY-MM-DD HH:MM", by, alerts:[{tag, lvl:"risk|warn|ok", title, text?, until?:"YYYY-MM-DD", src?, url?}]}
// 沒有警報就是空陣列。首頁只顯示 risk（紅）與 warn（黃），ok 不顯示；until 過了就不顯示；檔太久沒更新會提醒。

export async function getAlerts() {
  const files = await Promise.all(CONFIG.alertsPaths.map((p) => oneDriveJson(p)));
  return files.map((f, i) => (f && typeof f === 'object' ? { ...f, path: CONFIG.alertsPaths[i] } : null)).filter(Boolean);
}

export function demoAlerts() {
  const t = dateStr();
  return [{ updated: `${t} 07:35`, by: '示範', path: 'demo', alerts: [
    { tag: '低溫警戒', lvl: 'warn', title: '示範：低溫特報生效', text: '明晨新北最低 9°C，長輩保暖、接送加衣物', until: addDays(t, 1), src: '中央氣象署', url: 'https://www.cwa.gov.tw/' },
    { tag: '家屬提醒', lvl: 'warn', title: '明天偏冷溫差大', text: '12–16°C，早晚溫差大，請護理師提醒家屬', until: addDays(t, 1), src: '中央氣象署' },
  ] }];
}

const ALERT_STALE_HOURS = 30;
export function alertsView(files, today, now = new Date()) {
  const entries = [];
  const stale = [];
  const seen = new Set();
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || !Array.isArray(f.alerts)) continue;
    const at = Date.parse(String(f.updated || '').replace(' ', 'T') + '+08:00');
    if (Number.isFinite(at) && now.getTime() - at > ALERT_STALE_HOURS * 3600e3) stale.push({ name: f.path || '', hours: Math.floor((now.getTime() - at) / 3600e3), by: f.by || '' });
    for (const a of f.alerts) {
      if (!a || !a.title || (a.lvl !== 'risk' && a.lvl !== 'warn')) continue;
      if (a.until && /^\d{4}-\d{2}-\d{2}$/.test(a.until) && a.until < today) continue;
      const tag = String(a.tag || '警報').slice(0, 8);
      const key = `${tag}:${a.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ key, tag, lvl: a.lvl, title: String(a.title).slice(0, 40), text: String(a.text || '').slice(0, 80), src: String(a.src || ''), url: /^https?:\/\//.test(a.url || '') ? a.url : '' });
    }
  }
  return { entries, stale };
}

// ---------- 今日時間軸 ----------
// 把今天的 Outlook 行程、TickTick 待辦（有時間的排進時間軸，沒時間的是「全天」，過期的是「逾期」）和警報排成一條線。
// 純函式，不連網（tests/parse-test.html 測這裡）。nowHM 是現在的時間 "HH:MM"。
const stripEmoji = (t) => String(t || '').replace(/^\p{Extended_Pictographic}️?/u, '');
export function dayView({ events = [], tasks = [], alerts = [] }, today, nowHM) {
  const items = [];
  for (const ev of events) {
    if (!ev || String(ev.start || '').slice(0, 10) !== today) continue;
    if (ev.allDay) { items.push({ group: 1, time: '全天', title: ev.subject, meta: ev.location || '', tone: 'info', link: ev.link || '', kind: 'event' }); continue; }
    const t = ev.start.slice(11, 16);
    items.push({ group: 0, sortKey: t, time: t, title: ev.subject, meta: [ev.end ? `到 ${ev.end.slice(11, 16)}` : '', ev.location].filter(Boolean).join(' · '), tone: 'info', past: (ev.end || ev.start).slice(11, 16) < nowHM, link: ev.link || '', kind: 'event' });
  }
  for (const t of tasks) {
    if (!t || !t.due || !t.title) continue;
    const list = stripEmoji(t.list);
    if (t.due < today) items.push({ group: 3, sortKey: t.due, time: '逾期', title: t.title, meta: `已逾 ${Math.round((Date.parse(`${today}T12:00:00+08:00`) - Date.parse(`${t.due}T12:00:00+08:00`)) / 86400000)} 天 · ${list}`, tone: 'bad', kind: 'task' });
    else if (t.due === today && t.time) items.push({ group: 0, sortKey: t.time, time: t.time, title: t.title, meta: list, tone: t.priority >= 5 ? 'warn' : 'info', past: t.time < nowHM, kind: 'task' });
    else if (t.due === today) items.push({ group: 2, time: '全天', title: t.title, meta: list, tone: 'info', kind: 'task' });
  }
  // 家屬提醒（tag「家屬提醒」）另外在狀態下面顯示，不放進時間軸；但仍算在「要留意」的件數裡
  for (const a of alerts) if (a.tag !== '家屬提醒') items.push({ group: 1, time: '警報', title: a.title, meta: a.text || '', tone: a.lvl === 'risk' ? 'bad' : 'warn', kind: 'alert', link: a.url || '' });
  const order = (x) => x.group * 10 + (x.tone === 'bad' ? 0 : 1);
  items.sort((a, b) => a.group - b.group || (a.group === 0 ? a.sortKey.localeCompare(b.sortKey) : a.group === 3 ? a.sortKey.localeCompare(b.sortKey) : order(a) - order(b)));
  const timed = items.filter((x) => x.group === 0);
  const firstUpcoming = timed.findIndex((x) => !x.past);
  const nowAt = timed.length ? (firstUpcoming === -1 ? timed.length : firstUpcoming) : -1; // 現在線插在第幾個定時項目前面
  const redAlerts = alerts.filter((a) => a.lvl === 'risk').length;
  const yellowAlerts = alerts.filter((a) => a.lvl === 'warn').length;
  const overdue = items.filter((x) => x.group === 3).length;
  const upcoming = timed.filter((x) => !x.past);
  let tone = 'ok';
  let head;
  if (redAlerts) { tone = 'bad'; head = `有 ${redAlerts} 件緊急警報`; }
  else if (yellowAlerts || overdue) { tone = 'warn'; head = `今天有 ${yellowAlerts + overdue} 件要留意`; }
  else head = upcoming.length ? `今天還有 ${upcoming.length} 件事` : '今天沒有要緊的事';
  const bits = [];
  if (upcoming.length) bits.push(`下一件 ${upcoming[0].time} ${upcoming[0].title}`);
  for (const a of alerts.filter((x) => x.lvl === 'risk' || x.lvl === 'warn').slice(0, 2)) bits.push(a.title);
  if (overdue) bits.push(`逾期 ${overdue} 件`);
  return { items, nowAt, tone, head, detail: bits.join(' · '), counts: { red: redAlerts, yellow: yellowAlerts, overdue, upcoming: upcoming.length } };
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

export function lifeTasks(ticktick) {
  return (ticktick?.tasks || []).filter((t) => LIFE_LISTS.includes(t.list) && t.due)
    .sort((a, b) => a.due.localeCompare(b.due) || (a.time || '99').localeCompare(b.time || '99'));
}

export function demoTravels() {
  return { updated: dateStr(), places: [
    { name: '東京', country: '日本', iso: '392', lat: 35.68, lon: 139.69 },
    { name: '沖繩', country: '日本', iso: '392', lat: 26.21, lon: 127.68 },
    { name: '香港', country: '香港', iso: '', lat: 22.32, lon: 114.17 },
  ] };
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
      { cat: '長照', tag: '日照', text: '示範：[某項長照補助上路](https://example.com/)，申請方式簡化。', more: '示範：另有[照服員薪資新制](https://example.com/)，下月起適用。' },
      { cat: '生活', text: '示範：本週物價小幅上漲，基本工資明年調整。' },
      { cat: '美股', tag: '持股', text: '示範：某持股[公布財報](https://example.com/)，盤後上漲。', more: '示範：費半收漲 1%，AI 族群走強。' },
      { cat: '台股', text: '示範：某指數[收漲 1%](https://example.com/)，電子股帶動。' },
      { cat: '總經', text: '示範：今晚公布某項經濟數據，市場預期持平。' },
    ],
  };
  return { digests: [digest], rows: [
    { title: '示範財經新聞：某指數收漲', src: '示範來源', url: 'https://example.com/', rel: '示範說明', cat: '財經', by: '早報', at: `${t}T08:50:00+08:00` },
    { title: '示範生活新聞：某項補助上路', src: '示範來源', url: 'https://example.com/', rel: '', cat: '生活', by: '早報', at: `${t}T08:50:00+08:00` },
    { title: '示範財經新聞：某公司公布財報', src: '示範來源', url: 'https://example.com/', rel: '', cat: '財經', by: '晚報', at: `${addDays(t, -1)}T22:05:00+08:00` },
  ] };
}

// 摘要：取最新一份（3 天內）。類別、順序、哪些先看、哪些收起來，全部由報告指示（早報.md、晚報.md）決定，程式不寫死：
//   items: [{cat, text, more?, tag?}]，照檔案裡出現的順序顯示；同一個 cat 寫多筆就合併成一段。
//   text 一定顯示；more 是「更多」（預設收起來，點了才展開）；tag 是額外的小標籤，例如「持股」「長照」。
// 最新那份沒有的類別（例如晚報沒有生活），用 24 小時內另一份補上並標出是哪份，位置照它在那份裡的前後順序插進去。
// [文字](網址) 拆成文字與連結（只認 http(s)）；顏色：台股、美股、總經、持股、財經 用藍，其他用綠。
const DIGEST_FIN = ['台股', '美股', '總經', '持股', '財經'];
const DIGEST_MAX_CATS = 8;
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
function linkParts(raw) {
  const text = String(raw || '').trim().replace(/\[([^\]\n]+)\]\((?!https?:\/\/)[^)\s]*\)/g, '$1');
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[1], url: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
const joinText = (rows, key) => rows.map((it) => String(it[key] || '').trim()).filter(Boolean).join('\n');
export function digestView(digests, now = new Date()) {
  const all = (Array.isArray(digests) ? digests : [])
    .filter((x) => x && Array.isArray(x.items) && x.items.length && Date.parse(x.at) >= now.getTime() - 3 * 86400000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const d = all[0];
  if (!d) return null;
  const rowsOf = (x, cat) => x.items.filter((it) => it && String(it.cat || '').trim().slice(0, 8) === cat && String(it.text || '').trim());
  const catsOf = (x) => [...new Set(x.items.filter((it) => it && String(it.text || '').trim()).map((it) => String(it.cat || '').trim().slice(0, 8)).filter(Boolean))];
  const order = catsOf(d).slice(0, DIGEST_MAX_CATS);
  const from = new Map(order.map((c) => [c, d]));
  for (const x of all.slice(1)) {
    if (Date.parse(d.at) - Date.parse(x.at) > 86400000) continue;
    let prev = null;
    for (const c of catsOf(x)) {
      if (!from.has(c) && order.length < DIGEST_MAX_CATS) {
        order.splice(prev === null ? 0 : order.indexOf(prev) + 1, 0, c);
        from.set(c, x);
      }
      if (from.has(c)) prev = c;
    }
  }
  const items = order.map((cat) => {
    const src = from.get(cat);
    const rows = rowsOf(src, cat);
    const parts = linkParts(joinText(rows, 'text'));
    if (!parts.length) return null;
    const more = linkParts(joinText(rows, 'more'));
    const tag = rows.map((it) => String(it.tag || '').trim().slice(0, 12)).find(Boolean) || '';
    return { cat, parts, more: more.length ? more : null, tag, tone: DIGEST_FIN.includes(cat) ? 'fin' : 'life', from: src === d ? '' : src.by || '' };
  }).filter(Boolean);
  if (!items.length) return null;
  const at = new Date(d.at);
  return { by: d.by || '', day: dateStr(at), time: timeStr(at), items };
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

// 目前位置：瀏覽器定位（只有設定開啟才會呼叫，第一次會問要不要允許），座標只留到小數 2 位（約 1 公里），不送出本機
// 不允許、太久沒回應或沒有定位功能，就用設定裡的土城
function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60 * 1000 },
    );
  });
}

// 內建台灣地名（雙北桃竹與各縣市中心），定位開啟時用（不呼叫任何外部地名服務）：8 公里內直接用這個名字，40 公里內加「附近」
const TW_PLACES = [
  ['新北土城', 24.972, 121.443], ['新北板橋', 25.011, 121.459], ['新北中和', 24.999, 121.499], ['新北永和', 25.008, 121.516],
  ['新北三峽', 24.934, 121.369], ['新北樹林', 24.991, 121.425], ['新北鶯歌', 24.955, 121.354], ['新北新莊', 25.036, 121.45],
  ['新北三重', 25.062, 121.488], ['新北蘆洲', 25.085, 121.474], ['新北新店', 24.968, 121.541], ['新北汐止', 25.063, 121.661],
  ['新北淡水', 25.17, 121.441], ['新北林口', 25.077, 121.392], ['新北泰山', 25.059, 121.431], ['新北五股', 25.083, 121.438],
  ['台北中正', 25.032, 121.518], ['台北大安', 25.026, 121.543], ['台北信義', 25.033, 121.567], ['台北中山', 25.064, 121.533],
  ['台北松山', 25.05, 121.578], ['台北內湖', 25.069, 121.589], ['台北士林', 25.093, 121.525], ['台北北投', 25.132, 121.499],
  ['台北萬華', 25.035, 121.5], ['台北文山', 24.99, 121.57], ['台北南港', 25.055, 121.607], ['台北大同', 25.063, 121.513],
  ['桃園', 24.993, 121.301], ['桃園中壢', 24.954, 121.225], ['桃園龜山', 24.993, 121.338], ['桃園八德', 24.928, 121.284],
  ['桃園蘆竹', 25.045, 121.292], ['桃園機場', 25.077, 121.232], ['基隆', 25.128, 121.739], ['宜蘭', 24.757, 121.753],
  ['新竹', 24.804, 120.969], ['竹北', 24.839, 121.004], ['苗栗', 24.56, 120.821], ['台中', 24.148, 120.674],
  ['彰化', 24.08, 120.538], ['南投', 23.909, 120.684], ['雲林斗六', 23.711, 120.543], ['嘉義', 23.48, 120.449],
  ['台南', 22.999, 120.227], ['高雄', 22.627, 120.301], ['屏東', 22.669, 120.486], ['花蓮', 23.977, 121.604],
  ['台東', 22.756, 121.144], ['澎湖馬公', 23.566, 119.586], ['金門', 24.436, 118.318],
];
export function nearestPlace(lat, lon) {
  const rad = Math.PI / 180;
  let best = null;
  for (const [name, la, lo] of TW_PLACES) {
    const x = (lo - lon) * rad * Math.cos(((la + lat) / 2) * rad);
    const y = (la - lat) * rad;
    const km = Math.sqrt(x * x + y * y) * 6371;
    if (!best || km < best.km) best = { name, km };
  }
  if (best && best.km <= 8) return best.name;
  if (best && best.km <= 40) return `${best.name}附近`;
  return `北緯 ${lat.toFixed(1)}°・東經 ${lon.toFixed(1)}°`;
}

// 預設用 config.js 的土城，不問瀏覽器定位；只有 Excel「設定」表「用目前位置」= 是（enabled 為 true）才定位
export async function getLocation(enabled = false) {
  if (!enabled) return { ...CONFIG.weather, here: false };
  const pos = await currentPosition();
  if (!pos) return { ...CONFIG.weather, here: false };
  return { ...pos, name: nearestPlace(pos.lat, pos.lon), here: true };
}

export async function getWeather(loc = CONFIG.weather) {
  const { lat, lon } = loc;
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
  return { now: Math.round(r.current.temperature_2m), text: WX[r.current.weather_code] || '', days, place: loc.name || CONFIG.weather.name, here: !!loc.here };
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
