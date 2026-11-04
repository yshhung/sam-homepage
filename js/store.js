// 卡片說明與門檻：登入後從 OneDrive 的 Excel 讀，沒登入用示範資料。
// 首頁只讀不寫；要改卡片說明或門檻，直接在 Excel 裡改。
import { CONFIG } from '../config.js';
import { graph, GraphError } from './auth.js';
import { cellText } from './util.js';

function settingsFrom(rows) {
  const s = { ...CONFIG.defaults };
  for (const r of rows) {
    const k = cellText(r[0]);
    const v = Number(cellText(r[1]));
    if (k && Number.isFinite(v)) s[k] = v;
  }
  return s;
}

function cardsFrom(header, rows) {
  return rows
    .map((row) => Object.fromEntries(header.map((h, i) => [cellText(h), cellText(row[i])])))
    .filter((c) => c.領域);
}

// ---------- OneDrive Excel（只讀） ----------

export class ExcelStore {
  mode = 'live';
  fileId = null;
  webUrl = null;

  // graph 可以換掉，測試時用假的 Graph（tests/excel-test.html）
  constructor(graphFn = graph) {
    this.graph = graphFn;
  }

  async findFile() {
    if (this.fileId !== null) return this.fileId;
    const path = CONFIG.filePath.split('/').map(encodeURIComponent).join('/');
    try {
      const item = await this.graph(`/me/drive/root:/${path}?$select=id,webUrl`);
      this.fileId = item.id;
      this.webUrl = item.webUrl;
    } catch (e) {
      if (!(e instanceof GraphError) || e.status !== 404) throw e;
      this.fileId = ''; // 沒有這個檔：用預設門檻、空白卡片
    }
    return this.fileId;
  }

  async readTable(name) {
    const r = await this.graph(`/me/drive/items/${this.fileId}/workbook/tables/${name}/range?$select=values`);
    const [header, ...rows] = r.values;
    return { header, rows };
  }

  async load() {
    if (!(await this.findFile())) return { cards: [], settings: { ...CONFIG.defaults } };
    const [cards, settings] = await Promise.all([this.readTable('Cards'), this.readTable('Settings')]);
    return { cards: cardsFrom(cards.header, cards.rows), settings: settingsFrom(settings.rows) };
  }
}

// ---------- 示範模式 ----------

export class DemoStore {
  mode = 'demo';

  async load() {
    return {
      cards: [
        { 領域: '工作', 數字: '3', 說明: '本週兩個會議、一份報表' },
        { 領域: '沁耘', 數字: '—', 說明: '課程規劃中' },
        { 領域: '和果', 數字: '—', 說明: '' },
        { 領域: '投資', 數字: '—', 說明: '之後接上投資資料' },
        { 領域: '生活', 數字: '18 天', 說明: '距離花蓮之旅' },
      ],
      settings: { ...CONFIG.defaults },
    };
  }
}
