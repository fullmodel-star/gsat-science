# -*- coding: utf-8 -*-
"""2026-10-01 下架翰林出版社《精彩解析》詳解全文（老闆決定；詳解不是試題，不受著作權法第 9 條保護）。

直接改三支 App 的 index.html（使用者實際載入的檔案），可重複執行（已處理過就不再變動）：
  1. QB 資料：每題 expl（詳解）清空；topic（翰林「測驗目標」敘述，畫面沒顯示但留在檔案裡）清空；
     meta.source 改成只寫大考中心。自寫解析目前 0 題（SELF_WRITTEN 留空；日後自寫的題目 id 加進來即可保留）。
  2. 分科題目圖（從翰林解析 PDF 題目區裁切）若在題目框下方帶到翰林頁碼，裁掉框外那一段。
  3. 介面文字：原本顯示詳解的地方改顯示中性說明（EXPL_NOTE）；「詳解」「翰林」字樣全部改掉。
_build/inject_qb.py 重新注入 QB 後也會自動呼叫本腳本，避免詳解被重新灌回。

用法： python _tools/strip_hanlin_expl.py
"""
import json, os, re, sys, base64, io
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
APPS = ['biology', 'earth', 'advanced-bio']
SELF_WRITTEN = {}   # {sub: {題目id, ...}}：確定為自寫的解析才保留
SOURCE = {
    'biology': '大學入學考試中心 學測自然考科 官方公開試題（111–115）',
    'earth': '大學入學考試中心 學測自然考科 官方公開試題（111–115）',
    'advanced-bio': '大學入學考試中心 分科測驗生物 官方公開試題（112–114）',
}
NOTE = '答案依大學入學考試中心公布。本題解析整理中。'
NC_NOTE = '本題解析整理中。非選擇題的參考答案與評分原則，請見大學入學考試中心公布的資料。'

# 介面文字（舊 → 新）；三支引擎相同，只有「關於」一句因科目不同分開寫
UI = [
    ('<meta name="description" content="學測生物官方歷屆試題複習：依年份選題練習、逐題作答與詳解、',
     '<meta name="description" content="學測生物官方歷屆試題複習：依年份選題練習、逐題作答與對答、'),
    ('<meta name="description" content="學測地球科學官方歷屆試題複習：依年份選題練習、逐題作答與詳解、',
     '<meta name="description" content="學測地球科學官方歷屆試題複習：依年份選題練習、逐題作答與對答、'),
    ('<meta name="description" content="分科測驗生物官方歷屆試題複習：依年份選題練習、逐題作答與詳解、',
     '<meta name="description" content="分科測驗生物官方歷屆試題複習：依年份選題練習、逐題作答與對答、'),
    ('詳解出自翰林出版社《精彩解析》，著作權屬原出版者；', ''),
    ('<div class="sect">📚 章節練習（作答後看解析）</div>', '<div class="sect">📚 章節練習（交卷後對答案）</div>'),
    ('<div class="mt">非選擇題・參考答案與詳解</div><div class="md">${NC.length} 題歷屆混合題（無法自動批改，附官方式詳解）</div>',
     '<div class="mt">非選擇題・歷屆題目</div><div class="md">${NC.length} 題歷屆混合題（無法自動批改，可練習作答）</div>'),
    ("${last?'交卷／看解析 ✓'", "${last?'交卷／對答案 ✓'"),
    ('<div class="sect">📋 逐題解析（共 ${list.length} 題）</div>', '<div class="sect">📋 逐題對答（共 ${list.length} 題）</div>'),
    ('— 點開看解析</div>', '— 點開看答案</div>'),
    # 原本有詳解才顯示 → 改成：有自寫解析才顯示，否則顯示中性說明
    ("${q.expl?`<div class=\"expl\">💡 ${esc(q.expl)}</div>`:''}", "${explHtml(q)}"),
    ("<details><summary>看參考詳解</summary><div class=\"ncref\">${esc(q.expl)||'（詳解整理中）'}</div></details>",
     "<details><summary>參考答案</summary><div class=\"ncref\">${esc(q.expl)||NC_NOTE}</div></details>"),
    ('此處提供翰林逐題詳解供對照。</p>', '參考答案與評分原則請見大學入學考試中心公布的資料。</p>'),
    ('，\n      逐題詳解引自 <b>翰林 學測精彩解析</b>（免費公開）。', '。'),
    ('，\r\n      逐題詳解引自 <b>翰林 學測精彩解析</b>（免費公開）。', '。'),
    ('，\n      逐題詳解引自 <b>翰林 分科測驗精彩解析</b>（免費公開）。', '。'),
    ('，\r\n      逐題詳解引自 <b>翰林 分科測驗精彩解析</b>（免費公開）。', '。'),
    ('另有 ${NC.length} 題混合題／非選附詳解。答案已對大考中心官方答案核對。',
     '另有 ${NC.length} 題混合題／非選可瀏覽。答案已對大考中心官方答案核對；逐題解析整理中。'),
    ('tagline:"大考中心歷屆生物・官方題＋逐題詳解"', 'tagline:"大考中心歷屆生物・官方題＋官方答案"'),
    ('tagline:"大考中心歷屆地球科學・官方題＋逐題詳解"', 'tagline:"大考中心歷屆地球科學・官方題＋官方答案"'),
    ('tagline:"分科測驗生物・選修生物Ⅰ-Ⅳ・官方題＋詳解"', 'tagline:"分科測驗生物・選修生物Ⅰ-Ⅳ・官方題＋官方答案"'),
    # explHtml / 說明文字定義：插在 diffTag 後面
    ("function diffTag(q){ return q.diff?`<span class=\"tag diff\">${esc(q.diff)}</span>`:''; }",
     "function diffTag(q){ return q.diff?`<span class=\"tag diff\">${esc(q.diff)}</span>`:''; }\n"
     f"const EXPL_NOTE='{NOTE}', NC_NOTE='{NC_NOTE}';\n"
     "function explHtml(q){ return q.expl?`<div class=\"expl\">💡 ${esc(q.expl)}</div>`:`<div class=\"expl expl-note\">${EXPL_NOTE}</div>`; }"),
    ('.rev-item .expl{margin-top:8px;font-size:.84rem}',
     '.rev-item .expl{margin-top:8px;font-size:.84rem}\n.expl.expl-note{color:var(--sub);border-left-color:var(--line);font-size:.82rem}'),
]

def trim_footer(src):
    """分科題目圖：題目框（淡青底）下方若有翰林頁碼，裁到框底 +5px。回傳 (新 data URI, 裁掉的列數)"""
    from PIL import Image
    import numpy as np
    head, b64 = src.split(',', 1)
    im = Image.open(io.BytesIO(base64.b64decode(b64)))
    a = np.asarray(im.convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    rows = np.where((((r >= 200) & (r <= 240) & (g >= 245) & (b >= 245)).mean(axis=1)) > 0.3)[0]
    if not len(rows): return src, 0
    last = int(rows[-1]); H = a.shape[0]
    tail = a[last + 1:]
    if H - 1 - last <= 8 or not (tail.sum(axis=2) < 720).any(): return src, 0
    out = im.crop((0, 0, im.size[0], last + 5))
    buf = io.BytesIO(); out.save(buf, format='PNG', optimize=True)
    return head + ',' + base64.b64encode(buf.getvalue()).decode('ascii'), H - (last + 5)

def main():
    total = 0
    for sub in APPS:
        path = os.path.join(ROOT, sub, 'index.html')
        raw = open(path, 'rb').read()
        crlf = b'\r\n' in raw
        text = raw.decode('utf-8')
        lines = text.split('\n')
        idx = [i for i, l in enumerate(lines) if l.startswith('const QB = ')]
        assert len(idx) == 1, sub
        eol = '\r' if lines[idx[0]].endswith('\r') else ''
        qb = json.loads(lines[idx[0]][len('const QB = '):].rstrip('\r').rstrip(';'))
        keep = SELF_WRITTEN.get(sub, set())
        n_expl = n_topic = n_img = 0; kept = []
        for q in qb['reading'] + qb['nonchoice']:
            if q.get('expl'):
                if q['id'] in keep: kept.append(q['id'])
                else: q['expl'] = ''; n_expl += 1
            if q.get('topic'): q['topic'] = ''; n_topic += 1
        if sub == 'advanced-bio':
            for holder in qb['reading'] + qb['nonchoice'] + list(qb['groups'].values()):
                for i, s in enumerate(holder.get('imgs') or []):
                    ns, cut = trim_footer(s)
                    if cut:
                        holder['imgs'][i] = ns; n_img += 1
                        print(f'   裁頁碼 {holder.get("id") or [k for k, v in qb["groups"].items() if v is holder][0]} 圖{i}：下方 {cut}px')
        qb['meta']['source'] = SOURCE[sub]
        lines[idx[0]] = 'const QB = ' + json.dumps(qb, ensure_ascii=False) + ';' + eol
        out = '\n'.join(lines)
        n_ui = 0
        for old, new in UI:
            if crlf: new = new.replace('\r\n', '\n').replace('\n', '\r\n'); old_c = old.replace('\r\n', '\n').replace('\n', '\r\n')
            else: old_c = old
            if old_c in out and old_c != new and not (new.startswith(old_c) and new in out):   # 插入型（new 以 old 開頭）已套用過就跳過
                out = out.replace(old_c, new); n_ui += 1
        open(path, 'wb').write(out.encode('utf-8'))
        assert open(path, 'rb').read() == out.encode('utf-8')
        print(f'[{sub}] 清空詳解 {n_expl} 題、topic {n_topic} 題、保留自寫 {kept}、裁圖 {n_img}、介面替換 {n_ui} 處')
        total += n_expl
    print(f'合計清空詳解 {total} 題')

if __name__ == '__main__':
    main()
