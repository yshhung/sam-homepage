"""每天更新首頁的投資數字（由「Sam 首頁：每日備援同步」排程執行）。

讀 OneDrive「投資資料/holdings.json」（持股，只在這台電腦和 OneDrive 裡，不進 GitHub），
用公開的收盤價更新價格，記一筆到「投資資料/history.json」，
再把首頁需要的彙總數字寫到「Sam Homepage/invest.json」（沒有股數、代號、帳號）。

價格來源（都不用登入或權杖）：
  台股上市 TWSE OpenAPI、台股上櫃 TPEx OpenAPI、美股與選擇權 Yahoo Finance chart、匯率 currency-api。
抓不到的價格沿用上一次的值，並在 invest.json 的 stalePrices 記數量。

用法：python tools/invest_sync.py [--dry-run]
      python tools/invest_sync.py --selftest   （只跑計算測試，不連網、不讀寫檔案）
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))
ONEDRIVE = os.environ.get('SAM_ONEDRIVE', r'C:\Users\YuSheng\OneDrive - 沁耘健康企業有限公司')
DATA_DIR = os.path.join(ONEDRIVE, '投資資料')
HOLDINGS = os.path.join(DATA_DIR, 'holdings.json')
HISTORY = os.path.join(DATA_DIR, 'history.json')
OUT = os.path.join(ONEDRIVE, 'Sam Homepage', 'invest.json')
UA = {'User-Agent': 'Mozilla/5.0 (sam-homepage invest sync)'}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def roc_date(s):
    """'1151103' → '2026-11-03'"""
    s = s.strip()
    return f'{int(s[:-4]) + 1911}-{s[-4:-2]}-{s[-2:]}'


def num(v):
    try:
        return float(str(v).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


# ---------- 抓價格：回傳 {code: (price, prev_price, date)} ----------

def tw_quotes():
    out = {}
    for r in get_json('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'):
        close, chg = num(r.get('ClosingPrice')), num(r.get('Change'))
        if close:
            out[r['Code']] = (close, round(close - (chg or 0), 4), roc_date(r['Date']))
    try:
        for r in get_json('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'):
            close, chg = num(r.get('Close')), num(r.get('Change'))
            if close and r.get('SecuritiesCompanyCode') not in out:
                out[r['SecuritiesCompanyCode']] = (close, round(close - (chg or 0), 4), roc_date(r['Date']))
    except Exception as e:  # 上櫃抓不到不影響上市
        print('TPEx 抓不到：', e)
    return out


def yahoo_quote(symbol):
    r = get_json(f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=7d&interval=1d')['chart']['result'][0]
    off = r['meta'].get('gmtoffset', 0)
    bars = [(datetime.fromtimestamp(t + off, timezone.utc).strftime('%Y-%m-%d'), c)
            for t, c in zip(r.get('timestamp') or [], r['indicators']['quote'][0].get('close') or []) if c is not None]
    price = r['meta'].get('regularMarketPrice')
    day = datetime.fromtimestamp(r['meta']['regularMarketTime'] + off, timezone.utc).strftime('%Y-%m-%d')
    earlier = [c for d, c in bars if d < day]
    prev = earlier[-1] if earlier else r['meta'].get('chartPreviousClose', price)
    return price, round(prev, 4) if prev is not None else None, day


def usd_twd():
    for u in ('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
              'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json'):
        try:
            return float(get_json(u)['usd']['twd'])
        except Exception:
            continue
    return None


# ---------- 計算（純函式，--selftest 測這裡） ----------

CASH_CODES = {'CASH', 'TWCASH'}


def apply_quotes(holdings, quotes):
    """把新價格寫回持股；來源日期比現有舊就不用。回傳沒更新到的檔數（現金不算）。"""
    stale = 0
    for h in holdings:
        if h['code'] in CASH_CODES:
            continue
        key = h.get('occ') or h['code']
        q = quotes.get(key)
        if not q or q[0] is None or (h.get('price_date') and q[2] < h['price_date']):
            stale += 1
            continue
        price, prev, day = q
        if day == h.get('price_date'):
            h['price'] = price  # 同一天重抓：只更新收盤價，前一日不動
        else:
            h['prev_price'], h['prev_date'] = h.get('price'), h.get('price_date')
            h['price'], h['price_date'] = price, day
        if prev is not None:
            h['prev_price'] = prev
        h['session'] = '收盤'
    return stale


def totals(holdings, fx):
    def val(h, field):
        p = h.get(field)
        if p is None or h['code'] in CASH_CODES:
            p = h.get('price')
        return h['shares'] * p
    tw = [h for h in holdings if h.get('currency') == 'TWD']
    us = [h for h in holdings if h.get('currency') == 'USD']
    t = {
        'tw': sum(val(h, 'price') for h in tw), 'twPrev': sum(val(h, 'prev_price') for h in tw),
        'us': sum(val(h, 'price') for h in us), 'usPrev': sum(val(h, 'prev_price') for h in us),
    }
    t['total'] = t['tw'] + t['us'] * fx
    t['totalPrev'] = t['twPrev'] + t['usPrev'] * fx
    return t


def pct(now, base):
    return round((now - base) / base * 100, 2) if base else None


def month_base(history, today):
    """本月變動的比較基準：上個月最後一筆；沒有的話用本月第一筆。"""
    first = today[:8] + '01'
    before = [h for h in history if h['date'] < first]
    if before:
        return before[-1]
    this = [h for h in history if h['date'] >= first]
    return this[0] if this else None


def summary(holdings, history, fx, now, stale):
    t = totals(holdings, fx)
    today = now[:10]
    base = month_base(history, today)
    def latest(cur):
        ds = [h['price_date'] for h in holdings if h.get('currency') == cur and h['code'] not in CASH_CODES and h.get('price_date')]
        return max(ds) if ds else None
    return {
        'updated': now,
        'by': '每日同步',
        'asOf': {'tw': latest('TWD'), 'us': latest('USD')},
        'totalTwd': round(t['total']),
        'cathayTwd': round(t['tw']),
        'schwabUsd': round(t['us'], 2),
        'schwabTwd': round(t['us'] * fx),
        'fx': round(fx, 3),
        'dayPct': pct(t['total'], t['totalPrev']),
        'cathayDayPct': pct(t['tw'], t['twPrev']),
        'schwabDayPct': pct(t['us'], t['usPrev']),
        'monthPct': pct(t['total'], base['total_twd']) if base else None,
        'monthBase': base['date'] if base else None,
        'stalePrices': stale,
        'note': '國泰＝台股（含交割戶）、嘉信＝美股帳戶（含現金、扣掉賣出選擇權）；本月變動含入金出金',
    }


def write_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def main(dry=False):
    now = datetime.now(TPE).strftime('%Y-%m-%d %H:%M')
    with open(HOLDINGS, encoding='utf-8') as f:
        holdings = json.load(f)
    with open(HISTORY, encoding='utf-8') as f:
        history = json.load(f)
    errors = []
    quotes = {}
    try:
        quotes.update(tw_quotes())
    except Exception as e:
        errors.append(f'台股價格：{e}')
    today = now[:10]
    for h in holdings:
        # 證交所的全市場檔有時隔天早上還是前一天的：比 Yahoo（.TW 上市／.TWO 上櫃）舊就改用 Yahoo
        if h.get('currency') == 'TWD' and h['code'] not in CASH_CODES:
            q = quotes.get(h['code'])
            if q and q[2] >= today:
                continue
            for sym in (f"{h['code']}.TW", f"{h['code']}.TWO"):
                try:
                    y = yahoo_quote(sym)
                except Exception:
                    continue
                if not q or y[2] > q[2]:
                    quotes[h['code']] = (y[0], round(y[1], 4), y[2])
                break
    for h in holdings:
        if h.get('currency') == 'USD' and h['code'] not in CASH_CODES:
            sym = h.get('occ') or h['code']
            try:
                quotes[sym] = yahoo_quote(sym)
            except Exception as e:
                print(f'{sym} 抓不到：{e}')
    fx = usd_twd()
    if fx is None:
        fx = history[-1]['fx'] if history else None
        errors.append('匯率抓不到，沿用上一筆')
    if fx is None:
        raise SystemExit('沒有匯率，無法計算')
    stale = apply_quotes(holdings, quotes)
    out = summary(holdings, history, fx, now, stale)
    if errors:
        out['errors'] = errors
    history.append({'date': now[:10], 'at': now, 'total_twd': out['totalTwd'], 'tw_twd': out['cathayTwd'],
                    'us_usd': out['schwabUsd'], 'fx': out['fx'], 'by': '每日同步'})
    if dry:
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return
    write_json(HOLDINGS, holdings)
    write_json(HISTORY, history)
    write_json(OUT, out)
    print(f'invest.json 已更新：{now}，價格沒更新到 {stale} 檔' + (f'，{"；".join(errors)}' if errors else ''))


def selftest():
    # 明顯是假的數字
    hs = [
        {'code': 'AAA', 'currency': 'TWD', 'shares': 100, 'price': 10, 'price_date': '2026-01-02', 'prev_price': 9, 'prev_date': '2026-01-01'},
        {'code': 'TWCASH', 'currency': 'TWD', 'shares': 1000, 'price': 1},
        {'code': 'BBB', 'currency': 'USD', 'shares': 10, 'price': 100, 'price_date': '2026-01-02'},
        {'code': 'BBB 1/16/2026 120.00 C', 'occ': 'BBB260116C00120000', 'kind': 'option', 'currency': 'USD', 'shares': -100, 'price': 1, 'price_date': '2026-01-02'},
        {'code': 'CASH', 'currency': 'USD', 'shares': 50, 'price': 1},
    ]
    q = {'AAA': (12.0, 10.0, '2026-01-05'), 'BBB': (110.0, 100.0, '2026-01-05'), 'BBB260116C00120000': (2.0, 1.0, '2025-12-31')}
    stale = apply_quotes(hs, q)
    ok = True
    def check(name, cond):
        nonlocal ok
        ok &= bool(cond)
        print(('✓ ' if cond else '✗ ') + name)
    check('較舊的報價不採用', hs[3]['price'] == 1 and stale == 1)
    check('新報價寫入、前一日用來源的前收', hs[0]['price'] == 12 and hs[0]['prev_price'] == 10 and hs[0]['price_date'] == '2026-01-05')
    t = totals(hs, 30)
    check('台股市值含交割戶', t['tw'] == 100 * 12 + 1000)
    check('美股含現金、扣選擇權', t['us'] == 10 * 110 - 100 * 1 + 50)
    hist = [{'date': '2025-12-31', 'total_twd': 30000}, {'date': '2026-01-02', 'total_twd': 31000}]
    check('本月基準＝上月最後一筆', month_base(hist, '2026-01-05')['date'] == '2025-12-31')
    check('月初沒有上月資料用本月第一筆', month_base(hist[1:], '2026-01-05')['date'] == '2026-01-02')
    s = summary(hs, hist, 30, '2026-01-05 07:30', stale)
    check('彙總沒有股數與代號', 'AAA' not in json.dumps(s) and 'shares' not in json.dumps(s))
    check('今日變動 %', s['cathayDayPct'] == pct(2200, 2000) and s['dayPct'] is not None)
    print('PASS' if ok else 'FAIL')
    return ok


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest() else 1)
    main(dry='--dry-run' in sys.argv)
