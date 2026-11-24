"""投資計畫書 v1（2026-11-06）的四池配置與觸發警報，由 invest_sync.py 呼叫。

讀 OneDrive「投資資料/rules.json」（kind：pool、cap+each、floor、budget、playbook、drawdown、fx、schedule、price_alert、watch）
與「投資資料/plans.json」（每檔的 pool、PLTR 的 sell_plan），算出：
  pools   四池目前比例、目標、偏離、是否超出容許區間（每次跑都算）
  alerts  觸發中的警報（只有 07:30 每日同步帶 --alerts 才重新判斷；其他報告沿用上次結果）
  extras  樂透額度餘額、美金累積、下次季檢討日、PLTR 賣出進度
結果放進 invest.json 與 state.json 的 "plan"；state.json 的 "plan_state" 記每個警報目前的級別，
用來判斷「第一次觸發」或「升級到下一級」（new: true，早報只推播這些）。
一律用收盤價；52 週高點也用收盤高點（忽略單日尖刺，見 invest_sync.yahoo_year）。
已知悉（ack）：plans.json 每檔可加 ack:{"cap"或"dd":"YYYY-MM-DD","note":"…"}。被 ack 的警報照樣列在投資頁（灰色），
但首頁待處理與投資卡的警報數不算它；條件消失後再出現（since 晚於 ack 日）或級別升高（raised 晚於 ack 日），ack 自動失效。
回撤警報有遲滯：跌到 threshold 觸發，回到 release（預設 threshold+5 點）以內才解除。
四池可設過渡目標 interim:{until,max,min}：期限內只要在過渡範圍內就不標超出區間。休市日沒有新收盤就不重算、不標 new。
價格提醒 price_alert（2026-11-19 補）：codes 的最新收盤達 trigger_price（direction 預設 above）就列入警報；until 之後不顯示；
  有 occ 的規則在持股檔找不到那一檔選擇權（已平倉或到期）就不顯示；checkpoint（YYYY-MM-DD）當天與前一天另列一條「檢查點」提醒。
觀察 watch（2026-11-19 補）：只提醒、不下單。codes 的目前沒有賣出中的 Cover Call，而且「當天反彈（漲 ≥1%）或連漲 ≥2 天、
  靠近月線／季線／近 60 日前高（3% 內）、IV Rank ≥ 50」任一成立、又沒有「大跌（當天 ≤ -3%）或恐慌殺盤（VIX ≥ 30 且當天下跌）」才列入警報。
  月線＝20 日均線、季線＝60 日均線；日線來自 fetch_market 的 market['bars']，沒有就只用持股檔的現價與前收判斷、並註明缺哪些資料；
  IV Rank 沒有資料來源（market['iv_rank'] 有才用），沒有就寫「IV Rank 查不到」，不猜。
  警報內容固定有：代號、現價、當天漲跌、IV Rank、規則 spec 裡講到履約價或到期的句子（目標履約價與到期日）。
  規則的 requires 以「無」開頭＝沒有前提；其他文字程式無法判斷，原文附在內容裡請 Sam 自己確認。
  requires 或 spec 提到「買回」（例如 PLTR 12/18 210C 還沒平倉）時，就算已經有賣出中的 Call 也照樣提醒，並註明須先買回那一張。
暫停 pause（2026-11-20 補）：start～end 之間算進 invest.json 的 plan['pause']，投資頁頂端顯示一行「暫停中」與 pause 清單第一點。
"""
import calendar
from datetime import date, timedelta

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


def next_review(today, months=(1, 4, 7, 10)):
    """季檢討日：每年 1、4、7、10 月的第一個週日（2026-11-24 Sam 定，取代原本 6、12 月底的半年檢查）。"""
    y = int(today[:4])
    for yy in (y, y + 1):
        for mm in sorted(months):
            first = date(yy, mm, 1)
            d = (first + timedelta(days=(6 - first.weekday()) % 7)).isoformat()
            if d >= today:
                return d
    return None


def review_compare(rules, pools):
    """季檢討的信念池比例要比上次低：rules.json 的 schedule/review 有 history:[{date,conviction}] 就比較。"""
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
    ex['nextReview'] = next_review(today, tuple(sch.get('months', (1, 4, 7, 10))) if sch else (1, 4, 7, 10))
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


REBOUND, NEAR, AVOID_DROP, VIX_PANIC, IVR_MIN = 0.01, 0.03, -0.03, 30, 50


def _stock(holdings, code):
    return next((h for h in holdings if h.get('code') == code and h.get('kind') != 'option' and code not in CASH_CODES), None)


def _short_call_on(holdings, code):
    """持股檔裡這檔股票已經有賣出中的 Call（occ 的第 11 個字元是 C、股數為負）。"""
    for h in holdings:
        occ = h.get('occ') or ''
        if h.get('kind') == 'option' and h.get('shares', 0) < 0 and len(occ) > 15 and occ[-9] == 'C' and occ[:-15] == code:
            return True
    return False


def _short_calls_on(holdings, code):
    """持股檔裡這檔股票賣出中的 Call 合約名稱（例如「PLTR 12/18/2026 210.00 C」）。"""
    out = []
    for h in holdings:
        occ = h.get('occ') or ''
        if h.get('kind') == 'option' and h.get('shares', 0) < 0 and len(occ) > 15 and occ[-9] == 'C' and occ[:-15] == code:
            out.append(h.get('code') or occ)
    return out


def _spec_targets(spec):
    """spec 裡講到履約價或到期日的句子（用「；」分段）；都沒有就回傳整段 spec。"""
    segs = [x.strip() for x in (spec or '').replace(';', '；').split('；') if x.strip()]
    pick = [x for x in segs if '履約價' in x or '到期' in x]
    return '；'.join(pick or segs)


def pause_status(rules, today):
    """rules.json 的 pause：今天落在 start～end 之間的第一條（active 不是 false）。回傳 None 或 {label,start,end,resume,first,items}。"""
    for r in rules or []:
        if r.get('kind') != 'pause' or r.get('active') is False:
            continue
        if r.get('start') and today < r['start']:
            continue
        if r.get('end') and today > r['end']:
            continue
        items = [x for x in (r.get('pause') or []) if x]
        return {'label': r.get('label') or '暫停新增投資', 'start': r.get('start'), 'end': r.get('end'), 'resume': r.get('resume'),
                'first': items[0] if items else '', 'items': items}
    return None


def _fmt_md(d):
    return f'{d.month}/{d.day}'


def price_alerts(holdings, rules, today):
    """rules.json 的 price_alert：最新收盤達提醒價，以及 checkpoint 當天與前一天的檢查點。回傳 {key: alert}。"""
    out = {}
    td = date.fromisoformat(today)
    for r in rules or []:
        if r.get('kind') != 'price_alert' or r.get('active') is False:
            continue
        if r.get('until') and today > r['until']:
            continue
        occ = r.get('occ')
        if occ and not any(h.get('occ') == occ for h in holdings):
            continue  # 對應的選擇權已經平倉或到期，不再提醒
        key, label = r.get('key') or 'price_alert', r.get('label') or r.get('key') or '價格提醒'
        action = r.get('action') or ''
        trig = r.get('trigger_price')
        below = r.get('direction') == 'below'
        for code in r.get('codes') or []:
            h = _stock(holdings, code)
            price = h.get('price') if h else None
            if price is None or trig is None:
                continue
            if (price <= trig) if below else (price >= trig):
                out[f'pa:{key}:{code}'] = {'level': 1, 'lvl': 'warn', 'date': h.get('price_date'),
                                           'title': f"{code} 收 ${price:,.2f}，{'跌到' if below else '達'} ${trig:g} 提醒線（{label}）", 'meta': action}
        cp = r.get('checkpoint')
        if cp:
            cd = date.fromisoformat(cp)
            if 0 <= (cd - td).days <= 1:
                segs = [x.strip() for x in action.replace(';', '；').split('；') if x.strip()]
                text = next((x for x in segs if '檢查點' in x), segs[-1] if segs else '')
                out[f'pc:{key}'] = {'level': 1, 'lvl': 'warn', 'title': f"{label}：{_fmt_md(cd)} 檢查點（{'今天' if cd == td else '明天'}）", 'meta': text or '今天要決定'}
    return out


def _bars_stats(bars):
    """日線 [(日期, 收盤)] → 連漲天數、20 日與 60 日均線、近 60 日最高收盤；資料不夠的項目回傳 None。"""
    closes = [c for _, c in bars or []]
    st = {'streak': None, 'ma20': None, 'ma60': None, 'hi60': None}
    if len(closes) >= 2:
        n = 0
        for i in range(len(closes) - 1, 0, -1):
            if closes[i] > closes[i - 1]:
                n += 1
            else:
                break
        st['streak'] = n
    if len(closes) >= 20:
        st['ma20'] = sum(closes[-20:]) / 20
    if len(closes) >= 60:
        st['ma60'] = sum(closes[-60:]) / 60
        st['hi60'] = max(closes[-60:])
    return st


def watch_alerts(holdings, rules, market, today):
    """rules.json 的 watch（重賣 Cover Call 觀察）：只提醒、不下單。條件見檔頭說明。"""
    out = {}
    market = market or {}
    vix = (market.get('vix') or (None,))[0]
    for r in rules or []:
        if r.get('kind') != 'watch' or r.get('active') is False:
            continue
        if r.get('until') and today > r['until']:
            continue
        req = str(r.get('requires') or '').strip()
        must_close = '買回' in req or '買回' in str(r.get('spec') or '')
        for code in r.get('codes') or []:
            open_calls = _short_calls_on(holdings, code)
            if open_calls and not must_close:
                continue  # 已經有 Cover Call，不用再提醒
            h = _stock(holdings, code)
            bars = (market.get('bars') or {}).get(code)
            if bars and len(bars) >= 2:
                close, prev = bars[-1][1], bars[-2][1]
            elif h and h.get('price') and h.get('prev_price'):
                close, prev = h['price'], h['prev_price']
            else:
                continue
            day = close / prev - 1
            if day <= AVOID_DROP or (vix is not None and vix >= VIX_PANIC and day < 0):
                continue  # 剛大跌或恐慌殺盤當天不賣
            st = _bars_stats(bars)
            ivr = (market.get('iv_rank') or {}).get(code)
            hit, notes = [], []
            if day >= REBOUND:
                hit.append(f'當天反彈 +{day * 100:.1f}%')
            if st['streak'] is not None and st['streak'] >= 2:
                hit.append(f"連漲 {st['streak']} 天")
            for name, v in (('月線', st['ma20']), ('季線', st['ma60'])):
                if v and abs(close / v - 1) <= NEAR:
                    hit.append(f'靠近{name}（${v:,.2f}，差 {(close / v - 1) * 100:+.1f}%）')
            if st['hi60'] and close >= st['hi60'] * (1 - NEAR):
                hit.append(f"靠近近 60 日前高（${st['hi60']:,.2f}）")
            if ivr is not None and ivr >= IVR_MIN:
                hit.append(f'IV Rank {ivr:.0f}（≥{IVR_MIN}）')
            if not hit:
                continue
            notes.append(f'IV Rank {ivr:.0f}' if ivr is not None else 'IV Rank 查不到')
            if open_calls:
                notes.append(f"100 股已被 {'、'.join(open_calls)} 擔保，要先買回才能賣新的 Call，不可同時持有兩張（避免裸賣）")
            if req and not req.startswith('無'):
                notes.append(f'前提：{req}（程式無法判斷，請自行確認）')
            if not bars:
                notes.append('日線抓不到：連漲、月線、季線、前高沒有判斷，只用當天漲跌')
            elif st['ma60'] is None:
                notes.append('日線不足 60 根：季線與前高沒有判斷')
            facts = f"現價 ${close:,.2f}（當天 {day * 100:+.1f}%）"
            out[f"wt:{r.get('key') or 'watch'}:{code}"] = {
                'level': 1, 'lvl': 'warn', 'date': (bars[-1][0] if bars else h.get('price_date') if h else None),
                'title': f"{code} 可以考慮重賣 Cover Call（{'、'.join(hit)}）",
                'meta': '；'.join([x for x in [f"{facts}；{notes[0]}", '目標：' + _spec_targets(r.get('spec') or '賣 1 口 Cover Call（以 100 股擔保）'),
                                    '只提醒、不下單，由 Sam 決定'] + notes[1:] if x])}
    return out


def evaluate(holdings, plans, rules, fx, market, pools, total, prev_state=None, today=None):
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
    if today:
        out.update(price_alerts(holdings, rules, today))
        out.update(watch_alerts(holdings, rules, market, today))
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
    plan['pause'] = pause_status(rules, today)
    if evaluate_alerts and market is not None:
        asof = {'spx': (market.get('spx') or (None, None))[1],
                'tw': max([h.get('price_date') or '' for h in holdings if h.get('currency') == 'TWD' and h['code'] not in CASH_CODES] or ['']),
                'us': max([h.get('price_date') or '' for h in holdings if h.get('currency') == 'USD' and h['code'] not in CASH_CODES] or ['']),
                'day': today}  # 加日期：檢查點這類「看日期」的提醒，休市日也要每天重算（key 沒變就不標 new）
        plan['evaluated'] = today
        plan['evaluatedBy'] = evaluated_by or prev.get('evaluatedBy')
        if asof != prev.get('dataAsOf'):  # 有新收盤才重算；休市日沿用、不標 new
            cur = evaluate(holdings, plans, rules, fx, market, pools, total, state.get('plan_state'), today)
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
    check('下次季檢討（1、4、7、10 月第一個週日）', next_review('2026-11-07') == '2027-01-03' and next_review('2027-01-03') == '2027-01-03' and next_review('2027-01-04') == '2027-04-04' and next_review('2027-10-10') == '2028-01-02')
    check('季檢討：舊 rules.json 的 months [6,12] 仍可算（第一個週日）', next_review('2026-11-07', (6, 12)) == '2026-12-06')
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
    # ---- 已知悉（ack）、遲滯、過渡目標、依 pool 的上限、季檢討比較 ----
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
    # 季檢討比較
    rv = review_compare([{'key': 'review', 'kind': 'schedule', 'history': [{'date': '2026-06-30', 'conviction': 0.5}, {'date': '2026-12-31', 'conviction': 0.45}]}],
                        [{'key': 'conviction', 'pct': 0.44}])
    check('季檢討：跟最近一次比，下降才算 down', rv['conviction'] == 0.45 and rv['down'] and not review_compare([{'key': 'review', 'kind': 'schedule', 'history': [{'date': 'x', 'conviction': 0.4}]}], [{'key': 'conviction', 'pct': 0.44}])['down'])
    pe = build(hs, plans, rules, 30, '2026-01-11', {}, mk, True, evaluated_by='早報')
    check('evaluated_by 記下是同步或早報判斷的', pe['evaluatedBy'] == '早報' and pe['highs']['BBB']['high52'] == 10.0)
    # ---- 價格提醒 price_alert 與觀察 watch（2026-11-19；全部是假代號、假價格）----
    hw = [{'code': 'XXX', 'currency': 'USD', 'shares': 100, 'price': 205.0, 'prev_price': 198.0, 'price_date': '2026-11-18'},
          {'code': 'XXX 12/18/2026 210.00 C', 'occ': 'XXX261218C00210000', 'kind': 'option', 'currency': 'USD', 'shares': -100, 'price': 3},
          {'code': 'YYY', 'currency': 'USD', 'shares': 100, 'price': 100.0, 'prev_price': 99.0, 'price_date': '2026-11-18'},
          {'code': 'CASH', 'currency': 'USD', 'shares': 10, 'price': 1}]
    rpa = {'key': 'xxx_watch', 'kind': 'price_alert', 'label': 'XXX 12/18 $210 Call 追蹤', 'codes': ['XXX'], 'occ': 'XXX261218C00210000',
           'direction': 'above', 'trigger_price': 200, 'until': '2026-12-18', 'checkpoint': '2026-11-25',
           'action': 'XXX ≥ $200：評估 Roll up & out；11/25 最後檢查點：決定續抱、買回或 Roll'}
    pa1 = price_alerts(hw, [rpa], '2026-11-19')
    check('price_alert：最新收盤達提醒價就列入警報（標題有收盤價、meta 是規則的 action）',
          list(pa1) == ['pa:xxx_watch:XXX'] and '205.00' in pa1['pa:xxx_watch:XXX']['title'] and pa1['pa:xxx_watch:XXX']['meta'] == rpa['action'])
    hw_low = [dict(h, price=190.0) if h['code'] == 'XXX' else h for h in hw]
    check('price_alert：沒到提醒價不提醒', price_alerts(hw_low, [rpa], '2026-11-19') == {})
    check('price_alert：direction below 是跌到提醒價以下', list(price_alerts(hw_low, [dict(rpa, direction='below', trigger_price=195)], '2026-11-19')) == ['pa:xxx_watch:XXX'])
    check('price_alert：checkpoint 只在當天與前一天出現（含「明天」「今天」字樣）',
          'pc:xxx_watch' not in price_alerts(hw_low, [rpa], '2026-11-23') and '明天' in price_alerts(hw_low, [rpa], '2026-11-24')['pc:xxx_watch']['title']
          and '今天' in price_alerts(hw_low, [rpa], '2026-11-25')['pc:xxx_watch']['title'] and 'pc:xxx_watch' not in price_alerts(hw_low, [rpa], '2026-11-26')
          and '決定續抱、買回或 Roll' in price_alerts(hw_low, [rpa], '2026-11-25')['pc:xxx_watch']['meta'])
    check('price_alert：過了 until、active=false、對應的選擇權已平倉都不顯示',
          price_alerts(hw, [dict(rpa, until='2026-11-18')], '2026-11-19') == {} and price_alerts(hw, [dict(rpa, active=False)], '2026-11-19') == {}
          and price_alerts([h for h in hw if h.get('kind') != 'option'], [rpa], '2026-11-19') == {})
    rw = {'key': 'wt', 'kind': 'watch', 'codes': ['YYY'], 'spec': '賣 1 口 Cover Call（以 100 股擔保）'}
    w1 = watch_alerts(hw, [rw], {}, '2026-11-19')
    check('watch：當天漲 ≥1% 就列入；沒有日線時註明缺什麼、IV Rank 查不到、只提醒不下單',
          list(w1) == ['wt:wt:YYY'] and '當天反彈' in w1['wt:wt:YYY']['title'] and 'IV Rank 查不到' in w1['wt:wt:YYY']['meta']
          and '日線抓不到' in w1['wt:wt:YYY']['meta'] and '只提醒、不下單' in w1['wt:wt:YYY']['meta'])
    check('watch：已經有賣出中的 Cover Call 就不提醒（XXX 有 12/18 Call）', watch_alerts(hw, [dict(rw, codes=['XXX'])], {}, '2026-11-19') == {})
    hw_drop = [dict(h, price=96.0) if h['code'] == 'YYY' else h for h in hw]
    check('watch：當天大跌（-4%）是 avoid，不提醒', watch_alerts(hw_drop, [rw], {}, '2026-11-19') == {})
    hw_dn = [dict(h, price=98.5) if h['code'] == 'YYY' else h for h in hw]
    check('watch：VIX ≥ 30 且當天下跌是恐慌殺盤，不提醒；VIX 低就沒有 avoid（但這天下跌、沒條件成立也不提醒）',
          watch_alerts(hw_dn, [rw], {'vix': (31.0, 'd')}, '2026-11-19') == {} and watch_alerts(hw_dn, [rw], {}, '2026-11-19') == {})
    flat = [('d%02d' % i, 100.0) for i in range(68)] + [('d68', 100.2), ('d69', 100.4)]
    hw_f = [dict(h, price=100.4, prev_price=100.2) if h['code'] == 'YYY' else h for h in hw]
    wf = watch_alerts(hw_f, [rw], {'bars': {'YYY': flat}}, '2026-11-19')['wt:wt:YYY']
    check('watch：用日線算連漲 2 天、靠近月線與季線與近 60 日前高', '連漲 2 天' in wf['title'] and '靠近月線' in wf['title'] and '靠近季線' in wf['title'] and '靠近近 60 日前高' in wf['title']
          and '日線抓不到' not in wf['meta'])
    falling = [('d%02d' % i, 100.0 * 0.995 ** i) for i in range(70)]
    hw_fall = [dict(h, price=falling[-1][1], prev_price=falling[-2][1]) if h['code'] == 'YYY' else h for h in hw]
    check('watch：一路下跌、離月線季線前高都遠、沒有 IV Rank，就沒有條件成立', watch_alerts(hw_fall, [rw], {'bars': {'YYY': falling}}, '2026-11-19') == {})
    wi = watch_alerts(hw_fall, [rw], {'bars': {'YYY': falling}, 'iv_rank': {'YYY': 62}}, '2026-11-19')['wt:wt:YYY']
    check('watch：有 IV Rank ≥ 50 就成立，且不再寫「IV Rank 查不到」', 'IV Rank 62' in wi['title'] and 'IV Rank 查不到' not in wi['meta'])
    check('watch：active=false 不提醒', watch_alerts(hw, [dict(rw, active=False)], {}, '2026-11-19') == {})
    rules_pw = [rpa, rw]
    mk0 = {'spx': (100.0, '2026-11-18', 100.0)}
    stw = {}
    bw = build(hw, [], rules_pw, 30, '2026-11-19', stw, mk0, True)
    check('build：price_alert 與 watch 進 plan.alerts、第一次觸發標 new', {a['key'] for a in bw['alerts']} == {'pa:xxx_watch:XXX', 'wt:wt:YYY'} and all(a['new'] for a in bw['alerts']))
    bw2 = build(hw, [], rules_pw, 30, '2026-11-20', stw, mk0, True)
    check('build：隔天（市場資料沒變）照樣重算、不重複標 new', {a['key'] for a in bw2['alerts']} == {'pa:xxx_watch:XXX', 'wt:wt:YYY'} and not any(a['new'] for a in bw2['alerts']))
    bw3 = build(hw, [], rules_pw, 30, '2026-11-24', stw, mk0, True)
    check('build：檢查點前一天（市場資料沒變）也會出現、標 new', 'pc:xxx_watch' in {a['key'] for a in bw3['alerts']} and next(a for a in bw3['alerts'] if a['key'] == 'pc:xxx_watch')['new'])
    check('evaluate 沒帶 today 不判斷 price_alert 與 watch（相容舊呼叫）', not any(k[:3] in ('pa:', 'pc:', 'wt:') for k in evaluate(hw, [], rules_pw, 30, mk0, [], 100000)))
    # ---- 2026-11-20：watch 內容固定有現價、漲跌、IV Rank、目標；210C 須先買回；pause ----
    hq = [{'code': 'PPP', 'currency': 'USD', 'shares': 160, 'price': 155.0, 'prev_price': 150.0, 'price_date': '2026-11-19'},
          {'code': 'PPP 12/18/2026 210.00 C', 'occ': 'PPP261218C00210000', 'kind': 'option', 'currency': 'USD', 'shares': -100, 'price': 0.8}]
    rq = {'key': 'ppp_resell', 'kind': 'watch', 'codes': ['PPP'], 'requires': '無（現在就開始追蹤）；有 210C 要先買回',
          'spec': '賣 1 口 Cover Call：到期 30～45 天、delta 0.15～0.25；履約價不低於 $180；依 playbook timing'}
    wq = watch_alerts(hq, [rq], {}, '2026-11-20')
    a = wq.get('wt:ppp_resell:PPP', {})
    check('watch：meta 有現價與當天漲跌、IV Rank 查不到、目標（履約價與到期）句子',
          '現價 $155.00（當天 +3.3%）' in a.get('meta', '') and 'IV Rank 查不到' in a.get('meta', '') and '履約價不低於 $180' in a.get('meta', '')
          and '到期 30～45 天' in a.get('meta', '') and 'playbook timing' not in a.get('meta', ''))
    check('watch：規則提到買回、還有賣出中的 210C 時照樣提醒並註明要先買回（不裸賣）',
          '要先買回' in a.get('meta', '') and 'PPP 12/18/2026 210.00 C' in a.get('meta', ''))
    check('watch：requires 以「無」開頭＝沒有前提，不附前提說明', '前提：' not in a.get('meta', ''))
    rr2 = dict(rq, requires='NVDA 財報後才賣', spec='賣 1 口 Cover Call')
    check('watch：requires 有別的前提文字時原文附上、註明程式無法判斷', '前提：NVDA 財報後才賣' in watch_alerts([hq[0]], [rr2], {}, '2026-11-20')['wt:ppp_resell:PPP']['meta'])
    rn = dict(rq, requires='', spec='賣 1 口 Cover Call')
    check('watch：沒提到買回的規則，已有賣出中的 Call 就不提醒', watch_alerts(hq, [rn], {}, '2026-11-20') == {})
    wi2 = watch_alerts([hq[0]], [rn], {'iv_rank': {'PPP': 61}}, '2026-11-20')['wt:ppp_resell:PPP']
    check('watch：有 IV Rank 資料就寫數字、也算條件成立', 'IV Rank 61' in wi2['meta'] and 'IV Rank 61（≥50）' in wi2['title'])
    rp = {'key': 'hp', 'kind': 'pause', 'label': '旅遊月暫停', 'start': '2026-11-11', 'end': '2026-12-31', 'resume': '2027-01-01', 'pause': ['不新增波段倉', '不賣 Put']}
    ps = pause_status([rp], '2026-11-20')
    check('pause：期間內回傳標題、結束日、恢復日、第一點', ps and ps['label'] == '旅遊月暫停' and ps['end'] == '2026-12-31' and ps['resume'] == '2027-01-01' and ps['first'] == '不新增波段倉')
    check('pause：還沒開始、已經結束、active=false 都不顯示',
          pause_status([rp], '2026-11-10') is None and pause_status([rp], '2027-01-01') is None and pause_status([dict(rp, active=False)], '2026-11-20') is None)
    st9 = {}
    pb = build(hq, [], [rp], 30, '2026-11-20', st9)
    check('pause：進 plan，早晚報與首頁讀 invest.json 的 plan.pause', pb['pause']['first'] == '不新增波段倉')

