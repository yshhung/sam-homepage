"""每天更新首頁的投資數字（由雲端排程「Sam 首頁：每日同步」執行）。

讀 OneDrive「投資資料/holdings.json」（持股，只在 OneDrive，不進 GitHub；只有買賣時由 Claude 修改），
用公開的收盤價算出市值，把最新價格與最近 70 天的總資產記在「投資資料/state.json」，
這個月每天的總資產寫在「投資資料/history/YYYY-MM.json」（永久保留，過去的月份不再改），
再把首頁需要的彙總數字寫到「Sam Homepage/invest.json」（沒有股數、代號、帳號）。
雲端排程會先把 OneDrive 的檔案抄到暫存資料夾，用 --base 指過去、--expect 核對大小，算完再寫回 OneDrive。

價格來源（都不用登入或權杖）：
  台股上市 TWSE OpenAPI、台股上櫃 TPEx OpenAPI、美股與選擇權 Yahoo Finance chart、匯率 currency-api。
抓不到的價格沿用上一次的值，並在 invest.json 的 stalePrices 記數量。

用法：python tools/invest_sync.py [--base 資料夾] [--expect holdings.json=位元組,state.json=位元組] [--dry-run]
      python tools/invest_sync.py --selftest   （只跑計算測試，不連網、不讀寫檔案）
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))
ONEDRIVE = os.environ.get('SAM_ONEDRIVE', r'C:\Users\YuSheng\OneDrive - 沁耘健康企業有限公司')
UA = {'User-Agent': 'Mozilla/5.0 (sam-homepage invest sync)'}
CASH_CODES = {'CASH', 'TWCASH'}


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


# ---------- 抓價格：回傳 {代號: (price, prev_price, date)} ----------

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


def key_of(h):
    return h.get('occ') or h['code']


def fetch_quotes(holdings, today, errors):
    quotes = {}
    try:
        quotes.update(tw_quotes())
    except Exception as e:
        errors.append(f'台股價格：{e}')
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
                    quotes[h['code']] = y
                break
    for h in holdings:
        if h.get('currency') == 'USD' and h['code'] not in CASH_CODES:
            sym = key_of(h)
            try:
                quotes[sym] = yahoo_quote(sym)
            except Exception as e:
                print(f'{sym} 抓不到：{e}')
    return quotes


# ---------- 計算（純函式，--selftest 測這裡） ----------

def apply_state_prices(holdings, state):
    """state.json 裡上次抓到的價格比持股檔新，就先用它（持股檔只在買賣時由 Claude 修改）。"""
    for h in holdings:
        p = (state.get('prices') or {}).get(key_of(h))
        if p and h['code'] not in CASH_CODES and (not h.get('price_date') or p[2] >= h['price_date']):
            h['price'], h['prev_price'], h['price_date'] = p[0], p[1], p[2]


def apply_quotes(holdings, quotes):
    """把新價格寫進持股（只在記憶體裡）；來源日期比現有舊就不用。回傳沒更新到的檔數（現金不算）。"""
    stale = 0
    for h in holdings:
        if h['code'] in CASH_CODES:
            continue
        q = quotes.get(key_of(h))
        if not q or q[0] is None or (h.get('price_date') and q[2] < h['price_date']):
            stale += 1
            continue
        price, prev, day = q
        if day != h.get('price_date'):
            h['prev_price'] = h.get('price')
        h['price'], h['price_date'] = price, day
        if prev is not None:
            h['prev_price'] = prev
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


def month_base(daily, today):
    """本月變動的比較基準：上個月最後一筆；沒有的話用本月第一筆。"""
    first = today[:8] + '01'
    before = [d for d in daily if d['date'] < first]
    if before:
        return before[-1]
    this = [d for d in daily if d['date'] >= first]
    return this[0] if this else None


def summary(holdings, daily, fx, now, stale):
    t = totals(holdings, fx)
    base = month_base(daily, now[:10])
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
        'monthPct': pct(t['total'], base['total']) if base else None,
        'monthBase': base['date'] if base else None,
        'stalePrices': stale,
        'note': '國泰＝台股（含交割戶）、嘉信＝美股帳戶（含現金、扣掉賣出選擇權）；本月變動含入金出金',
    }


def update_state(state, holdings, out, keep=70):
    prices = {key_of(h): [h.get('price'), h.get('prev_price'), h.get('price_date')]
              for h in holdings if h['code'] not in CASH_CODES and h.get('price') is not None}
    row = {'date': out['updated'][:10], 'total': out['totalTwd'], 'tw': out['cathayTwd'], 'us': out['schwabUsd'], 'fx': out['fx']}
    daily = [d for d in state.get('daily', []) if d['date'] != row['date']] + [row]
    daily.sort(key=lambda d: d['date'])
    return {'updated': out['updated'], 'prices': prices, 'daily': daily[-keep:]}


# ---------- 讀寫檔 ----------

def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(dumps(obj))
    os.replace(tmp, path)
    return os.path.getsize(path)


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8-sig') as f:
        return json.load(f)


def run(base, expect=None, dry=False):
    """base 底下要有「投資資料/holdings.json」（state.json 可以沒有）；
    結果寫到「投資資料/state.json」與「Sam Homepage/invest.json」，最後一行印出每個檔的位元組數。"""
    now = datetime.now(TPE).strftime('%Y-%m-%d %H:%M')
    data_dir = os.path.join(base, '投資資料')
    state_path = os.path.join(data_dir, 'state.json')
    out_path = os.path.join(base, 'Sam Homepage', 'invest.json')
    # 雲端是先從 OneDrive 抄下來再算：大小不對就是抄錯了，寧可不更新
    for name, size in (expect or {}).items():
        actual = os.path.getsize(os.path.join(data_dir, name))
        if actual != size:
            raise SystemExit(f'{name} 大小 {actual} 跟 OneDrive 的 {size} 不一樣，停止（沒有寫任何檔）')
    holdings = load_json(os.path.join(data_dir, 'holdings.json'))
    state = load_json(state_path, {'prices': {}, 'daily': []})
    apply_state_prices(holdings, state)
    errors = []
    quotes = fetch_quotes(holdings, now[:10], errors)
    fx = usd_twd()
    if fx is None:
        fx = state['daily'][-1]['fx'] if state.get('daily') else None
        errors.append('匯率抓不到，沿用上一筆')
    if fx is None:
        raise SystemExit('沒有匯率，無法計算')
    stale = apply_quotes(holdings, quotes)
    out = summary(holdings, state.get('daily', []), fx, now, stale)
    if errors:
        out['errors'] = errors
    new_state = update_state(state, holdings, out)
    if dry:
        print(dumps(out))
        return
    month = now[:7]
    month_rows = [dict(d, src='排程') for d in new_state['daily'] if d['date'].startswith(month)]
    sizes = {
        'state.json': write_json(state_path, new_state),
        'invest.json': write_json(out_path, out),
        # 永久的總資產歷史：一個月一個檔，只寫這個月（state 留 70 天，一定涵蓋整個月）
        f'history/{month}.json': write_json(os.path.join(data_dir, 'history', f'{month}.json'), {'rows': month_rows}),
    }
    print(f'invest.json 已更新：{now}，價格沒更新到 {stale} 檔' + (f'，{"；".join(errors)}' if errors else ''))
    print('BYTES ' + json.dumps(sizes))


def selftest():
    # 明顯是假的數字
    hs = [
        {'code': 'AAA', 'currency': 'TWD', 'shares': 100, 'price': 10, 'price_date': '2026-01-02', 'prev_price': 9},
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
    daily = [{'date': '2025-12-31', 'total': 30000}, {'date': '2026-01-02', 'total': 31000}]
    check('本月基準＝上月最後一筆', month_base(daily, '2026-01-05')['date'] == '2025-12-31')
    check('月初沒有上月資料用本月第一筆', month_base(daily[1:], '2026-01-05')['date'] == '2026-01-02')
    s = summary(hs, daily, 30, '2026-01-05 07:30', stale)
    check('彙總沒有股數與代號', 'AAA' not in json.dumps(s) and 'shares' not in json.dumps(s))
    check('今日變動 %', s['cathayDayPct'] == pct(2200, 2000) and s['dayPct'] is not None)
    st = update_state({'daily': [{'date': '2026-01-05', 'total': 1}]}, hs, s, keep=2)
    check('同一天重跑只留一筆、價格記進 state', len(st['daily']) == 1 and st['daily'][0]['total'] == s['totalTwd'] and st['prices']['AAA'][0] == 12)
    h2 = [{'code': 'AAA', 'currency': 'TWD', 'shares': 1, 'price': 1, 'price_date': '2026-01-01'}]
    apply_state_prices(h2, st)
    check('持股檔的舊價格會被 state 的新價格蓋過', h2[0]['price'] == 12 and h2[0]['price_date'] == '2026-01-05')
    print('PASS' if ok else 'FAIL')
    return ok


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--selftest' in args:
        sys.exit(0 if selftest() else 1)
    base = args[args.index('--base') + 1] if '--base' in args else ONEDRIVE
    expect = {}
    if '--expect' in args:  # 例如 --expect holdings.json=6133,state.json=2048
        for pair in args[args.index('--expect') + 1].split(','):
            name, size = pair.split('=')
            expect[name] = int(size)
    run(base, expect, dry='--dry-run' in args)
