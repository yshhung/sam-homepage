// 投資頁「計畫」分頁：四池配置、觸發中的警報、小計（從首頁搬過來，資料一樣是 Sam Homepage/invest.json）
import { planView } from '../sources.js';
import { dateStr, el, shortDate } from '../util.js';

export function renderPools(invest) {
  const box = document.getElementById('pools');
  const v = planView(invest, dateStr());
  box.hidden = !v;
  if (!v) return;
  const pools = v.pools.map((x) => el('div', { class: `pool ${x.tone}` },
    el('div', { class: 'k' }, x.label),
    el('div', { class: 'v' }, x.pct),
    el('div', { class: 's' }, x.target),
    el('div', { class: `s dev ${x.tone}` }, x.out ? `${x.dev}・超出區間` : x.dev),
    el('div', { class: 's' }, x.sub || ' ')));
  const alerts = v.alerts.map((a) => el('li', { class: `pa ${a.lvl === 'risk' ? 'bad' : 'warn'}` },
    el('div', { class: 'pa-top' }, el('span', { class: 'chip' }, a.isNew ? '新觸發' : `${shortDate(a.since)} 起`), el('b', {}, a.title)),
    el('div', { class: 's' }, a.meta)));
  const stats = v.stats.map((x) => el('div', { class: `pstat ${x.tone || ''}` }, el('div', { class: 'k' }, x.k), el('div', { class: 'v' }, x.v), el('div', { class: 's' }, x.s)));
  document.getElementById('pools-count').textContent = v.alerts.length ? `・${v.alerts.length} 個警報觸發中` : '・沒有觸發';
  document.getElementById('pools-grid').replaceChildren(...pools);
  const ul = document.getElementById('pools-alerts');
  ul.hidden = !alerts.length;
  ul.replaceChildren(...alerts);
  document.getElementById('pools-stats').replaceChildren(...stats);
  document.getElementById('pools-note').textContent = v.note;
}
