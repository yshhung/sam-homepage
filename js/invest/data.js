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

// 全部組起來：名稱跟舊儀表板的資料表一樣
export function buildDatasets(f) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    holdings: applyPrices(arr(f.holdings), f.state),
    fx: fxRows(f.invest, f.state),
    lastupdate: lastUpdateRows(f.invest),
    history: historyRows(f.history),
    changes: arr(f.changes), plans: arr(f.plans), options: arr(f.options), watchlist: arr(f.watchlist),
    events: arr(f.events), sectors: arr(f.sectors), goals: arr(f.goals), rules: arr(f.rules),
    realized: arr(f.realized), schwab_flows: arr(f.schwab_flows),
    mk_tiles: arr(f.mk_tiles), mk_notes: arr(f.mk_notes), fin_news: arr(f.fin_news), inv_brief: arr(f.inv_brief), cc_ref: arr(f.cc_ref),
    cathay_bal: arr(f.cathay_bal), schwab_bal: arr(f.schwab_bal), fx_hist: arr(f.fx_hist),
  };
}
