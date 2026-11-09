"""投資計畫書 v1（2026-11-06）的四池配置與觸發警報，由 invest_sync.py 呼叫。

讀 OneDrive「投資資料/rules.json」（kind：pool、cap+each、floor、budget、playbook、drawdown、fx、schedule）
與「投資資料/plans.json」（每檔的 pool、PLTR 的 sell_plan），算出：
  pools   四池目前比例、目標、偏離、是否超出容許區間（每次跑都算）
  alerts  觸發中的警報（只有 07:30 每日同步帶 --alerts 才重新判斷；其他報告沿用上次結果）
  extras  樂透額度餘額、美金累積、下次半年檢查日、PLTR 賣出進度
結果放進 invest.json 與 state.json 的 "plan"；state.json 的 "plan_state" 記每個警報目前的級別，
用來判斷「第一次觸發」或「升級到下一級」（new: true，早報只推播這些）。
一律用收盤價；52 週高點也用收盤高點（忽略單日尖刺，見 invest_sync.yahoo_year）。
已知悉（ack）：plans.json 每檔可加 ack:{"cap"或"dd":"YYYY-MM-DD","note":"…"}。被 ack 的警報照樣列在投資頁（灰色），
但首頁待處理與投資卡的警報數不算它；條件消失後再出現（since 晚於 ack 日）或級別升高（raised 晚於 ack 日），ack 自動失效。
回撤警報有遲滯：跌到 threshold 觸發，回到 release（預設 threshold+5 點）以內才解除。
四池可設過渡目標 interim:{until,max,min}：期限內只要在過渡範圍內就不標超出區間。休市日沒有新收盤就不重算、不標 new。
"""
import calendar
from datetime import date

CASH_CODES = {'CASH', 'TWCASH'}
POOLS = [('broad', '大盤'), ('conviction', '信念'), ('swing', '波段／待處理'), ('cash', '現金')]


def _rule(rules, kind, key=None):
    for r in rules or []:
        if r.get('active') is False:
            continue
        if r.get('kind') == kind and (key is None or r.get('key') == key):
            return r
    return None


def pool_of(code, plan_pool):
    if code in CASH_CODES:
        return 'cash'
    base = code.split(' ')[0]  # 選擇權「PLTR 12/18/2026 210.00 C」算在標的的池子
    p = plan_pool.get(base)
    return p if p in ('broad', 'conviction', 'swing', 'cash') else 'swing'  # pending、沒歸池的都算「波段／待處理」


def values_twd(holdings, fx):
    return [(h, h['shares'] * (h.get('price') or 0) * (fx if h.get('currency') == 'USD' else 1)) for h in holdings]


def compute_pools(holdings, plans, rules, fx, today=None):
    plan_pool = {p['code']: p.get('pool') for p in plans or [] if p.get('code')}
    vals = values_twd(holdings, fx)
    total = sum(v for _, v in vals)
    sums = {k: 0.0 for k, _ in POOLS}
    broad_us = 0.0
    for h, v in vals:
        k = pool_of(h['code'], plan_pool)
        sums[k] += v
        if k == 'broad' and h.get('currency') == 'USD':
            broad_us += v
    out = []
    for key, label in POOLS:
        r = _rule(rules, 'pool', 'pool_' + key) or {}
        pct = sums[key] / total if total else 0
        target, band = r.get('target'), r.get('band')
        dev = pct - target if target is not None else None
        lo = hi = None
        if target is not None and band is not None:
            lo, hi = target - band, target + band
        im = r.get('interim')
        active_im = bool(im and today and (not im.get('until') or today <= im['until']))
        if active_im:  # 過渡期：有設的那一側用過渡門檻，沒設的那一側沿用原區間
            if im.get('max') is not None:
                hi = im['max']
            if im.get('min') is not None:
                lo = im['min']
        row = {'key': key, 'label': label, 'pct': round(pct, 4), 'target': target, 'band': band,
               'dev': round(dev, 4) if dev is not None else None,
               'out': bool(lo is not None and (pct > hi + 1e-9 or pct < lo - 1e-9))}
        if active_im:
            row['interim'] = {k: im.get(k) for k in ('until', 'max', 'min') if im.get(k) is not None}
            row['outNormal'] = bool(dev is not None and band is not None and abs(dev) > band + 1e-9)
        if key == 'broad' and total:
            row['split'] = {'us': round(broad_us / total, 4), 'tw': round((sums[key] - broad_us) / total, 4)}
        out.append(row)
    return out, total


def next_review(today, months=(6, 12)):
    y, m = int(today[:4]), int(today[5:7])
    for yy in (y, y + 1):
        for mm in sorted(months):
            d = date(yy, mm, calendar.monthrange(yy, mm)[1]).isoformat()
            if d >= today:
                return d
    return None


def review_compare(rules, pools):
    """半年檢查的信念池比例要比上次低：rules.json 的 schedule/review 有 history:[{date,conviction}] 就比較。"""
    sch = _rule(rules, 'schedule', 'review')
    hist = (sch or {}).get('history') or []
    now = next((p['pct'] for p in pools if p['key'] == 'conviction'), None)
    if not hist or now is None:
        return None
    last = sorted(hist, key=lambda h: h['date'])[-1]
    return {'date': last['date'], 'conviction': last.get('conviction'), 'now': now,
            'down': now < last.get('conviction', 9) - 1e-9}


def compute_extras(holdings, plans, rules, today):
    ex = {}
    lot = _rule(rules, 'budget', 'lotto')
    if lot:
        used = (lot.get('used_usd') or 0) if str(lot.get('year')) == today[:4] else 0
        ex['lotto'] = {'limitUsd': lot.get('limit_usd'), 'usedUsd': used, 'leftUsd': max(0, (lot.get('limit_usd') or 0) - used), 'year': int(today[:4])}
    fxr = _rule(rules, 'fx')
    if fxr:
        acc = fxr.get('usd_accum')
        ex['usdAccum'] = {'usd': acc, 'asOf': fxr.get('usd_accum_date'), 'threshold': fxr.get('transfer_usd'),
                          'ready': acc is not None and fxr.get('transfer_usd') is not None and acc >= fxr['transfer_usd']}
    sch = _rule(rules, 'schedule', 'review')
    ex['nextReview'] = next_review(today, tuple(sch.get('months', (6, 12))) if sch else (6, 12))
    for p in plans or []:
        sp = p.get('sell_plan')
        if not sp:
            continue
        h = next((x for x in holdings if x['code'] == p['code']), None)
        cur = h['shares'] if h else sp['keep']
        total = sum(b['shares'] for b in sp['batches'])
        sold = max(0, min(total, sp['start_shares'] - cur))
        done, left = 0, sold
        for b in sp['batches']:
            if left >= b['shares']:
                done += 1
                left -= b['shares']
        nxt = sp['batches'][done] if done < len(sp['batches']) else None
        ex['sellPlan'] = {'code': p['code'], 'sold': sold, 'total': total, 'batchesDone': done, 'batches': len(sp['batches']),
                          'nextPrice': nxt['price'] if nxt else None, 'deadline': p.get('deadline')}
    return ex


def put_collateral_usd(holdings):
    """現金擔保 Sell Put 佔用的美金：履約價 × 100 × 口數（從 OCC 代號讀）。"""
    c = 0.0
    for h in holdings:
        occ = h.get('occ') or ''
        if h.get('kind') == 'option' and len(occ) > 15 and occ[-9] == 'P' and h['shares'] < 0:
            c += int(occ[-8:]) / 1000 * -h['shares']
    return c


def evaluate(holdings, plans, rules, fx, market, pools, total, prev_state=None):
    """回傳目前觸發中的警報 {key: {level, title, meta, lvl}}。market：
    {'spx': (close, date, high52), 'vix': (close, date), 'year': {code: (close, date, high52)}}"""
    plan_pool = {p['code']: p.get('pool') for p in plans or [] if p.get('code')}
    names = {h['code']: h.get('name') for h in holdings if h.get('market') == '台股' and h.get('name')}
    for p in plans or []:
        if p.get('market') == '台股' and p.get('name') and p.get('code'):
            names.setdefault(p['code'], p['name'])
    nm = lambda code: f"{code} {names[code]}" if code in names else code  # 台股記不住代號，標題加中文名稱
    out = {}
    pb = _rule(rules, 'playbook', 'cash_playbook')
    cash_pct = next((p['pct'] for p in pools if p['key'] == 'cash'), None)
    spx = market.get('spx')
    if pb and spx and spx[2]:
        dd = spx[0] / spx[2] - 1
        steps = sorted(pb['steps'], key=lambda s: -s['drawdown'])  # -10% → -20% → -30%
        level = 0
        for i, s in enumerate(steps):
            if dd <= s['drawdown'] + 1e-12:
                level = i + 1
        if level:
            s = steps[level - 1]
            out['spx'] = {'level': level, 'lvl': 'risk' if level >= 2 else 'warn',
                          'title': f"S&P 500 從 52 週高點 {dd * 100:.1f}%（第 {level} 級）",
                          'meta': f"現金劇本：現金降到 {s['cash'] * 100:.0f}%（目前 {cash_pct * 100:.1f}%）；美股跌先用美金買 SPYM，美金用完改用台幣買 006208",
                          'date': spx[1]}
    vix = market.get('vix')
    if pb and vix and vix[0] is not None and vix[0] > pb.get('vix_alert', 30):
        out['vix'] = {'level': 1, 'lvl': 'warn', 'title': f"VIX {vix[0]:.1f}（> {pb.get('vix_alert', 30)}，恐慌）",
                      'meta': '恐慌確實存在，現金劇本可以更有信心執行，但比例仍照表', 'date': vix[1]}
    ddr = _rule(rules, 'drawdown', 'conviction_dd')
    prev_state = prev_state or {}
    release = ddr.get('release', ddr['threshold'] + 0.05) if ddr else None
    for code, v in (market.get('year') or {}).items():
        close, day, hi = v[0], v[1], v[2]
        if ddr and plan_pool.get(code) == 'conviction' and hi:
            dd = close / hi - 1
            # 遲滯：已在觸發中就要回到 release（例如 -20%）以內才解除，避免在門檻附近天天進出
            on = dd <= ddr['threshold'] + 1e-12 or ('dd:' + code in prev_state and dd <= release + 1e-12)
            if on:
                out['dd:' + code] = {'level': 1, 'lvl': 'warn', 'title': f"{nm(code)} 從 52 週高點 {dd * 100:.1f}%",
                                     'meta': '觸發兩步驟檢查：① 對照信念卡「錯了的訊號」② 看賣壓來源（融資、Put/Call、空單、成交量、同族群）',
                                     'date': day}
    cap = next((r for r in rules or [] if r.get('active') is not False and r.get('kind') == 'cap' and r.get('each')), None)
    if cap and total:
        # 單一信念股上限：依 plans.json 裡 pool 是 conviction 的全部（規則有 pool 時），沒有 pool 才退回 codes
        cap_codes = ({c for c, pl in plan_pool.items() if pl == cap['pool']} if cap.get('pool') else set(cap.get('codes') or []))
        for h, v in values_twd(holdings, fx):
            if h['code'] in cap_codes and v / total > cap['cap']:
                out['cap:' + h['code']] = {'level': 1, 'lvl': 'warn', 'title': f"{nm(h['code'])} 占總資產 {v / total * 100:.1f}%（> {cap['cap'] * 100:.0f}%）",
                                           'meta': '超過單一信念股天花板，只賣超出部分（或有意識地容忍）'}
    fl = _rule(rules, 'floor', 'cash_floor')
    if fl:
        usd = next((h['shares'] for h in holdings if h['code'] == 'CASH'), None)
        twd = next((h['shares'] for h in holdings if h['code'] == 'TWCASH'), None)
        if usd is not None and fl.get('usd') is not None:
            col = put_collateral_usd(holdings)
            avail = usd - col
            if avail < fl['usd']:
                out['floor:usd'] = {'level': 1, 'lvl': 'risk', 'title': f"嘉信美金低於底線 US${fl['usd']:,}",
                                    'meta': f"可用約 US${avail:,.0f}" + (f"（已扣 Sell Put 擔保 US${col:,.0f}）" if col else '') + '；平時不動用，現金劇本觸發時立刻匯款'}
        if twd is not None and fl.get('twd') is not None and twd < fl['twd']:
            out['floor:twd'] = {'level': 1, 'lvl': 'risk', 'title': f"台幣現金低於底線 NT${fl['twd']:,}",
                                'meta': f"國泰交割戶約 NT${twd:,.0f}；每月新資金先補現金池"}
    return out


def apply_ack(alerts, plans):
    """依 plans.json 的 ack 標記已知悉。alerts 是 merge 之後的清單（有 key、since、raised）。"""
    acks = {p['code']: p.get('ack') or {} for p in plans or [] if p.get('code')}
    out = []
    for a in alerts:
        kind, _, code = a['key'].partition(':')
        ack = (acks.get(code) or {}).get(kind) if code else None
        a = {k: v for k, v in a.items() if k not in ('acked', 'ackNote', 'ackDate')}
        # 有效條件：這一輪觸發從 ack 當天（含）以前就開始，而且之後沒有升級
        if ack and a.get('since', '9999') <= ack and a.get('raised', '9999') <= ack:
            a.update(acked=True, ackDate=ack, ackNote=(acks[code].get('note') or ''), new=False)
        out.append(a)
    order = {'risk': 0, 'warn': 1}
    out.sort(key=lambda a: (bool(a.get('acked')), not a.get('new'), order.get(a.get('lvl'), 2), a['key']))
    return out


def merge(current, prev_state, today):
    """跟上次比：沒觸發過或級別升高＝new（第一次觸發／升級）。回傳 (alerts 清單, 新的 plan_state)。"""
    prev_state = prev_state or {}
    alerts, state = [], {}
    for key, a in current.items():
        p = prev_state.get(key)
        raised = not p or a['level'] > p.get('level', 0)
        since = today if not p else p.get('since', today)
        state[key] = {'level': a['level'], 'since': since, 'raised': today if raised else p.get('raised', since)}
        alerts.append(dict(a, key=key, since=since, raised=state[key]['raised'], new=raised))
    order = {'risk': 0, 'warn': 1}
    alerts.sort(key=lambda a: (not a['new'], order.get(a['lvl'], 2), a['key']))
    return alerts, state


def build(holdings, plans, rules, fx, today, state, market=None, evaluate_alerts=False, evaluated_by=None):
    """回傳要放進 invest.json 的 plan 區塊，並更新 state（plan、plan_state）。"""
    prev = state.get('plan') or {}
    if plans is None or rules is None:  # 這次沒抄到規則檔（例如早晚報）：沿用上次
        return prev or None
    pools, total = compute_pools(holdings, plans, rules, fx, today)
    plan = {'pools': pools, 'extras': compute_extras(holdings, plans, rules, today),
            # 沿用：當天升級的保留 new（早報要推播），隔天就不算 new
            'alerts': [dict(a, new=bool(a.get('new')) and a.get('raised') == today) for a in prev.get('alerts', [])],
            'evaluated': prev.get('evaluated'), 'evaluatedBy': prev.get('evaluatedBy'), 'dataAsOf': prev.get('dataAsOf'),
            'market': prev.get('market'), 'highs': prev.get('highs')}
    rv = review_compare(rules, pools)
    if rv:
        plan['extras']['review'] = rv
    if evaluate_alerts and market is not None:
        asof = {'spx': (market.get('spx') or (None, None))[1],
                'tw': max([h.get('price_date') or '' for h in holdings if h.get('currency') == 'TWD' and h['code'] not in CASH_CODES] or ['']),
                'us': max([h.get('price_date') or '' for h in holdings if h.get('currency') == 'USD' and h['code'] not in CASH_CODES] or [''])}
        plan['evaluated'] = today
        plan['evaluatedBy'] = evaluated_by or prev.get('evaluatedBy')
        if asof != prev.get('dataAsOf'):  # 有新收盤才重算；休市日沿用、不標 new
            cur = evaluate(holdings, plans, rules, fx, market, pools, total, state.get('plan_state'))
            plan['alerts'], state['plan_state'] = merge(cur, state.get('plan_state'), today)
            plan['dataAsOf'] = asof
            plan['highs'] = {c: {'close': v[0], 'date': v[1], 'high52': v[2], 'highDate': v[3] if len(v) > 3 else None, 'dd': round(v[0] / v[2] - 1, 4)}
                             for c, v in (market.get('year') or {}).items() if v[2]}
            spx, vix = market.get('spx'), market.get('vix')
            plan['market'] = {'spx': {'close': spx[0], 'date': spx[1], 'high52': spx[2], 'dd': round(spx[0] / spx[2] - 1, 4)} if spx and spx[2] else None,
                              'vix': {'close': vix[0], 'date': vix[1]} if vix else None}
    plan['alerts'] = apply_ack(plan['alerts'], plans)  # ack 每次都重新套（Sam 剛加 ack、或升級後失效，不用等下一次判斷）
    state['plan'] = plan
    return plan


def selftest(check):
    hs = [
        {'code': 'AAA', 'currency': 'TWD', 'shares': 100, 'price': 10, 'price_date': '2026-01-05'},
        {'code': 'BBB', 'currency': 'USD', 'shares': 10, 'price': 10, 'price_date': '2026-01-05'},
        {'code': 'BBB 1/16/2026 120.00 C', 'occ': 'BBB260116C00120000', 'kind': 'option', 'currency': 'USD', 'shares': -100, 'price': 0.01},
        {'code': 'CCC', 'currency': 'USD', 'shares': 1, 'price': 10, 'price_date': '2026-01-05'},
        {'code': 'CASH', 'currency': 'USD', 'shares': 5, 'price': 1},
        {'code': 'TWCASH', 'currency': 'TWD', 'shares': 100, 'price': 1},
    ]
    plans = [{'code': 'AAA', 'pool': 'broad'}, {'code': 'BBB', 'pool': 'conviction',
              'sell_plan': {'start_shares': 16, 'keep': 10, 'batches': [{'shares': 2, 'price': 1}, {'shares': 2, 'price': 2}, {'shares': 2, 'price': 3}]}}]
    rules = [{'key': 'pool_broad', 'kind': 'pool', 'target': 0.4, 'band': 0.05},
             {'key': 'pool_conviction', 'kind': 'pool', 'target': 0.4, 'band': 0.05},
             {'key': 'conv', 'kind': 'cap', 'each': True, 'codes': ['BBB'], 'cap': 0.25},
             {'key': 'cash_floor', 'kind': 'floor', 'usd': 10, 'twd': 50},
             {'key': 'cash_playbook', 'kind': 'playbook', 'steps': [{'drawdown': -0.1, 'cash': 0.12}, {'drawdown': -0.2, 'cash': 0.08}, {'drawdown': -0.3, 'cash': 0.04}], 'vix_alert': 30},
             {'key': 'conviction_dd', 'kind': 'drawdown', 'threshold': -0.25},
             {'key': 'lotto', 'kind': 'budget', 'limit_usd': 500, 'used_usd': 100, 'year': 2026},
             {'key': 'old', 'kind': 'pool', 'active': False}]
    pools, total = compute_pools(hs, plans, rules, 30)
    pd = {p['key']: p for p in pools}
    check('四池：選擇權算在標的的池、沒歸池的算波段／待處理', abs(total - (1000 + 3000 - 30 + 300 + 150 + 100)) < 1e-6
          and abs(pd['conviction']['pct'] - 2970 / total) < 1e-4 and abs(pd['swing']['pct'] - 300 / total) < 1e-4)
    check('四池加總 100%', abs(sum(p['pct'] for p in pools) - 1) < 1e-3)
    check('超出容許區間標 out', pd['conviction']['out'] and pd['broad']['out'])
    ex = compute_extras(hs, plans, rules, '2026-03-01')
    check('PLTR 類賣出進度：賣了 6 股＝3 批完成', ex['sellPlan']['sold'] == 6 and ex['sellPlan']['batchesDone'] == 3 and ex['sellPlan']['nextPrice'] is None)
    hn = [{'code': '2308', 'name': '台達電', 'market': '台股', 'currency': 'TWD', 'shares': 1000, 'price': 100}, {'code': 'AAA', 'currency': 'TWD', 'shares': 1, 'price': 1}]
    pn = [{'code': '2308', 'pool': 'conviction'}]
    en = evaluate(hn, pn, rules, 30, {'year': {'2308': (100, '2026-01-05', 200)}}, [], 100000)
    check('台股警報標題加中文名稱', en.get('dd:2308', {}).get('title', '').startswith('2308 台達電 從 52 週高點'))
    check('樂透額度跨年歸零', compute_extras(hs, plans, rules, '2027-01-02')['lotto']['leftUsd'] == 500 and ex['lotto']['leftUsd'] == 400)
    check('下次半年檢查', next_review('2026-11-07') == '2026-12-31' and next_review('2027-01-02') == '2027-06-30')
    mk = {'spx': (69.0, '2026-01-05', 100.0), 'vix': (31.0, '2026-01-05'), 'year': {'BBB': (7.4, '2026-01-05', 10.0), 'AAA': (1, '2026-01-05', 10)}}
    st = {}
    p1 = build(hs, plans, rules, 30, '2026-01-06', st, mk, True)
    keys = {a['key'] for a in p1['alerts']}
    check('觸發：大盤第 3 級、VIX、信念股 -26%、天花板、現金底線', keys == {'spx', 'vix', 'dd:BBB', 'cap:BBB', 'floor:usd'}
          and next(a for a in p1['alerts'] if a['key'] == 'spx')['level'] == 3 and all(a['new'] for a in p1['alerts']))
    p2 = build(hs, plans, rules, 30, '2026-01-07', st, mk, True)
    check('休市日沒有新收盤：不重算、不標 new', not any(a['new'] for a in p2['alerts']) and len(p2['alerts']) == 5)
    hs[0]['price_date'] = '2026-01-07'
    mk2 = dict(mk, spx=(85.0, '2026-01-07', 100.0))
    p3 = build(hs, plans, rules, 30, '2026-01-08', st, mk2, True)
    check('同級或降級不再標 new', next(a for a in p3['alerts'] if a['key'] == 'spx')['level'] == 1 and not any(a['new'] for a in p3['alerts']))
    hs[0]['price_date'] = '2026-01-08'
    p4 = build(hs, plans, rules, 30, '2026-01-09', st, dict(mk, spx=(75.0, '2026-01-08', 100.0)), True)
    check('升級到下一級才標 new', [a['key'] for a in p4['alerts'] if a['new']] == ['spx'])
    p5 = build(hs, plans, rules, 30, '2026-01-09', st, None, False)
    check('早晚報（不帶 --alerts）沿用警報、當天的 new 保留', len(p5['alerts']) == 5 and [a['key'] for a in p5['alerts'] if a['new']] == ['spx'])
    p6 = build(hs, plans, rules, 30, '2026-01-10', st, None, False)
    check('隔天沿用就不算 new', len(p6['alerts']) == 5 and not any(a['new'] for a in p6['alerts']))
    check('沒抄到規則檔就沿用上次', build(hs, None, None, 30, '2026-01-09', st) == st['plan'])
    hs.append({'code': 'BBB 2/20/2026 8.00 P', 'occ': 'BBB260220P00008000', 'kind': 'option', 'currency': 'USD', 'shares': -100, 'price': 0.1})
    check('Sell Put 擔保額從美金扣掉', put_collateral_usd(hs) == 800)
    # ---- 已知悉（ack）、遲滯、過渡目標、依 pool 的上限、半年檢查比較 ----
    plans_a = [dict(p) for p in plans]
    plans_a[1]['ack'] = {'cap': '2026-01-06', 'dd': '2026-01-06', 'note': '已掛單'}
    al = apply_ack(p1['alerts'], plans_a)
    ak = {a['key']: a for a in al}
    check('ack：被 ack 的警報標 acked、其他警報不受影響、排到最後',
          ak['cap:BBB'].get('acked') and ak['dd:BBB'].get('acked') and ak['cap:BBB']['ackNote'] == '已掛單'
          and not ak['spx'].get('acked') and [a['key'] for a in al][-2:] == ['cap:BBB', 'dd:BBB'])
    plans_late = [dict(p) for p in plans]
    plans_late[1]['ack'] = {'cap': '2026-01-05'}  # ack 早於這輪觸發開始＝條件消失後再出現，ack 失效
    check('ack：條件消失再出現（since 晚於 ack 日）ack 自動失效', not apply_ack(p1['alerts'], plans_late)[0].get('acked')
          and not any(a.get('acked') for a in apply_ack(p1['alerts'], plans_late)))
    raised = [dict(a, raised='2026-01-08') for a in p1['alerts'] if a['key'] == 'cap:BBB']
    check('ack：級別升高（raised 晚於 ack 日）ack 失效', not apply_ack(raised, plans_a)[0].get('acked'))
    stA = {}
    pa = build(hs, plans_a, rules, 30, '2026-01-06', stA, mk, True)
    check('ack：build 之後 acked 的警報不算 new、仍列在清單裡', sum(1 for a in pa['alerts'] if a.get('acked')) == 2
          and not any(a['new'] for a in pa['alerts'] if a.get('acked')))
    ddr_rules = [r for r in rules if r['kind'] == 'drawdown']
    hs2 = [h for h in hs if h['code'] in ('AAA', 'BBB', 'CASH', 'TWCASH')]
    def dd_keys(close, prev):
        out = evaluate(hs2, plans, rules, 30, {'year': {'BBB': (close, '2026-02-02', 10.0)}}, [], 100000, prev)
        return 'dd:BBB' in out
    check('遲滯：-25% 觸發', dd_keys(7.4, {}))
    check('遲滯：-22% 沒觸發過就不觸發', not dd_keys(7.8, {}))
    check('遲滯：已觸發的 -22% 維持、-19% 才解除', dd_keys(7.8, {'dd:BBB': {}}) and not dd_keys(8.1, {'dd:BBB': {}}))
    ddr_rules[0]['release'] = -0.1
    check('遲滯：rules 的 release 可自訂', dd_keys(8.8, {'dd:BBB': {}}) and not dd_keys(9.1, {'dd:BBB': {}}))
    ddr_rules[0].pop('release')
    # 過渡目標
    rules_i = [dict(r) for r in rules]
    rules_i[1] = dict(rules_i[1], interim={'until': '2026-06-30', 'max': 0.99})
    pi, _ = compute_pools(hs, plans, rules_i, 30, '2026-03-01')
    pj, _ = compute_pools(hs, plans, rules_i, 30, '2026-07-01')
    pc = {p['key']: p for p in pi}['conviction']
    check('過渡期：在過渡上限內不標超出區間，仍記下與原區間的關係', not pc['out'] and pc['outNormal'] and pc['interim']['max'] == 0.99)
    check('過渡期過了就回到原區間', {p['key']: p for p in pj}['conviction']['out'] and 'interim' not in {p['key']: p for p in pj}['conviction'])
    rules_i[1]['interim'] = {'until': '2026-06-30', 'max': 0.5}
    check('過渡期：超過過渡上限仍標超出', {p['key']: p for p in compute_pools(hs, plans, rules_i, 30, '2026-03-01')[0]}['conviction']['out'])
    # 單一信念股上限依 pool
    hp = [{'code': 'AAA', 'currency': 'TWD', 'shares': 100, 'price': 10}, {'code': 'ZZZ', 'currency': 'USD', 'shares': 10, 'price': 100},
          {'code': 'CASH', 'currency': 'USD', 'shares': 1, 'price': 1}]
    rp = [{'key': 'c', 'kind': 'cap', 'each': True, 'pool': 'conviction', 'example_codes': ['BBB'], 'cap': 0.25}]
    ev = evaluate(hp, [{'code': 'ZZZ', 'pool': 'conviction'}, {'code': 'AAA', 'pool': 'broad'}], rp, 30, {}, [], 31000)
    check('上限依 pool：plans.json 新增的信念股自動納入、其他池不算', 'cap:ZZZ' in ev and 'cap:AAA' not in ev)
    # 半年檢查比較
    rv = review_compare([{'key': 'review', 'kind': 'schedule', 'history': [{'date': '2026-06-30', 'conviction': 0.5}, {'date': '2026-12-31', 'conviction': 0.45}]}],
                        [{'key': 'conviction', 'pct': 0.44}])
    check('半年檢查：跟最近一次比，下降才算 down', rv['conviction'] == 0.45 and rv['down'] and not review_compare([{'key': 'review', 'kind': 'schedule', 'history': [{'date': 'x', 'conviction': 0.4}]}], [{'key': 'conviction', 'pct': 0.44}])['down'])
    pe = build(hs, plans, rules, 30, '2026-01-11', {}, mk, True, evaluated_by='早報')
    check('evaluated_by 記下是同步或早報判斷的', pe['evaluatedBy'] == '早報' and pe['highs']['BBB']['high52'] == 10.0)
