// 投資頁的資料轉換：把 OneDrive「投資資料」的檔案，轉成舊版投資儀表板程式要的資料表。
// 純函式，不連網；tests/invest-test.html 用假資料測這裡。

const CASH = new Set(['CASH', 'TWCASH']);
const keyOf = (h) => h.occ || h.code;

// 持股檔只在買賣時改；每日同步把最新價格記在 state.json，比持股檔新就用它
export function applyPrices(holdings, state) {
  const prices = state?.prices || {};
  return (holdings || []).map((h) => {
    const p = prices[keyOf(h)];
    if (!p || CASH.has(h.code) || (h.price_date && p[2] < h.price_date)) return { ...h };
    return { ...h, price: p[0], prev_price: p[1], price_date: p[2], session: '收盤' };
  });
}

// 總資產歷史：舊程式要的是「每次排程一筆」的格式；我們一天一筆，日期當作那天最後一筆。
// 2026-10-20 以前由對帳單重建的列不放進來（舊程式會直接用國泰、嘉信的每日市值算那一段）
export function historyRows(files) {
  const byDate = new Map();
  for (const f of files || []) {
    for (const r of f?.rows || []) {
      if (r.src === '對帳單重建' || !r.date) continue;
      byDate.set(r.date, { date: r.date, at: `${r.date} 23:59`, total_twd: r.total, tw_twd: r.tw, us_usd: r.us, fx: r.fx, by: '每日同步' });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 換算美股用的匯率：每日同步寫在 invest.json；沒有就用 state.json 最後一天
export function fxRows(invest, state) {
  const last = (state?.daily || []).at(-1);
  const rate = invest?.fx ?? last?.fx;
  if (!rate) return [];
  return [{ pair: 'USD/TWD', rate, at: invest?.updated || last?.date || '', source: 'currency-api', by: '每日同步' }];
}

export function lastUpdateRows(invest) {
  if (!invest?.updated) return [];
  return [{ label: `${invest.updated.replace(/-/g, '').replace(':', '')} 每日同步`, at: invest.updated, by: '每日同步' }];
}

// 追蹤清單的現價：每日同步記在 state.json 的 watch
export function applyWatch(watchlist, state) {
  const w = state?.watch || {};
  return (watchlist || []).map((x) => {
    const p = w[x.code];
    if (!p || (x.price_date && p[2] < x.price_date)) return { ...x };
    return { ...x, price: p[0], prev_price: p[1], price_date: p[2] };
  });
}

// 市場分頁：早報、晚報、週回顧各寫自己的檔（投資資料/市場/<報別>/），舊資料在 投資資料/市場/ 本身。
// 每個指數群組、每個筆記區塊，用「最新寫入的那一份」；財經新聞留 48 小時、30 秒重點留 7 天
const ms = (at) => { const t = Date.parse(at || ''); return Number.isNaN(t) ? 0 : t; };
const newest = (rows) => Math.max(0, ...rows.map((r) => ms(r.at)));

// 10 天沒有任何報告更新的群組就不再顯示（舊儀表板留下、現在沒有報告會寫的區塊）；週回顧每 7 天換新，不受影響
const STALE_DAYS = 10;
function latestBy(sources, key, now) {
  const best = new Map(); // 群組 → { t, rows }
  for (const rows of sources) {
    const groups = new Map();
    for (const r of rows || []) {
      const k = r[key] ?? '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const [k, g] of groups) {
      const t = newest(g);
      if (!best.has(k) || t > best.get(k).t) best.set(k, { t, rows: g });
    }
  }
  return [...best.values()].filter((x) => now - x.t <= STALE_DAYS * 86400e3).flatMap((x) => x.rows);
}

export function mergeMarket(sources, now = Date.now()) {
  const all = (name) => sources.map((s) => (Array.isArray(s?.[name]) ? s[name] : []));
  const recent = (rows, hours) => rows.filter((r) => now - ms(r.at) <= hours * 3600e3);
  const news = new Map();
  for (const r of recent(all('fin_news').flat(), 48).sort((a, b) => ms(b.at) - ms(a.at))) if (!news.has(r.title)) news.set(r.title, r);
  const cc = all('cc_ref').filter((x) => x.length).sort((a, b) => newest(b) - newest(a))[0] || [];
  return {
    mk_tiles: latestBy(all('mk_tiles'), 'group', now),
    mk_notes: latestBy(all('mk_notes'), 'section', now),
    fin_news: [...news.values()],
    inv_brief: recent(all('inv_brief').flat(), 24 * 7),
    cc_ref: cc,
  };
}

// 全部組起來：名稱跟舊儀表板的資料表一樣
export function buildDatasets(f) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const market = mergeMarket([
    { mk_tiles: f.mk_tiles, mk_notes: f.mk_notes, fin_news: f.fin_news, inv_brief: f.inv_brief, cc_ref: f.cc_ref },
    ...(f.reports || []),
  ], f.now);
  return {
    ...market,
    holdings: applyPrices(arr(f.holdings), f.state),
    fx: fxRows(f.invest, f.state),
    lastupdate: lastUpdateRows(f.invest),
    history: historyRows(f.history),
    changes: arr(f.changes), plans: arr(f.plans), options: arr(f.options), watchlist: applyWatch(arr(f.watchlist), f.state),
    events: arr(f.events), sectors: arr(f.sectors), goals: arr(f.goals), rules: arr(f.rules),
    realized: arr(f.realized), schwab_flows: arr(f.schwab_flows),
    cathay_bal: arr(f.cathay_bal), schwab_bal: arr(f.schwab_bal), fx_hist: arr(f.fx_hist),
  };
}
