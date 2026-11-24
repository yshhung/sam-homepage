// 投資頁：各卡片可收合、卡片說明收進「ⓘ」、表格過長的備註點一下展開（2026-11-24）
// 只動版面：不碰資料；狀態存在這台裝置的 localStorage（讀寫失敗就用預設）。
(function () {
  var KEY = 'inv.fold.v1';
  // 預設收起：參考性、較少天天看的卡片；其他預設展開
  var DEFAULT_COLLAPSED = { 'mk-cc': 1, heat: 1, contrib: 1, rules: 1 };
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* 沒有儲存也能用 */ } }
  function isCollapsed(id) { return id in saved ? !!saved[id] : !!DEFAULT_COLLAPSED[id]; }

  function setCollapsed(card, on, remember) {
    card.classList.toggle('is-collapsed', on);
    var h = card.querySelector(':scope > h2');
    if (h) { h.setAttribute('aria-expanded', String(!on)); var c = h.querySelector('.sd-chev'); if (c) c.textContent = on ? '▸' : '▾'; }
    if (remember && card.id) { saved[card.id] = on; persist(); }
    if (!on) window.dispatchEvent(new Event('resize')); // 圖表在收起時量不到寬度，展開後重畫
  }

  document.querySelectorAll('.sd-card').forEach(function (card) {
    var h = card.querySelector(':scope > h2'); if (!h || !card.id) return;
    h.classList.add('sd-fh'); h.setAttribute('role', 'button'); h.tabIndex = 0;
    var chev = document.createElement('span'); chev.className = 'sd-chev'; chev.setAttribute('aria-hidden', 'true'); h.insertBefore(chev, h.firstChild);
    // 沒有 id 的 .sd-note 是固定說明文字：收進「ⓘ」；有 id 的是會隨資料變的數字，維持顯示
    var fixed = card.querySelectorAll(':scope > p.sd-note:not([id])');
    if (fixed.length) {
      fixed.forEach(function (n) { n.classList.add('fn'); });
      var i = document.createElement('button'); i.type = 'button'; i.className = 'sd-i'; i.textContent = 'ⓘ'; i.title = '看這張卡的說明'; i.setAttribute('aria-label', '看這張卡的說明');
      i.addEventListener('click', function (ev) { ev.stopPropagation(); card.classList.toggle('show-note'); });
      h.appendChild(i);
    }
    function toggle() { setCollapsed(card, !card.classList.contains('is-collapsed'), true); }
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
    setCollapsed(card, isCollapsed(card.id), false);
  });

  // 「目標狀態」的「詳細 →」要跳到的卡片若被收起，先展開
  var gl = document.getElementById('goal-status-link');
  if (gl) gl.addEventListener('click', function () { var g = document.getElementById('goals'); if (g && g.classList.contains('is-collapsed')) setCollapsed(g, false, true); }, true);

  // 表格備註被截斷時，點一下展開、再點收起
  document.addEventListener('click', function (ev) {
    var td = ev.target.closest && ev.target.closest('.sd-table td.nm');
    if (!td) return;
    if (td.classList.contains('open')) td.classList.remove('open');
    else if (td.scrollWidth > td.clientWidth + 1) td.classList.add('open');
  });
})();
