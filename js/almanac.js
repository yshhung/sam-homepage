// 農民曆：農曆日期、節氣、宜忌（離線計算，用本站的 vendor/lunar-javascript-1.7.7.js，npm 官方 MIT 套件）
// 套件只有簡體字，這裡把宜忌、月日、節氣會用到的字轉成繁體（只列有差異的字）

const TRAD = {
  丧: '喪', 习: '習', 买: '買', 产: '產', 亲: '親', 仓: '倉', 佣: '傭', 养: '養', 医: '醫', 厕: '廁', 发: '髮',
  坏: '壞', 坟: '墳', 墙: '牆', 学: '學', 宁: '寧', 寿: '壽', 帐: '帳', 库: '庫', 庙: '廟', 开: '開', 归: '歸',
  扫: '掃', 挂: '掛', 断: '斷', 机: '機', 桥: '橋', 梁: '樑', 殓: '殮', 涂: '塗', 渔: '漁', 疗: '療', 盖: '蓋',
  种: '種', 筑: '築', 纳: '納', 经: '經', 结: '結', 绘: '繪', 络: '絡', 网: '網', 艺: '藝', 蚁: '蟻', 补: '補',
  见: '見', 订: '訂', 讼: '訟', 词: '詞', 诸: '諸', 谢: '謝', 财: '財', 货: '貨', 贵: '貴', 车: '車', 进: '進',
  酝: '醞', 酿: '釀', 针: '針', 钻: '鑽', 铸: '鑄', 门: '門', 问: '問', 饰: '飾', 馀: '餘', 齐: '齊', 斋: '齋',
  动: '動', 头: '頭', 竖: '豎', 闰: '閏', 腊: '臘', 启: '啟', 会: '會', 马: '馬', 猎: '獵', 处: '處', 惊: '驚',
  谷: '穀', 满: '滿', 无: '無', 蛰: '蟄',
};

export const toTrad = (s) => [...String(s || '')].map((c) => TRAD[c] || c).join('');

// 'YYYY-MM-DD' → { lunar: '九月十五', term: '立冬' 或 '', yi: [...], ji: [...] }；套件沒載入就回 null
export function almanac(date, n = 3) {
  const Solar = globalThis.Solar;
  if (!Solar?.fromYmd) return null;
  try {
    const [y, m, d] = date.split('-').map(Number);
    const l = Solar.fromYmd(y, m, d).getLunar();
    return {
      lunar: toTrad(`${l.getMonthInChinese()}月${l.getDayInChinese()}`),
      term: toTrad(l.getJieQi() || ''),
      yi: l.getDayYi().slice(0, n).map(toTrad),
      ji: l.getDayJi().slice(0, n).map(toTrad),
    };
  } catch {
    return null;
  }
}

// 月曆格子裡的小字：節氣優先，初一顯示月份，其他顯示日（「廿七」）
export function lunarDay(date) {
  const Solar = globalThis.Solar;
  if (!Solar?.fromYmd) return '';
  try {
    const [y, m, d] = date.split('-').map(Number);
    const l = Solar.fromYmd(y, m, d).getLunar();
    const term = l.getJieQi();
    if (term) return toTrad(term);
    return toTrad(l.getDay() === 1 ? `${l.getMonthInChinese()}月` : l.getDayInChinese());
  } catch {
    return '';
  }
}

// 日期列用的一段文字：「農曆九月十五 · 宜 祭祀、出行、嫁娶 · 忌 動土、安葬、開市」
export function almanacText(date) {
  const a = almanac(date);
  if (!a) return '';
  return [
    `農曆${a.lunar}${a.term ? `（${a.term}）` : ''}`,
    a.yi.length ? `宜 ${a.yi.join('、')}` : '',
    a.ji.length ? `忌 ${a.ji.join('、')}` : '',
  ].filter(Boolean).join(' · ');
}
