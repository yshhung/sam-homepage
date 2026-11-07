"""早報、晚報、週回顧寫給投資頁「市場」分頁的資料（由雲端排程執行）。

改自舊的 dash_sync.py：每份報告只寫自己的檔，放在 OneDrive「投資資料/市場/<報別>/」，
不用先讀舊檔再合併（投資頁讀的時候才合併，見 js/invest/data.js 的 mergeMarket）。

用法：python3 tools/report_sync.py <報別> <data.json> <輸出資料夾>
  報別：早報、晚報、週回顧
  data.json：報告整理好的中間資料（區塊格式跟舊的早報、晚報一樣：invest、news_fin、summary_invest）
  輸出：<輸出資料夾>/mk_tiles.json、mk_notes.json、fin_news.json、inv_brief.json，有 Cover Call 表才有 cc_ref.json；
        早報、晚報另外寫 news_<星期幾 1～7>.json（財經＋生活新聞），給首頁的「新聞」區；
        每週同一天會蓋掉上週那天的檔，所以首頁永遠有最近 7 天的新聞，不用另外刪；
        data.json 有 news_digest（各類別一段摘要，類別與順序由報告指示決定）時另外寫 news_digest.json，首頁顯示最新一份，
        摘要裡的連結只留本報新聞列過的網址（AI 自己生出來的網址會變成純文字）
        最後一行印出 BYTES {檔名: 位元組數}
"""
import datetime
import json
import os
import re
import sys

TZ = datetime.timezone(datetime.timedelta(hours=8))  # 台北沒有夏令時間


def blocks(arr, *types):
    return [b for b in (arr or []) if isinstance(b, dict) and b.get('t') in types]


def uniq(rows, key):
    seen, out = set(), []
    for r in rows:
        k = r.get(key)
        base, n = k, 2
        while k in seen:
            k = f'{base}（{n}）'
            n += 1
        r[key] = k
        seen.add(k)
        out.append(r)
    return out


def text_items(b):
    out = []
    for it in b.get('items') or []:
        if isinstance(it, dict):
            out.append((it.get('h') or '', it.get('p') or ''))
        else:
            out.append(('', str(it)))
    return out


DIGEST_MAX_CATS = 8   # 最多幾個類別
DIGEST_CAT_LEN = 8    # 類別名稱最長幾個字
DIGEST_TAG_LEN = 12   # 小標籤最長幾個字
LINK = re.compile(r'\[([^\]\n]+)\]\(([^)\s]+)\)')


def norm_url(u):
    return re.sub(r'[?#].*$', '', str(u or '')).rstrip('/')


def digest(data, urls):
    """news_digest → [{cat, text, more?, tag?}]。
    類別名稱與順序由報告指示決定（照 data.json 裡出現的順序，不認識的名稱也留；最多 8 類、名稱最長 8 字）。
    text 一定顯示；more 是首頁預設收起來的「更多」；tag 是額外的小標籤（最長 12 字，例如「持股」「長照」）。
    同一類寫多筆就合併成一段。空的不留，連結只留新聞列過的網址。"""
    ok = {norm_url(u) for u in urls}
    def fix(m):
        text, url = m.group(1), m.group(2)
        return m.group(0) if url.startswith(('https://', 'http://')) and norm_url(url) in ok else text
    def clean(v):
        return LINK.sub(fix, str(v or '').strip())
    cats, by = [], {}
    for it in data.get('news_digest') or []:
        if not isinstance(it, dict):
            continue
        cat = str(it.get('cat') or '').strip()[:DIGEST_CAT_LEN]
        text = clean(it.get('text'))
        if not cat or not text:
            continue
        if cat not in by:
            if len(cats) >= DIGEST_MAX_CATS:
                continue
            cats.append(cat)
            by[cat] = {'text': [], 'more': [], 'tag': ''}
        by[cat]['text'].append(text)
        more = clean(it.get('more'))
        if more:
            by[cat]['more'].append(more)
        tag = str(it.get('tag') or '').strip()[:DIGEST_TAG_LEN]
        if tag and not by[cat]['tag']:
            by[cat]['tag'] = tag
    out = []
    for c in cats:
        row = {'cat': c, 'text': '\n'.join(by[c]['text'])}
        if by[c]['more']:
            row['more'] = '\n'.join(by[c]['more'])
        if by[c]['tag']:
            row['tag'] = by[c]['tag']
        out.append(row)
    return out


def convert(slot, data, now):
    """data.json → 這份報告的市場資料（純函式，--selftest 測這裡）"""
    at = now.strftime('%Y-%m-%dT%H:%M:%S+08:00')
    tag = {'by': slot, 'at': at}
    tiles, notes, cc = [], [], None
    nf = list(data.get('news_fin') or [])
    for b in data.get('invest') or []:
        if not isinstance(b, dict):
            continue
        t, title = b.get('t'), b.get('title') or ''
        if t == 'market':
            for x in b.get('tiles') or []:
                tiles.append({'group': title, 'name': x.get('name', ''), 'value': x.get('value'), 'pct': x.get('pct'),
                              'chip': x.get('chip'), 'tone': x.get('tone'), 'd': x.get('d'), 'sub': None, **tag})
            if b.get('summary'):
                notes.append({'section': title, 'lvl': None, 'h': '', 'p': b['summary'], **tag})
        elif t == 'vix':
            tiles.append({'group': '美股收盤', 'name': 'VIX', 'value': b.get('value'), 'pct': b.get('pct'), 'chip': None,
                          'tone': None, 'd': 2, 'sub': None, **tag})
        elif t == 'rows':
            for x in b.get('rows') or []:
                tiles.append({'group': title, 'name': x.get('name', ''), 'value': x.get('value'), 'pct': x.get('pct'),
                              'chip': x.get('chip'), 'tone': x.get('tone'), 'd': x.get('d'), 'sub': x.get('sub'), **tag})
            if b.get('summary'):
                notes.append({'section': title, 'lvl': None, 'h': '', 'p': b['summary'], **tag})
        elif t == 'watch':
            for it in b.get('items') or []:
                notes.append({'section': title or '今日觀察', 'lvl': it.get('lvl'), 'h': '', 'p': it.get('text', ''), **tag})
        elif t == 'text':
            for h, p in text_items(b):
                notes.append({'section': title, 'lvl': None, 'h': h, 'p': p, **tag})
        elif t == 'kv':
            if 'Cover Call' in title:
                cc = []
                for r in b.get('rows') or []:
                    r = list(r) + [''] * 7
                    cc.append({'code': r[0], 'iv': r[1], 'wk': r[2], 'mo': r[3], 'p5': r[4], 'p10': r[5], 'note': r[6], **tag})
                if b.get('note'):
                    notes.append({'section': 'Cover Call 參考', 'lvl': None, 'h': '', 'p': b['note'], **tag})
            else:
                for r in b.get('rows') or []:
                    cells = [str(c) for c in r]
                    notes.append({'section': title, 'lvl': None, 'h': cells[0] if cells else '', 'p': '｜'.join(cells[1:]), **tag})
                if b.get('note'):
                    notes.append({'section': title, 'lvl': None, 'h': '', 'p': b['note'], **tag})
        elif t == 'news':
            nf.append(b)
    seen, rows = set(), []
    for r in tiles:
        k = (r['group'], r['name'])
        if k not in seen:
            seen.add(k)
            rows.append(r)
    for i, r in enumerate(notes):
        r['id'] = f"{slot}-{r.get('section', '')}-{i + 1}"
    news = [{'title': it.get('title', ''), 'src': it.get('src', ''), 'url': it.get('url'), 'rel': it.get('rel', ''), **tag}
            for b in blocks(nf, 'news') for it in (b.get('items') or [])]
    # 首頁新聞：財經（news_fin）＋生活（news_life），只留有網址的
    home = [{'title': it.get('title', ''), 'src': it.get('src', ''), 'url': it.get('url'), 'rel': it.get('rel', ''), 'cat': cat, **tag}
            for cat, arr in (('財經', nf), ('生活', data.get('news_life')))
            for b in blocks(arr, 'news') for it in (b.get('items') or [])
            if isinstance(it, dict) and str(it.get('url') or '').startswith(('https://', 'http://'))]
    si = (data.get('summary_invest') or '').strip()
    out = {
        'mk_tiles.json': rows,
        'mk_notes.json': notes,
        'fin_news.json': uniq(news, 'title'),
        'inv_brief.json': [{'date': now.strftime('%Y-%m-%d'), 'slot': slot, 'at': at, 'text': si}] if si else [],
    }
    if cc is not None:
        out['cc_ref.json'] = uniq(cc, 'code')
    if slot in ('早報', '晚報'):
        out[f'news_{now.isoweekday()}.json'] = home
        dg = digest(data, [r['url'] for r in home])
        if dg:  # 沒寫摘要（例如週日晚報）就不寫檔，首頁繼續顯示上一份
            out['news_digest.json'] = {'by': slot, 'at': at, 'items': dg}
    return out


def main():
    slot, data_path, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(data_path, encoding='utf-8') as f:
        data = json.load(f)
    files = convert(slot, data, datetime.datetime.now(TZ))
    os.makedirs(out_dir, exist_ok=True)
    sizes = {}
    for name, rows in files.items():
        p = os.path.join(out_dir, name)
        with open(p, 'w', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(rows, ensure_ascii=False, indent=1))
        sizes[name] = os.path.getsize(p)
    print('BYTES ' + json.dumps(sizes, ensure_ascii=False))


def selftest():
    now = datetime.datetime(2026, 1, 5, 8, 50, tzinfo=TZ)
    data = {
        'summary_invest': '假的重點',
        'news_fin': [{'t': 'news', 'title': '財經新聞', 'items': [{'title': 'A', 'src': 'S', 'url': 'https://example.test/a', 'rel': 'r'}, {'title': 'A', 'src': 'S2'}]}],
        'news_life': [{'t': 'news', 'title': '生活新聞', 'items': [{'title': 'L', 'src': 'S3', 'url': 'https://example.test/l'}, {'title': 'X', 'url': 'javascript:alert(1)'}]}],
        'news_digest': [
            {'cat': '生活', 'text': '假生活摘要[L](https://example.test/l/)。'},
            {'cat': '台股', 'text': '假台股摘要[A](https://example.test/a?x=1)，[編的](https://example.test/fake)，[壞](javascript:alert)。'},
            {'cat': '長照', 'text': '長照一句。', 'more': '長照更多[A](https://example.test/a)。', 'tag': '日照'},
            {'cat': '長照', 'text': '長照第二筆。', 'tag': '被忽略'},
            {'cat': '美股', 'text': '  '}, {'cat': '', 'text': '沒類別'}, {'cat': '很長很長很長很長很長的類別', 'text': '名稱會被截短'},
        ],
        'invest': [
            {'t': 'watch', 'title': '今日觀察', 'items': [{'lvl': 'look', 'text': '假觀察'}]},
            {'t': 'market', 'title': '美股收盤', 'tiles': [{'name': 'X 指數', 'value': 100, 'pct': 1.0}], 'summary': '一句話'},
            {'t': 'vix', 'value': 15, 'pct': -2},
            {'t': 'rows', 'title': '台股盤前', 'rows': [{'name': 'Y', 'value': None, 'sub': '休市'}]},
            {'t': 'kv', 'title': 'Cover Call 參考', 'rows': [['ZZZ', '30%', '1/9', '1/16', '105', '110', '備註']], 'note': '說明'},
        ],
    }
    out = convert('早報', data, now)
    ok = True
    def check(name, cond):
        nonlocal ok
        ok &= bool(cond)
        print(('✓ ' if cond else '✗ ') + name)
    check('指數磚含 VIX', [r['name'] for r in out['mk_tiles.json']] == ['X 指數', 'VIX', 'Y'])
    check('筆記含觀察與一句話、有 id', len(out['mk_notes.json']) == 3 and all(r['id'].startswith('早報-') for r in out['mk_notes.json']))
    check('新聞同標題自動加編號', [r['title'] for r in out['fin_news.json']] == ['A', 'A（2）'])
    check('30 秒重點一筆', out['inv_brief.json'][0]['text'] == '假的重點' and out['inv_brief.json'][0]['slot'] == '早報')
    check('Cover Call 表', out['cc_ref.json'][0]['code'] == 'ZZZ' and out['cc_ref.json'][0]['p10'] == '110')
    check('每列都標報別與時間', all(r['by'] == '早報' and r['at'].startswith('2026-01-05T08:50') for r in out['mk_tiles.json']))
    hn = out.get('news_1.json')  # 2026-01-05 是週一
    check('首頁新聞檔：財經＋生活、只留 http 網址', hn is not None and [(r['cat'], r['title']) for r in hn] == [('財經', 'A'), ('生活', 'L')])
    dg = out.get('news_digest.json')
    check('摘要：類別照檔案裡的順序、去掉空的與沒類別的、名稱截短', dg and dg['by'] == '早報' and [r['cat'] for r in dg['items']] == ['生活', '台股', '長照', '很長很長很長很長'])
    check('摘要：只留新聞列過的網址', dg and dg['items'][1]['text'] == '假台股摘要[A](https://example.test/a?x=1)，編的，壞。'
          and '[L](https://example.test/l/)' in dg['items'][0]['text'])
    cl = next((r for r in (dg or {}).get('items', []) if r['cat'] == '長照'), {})
    check('摘要：同類合併、more 與 tag 帶出來（tag 取第一個）', cl.get('text') == '長照一句。\n長照第二筆。' and cl.get('more') == '長照更多[A](https://example.test/a)。' and cl.get('tag') == '日照')
    check('摘要：沒有 more、tag 的類別不寫這兩欄', dg and 'more' not in dg['items'][0] and 'tag' not in dg['items'][0])
    many = convert('早報', {**data, 'news_digest': [{'cat': f'類{i}', 'text': 'x'} for i in range(12)]}, now)['news_digest.json']['items']
    check('摘要：最多 8 類', len(many) == 8)
    check('沒寫摘要就不寫摘要檔', 'news_digest.json' not in convert('晚報', {**data, 'news_digest': []}, now))
    check('週回顧不寫首頁新聞檔', not any(k.startswith('news_') for k in convert('週回顧', data, now)))
    print('PASS' if ok else 'FAIL')
    return ok


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest() else 1)
    main()
