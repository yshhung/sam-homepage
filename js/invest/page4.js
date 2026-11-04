// 舊版「Sam的投資儀表板」的頁面程式，原樣搬過來；資料改由 js/invest/shim.js 提供（讀 OneDrive）
(() => {
dash.calc('sch_stats', {
  inputs: ['schwab_bal', 'schwab_flows', 'changes'],
  title: '嘉信帳戶統計',
  description: '最新帳戶總值，以及扣掉入金出金後的時間加權報酬（近一年、全期間、年化）與最大回落；資金進出取嘉信匯款紀錄與異動紀錄中的美股入金出金',
  fn: (schwab_bal, schwab_flows, changes) => {
    const r = [...schwab_bal].map((x) => ({ date: String(x.date).slice(0, 10), usd: Number(x.usd) })).filter((x) => x.usd > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (r.length < 2) return [];
    const fl = {}, seen = new Set();
    const add = (d, v) => { const k = d + '|' + v.toFixed(2); if (seen.has(k)) return; seen.add(k); fl[d] = (fl[d] || 0) + v; };
    (schwab_flows || []).forEach((x) => add(String(x.date).slice(0, 10), Number(x.usd)));
    (changes || []).forEach((x) => { const a = String(x.action || ''), c = String(x.code || ''); if ((a === '入金' || a === '出金') && !/^\d{4,6}[A-Z]?$/.test(c) && c !== 'TWCASH') add(String(x.date).slice(0, 10), (a === '入金' ? 1 : -1) * Number(x.qty) * Number(x.price)); });
    const days = r.map((x) => x.date), dates = Object.keys(fl);
    dates.forEach((d) => { if (!fl[d]) return; const t = days.find((x) => x >= d); if (t && t !== d) { fl[t] = (fl[t] || 0) + fl[d]; delete fl[d]; } });
    const idx = [1]; let peak = 1, mdd = 0;
    for (let i = 1; i < r.length; i++) { const v = idx[i - 1] * (r[i].usd - (fl[r[i].date] || 0)) / r[i - 1].usd; idx.push(v); peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
    const last = r[r.length - 1], first = r[0];
    const ago = new Date(last.date + 'T00:00:00Z'); ago.setUTCFullYear(ago.getUTCFullYear() - 1);
    const agoS = ago.toISOString().slice(0, 10);
    let i1 = 0; r.forEach((x, i) => { if (x.date <= agoS) i1 = i; });
    const yrs = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 864e5);
    const tot = idx[idx.length - 1] - 1, dep = Object.values(fl).reduce((s, v) => s + v, 0);
    return [
      { k: 'last', label: '最新 ' + last.date, v: last.usd },
      { k: 'twr1y', label: '近一年報酬（扣入金）', v: idx[idx.length - 1] / idx[i1] - 1 },
      { k: 'twrall', label: '全期間報酬 ' + first.date + ' 起', v: tot },
      { k: 'ann', label: '年化', v: yrs > 0 ? Math.pow(1 + tot, 1 / yrs) - 1 : null },
      { k: 'mdd', label: '最大回落（扣入金）', v: mdd },
      { k: 'flow', label: '期間入金合計', v: dep }
    ];
  }
});
})();
