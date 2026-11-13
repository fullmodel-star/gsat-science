# -*- coding: utf-8 -*-
"""2026-11-13 分科生物自寫解析：把帳本 _tools/fenke_expl/expl_{年}.json 灌進 advanced-bio/index.html 的 const QB。

- 帳本每題 status：done（寫入 expl）／mismatch（推理與官方答案對不上，不顯示解析）／failed（沒做完）。
- 只有 status=done 的題目寫入 expl；其餘清成空字串（畫面顯示「本題解析整理中」）。
- 只換 const QB 那一行，CRLF／其他內容原樣保留；可重複執行。
- strip_hanlin_expl.SELF_WRITTEN 也讀同一份帳本，所以重跑下架腳本不會把自寫解析清掉。

用法： python _tools/apply_fenke_expl.py        （寫入）
       python _tools/apply_fenke_expl.py --dry  （只統計）
"""
import json, os, sys, glob
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
LEDGER_DIR = os.path.join(ROOT, '_tools', 'fenke_expl')
SUB = 'advanced-bio'


def load_ledger():
    L = {}
    for f in sorted(glob.glob(os.path.join(LEDGER_DIR, 'expl_*.json'))):
        L.update(json.load(open(f, encoding='utf-8')))
    return L


def done_ids():
    return {k for k, v in load_ledger().items() if v.get('status') == 'done' and (v.get('expl') or '').strip()}


def main(dry=False):
    L = load_ledger()
    path = os.path.join(ROOT, SUB, 'index.html')
    raw = open(path, 'rb').read()
    text = raw.decode('utf-8')
    lines = text.split('\n')
    idx = [i for i, l in enumerate(lines) if l.startswith('const QB = ')]
    assert len(idx) == 1, 'const QB 行數不是 1'
    eol = '\r' if lines[idx[0]].endswith('\r') else ''
    qb = json.loads(lines[idx[0]][len('const QB = '):].rstrip('\r').rstrip(';'))
    allq = qb['reading'] + qb['nonchoice']
    ids = {q['id'] for q in allq}
    missing = sorted(ids - set(L))
    extra = sorted(set(L) - ids)
    if extra: raise SystemExit(f'帳本有題庫沒有的題號：{extra}')
    n = {'done': 0, 'mismatch': 0, 'failed': 0, '未入帳': len(missing)}
    for q in allq:
        e = L.get(q['id'])
        if e and e.get('status') == 'done' and (e.get('expl') or '').strip():
            # 選擇題：帳本記的官方答案必須和題庫答案一致
            if q['answer']:
                off = ''.join(sorted(c for c in e.get('official', '') if c.isalpha() and c.isupper()))
                if off != ''.join(sorted(q['answer'])):
                    raise SystemExit(f'{q["id"]} 帳本官方答案 {e.get("official")} ≠ 題庫 {q["answer"]}')
            q['expl'] = e['expl'].strip(); n['done'] += 1
        else:
            q['expl'] = ''
            if e: n[e.get('status', 'failed') if e.get('status') in ('mismatch', 'failed') else 'failed'] += 1
    print(f'[{SUB}] 題數 {len(allq)}：寫入解析 {n["done"]}、mismatch {n["mismatch"]}、failed {n["failed"]}、未入帳 {n["未入帳"]} {missing[:10]}')
    if dry: return
    lines[idx[0]] = 'const QB = ' + json.dumps(qb, ensure_ascii=False) + ';' + eol
    out = '\n'.join(lines).encode('utf-8')
    open(path, 'wb').write(out)
    assert open(path, 'rb').read() == out
    print('已寫入', path)


if __name__ == '__main__':
    main(dry='--dry' in sys.argv)
