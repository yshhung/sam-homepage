// 日期一律用台北時間的 'YYYY-MM-DD' 字串，跟 Excel 裡的寫法一致
const TZ = 'Asia/Taipei';

export function dateStr(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

export function timeStr(d = new Date()) {
  return d.toLocaleTimeString('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function nowStamp() {
  return `${dateStr()} ${timeStr()}`;
}

export function addDays(str, n) {
  const d = new Date(`${str}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return dateStr(d);
}

export function diffDays(a, b) {
  return Math.round((new Date(`${a}T12:00:00+08:00`) - new Date(`${b}T12:00:00+08:00`)) / 86400000);
}

export function nextMonday(str) {
  const dow = new Date(`${str}T12:00:00+08:00`).getUTCDay();
  return addDays(str, ((8 - dow) % 7) || 7);
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export function weekday(str) {
  return WEEK[new Date(`${str}T12:00:00+08:00`).getUTCDay()];
}

export function shortDate(str) {
  const [, m, d] = str.split('-');
  return `${Number(m)}/${Number(d)}（${weekday(str)}）`;
}

// 相對日期：今天、明天、3 天後、逾期 2 天
export function relDay(str, today = dateStr()) {
  const n = diffDays(str, today);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '後天';
  if (n < 0) return `逾期 ${-n} 天`;
  return `${n} 天後`;
}

// Excel 儲存格可能回來數字（使用者在 Excel 裡打了日期）或文字
export function cellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

export function cellDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = cellText(v).replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
