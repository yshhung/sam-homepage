// 投資頁：提供舊版投資儀表板程式用的 dash 介面（data、calc、onData、setLink）。
// 資料由 js/invest/load.js 從 OneDrive 讀進來後呼叫 dash.__load；頁面只讀，沒有任何寫入。
(() => {
  const sets = {};
  const calcs = {};
  let cache = {};
  const subs = [];
  let loaded = false;

  // 私人設定（補進度標的、定期定額金額等）放在 OneDrive 的 page_config.json，不寫在程式裡
  window.INV_CFG = { exclude: [], catchupTw: null, catchupUs: null, trancheTwd: null };

  function data(id) {
    if (Object.prototype.hasOwnProperty.call(sets, id)) return { status: 'ok', data: sets[id], rows: sets[id], meta: [] };
    const c = calcs[id];
    if (c) {
      if (!loaded) return { status: 'loading', data: [], rows: [], meta: [] };
      if (!(id in cache)) {
        try {
          const args = (c.inputs || []).map((i) => { const d = data(i); return d.status === 'ok' ? d.data : []; });
          cache[id] = { status: 'ok', data: c.fn(...args) };
        } catch (e) {
          console.error('calc', id, e);
          cache[id] = { status: 'error', data: [], message: e.message };
        }
      }
      return { ...cache[id], rows: cache[id].data, meta: [] };
    }
    return { status: loaded ? 'missing' : 'loading', data: [], rows: [], meta: [] };
  }

  function run() {
    for (const fn of subs) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  window.dash = {
    data,
    calc(id, def) { calcs[id] = def; },
    onData(fn) { subs.push(fn); try { fn(); } catch (e) { console.error(e); } },
    setLink(name) { try { history.replaceState(null, '', `#${name}`); } catch { /* 忽略 */ } },
    colors: ['#38bdf8', '#2fd47a', '#f5b942', '#a78bfa', '#ff5c5c', '#f472b6', '#22d3ee', '#94a3b8'],
    params: () => ({}), setParams() {}, resetParams() {}, refresh() {}, loader() {},
    __load(datasets, cfg) {
      Object.assign(sets, datasets);
      Object.assign(window.INV_CFG, cfg || {});
      cache = {};
      loaded = true;
      run();
    },
  };

  // 寬度改變（轉手機方向、切分頁）就重畫，圖表跟著寬度縮放
  let t;
  addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(run, 120);
  });
})();
