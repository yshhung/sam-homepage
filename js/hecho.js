// 和果頁：讀和果群組「儀表板資料」裡 YunCare 匯出的統計（只有人數，沒有姓名、案號、金額）
import { getAccount, initAuth, isConfigured, login } from './auth.js';
import { demoHechoDetail, getHechoDetail } from './sources.js';
import { barChart, fmt, lineChart } from './charts.js';
import { el, shortDate } from './util.js';

const $ = (id) => document.getElementById(id);
const num = (v) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
const mkey = (r) => `${r.年}-${String(r.月).padStart(2, '0')}`;

function kpi(k, v, sub, tone = '') {
  return el('div', { class: 'cp-kpi' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), el('div', { class: `s ${tone}` }, sub));
}

function render({ exported, days, months }) {
  const cur = months[months.length - 1];
  const last = days[days.length - 1];
  const rate = num(cur?.出席率);
  const gain = num(cur?.新收_推算);
  const lost = num(cur?.本月未再服務);
  $('take').textContent = cur
    ? `${cur.年}/${cur.月} 出席率 ${rate === null ? '—' : `${Math.round(rate * 100)}%`}、服務 ${fmt(num(cur.服務個案數))} 位個案`
    : '還沒有資料';
  $('kpis').replaceChildren(
    kpi('本月出席率', rate === null ? '—' : `${(rate * 100).toFixed(1)}%`, cur ? `算到 ${cur.計算到?.slice(5)}` : ''),
    kpi('每日平均出席', cur?.每日平均出席 || '—', cur ? `服務 ${fmt(num(cur.服務日數))} 天` : ''),
    kpi('服務個案數', fmt(num(cur?.服務個案數)), `名單 ${fmt(num(cur?.名單人數))} 人`),
    kpi('新收／未再服務', gain === null ? '—' : `+${gain}／−${lost ?? '—'}`, `暫停 ${fmt(num(cur?.暫停))}・結案 ${fmt(num(cur?.結案))}`),
    kpi('平均年齡', cur?.平均年齡 ? `${cur.平均年齡} 歲` : '—', `男 ${fmt(num(cur?.男))}・女 ${fmt(num(cur?.女))}`),
    kpi(last ? `${shortDate(last.date).replace(/（.）/, '')} 實到` : '最近一天', last ? `${last.present ?? '未點名'}／${last.expected ?? '—'}` : '—',
      last ? `個案請假 ${fmt(last.clientLeave)}・異常 ${fmt(last.incidents)}` : '', last?.incidents > 0 ? 'down' : ''),
  );
  const ms = months.slice(-12);
  lineChart($('chart-rate'), [{ cls: 'l1', points: ms.map((r) => ({ date: mkey(r), value: num(r.出席率) === null ? null : Math.round(num(r.出席率) * 1000) / 10 })) }], { label: (d) => `${Number(d.slice(5))} 月` });
  barChart($('chart-flow'), ms.slice(-6).map((r) => ({ label: mkey(r), bars: [{ cls: 'b1', value: num(r.服務個案數) }, { cls: 'b2', value: num(r.新收_推算) }, { cls: 'b3', value: num(r.本月未再服務) }] })));
  barChart($('chart-age'), cur ? [['未滿65', '未滿 65'], ['65-74', '65–74'], ['75-84', '75–84'], ['85以上', '85 以上']].map(([k, label]) => ({ label, bars: [{ cls: 'b1', value: num(cur[k]) }] })) : [], (l) => l);
  // 清冊還沒匯進 YunCare 時，年齡與男女是空的（或全是 0），整張圖先藏起來
  const ageOk = cur && ['未滿65', '65-74', '75-84', '85以上'].some((k) => num(cur[k]) > 0);
  $('chart-age').closest('section').hidden = !ageOk;
  $('age-note').textContent = cur ? `${cur.年}/${cur.月}，只算有來的個案` : '';
  const dd = days.slice(-14);
  lineChart($('chart-day'), [{ cls: 'l1', points: dd.map((r) => ({ date: r.date, value: r.expected ?? null })) }, { cls: 'l2', points: dd.map((r) => ({ date: r.date, value: r.present ?? null })) }], { fromZero: true });
  const age = exported ? Math.floor((Date.now() - new Date(exported.replace(' ', 'T')).getTime()) / 86400000) : null;
  $('foot').textContent = `${age >= 2 ? `⚠️ 已 ${age} 天沒更新（YunCare 要開著才會更新）　` : ''}${exported ? `YunCare 匯出於 ${exported.slice(5)}　` : ''}只有人數，沒有姓名；細節請在電腦的 YunCare 看`;
}

function status(cls, text) {
  $('status').className = `wk-status ${cls}`;
  $('status-text').textContent = text;
}
function banner(text, button) {
  const b = $('banner');
  b.hidden = false;
  b.replaceChildren(text, ...(button ? [' ', button] : []));
}

async function start() {
  if (!isConfigured()) { render(demoHechoDetail()); status('demo', '示範模式'); banner('示範模式：還沒設定 Microsoft 登入，下面是示範數字。'); return; }
  try { await initAuth(); } catch (e) { status('bad', '登入失敗'); banner(`登入失敗：${e.message}`); return; }
  if (!getAccount()) {
    render(demoHechoDetail());
    status('demo', '示範模式');
    banner('示範模式：下面是示範數字，登入後才會看到和果真實的統計。', el('button', { class: 'btn', type: 'button', onclick: () => login() }, '登入'));
    return;
  }
  status('loading', '讀取中');
  try {
    render(await getHechoDetail());
    status('live', '已同步');
  } catch (e) {
    console.error(e);
    status('bad', '讀取失敗');
    banner(`讀不到資料：${e.message}`);
  }
}

start();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
