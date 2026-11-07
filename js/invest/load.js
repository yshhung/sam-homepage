// 投資頁：登入後從 OneDrive「投資資料」讀檔（只讀），交給舊版儀表板程式畫出來
import { getAccount, graph, GraphError, initAuth, isConfigured, login } from '../auth.js';
import { buildDatasets } from './data.js';
import { renderPools } from './pools.js';

const BASE = '投資資料';
const FILES = {
  holdings: 'holdings.json', state: 'state.json', changes: 'changes.json', plans: 'plans.json', options: 'options.json',
  watchlist: 'watchlist.json', events: 'events.json', sectors: 'sectors.json', goals: 'goals.json', rules: 'rules.json',
  realized: 'realized.json', schwab_flows: 'schwab_flows.json', config: 'page_config.json',
  mk_tiles: '市場/mk_tiles.json', mk_notes: '市場/mk_notes.json', fin_news: '市場/fin_news.json',
  inv_brief: '市場/inv_brief.json', cc_ref: '市場/cc_ref.json',
  cathay_bal: '舊資料/cathay_balances.json', schwab_bal: '舊資料/schwab_balances.json', fx_hist: '舊資料/fx_hist.json',
};

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function readJson(path) {
  try {
    return await (await graph(`/me/drive/root:/${enc(path)}:/content`, { raw: true })).json();
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null;
    throw e;
  }
}

// 市場分頁：每份報告各自的檔（還沒跑過的報告就沒有，讀不到當作空的）
const REPORTS = ['早報', '晚報', '週回顧'];
const MARKET_FILES = ['mk_tiles', 'mk_notes', 'fin_news', 'inv_brief', 'cc_ref'];
async function listNames(path) {
  try {
    const r = await graph(`/me/drive/root:/${enc(path)}:/children?$select=name&$top=500`);
    return (r.value || []).map((x) => x.name);
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return [];
    throw e;
  }
}
function readReports() {
  return Promise.all(REPORTS.map(async (r) => {
    const have = new Set(await listNames(`${BASE}/市場/${r}`)); // 只讀這份報告真的寫過的檔
    const v = await Promise.all(MARKET_FILES.map((n) => (have.has(`${n}.json`) ? readJson(`${BASE}/市場/${r}/${n}.json`) : null)));
    return Object.fromEntries(MARKET_FILES.map((n, i) => [n, v[i]]));
  }));
}

// 總資產歷史：一個舊資料總檔＋每月一個檔，全部讀進來
async function readHistory() {
  const names = (await listNames(`${BASE}/history`)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(names.map((n) => readJson(`${BASE}/history/${n}`)));
}

function banner(text, button) {
  const b = document.getElementById('inv-banner');
  b.hidden = false;
  b.textContent = text;
  if (button) b.append(button);
}

async function start() {
  if (!isConfigured()) { banner('還沒設定 Microsoft 登入，投資頁需要登入才能看。'); return; }
  try {
    await initAuth();
  } catch (e) {
    banner(`登入失敗：${e.message}`);
    return;
  }
  if (!getAccount()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '登入';
    btn.addEventListener('click', () => login());
    banner('請先登入，才能讀你 OneDrive 裡的投資資料。', btn);
    return;
  }
  try {
    const keys = Object.keys(FILES);
    const [values, history, invest, reports] = await Promise.all([
      Promise.all(keys.map((k) => readJson(`${BASE}/${FILES[k]}`))),
      readHistory(),
      readJson('Sam Homepage/invest.json'),
      readReports(),
    ]);
    const f = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
    f.history = history;
    f.invest = invest;
    f.reports = reports;
    if (!f.holdings) { banner('OneDrive 的「投資資料/holdings.json」讀不到。'); return; }
    renderPools(invest);
    const cfg = f.config || {};
    window.dash.__load(buildDatasets(f), {
      exclude: cfg.exclude || [], catchupTw: cfg.catchupTw || null, catchupUs: cfg.catchupUs || null, trancheTwd: cfg.trancheTwd || null,
    });
  } catch (e) {
    console.error(e);
    banner(`投資資料讀不到：${e.message}`);
  }
}

start();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
