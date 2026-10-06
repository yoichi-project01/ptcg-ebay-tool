# public/cards の全画像を、画素まで読めるか確かめる（2026-10-06）。
#   python scripts/check-image-decode.py      結果は scripts/image-decode-report/broken.tsv・summary.json
# Pillow で開いて load()（全画素を展開）する。ヘッダだけ正しく画素データが壊れているファイル（PMCG1-006 の例）も見つかる。
# 画像の対応表（src/imageIndex.json）にあるかどうかと、対応表のキー（card_id）も出す。
import json, os, sys, warnings
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, "public", "cards")
OUT = os.path.join(ROOT, "scripts", "image-decode-report")
os.makedirs(OUT, exist_ok=True)
index = json.load(open(os.path.join(ROOT, "src", "imageIndex.json"), encoding="utf-8"))
key_of = {v.lstrip("/").replace("/", os.sep): k for k, v in index.items()}

warnings.simplefilter("error")  # 切り詰めなどの警告も壊れとして扱う
broken, total = [], 0
for dirpath, _, files in os.walk(CARDS):
    for f in files:
        if not f.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
            continue
        total += 1
        p = os.path.join(dirpath, f)
        rel = os.path.relpath(p, os.path.join(ROOT, "public"))
        try:
            with Image.open(p) as im:
                im.load()
                w, h = im.size
            if w < 50 or h < 50:
                raise ValueError(f"画像が小さすぎる {w}x{h}")
        except Exception as e:  # noqa: BLE001
            key = key_of.get(rel)
            broken.append({"path": rel.replace(os.sep, "/"), "cardKey": key or "", "bytes": os.path.getsize(p),
                           "mtime": os.path.getmtime(p), "error": f"{type(e).__name__}: {e}"[:200]})

with open(os.path.join(OUT, "broken.tsv"), "w", encoding="utf-8") as fp:
    fp.write("cardKey\tpath\tbytes\terror\n")
    for b in broken:
        fp.write(f"{b['cardKey']}\t{b['path']}\t{b['bytes']}\t{b['error']}\n")
with open(os.path.join(OUT, "summary.json"), "w", encoding="utf-8") as fp:
    json.dump({"checked": total, "broken": len(broken), "items": broken}, fp, ensure_ascii=False, indent=1)
print(f"確認 {total} 件、読めない {len(broken)} 件")
for b in broken[:50]:
    print(b["cardKey"], b["path"], b["error"])
