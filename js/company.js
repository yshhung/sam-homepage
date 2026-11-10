// 沁耘頁：登入後讀 OneDrive「Sam Homepage」的 company_history.json（只讀）與 company_stats.json，畫幾張圖
import { CONFIG } from '../config.js';
import { getAccount, initAuth, isConfigured, login } from './auth.js';
import { demoCompany, oneDriveJson } from './sources.js';
import { dailySeries, demoCompanyHistory, latestWithChange, sumLast, webSeries } from './company-data.js';
import { el } from './util.js';
import { barChart, fmt, lineChart } from './charts.js';

const $ = (id) => document.getElementById(id);
function kpi(k, v, sub, tone = '') {
  return el('div', { class: 'cp-kpi' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), el('div', { class: `s ${tone}` }, sub));
}
const delta = (c, unit = '') => (c === null ? '' : `${c > 0 ? '+' : c < 0 ? '−' : '±'}${fmt(Math.abs(c))}${unit}（近 30 天）`);

function render(history, stats) {
  const web = webSeries(history);
  const cur = web[web.length - 1];
  const ig = dailySeries(history, 'instagram', 'followers');
  const fb = dailySeries(history, 'facebook', 'followers');
  const igL = latestWithChange(dailySeries(history, 'instagram', 'followers', 120));
  const fbL = latestWithChange(dailySeries(history, 'facebook', 'followers', 120));
  const w = stats?.website;
  $('take').textContent = [
    cur ? `網站 ${cur.month} 瀏覽 ${fmt(w?.views ?? cur.views)}、訪客 ${fmt(w?.visitors ?? cur.visitors)}` : '',
    igL || fbL ? `追蹤 IG ${fmt(igL?.value ?? null)}・FB ${fmt(fbL?.value ?? null)}` : '',
  ].filter(Boolean).join(' · ') || '還沒有資料';
  $('kpis').replaceChildren(
    kpi('本月瀏覽', fmt(w?.views ?? cur?.views ?? null), cur ? `${cur.month} 累計` : ''),
    kpi('本月訪客', fmt(w?.visitors ?? cur?.visitors ?? null), `文章 ${fmt(w?.posts ?? cur?.posts ?? null)} 篇`),
    kpi('IG 追蹤', fmt(igL?.value ?? null), delta(igL?.change ?? null), igL?.change > 0 ? 'up' : igL?.change < 0 ? 'down' : ''),
    kpi('FB 追蹤', fmt(fbL?.value ?? null), delta(fbL?.change ?? null), fbL?.change > 0 ? 'up' : fbL?.change < 0 ? 'down' : ''),
  );
  barChart($('chart-web'), web.map((r) => ({ label: `${r.month}`, bars: [{ cls: 'b1', value: r.views }, { cls: 'b2', value: r.visitors }] })));
  $('web-note').textContent = cur ? `${cur.month} 是累計到今天` : '';
  lineChart($('chart-fol'), [{ cls: 'l1', points: ig }, { cls: 'l2', points: fb }]);
  lineChart($('chart-reach'), [{ cls: 'l1', points: dailySeries(history, 'instagram', 'views') }, { cls: 'l2', points: dailySeries(history, 'facebook', 'views') }], { fromZero: true });
  const gv = dailySeries(history, 'google', 'views');
  const gi = dailySeries(history, 'google', 'interactions');
  lineChart($('chart-gbp'), [{ cls: 'l1', points: gv }, { cls: 'l3', points: gi }], { fromZero: true });
  const g7 = sumLast(gv, 7), c7 = sumLast(gi, 7);
  $('foot').textContent = `${history?.updated ? `數字更新於 ${history.updated.slice(5)}` : ''}${g7 !== null ? `　Google 商家近 7 天：曝光 ${fmt(g7)}、點擊 ${fmt(c7)}` : ''}`;
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
  const demo = (text, button) => { render(demoCompanyHistory(), demoCompany()); status('demo', '示範模式'); banner(text, button); };
  if (!isConfigured()) { demo('示範模式：還沒設定 Microsoft 登入，下面是示範數字。'); return; }
  try { await initAuth(); } catch (e) { status('bad', '登入失敗'); banner(`登入失敗：${e.message}`); return; }
  if (!getAccount()) {
    demo('示範模式：下面是示範數字，登入後才會看到沁耘真實的網站與社群數字。', el('button', { class: 'btn', type: 'button', onclick: () => login() }, '登入'));
    return;
  }
  status('loading', '讀取中');
  try {
    const [history, stats] = await Promise.all([oneDriveJson(CONFIG.companyHistoryPath), oneDriveJson(CONFIG.companyStatsPath)]);
    if (!history && !stats) { status('bad', '沒有資料'); banner('OneDrive 的「Sam Homepage/company_history.json」還沒有。每日同步 07:30 跑過一次就會出現。'); return; }
    render(history || {}, stats);
    status('live', '已讀取');
  } catch (e) {
    console.error(e);
    status('bad', '讀取失敗');
    banner(`讀不到資料：${e.message}`);
  }
}

start();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
