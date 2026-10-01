# -*- coding: utf-8 -*-
"""702 題庫資料檢查：直接讀三支 App 的 index.html 內嵌 QB（＝使用者實際看到的資料）。

檢查項目（任一違規 → 結束碼 1）：
  A. 練習題（reading）每題：可作答選項 ≥2、字母連續、答案非空且都在選項內、沒有空白選項文字；
     沒有文字選項的「純圖選項題」必須有 optKeys 與題目圖。
  B. 選項數＝實際選項數：
     B1 人工看圖確認過的純圖選項題（下方 VISUAL 表）選項數必須相符；
     B2 若本機有 _封存_舊中文結構/_build 的原始 PDF，逐題比對原卷的 (A)…(F) 標記數（學測＝官方試卷；分科＝翰林解析題目區）。
  C. 題幹與選項不得混入下一題組引言／試卷說明（「NN-NN題為題組」「第貳部分」「說明：本部分」「【閱讀」）。
  D. 題目文字引用「圖N／表N」者，本題或所屬題組必須有圖。
  E. 圖檔可解碼，且沒有只剩頁首條的殘圖（高度 < 100px）。
  F. 若本機有原始 PDF：112 年起的答案與翰林答案欄逐題比對；答案欄是文字（非選）的題目不得出現在練習題。
  G. 翰林詳解下架（2026-10-01）：每題 expl（解析）必須為空（除非列在 strip_hanlin_expl.SELF_WRITTEN 的自寫題）、
     topic（翰林測驗目標）必須為空；三支 App 與 hub 的 index.html 不得出現「翰林」「精彩解析」；
     若本機有 _build/qb_*.json（含原翰林詳解），逐題確認原詳解文字（前 20 字）不在 index.html 裡。

用法： python _tools/check_qb.py
"""
import json, re, os, sys, base64, io, struct
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BUILD = os.path.join(ROOT, '_封存_舊中文結構', '_build')
ROOT = os.environ.get('QB_CHECK_ROOT', ROOT)   # 可指向別份 checkout（例：驗證舊版確實會被抓到）
APPS = [('biology', '學測生物'), ('earth', '學測地科'), ('advanced-bio', '分科生物')]

# 2026-10-01 人工看原卷圖確認的選項數（純圖選項題）
VISUAL = {
    'biology': {'112-10': 5, '112-56': 5, '114-8': 5, '115-28': 5, '115-39': 5},
    'earth': {'114-13': 5, '114-45': 5},
    'advanced-bio': {'F112-8': 4, 'F112-18': 4, 'F112-19': 4, 'F112-25': 4, 'F112-26': 4, 'F113-5': 4},
}
LEAK_RE = re.compile(r'\d{1,2}\s*[.．]?\s*[-－~～、]\s*\d{1,2}\s*[.．]?\s*題為題組|第貳部分|說明：本部分|【閱讀')
REF_RE = re.compile(r'(?<![代發列外])([圖表])\s*(\d+)')

def load_qb(sub):
    raw = open(os.path.join(ROOT, sub, 'index.html'), 'rb').read().decode('utf-8')
    line = [l for l in raw.split('\n') if l.startswith('const QB = ')]
    assert len(line) == 1, sub
    return json.loads(line[0][len('const QB = '):].rstrip('\r').rstrip(';'))

def img_h(s):
    data = base64.b64decode(s.split(',', 1)[1])
    if data[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', data[16:24])[1]
    from PIL import Image
    return Image.open(io.BytesIO(data)).size[1]

def pdf_truth():
    """有原始 PDF 才做：{sub: {id: letters}} 與 {sub: {id: 答案欄原文}}"""
    if not os.path.isdir(os.path.join(BUILD, 'src_pdf')): return None
    sys.path.insert(0, BUILD); cwd = os.getcwd(); os.chdir(BUILD)
    try:
        import fix_20261001 as F
        import parse_hanlin
        letters, answers = {'biology': {}, 'earth': {}, 'advanced-bio': {}}, {'biology': {}, 'earth': {}, 'advanced-bio': {}}
        for y in ['111', '112', '113', '114', '115']:
            seg = F.official_segments(f'src_pdf/{y}官方自然試卷.pdf')
            ar = F.hanlin_answer_raw(f'src_pdf/{y}翰林自然解析.pdf') if y != '111' else {}
            for sub in ('biology', 'earth'):
                for n, s in seg.items(): letters[sub][f'{y}-{n}'] = s['letters']
                for n, a in ar.items(): answers[sub][f'{y}-{n}'] = a
        for y in ['112', '113', '114']:
            pdf = f'src_fenke/{y}翰林分科生物解析.pdf'
            doc, L = F.pdf_lines(pdf); M = F.fenke_marks(L)
            for k, mk in enumerate(M):
                if mk[1] != 'q': continue
                key = f'F{y}-{mk[2]}'
                if key in letters['advanced-bio']: continue
                nxt = M[k + 1] if k + 1 < len(M) else None
                if nxt and nxt[1] == 'a':
                    t = parse_hanlin.norm('\n'.join(l['t'] for l in L[mk[0]:nxt[0]]))
                    letters['advanced-bio'][key] = sorted(set(re.findall(r'\(([A-F])\)', t)))
            for n, a in F.hanlin_answer_raw(pdf).items(): answers['advanced-bio'][f'F{y}-{n}'] = a
        return letters, answers, F
    finally:
        os.chdir(cwd)

def hanlin_check():
    """G 類：回傳 (違規清單, 掃描題數, 比對原詳解題數)"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from strip_hanlin_expl import SELF_WRITTEN
    V = []; scanned = 0; orig_cmp = 0
    for sub, name in APPS:
        raw = open(os.path.join(ROOT, sub, 'index.html'), 'rb').read().decode('utf-8')
        for w in ('翰林', '精彩解析'):
            if w in raw: V.append((sub, 'G', f'index.html 含「{w}」{raw.count(w)} 處'))
        qb = load_qb(sub); keep = SELF_WRITTEN.get(sub, set())
        for q in qb['reading'] + qb['nonchoice']:
            scanned += 1
            if (q.get('expl') or '').strip() and q['id'] not in keep: V.append((q['id'], 'G', f'{sub} 解析欄不是空的（{q["expl"][:20]}…）'))
            if (q.get('topic') or '').strip(): V.append((q['id'], 'G', f'{sub} topic 欄不是空的'))
        src = {'biology': 'qb_bio', 'earth': 'qb_esc', 'advanced-bio': 'qb_fenke'}[sub]
        for fn in (f'{src}.json', f'{src}.pre20261001.json'):
            fp = os.path.join(BUILD, fn)
            if not os.path.isfile(fp): continue
            old = json.load(open(fp, encoding='utf-8'))
            for q in old['reading'] + old['nonchoice']:
                e = re.sub(r'\s+', ' ', q.get('expl') or '').strip()
                if len(e) < 12 or q['id'] in keep: continue
                orig_cmp += 1
                frag = json.dumps(e[:20], ensure_ascii=False)[1:-1]
                if frag in raw or e[:20] in raw: V.append((q['id'], 'G', f'{sub} 原翰林詳解文字仍在 index.html（{e[:20]}）'))
    hub = open(os.path.join(ROOT, 'index.html'), 'rb').read().decode('utf-8')
    for w in ('翰林', '精彩解析'):
        if w in hub: V.append(('hub', 'G', f'index.html 含「{w}」{hub.count(w)} 處'))
    return V, scanned, orig_cmp

def main():
    truth = pdf_truth()
    total_v = 0; scanned = 0; scanned_nc = 0; refs_checked = 0; imgs_checked = 0; pdf_cmp = 0; ans_cmp = 0
    for sub, name in APPS:
        qb = load_qb(sub); G = qb.get('groups', {})
        V = []
        R = qb['reading']; NC = qb['nonchoice']
        scanned += len(R); scanned_nc += len(NC)
        for q in R:
            opts = q.get('options') or {}
            keys = list(opts) or q.get('optKeys') or []
            if len(keys) < 2: V.append((q['id'], 'A', f'可作答選項 {keys}'))
            if keys != list('ABCDEF')[:len(keys)]: V.append((q['id'], 'A', f'選項字母不連續 {keys}'))
            if not q.get('answer') or any(a not in keys for a in q['answer']): V.append((q['id'], 'A', f'答案 {q.get("answer")} 不在選項 {keys}'))
            if any(not str(v).strip() for v in opts.values()): V.append((q['id'], 'A', '有空白選項文字'))
            if not opts and not q.get('imgs'): V.append((q['id'], 'A', '純圖選項題沒有圖'))
            if not opts and not q.get('optKeys'): V.append((q['id'], 'A', '純圖選項題沒有 optKeys'))
            exp = VISUAL.get(sub, {}).get(q['id'])
            if exp is not None and len(keys) != exp: V.append((q['id'], 'B1', f'人工確認 {exp} 個選項，資料為 {len(keys)}'))
            if truth:
                lt = truth[0][sub].get(q['id'])
                if lt is not None:
                    pdf_cmp += 1
                    if len(lt) != len(keys): V.append((q['id'], 'B2', f'原卷選項 {lt}，資料 {keys}'))
                ar = truth[1][sub].get(q['id'])
                if ar is not None:
                    ans_cmp += 1
                    if not truth[2].letters_only(ar): V.append((q['id'], 'F', f'翰林答案欄是文字「{ar[:20]}」卻列在練習題'))
                    elif truth[2].ans_letters(ar) != sorted(q['answer']): V.append((q['id'], 'F', f'答案 {q["answer"]} ≠ 翰林 {truth[2].ans_letters(ar)}'))
        for q in R + NC:
            for fld, txt in [('題幹', q.get('stem', ''))] + [(f'選項{k}', v) for k, v in (q.get('options') or {}).items()]:
                m = LEAK_RE.search(txt or '')
                if m: V.append((q['id'], 'C', f'{fld}混入「{txt[m.start():m.start()+24]}」'))
            txt = q.get('stem', '') + ' '.join((q.get('options') or {}).values())
            refs = REF_RE.findall(txt)
            if refs:
                refs_checked += 1
                g = G.get(q.get('gid')) if q.get('gid') else None
                if not q.get('imgs') and not (g and g.get('imgs')):
                    V.append((q['id'], 'D', f'引用 {sorted(set(a+b for a, b in refs))} 但本題與題組都沒有圖'))
            for s in q.get('imgs') or []:
                imgs_checked += 1
                try:
                    if img_h(s) < 100: V.append((q['id'], 'E', f'殘圖（高 {img_h(s)}px）'))
                except Exception as e: V.append((q['id'], 'E', f'圖無法解碼 {e}'))
        for gid, g in G.items():
            for s in g.get('imgs') or []:
                imgs_checked += 1
                try:
                    if img_h(s) < 60: V.append((gid, 'E', f'題組殘圖（高 {img_h(s)}px）'))
                except Exception as e: V.append((gid, 'E', f'題組圖無法解碼 {e}'))
        print(f'[{name} {sub}] 練習 {len(R)}（純圖選項 {sum(1 for q in R if not q.get("options"))}）＋非選 {len(NC)}，題組 {len(G)}；違規 {len(V)}')
        for v in V: print('   ✗', *v)
        total_v += len(V)
    print(f'\n掃描題數：練習 {scanned}＋非選 {scanned_nc}＝{scanned + scanned_nc}；引用圖表題 {refs_checked}；圖檔 {imgs_checked}；'
          f'原卷選項數比對 {pdf_cmp} 題；翰林答案比對 {ans_cmp} 題' + ('' if truth else '（本機無原始 PDF，B2/F 略過）'))
    GV, g_scan, g_cmp = hanlin_check()
    print(f'[翰林詳解下架 G] 掃描題數 {g_scan}；比對原翰林詳解 {g_cmp} 筆（含修正前備份，有重複）；違規 {len(GV)}')
    for v in GV: print('   ✗', *v)
    total_v += len(GV)
    if g_scan == 0: print('✗ G 類沒有掃到任何題目'); sys.exit(1)
    print(f'違規總數：{total_v}')
    if scanned == 0: print('✗ 沒有掃到任何題目'); sys.exit(1)
    sys.exit(1 if total_v else 0)

if __name__ == '__main__':
    main()
