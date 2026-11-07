// 沁耘頁的資料整理：純函式，不連網（tests/parse-test.html 測這裡）。
// company_history.json：{updated, web:[{month,views,visitors,posts,pages}], social:[{date,network,followers,views,posts,interactions}]}
// network：instagram、facebook、google（Google 商家：views 曝光、interactions 點擊）

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// 每月網站數字：照月份排，最多留最近 12 個月；當月是累計到今天
export function webSeries(history, limit = 12) {
  return (Array.isArray(history?.web) ? history.web : [])
    .filter((r) => r && /^\d{4}-\d{2}$/.test(r.month || ''))
    .map((r) => ({ month: r.month, views: num(r.views), visitors: num(r.visitors), posts: num(r.posts ?? r.posts_published) }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-limit);
}

// 某個平台某個欄位最近 N 天的每日數字：同一天重複只留最後一筆，照日期排；沒有的日子是 null（折線在那裡斷開）
export function dailySeries(history, network, field, days = 35) {
  const by = new Map();
  for (const r of Array.isArray(history?.social) ? history.social : []) {
    if (r && r.network === network && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) by.set(r.date, num(r[field]));
  }
  const dates = [...by.keys()].sort();
  return dates.slice(-days).map((d) => ({ date: d, value: by.get(d) }));
}

// 最新一個有數字的值，和跟 N 天前相比的變化
export function latestWithChange(series, daysBack = 30) {
  const pts = series.filter((p) => p.value !== null);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const t = Date.parse(`${last.date}T12:00:00+08:00`) - daysBack * 86400000;
  const before = [...pts].reverse().find((p) => Date.parse(`${p.date}T12:00:00+08:00`) <= t) || pts[0];
  return { value: last.value, date: last.date, change: before === last ? null : last.value - before.value, since: before.date };
}

// 區間合計（例如近 7 天的觸及）
export function sumLast(series, days = 7) {
  const pts = series.slice(-days).filter((p) => p.value !== null);
  return pts.length ? pts.reduce((a, p) => a + p.value, 0) : null;
}
