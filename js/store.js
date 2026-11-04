// 資料存放：登入後是 OneDrive 裡的 Excel，沒登入是這台裝置的示範資料。
// 兩種都提供同樣的方法：load / addItem / updateItem / deleteItem / updateCard
import { CONFIG } from '../config.js';
import { graph, GraphError } from './auth.js';
import { addDays, cellDate, cellText, dateStr, nowStamp, uid } from './util.js';

export const ITEM_COLS = ['ID', '類別', '標題', '備註', '到期日', '狀態', '延後至', '連結', '建立', '完成'];
export const CARD_COLS = ['領域', '數字', '說明', '更新'];
const DATE_COLS = new Set(['到期日', '延後至']);

function rowToObj(cols, row) {
  const o = {};
  cols.forEach((c, i) => { o[c] = DATE_COLS.has(c) ? cellDate(row[i]) : cellText(row[i]); });
  return o;
}

function objToRow(cols, o) {
  return cols.map((c) => o[c] ?? '');
}

function settingsFrom(rows) {
  const s = { ...CONFIG.defaults };
  for (const r of rows) {
    const k = cellText(r[0]);
    const v = Number(cellText(r[1]));
    if (k && Number.isFinite(v)) s[k] = v;
  }
  return s;
}

// ---------- OneDrive Excel ----------

export class ExcelStore {
  mode = 'live';
  fileId = null;
  webUrl = null;

  // graph 可以換掉，測試時用假的 Graph（tests/excel-test.html）
  constructor(graphFn = graph) {
    this.graph = graphFn;
  }

  async ensureFile() {
    if (this.fileId) return;
    const path = CONFIG.filePath.split('/').map(encodeURIComponent).join('/');
    let item;
    try {
      item = await this.graph(`/me/drive/root:/${path}?$select=id,webUrl`);
    } catch (e) {
      if (!(e instanceof GraphError) || e.status !== 404) throw e;
      // 第一次使用：把空白範本上傳到 OneDrive（資料夾會自動建立）
      const res = await fetch(new URL('../template/SamHomepage.xlsx', import.meta.url));
      if (!res.ok) throw new Error('找不到空白範本 template/SamHomepage.xlsx');
      const tpl = await res.arrayBuffer();
      item = await this.graph(`/me/drive/root:/${path}:/content`, {
        method: 'PUT', body: tpl, headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    this.fileId = item.id;
    this.webUrl = item.webUrl;
  }

  wb(p) {
    return `/me/drive/items/${this.fileId}/workbook${p}`;
  }

  // 讀整張表（含表頭）；回傳欄名、資料列與表格位置
  async readTable(name) {
    const r = await this.graph(this.wb(`/tables/${name}/range?$select=address,values`));
    const [header, ...rows] = r.values;
    const m = r.address.match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);
    return { header: header.map(cellText), rows, sheet: m[1], c1: m[2], c2: m[4], top: Number(m[3]) };
  }

  // 直接改工作表上的那一列，比 table row API 穩定
  rowRange(t, i) {
    const r = t.top + 1 + i;
    return this.wb(`/worksheets/${encodeURIComponent(t.sheet)}/range(address='${t.c1}${r}:${t.c2}${r}')`);
  }

  async load() {
    await this.ensureFile();
    const [items, cards, settings] = await Promise.all([
      this.readTable('Items'), this.readTable('Cards'), this.readTable('Settings'),
    ]);
    return {
      items: items.rows
        .map((row, i) => ({ ...rowToObj(items.header, row), _row: i }))
        .filter((o) => o.標題 || o.ID)
        .map((o) => ({ ...o, ID: o.ID || `__r${o._row}` })),
      cards: cards.rows.map((row) => rowToObj(cards.header, row)).filter((c) => c.領域),
      settings: settingsFrom(settings.rows),
    };
  }

  async findRow(table, cols, match) {
    const t = await this.readTable(table);
    const i = t.rows.findIndex((row, idx) => match(rowToObj(t.header, row), idx));
    if (i < 0) throw new Error('找不到這筆資料，可能已在別台裝置被刪除');
    return { t, i, obj: rowToObj(t.header, t.rows[i]) };
  }

  matchItem(id) {
    return (o, idx) => (id.startsWith('__r') ? idx === Number(id.slice(3)) : o.ID === id);
  }

  async addItem(item) {
    await this.ensureFile();
    // 照 Excel 裡實際的欄位順序寫，使用者調過欄位順序也不會錯位
    const { header } = await this.readTable('Items');
    await this.graph(this.wb('/tables/Items/rows'), { method: 'POST', body: { values: [objToRow(header, item)] } });
  }

  async updateItem(id, patch) {
    await this.ensureFile();
    const { t, i, obj } = await this.findRow('Items', ITEM_COLS, this.matchItem(id));
    const next = { ...obj, ...patch, ID: obj.ID || uid() };
    await this.graph(this.rowRange(t, i), { method: 'PATCH', body: { values: [objToRow(t.header, next)] } });
  }

  async deleteItem(id) {
    await this.ensureFile();
    const { t, i } = await this.findRow('Items', ITEM_COLS, this.matchItem(id));
    await this.graph(`${this.rowRange(t, i)}/delete`, { method: 'POST', body: { shift: 'Up' } });
  }

  async updateCard(domain, patch) {
    await this.ensureFile();
    const { t, i, obj } = await this.findRow('Cards', CARD_COLS, (o) => o.領域 === domain);
    await this.graph(this.rowRange(t, i), { method: 'PATCH', body: { values: [objToRow(t.header, { ...obj, ...patch })] } });
  }
}

// ---------- 示範模式（只存在這台裝置） ----------

const DEMO_KEY = 'samhp-demo-v1';

function demoSeed() {
  const t = dateStr();
  const item = (類別, 標題, 到期日 = '', 備註 = '', 連結 = '') =>
    ({ ID: uid(), 類別, 標題, 備註, 到期日, 狀態: '待辦', 延後至: '', 連結, 建立: nowStamp(), 完成: '' });
  return {
    items: [
      item('沁耘', '確認 11 月排班表', addDays(t, -1), '和果站有兩位照服員請假'),
      item('帳單', '繳勞健保費', t, '金額依繳款單'),
      item('待辦', '回覆會計師 Q3 報表問題', addDays(t, 1)),
      item('旅行', '花蓮住宿最後確認', addDays(t, 2), '11/22–11/24'),
      item('投資', '檢視嘉信持股配置', addDays(t, 9)),
      item('其他', '想買的書整理一下'),
    ],
    cards: [
      { 領域: '工作', 數字: '3', 說明: '本週兩個會議、一份報表', 更新: '' },
      { 領域: '沁耘', 數字: '96%', 說明: '本月出勤率，和果站稍低', 更新: '' },
      { 領域: '投資', 數字: '—', 說明: '第 3 階段接上資料後自動更新', 更新: '' },
      { 領域: '生活', 數字: '18 天', 說明: '距離花蓮之旅', 更新: '' },
    ],
  };
}

export class DemoStore {
  mode = 'demo';

  read() {
    try {
      const saved = JSON.parse(localStorage.getItem(DEMO_KEY));
      if (saved?.items) return saved;
    } catch { /* 沒有或壞掉就重建 */ }
    const seed = demoSeed();
    this.write(seed);
    return seed;
  }

  write(db) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch { /* 無痕模式存不了 */ }
  }

  async load() {
    const db = this.read();
    return { items: db.items, cards: db.cards, settings: { ...CONFIG.defaults } };
  }

  async addItem(item) {
    const db = this.read();
    db.items.push(item);
    this.write(db);
  }

  async updateItem(id, patch) {
    const db = this.read();
    db.items = db.items.map((o) => (o.ID === id ? { ...o, ...patch } : o));
    this.write(db);
  }

  async deleteItem(id) {
    const db = this.read();
    db.items = db.items.filter((o) => o.ID !== id);
    this.write(db);
  }

  async updateCard(domain, patch) {
    const db = this.read();
    db.cards = db.cards.map((c) => (c.領域 === domain ? { ...c, ...patch } : c));
    this.write(db);
  }
}
