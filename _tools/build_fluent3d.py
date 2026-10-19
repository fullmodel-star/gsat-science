"""下載 Microsoft Fluent Emoji 的 3D 圖（MIT），縮成 128px PNG → vendor/fluent-3d/<key>.png

    python _tools/build_fluent3d.py
    （需要 Pillow：pip install pillow）

2026-10-19 版面美化「自然探險」建立（照 605 _tools/build_fluent3d.py）：首屏主視覺、題庫卡、
狀態列、學測倒數卡、分頁用 3D 立體圖。
- 來源：https://github.com/microsoft/fluentui-emoji （MIT，全文寫到 vendor/fluent-3d/LICENSE.txt）。
- 顯示最大約 120px，存 128px；下載後檢查是 PNG 檔頭（不是錯誤頁），不合格就停。
- ⚠ Fluent 資料夾名大小寫要完全一樣（例 Globe showing asia-australia）。
"""
import io
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "fluent-3d"
BASE = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main"
SIZE = 128

# key → Fluent 資料夾名（檔名＝資料夾名小寫、空白換底線＋_3d.png）
ICONS = {
    # 三個題庫（對應 index.html 的 APPS[].img）
    "dna": "Dna", "globe": "Globe showing asia-australia", "microscope": "Microscope",
    # 首屏主視覺與主鈕
    "test_tube": "Test tube", "sparkles": "Sparkles", "rocket": "Rocket",
    # 狀態列（累計已練／總答對率／待清錯題）
    "check": "Check mark button", "target": "Bullseye", "memo": "Memo",
    # 學測倒數、分頁、說明
    "calendar": "Spiral calendar", "books": "Books", "bulb": "Light bulb",
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for key, folder in ICONS.items():
        fname = folder.lower().replace(" ", "_") + "_3d.png"
        url = f"{BASE}/assets/{urllib.parse.quote(folder)}/3D/{urllib.parse.quote(fname)}"
        raw = fetch(url)
        if not raw.startswith(b"\x89PNG"):
            print(f"[FAIL] {key}：{url} 不是 PNG"); sys.exit(1)
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        dst = OUT / f"{key}.png"
        im.save(dst, optimize=True)
        print(f"OK {key:10s} {dst.stat().st_size // 1024} KB  <- {folder}")
    (OUT / "LICENSE.txt").write_bytes(fetch(f"{BASE}/LICENSE"))
    print("OK LICENSE.txt")


if __name__ == "__main__":
    main()
