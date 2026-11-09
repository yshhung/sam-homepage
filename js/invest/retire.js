// 投資計畫書 v1 的主目標：40～45 歲半退休三級現金流（goals.json 的 retire）。
// 每一級用「起始資產＋每年投入」反推到 45 歲該級所需金額的年化報酬率，算出「今天應有」多少（進度線）。
// 純函式，沒有 DOM；瀏覽器掛在 window.retirePace，測試用 require。
(function () {
  const fv = (p, c, r, y) => (Math.abs(r) < 1e-9 ? p + c * y : p * Math.pow(1 + r, y) + c * (Math.pow(1 + r, y) - 1) / r);
  const solve = (fn, target) => { let lo = -0.9, hi = 2; for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; if (fn(m) < target) lo = m; else hi = m; } return (lo + hi) / 2; };
  const YR = 365.25 * 864e5;
  const ym = (s) => Date.parse(s + '-01T00:00:00+08:00');

  function retirePace(g, totalTwd, now) {
    const rt = g && g.retire;
    if (!rt || !Array.isArray(rt.tiers) || !rt.tiers.length) return null;
    const t0 = Date.parse(g.start_date + 'T00:00:00+08:00');
    const p0 = Number(g.start_total_twd), c = Number(rt.annual_contrib_twd || g.annual_contrib_twd || 0);
    const yrs = Math.max(0, ((now || Date.now()) - t0) / YR);
    const cp45 = (rt.checkpoints || []).find((x) => x.age === 45);
    const y45 = ((cp45 ? ym(cp45.month) : t0 + 17 * YR) - t0) / YR;
    return rt.tiers.map((tier) => {
      const need45 = Number(tier.need_at_45_twd);
      const r = solve((x) => fv(p0, c, x, y45), need45);
      const pace = fv(p0, c, r, yrs);
      let lo = -30, hi = 80; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (fv(p0, c, r, m) < totalTwd) lo = m; else hi = m; }
      const cps = (rt.checkpoints || []).map((cp) => ({
        age: cp.age, month: cp.month, need: Number(tier['need_at_' + cp.age + '_twd']),
        pace: fv(p0, c, r, (ym(cp.month) - t0) / YR),
        role: cp.must === tier.key ? '必達' : cp.stretch === tier.key ? '挑戰' : '',
      }));
      return { key: tier.key, label: tier.label, desc: tier.desc, monthly: tier.monthly_twd, needToday: tier.need_today_twd, need45, rate: r,
        current: totalTwd, pace, diff: totalTwd - pace, diffPct: (totalTwd - pace) / pace, aheadMonths: (hi - yrs) * 12, cps };
    });
  }
  if (typeof window !== 'undefined') window.retirePace = retirePace;
  if (typeof module !== 'undefined') module.exports = { retirePace };
})();
