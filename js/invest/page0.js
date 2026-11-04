// 舊版「Sam的投資儀表板」的頁面程式，原樣搬過來；資料改由 js/invest/shim.js 提供（讀 OneDrive）
(() => {
window.CV = (n) => { let p = window.__cvp; if (!p) { p = window.__cvp = document.createElement('span'); p.style.display = 'none'; (document.querySelector('.sd') || document.body).append(p); } p.style.color = `var(${n})`; return getComputedStyle(p).color; };
})();
