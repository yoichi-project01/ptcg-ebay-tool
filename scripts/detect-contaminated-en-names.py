#!/usr/bin/env python3
"""
cardData.json の英語名フィールドから、インドネシア語混入を言語頻度により検出し空欄化する。

単語リスト方式（旧 blank-contaminated-en-names.mjs）は「英語には現れないインドネシア語」を
列挙する方式だったため、"Ursaluna Bulan Merah ex" のような
「正しい英語のポケモン名 + インドネシア語」の混成を取りこぼした。
本スクリプトは各単語の英語/インドネシア語での出現頻度を比較するため、列挙が不要。

依存: pip install wordfreq
使い方: python3 scripts/detect-contaminated-en-names.py [--apply]
        --apply なしでは検出結果を表示するのみ（デフォルトは dry-run）
"""
import json
import pathlib
import re
import sys

from wordfreq import zipf_frequency

ROOT = pathlib.Path(__file__).resolve().parent.parent
CARD_DATA_PATH = ROOT / "src" / "cardData.json"

# 英語のポケモン名・固有名詞のうち、インドネシア語の一般語と衝突するもののみ除外する。
# この方式では除外リストが小さく済むのが利点。追加する際は
# 「英語カード名として実在するか」を必ず確認すること。
EXEMPT = {
    "lele",  # Type: Null系のポケモン名との衝突ではなく "Lele"（アローラのお守り等の固有名詞）
    "tapu",  # カプ系ポケモン名 (Tapu Koko 等)
    "bulu",  # Silvally 等の道具名 "Bulu" との衝突を避けるための保険（実カード名に出現した場合のみ有効）
    "koko",  # Tapu Koko
    "fini",  # Tapu Fini
    "rotom",  # Rotom
    "mega",  # Mega Evolution
    "solo",  # Solgaleo / Solrock 系 "Solo" を含むカード名との衝突を避けるための保険
    "kaki",  # "Kaki" を含む地名由来カード名 (例: 今後追加されうるロケーション名) との衝突を避けるための保険
}

# インドネシア語でこの頻度以上、かつ英語との差がこの値以上なら混入とみなす
ID_MIN_FREQ = 3.5
MIN_DIFF = 1.5


def bad_tokens(name: str) -> list[str]:
    out = []
    for raw in re.findall(r"[A-Za-z]{3,}", name):
        t = raw.lower()
        if t in EXEMPT:
            continue
        en = zipf_frequency(t, "en")
        idn = zipf_frequency(t, "id")
        if idn >= ID_MIN_FREQ and idn - en >= MIN_DIFF:
            out.append(t)
    return out


def main() -> None:
    apply = "--apply" in sys.argv

    card_data = json.loads(CARD_DATA_PATH.read_text(encoding="utf-8"))

    hits = []
    for card_set in card_data:
        set_code = card_set["c"]
        for k in card_set["k"]:
            local_id, ja, en, *_rest = k
            if not en:
                continue
            tokens = bad_tokens(en)
            if tokens:
                hits.append((set_code, local_id, ja, en, tokens, k))

    for set_code, local_id, ja, en, tokens, _k in hits:
        print(f"{set_code}/{local_id} | {ja} | {en} | {','.join(tokens)}")

    print(f"\n{len(hits)}件検出", file=sys.stderr)

    if apply:
        for _set_code, _local_id, _ja, _en, _tokens, k in hits:
            k[2] = ""
        CARD_DATA_PATH.write_text(
            json.dumps(card_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"{len(hits)}件を空欄化して書き込みました。", file=sys.stderr)


if __name__ == "__main__":
    main()
