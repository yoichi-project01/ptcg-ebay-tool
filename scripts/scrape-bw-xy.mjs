#!/usr/bin/env node
/**
 * BW・XY世代のカードデータ取得（ステップ3: 対象はホワイトリストに明記したセットのみ）
 *
 * 背景・調査結果は docs/task-bw-xy.md と CLAUDE.md
 * 「調査（2026-08-04）: BW・XY世代のカード番号取得経路の検証」「...データモデル確認」を参照。
 *
 * 番号・レアリティは pokemon-card.com の details.php から取得する（経路A）。
 * resultAPI.php（official-card-cache.json の元データ）はカード番号を含まないため、
 * この2つを組み合わせて使う: official-card-cache.json でカードID一覧を得て、
 * details.php で1枚ずつ番号・総数・レアリティ・(HTMLデコード済みの)日本語名を検証する。
 *
 * 対象セットは TARGET_SETS のホワイトリストに明記したものだけを処理する。
 * official-card-cache.json には正体不明の裸の "BW"/"XY" setCode（レアリティ情報も
 * 1st Editionマークも無い、番号付き商品とは別カテゴリと思われる）が含まれており、
 * 機械的にキーを列挙すると誤って取り込んでしまうため、意図的にホワイトリスト方式にしている。
 * ステップ4（横展開）を行う場合は、このリストに1セットずつ追記すること。
 *
 * 使い方:
 *   node scripts/scrape-bw-xy.mjs
 *
 * 前提: scripts/official-card-cache.json が存在すること
 *   （無ければ node scripts/scrape-official-images.mjs --rescan を先に実行）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");
const REPORT_PATH = path.join(__dirname, "scrape-bw-xy-report.json");

const API_BASE = "https://www.pokemon-card.com";
const CONCURRENCY = 3;
const DELAY_MS = 400;
const FETCH_TIMEOUT_MS = 15000;
// 失敗カード数がこの件数を超えたら、不完全なデータをcardData.jsonに書き込まず異常終了する
const MAX_FAILED_CARDS = 5;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

// ja: TCGdexの `name` フィールド（https://api.tcgdex.net/v2/ja/series/xy）またはpokemon-card.com
//   公式レギュレーションページ（BW: /rules/regulation/bw.html）に準拠。
// y: XY系はTCGdexのreleaseDate。BW系はTCGdexにシリーズが存在せず取得経路が無いため未設定
//   （CLAUDE.md「ステップ4」参照。yの無いセットはbuildItemSpecificsのYear Manufacturedが
//   単に出力されないだけで、既存の分岐（旧裏Vintage判定等）には影響しない）。
// en/enAliasは付与しない（依頼書: 日本語版セットの英語名は信頼できるソースが無いため空欄のまま）。
// codeAlias: setCode（公式サイトの画像フォルダ名。内部識別子）とは別に、カードに実際に
// 印刷されている型番を毎セット画像で目視確認してから設定する。未確認のまま推測で
// 埋めないこと（確認できない場合はcodeAliasを付けずsetCodeがそのまま表示される。
// これは「型番が違うかもしれないが分からない」より安全）。
// sr="XY"/"BW" はSERIE_ORDER・SERIE_EN_NAMES（src/App.jsx）に登録済み
//
// sourceCacheKeys: official-card-cache.json 上で1つの商品が複数キーに分裂している場合
// （例: XY6-Bが本弾001-078、裸のXY6キーがその商品のシークレット079-089を保持していた）に、
// 複数キーのカードをマージして1つの出力セットにする。通常は [code] の1キーのみ
// ステップ4（横展開・XY世代）: 全13セットとも codeAlias を画像目視で個別確認済み
// （CLAUDE.md「ステップ4」参照）。ja/yはTCGdex（https://api.tcgdex.net/v2/ja/sets/{id}）から。
// XY5-Bg/Bt・XY11-Bb/BrのTCGdex名↔setCode対応は、パッケージ看板级EXポケモンの属性から
// 推定したもの（XY5-Bg=ゲンシグラードンEX収録→ガイアボルケーノ、XY5-Bt=メノクラゲ等の
// 水タイプ→タイダルストーム）。XY11-Bb/Brは弱い手がかり（Br収録のマニューラが氷タイプ→
// 冷酷の反逆者と推定）のみで確度が低い。ja名の対応が入れ替わっていても番号・レアリティ等の
// カード本体データには影響しない（cardData.json構造上、jaは表示用の付随情報のため）
const TARGET_SETS = [
  { code: "XY1-Bx", sourceCacheKeys: ["XY1-Bx"], ja: "コレクションX", sr: "XY", y: 2013, codeAlias: "XY1" },
  { code: "XY1-By", sourceCacheKeys: ["XY1-By"], ja: "コレクションY", sr: "XY", y: 2013, codeAlias: "XY1" },
  { code: "XY2", sourceCacheKeys: ["XY2"], ja: "ワイルドブレイズ", sr: "XY", y: 2014, codeAlias: "XY2" },
  { code: "XY3", sourceCacheKeys: ["XY3"], ja: "ライジングフィスト", sr: "XY", y: 2014, codeAlias: "XY3" },
  { code: "XY4", sourceCacheKeys: ["XY4"], ja: "ファントムゲート", sr: "XY", y: 2014, codeAlias: "XY4" },
  { code: "XY5-Bg", sourceCacheKeys: ["XY5-Bg"], ja: "ガイアボルケーノ", sr: "XY", y: 2014, codeAlias: "XY5" },
  { code: "XY5-Bt", sourceCacheKeys: ["XY5-Bt"], ja: "タイダルストーム", sr: "XY", y: 2014, codeAlias: "XY5" },
  { code: "XY6-B", sourceCacheKeys: ["XY6-B", "XY6"], ja: "エメラルドブレイク", sr: "XY", y: 2015, codeAlias: "XY6" },
  { code: "XY7-B", sourceCacheKeys: ["XY7-B", "XY7"], ja: "バンデットリング", sr: "XY", y: 2015, codeAlias: "XY7" },
  // official-card-cache.jsonのスキャン漏れで037/059(ゾロアークBREAK)・043/059(フラージェスBREAK)が
  // 欠落していたため、cardIdを直接指定して補った（details.phpで存在・番号を個別確認済み。
  // CLAUDE.md「ステップ4」参照）。BREAKポケモンのレアリティはrr(Double Rare)で、
  // 既存RARITIES配列に追加は不要と判明した実例でもある
  { code: "XY8-Bb", sourceCacheKeys: ["XY8-Bb"], extraCardIds: [31346, 31352], ja: "青い衝撃", sr: "XY", y: 2015, codeAlias: "XY8" },
  // 006/059(ブリガロンBREAK)・036/059(ガラガラBREAK)がスキャン漏れ。XY8-Bbと同じ原因と思われる
  { code: "XY8-Br", sourceCacheKeys: ["XY8-Br"], extraCardIds: [31374, 31404], ja: "赤い閃光", sr: "XY", y: 2015, codeAlias: "XY8" },
  // BREAKポケモン3種（030/047/066）がスキャン漏れ。XY8と同じ原因
  { code: "XY9-B", sourceCacheKeys: ["XY9-B"], extraCardIds: [31502, 31519, 31538], ja: "破天の怒り", sr: "XY", y: 2015, codeAlias: "XY9" },
  // BREAKポケモン4種（012/017/049/059）がスキャン漏れ
  { code: "XY10-B", sourceCacheKeys: ["XY10-B"], extraCardIds: [31746, 31751, 31783, 31793], ja: "めざめる超王", sr: "XY", y: 2016, codeAlias: "XY10" },
  // BREAKポケモン3種（010/020/042）がスキャン漏れ
  { code: "XY11-Bb", sourceCacheKeys: ["XY11-Bb"], extraCardIds: [32022, 32032, 32054], ja: "爆熱の闘士", sr: "XY", y: 2016, codeAlias: "XY11" },
  // BREAKポケモン3種（008/034/043）がスキャン漏れ
  { code: "XY11-Br", sourceCacheKeys: ["XY11-Br"], extraCardIds: [32074, 32100, 32109], ja: "冷酷の反逆者", sr: "XY", y: 2016, codeAlias: "XY11" },

  // ステップ4（横展開・BW世代）: ja名はpokemon-card.com公式レギュレーションページ
  // （/rules/regulation/bw.html、拡張パック商品名の一覧を取得済み）に準拠。
  // y（発売年）はTCGdexにBWシリーズが存在せず取得経路が無いため、全セット未設定のまま
  // 取り込む（CLAUDE.md「ステップ4」参照、課題として記録）。codeAliasは全セット画像で
  // 個別確認済み（バッジが単色でXY期のような色分けが無いことも確認した）。
  //
  // 【重要】official-card-cache.json上の"BW10-B"は拡張パック本弾ではなく、印刷されている
  // 型番が"EBB"（コンセプトパック「EXバトルブースト」と推定: レアリティ表記が無い・
  // 多地方混成のポケモン構成・©2013という一致しない年号から判断）だったため対象外とした。
  // 依頼書が想定していた「BW10=ドラゴンセレクション」という対応付けは誤りだったことになる。
  // ドラゴンセレクションはBulbapediaで「BW時代最初のサブセット」と説明されており、
  // XYA〜XYHと同種の非本弾サブセット/レターマーク単独商品と考えられ、対応するsetCodeは
  // official-card-cache.json内に見当たらなかった（推測で埋めていない）。よってBW世代の
  // 拡張パック本弾は9商品・14セットコードのみを対象とする。
  //
  // 分裂ペアのja名対応（信頼度に差がある。詳細はCLAUDE.md参照）:
  // - BW3-Bh/Bp: 高確度（BhにキュレムEX=氷/竜→ヘイルブリザード、Bpにミュウツーex=超→サイコドライブ）
  // - BW6-Bc/Bf: 高確度（実際のポケモン公式設定でホワイトキュレムの技=フュージョンボルト、
  //   ブラックキュレムの技=フュージョンフレアであることに基づく。Bcにホワイトキュレムex→
  //   フリーズボルト、Bfにブラックキュレムex→コールドフレア）
  // - BW8-Brf/Brn: 中確度（Brnにボルトロスex=電気→雷の名を持つライデンナックル、Brfは消去法でラセンフォース）
  // - BW5-Brn/Brz: 低確度（両方に竜タイプexが入っており型による判別ができず、バッジの色のみで推定）
  { code: "BW1-Bb", sourceCacheKeys: ["BW1-Bb"], ja: "ブラックコレクション", sr: "BW", codeAlias: "BW1" },
  { code: "BW1-Bw", sourceCacheKeys: ["BW1-Bw"], ja: "ホワイトコレクション", sr: "BW", codeAlias: "BW1" },
  { code: "BW2-B", sourceCacheKeys: ["BW2-B"], ja: "レッドコレクション", sr: "BW", codeAlias: "BW2" },
  { code: "BW3-Bh", sourceCacheKeys: ["BW3-Bh"], ja: "ヘイルブリザード", sr: "BW", codeAlias: "BW3" },
  { code: "BW3-Bp", sourceCacheKeys: ["BW3-Bp"], ja: "サイコドライブ", sr: "BW", codeAlias: "BW3" },
  { code: "BW4-B", sourceCacheKeys: ["BW4-B"], ja: "ダークラッシュ", sr: "BW", codeAlias: "BW4" },
  { code: "BW5-Brn", sourceCacheKeys: ["BW5-Brn"], ja: "リューズブラスト", sr: "BW", codeAlias: "BW5" },
  { code: "BW5-Brz", sourceCacheKeys: ["BW5-Brz"], ja: "リューノブレード", sr: "BW", codeAlias: "BW5" },
  { code: "BW6-Bc", sourceCacheKeys: ["BW6-Bc"], ja: "フリーズボルト", sr: "BW", codeAlias: "BW6" },
  { code: "BW6-Bf", sourceCacheKeys: ["BW6-Bf"], ja: "コールドフレア", sr: "BW", codeAlias: "BW6" },
  { code: "BW7-B", sourceCacheKeys: ["BW7-B"], ja: "プラズマゲイル", sr: "BW", codeAlias: "BW7" },
  { code: "BW8-Brf", sourceCacheKeys: ["BW8-Brf"], ja: "ラセンフォース", sr: "BW", codeAlias: "BW8" },
  { code: "BW8-Brn", sourceCacheKeys: ["BW8-Brn"], ja: "ライデンナックル", sr: "BW", codeAlias: "BW8" },
  { code: "BW9-B", sourceCacheKeys: ["BW9-B"], ja: "メガロキャノン", sr: "BW", codeAlias: "BW9" },

  // 追加依頼（2026-08-27、docs/task-bw-xy.mdステップ4横展開の続き）:
  // コンセプトパック（CP1〜CP6）・文字マーク単独セット（XYA〜XYH）を追加。
  // codeAliasはCPr/CPs/CPmを含む全17セットで、details.phpのimg-regulation altテキスト
  // （公式サイトが画像バッジに直接付与している代替テキスト）で機械的に確認した上、
  // CP1・CPrについては画像を目視でも照合し、印字されたバッジ文字列と一致することを確認済み。
  // sourceCacheKeysはofficial-card-cache.json上でも単一キー（分裂なし）。
  //
  // ja/yの出典: CP1〜CP4はTCGdex（https://api.tcgdex.net/v2/ja/sets/{id}）のname/releaseDateを
  // 直接取得（確度: 高）。CP5/CP6・XYA〜XYHはTCGdexに項目が無いため、Web検索で見つけた
  // 二次情報源（トレ研ポケカ等の集計ブログ）に基づく（確度: 中。番号・レアリティ等の
  // カード本体データはdetails.php由来で無関係、影響するのは表示用のset名・年のみ）。
  //
  // レアリティ: CP1/CP2/CP3/CP6はレアリティアイコンあり。CP4/CP5とXYA〜XYHは
  // アイコンなし（rarity=""になる。既存のRARITY_CODE_MAP・検証ロジックに変更不要、
  // XYA〜XYHについては依頼書の事前予告通り）。
  { code: "CP1", sourceCacheKeys: ["CP1"], ja: "マグマ団VSアクア団 ダブルクライシス", sr: "XY", y: 2015, codeAlias: "CP1" },
  { code: "CP2", sourceCacheKeys: ["CP2"], ja: "伝説キラコレクション", sr: "XY", y: 2015, codeAlias: "CP2" },
  { code: "CP3", sourceCacheKeys: ["CP3"], ja: "ポケキュンコレクション", sr: "XY", y: 2016, codeAlias: "CP3" },
  // official-card-cache.jsonのスキャン漏れで015/131(ブリガロンBREAK)・055/131(ソーナンスBREAK)が
  // 欠落していたため、cardIdを直接指定して補った（XY8-11と同じ原因・対処。CP4は商品名通り
  // BREAK進化を含むため発生。両カードともレアリティアイコンなし＝CP4全体の仕様と一致）。
  // 逆に基本エネルギー9種（草/炎/水/雷/超/闘/悪/鋼/フェアリー、cardId 31997-32005）は
  // details.phpで確認したところ"NNN/NNN"表記自体が無い汎用インサートだったため除外した
  // （セット内に番号付きの「ダブル無色エネルギー」131/131は別途存在し、そちらは通常通り採用）
  {
    code: "CP4", sourceCacheKeys: ["CP4"],
    extraCardIds: [31880, 31920],
    excludeCardIds: [31997, 31998, 31999, 32000, 32001, 32002, 32003, 32004, 32005],
    ja: "プレミアムチャンピオンパック EX×M×BREAK", sr: "XY", y: 2016, codeAlias: "CP4",
  },
  // y=2016-09-16（Web検索、確度: 中）
  { code: "CP5", sourceCacheKeys: ["CP5"], ja: "幻・伝説ドリームキラコレクション", sr: "XY", y: 2016, codeAlias: "CP5" },
  // y=2017-04-21（Web検索、確度: 中）
  // official-card-cache.jsonのスキャン漏れで016/087(キュウコンBREAK)・030/087(スターミーBREAK)・
  // 044/087(ニドキングBREAK)・058/087(カイリキーBREAK)が欠落していたため、cardIdを直接指定して
  // 補った（XY8-11・CP4と同じ原因・対処）
  {
    code: "CP6", sourceCacheKeys: ["CP6"],
    extraCardIds: [32222, 32236, 32250, 32264],
    ja: "ポケットモンスターカードゲーム 拡張パック 20th Anniversary", sr: "XY", y: 2017, codeAlias: "CP6",
  },

  // XYA〜XYHは拡張パック本弾ではなく構築済みデッキ専用の文字マーク（依頼書の事前調査通り、
  // レアリティアイコン・1 EDITIONマークとも無し）。ja名はデッキ商品名（Web検索、確度: 中）
  { code: "XYA", sourceCacheKeys: ["XYA"], ja: "メガバトルデッキ60「MリザードンEX」", sr: "XY", y: 2014, codeAlias: "XYA" },
  { code: "XYB", sourceCacheKeys: ["XYB"], ja: "ハイパーメタルチェーンデッキ60「ディアルガEX+ギルガルドEX」", sr: "XY", y: 2014, codeAlias: "XYB" },
  { code: "XYC", sourceCacheKeys: ["XYC"], ja: "スーパーレジェンドセット60「ゼルネアスEX・イベルタルEX」", sr: "XY", y: 2014, codeAlias: "XYC" },
  { code: "XYD", sourceCacheKeys: ["XYD"], ja: "メガバトルデッキ60「MレックウザEX」", sr: "XY", y: 2015, codeAlias: "XYD" },
  { code: "XYE", sourceCacheKeys: ["XYE"], ja: "対戦スタートセット30「エンブオーEX VS トゲキッスEX」", sr: "XY", y: 2015, codeAlias: "XYE" },
  // official-card-cache.jsonのスキャン漏れで003/016(ゴルダックBREAK)が欠落していたため、
  // cardIdを直接指定して補った（商品名通りBREAK進化を含むため。XY8-11・CP4・CP6と同じ原因・対処）
  { code: "XYF", sourceCacheKeys: ["XYF"], extraCardIds: [31450], ja: "BREAKコンボデッキ60「ゴルダックBREAK+パルキアEX」", sr: "XY", y: 2015, codeAlias: "XYF" },
  // official-card-cache.jsonのスキャン漏れで008/019(メレシーBREAK)が欠落していたため、
  // cardIdを直接指定して補った（同じ原因・対処）
  { code: "XYG", sourceCacheKeys: ["XYG"], extraCardIds: [31820], ja: "パーフェクトバトルデッキ60「ジガルデEX」", sr: "XY", y: 2016, codeAlias: "XYG" },
  { code: "XYH", sourceCacheKeys: ["XYH"], ja: "メガバトルデッキ60「MタブンネEX」", sr: "XY", y: 2016, codeAlias: "XYH" },

  // CPr/CPs/CPm: official-card-cache.json上は"CP"接頭辞だがCP1〜CP6とは無関係。
  // 実体は2007年ダイヤモンド&パール世代のプロモ（cardIdが23500番台、収録ポケモンが
  // 全て第4世代、画像に©2007表記・DP期特有の"Lv.X"テンプレートを確認）。
  // docs/task-bw-xy.mdの「対象外: DP/DPt世代」に本来該当するが、ユーザー指示により
  // DP除外方針を無視してこのタスクで取り込む（2026-08-27確認）。
  // ただしDP除外の理由だった「DPBP#001〜530の種族単位通し番号・印刷バリエーション判別不可」
  // 問題はここには当てはまらない: CPr/CPs/CPmは各セット内で001/0NN形式の独立した連番
  // （BW/XYと同じデータモデル）であることをdetails.phpで確認済み。
  // ja名: 公式・非公式とも出典が見つからなかったため空欄のまま（推測で埋めない）。
  // sr="DP"はSERIE_ORDER（src/App.jsx）に既存のキーを流用（SERIE_EN_NAMESには未登録のため
  // 英語シリーズ名はタイトルに付与されないが、これは「不明な呼称は推測で埋めない」の
  // 既存方針通り。y=2007は画像の©表記から確認（確度: 高、ただし正確な発売月日は不明）
  { code: "CPr", sourceCacheKeys: ["CPr"], ja: "", sr: "DP", y: 2007, codeAlias: "CPr" },
  { code: "CPs", sourceCacheKeys: ["CPs"], ja: "", sr: "DP", y: 2007, codeAlias: "CPs" },
  { code: "CPm", sourceCacheKeys: ["CPm"], ja: "", sr: "DP", y: 2007, codeAlias: "CPm" },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// resultAPI.phpのcardNameViewText同様、details.phpの<title>もHTMLエスケープされて
// 返る場合がある（過去の実例: S-PのTAG TEAMカード"グズマ&amp;ハラ"）。
// 今回取得するXY1には実例が無かったが、無条件で適用する（コストゼロの防御のため）
function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// cardThumbFile のファイル名先頭6桁 ("030046_P_FUSHIGIBANAEX.jpg") がそのまま cardID
function extractCardId(cardThumbFile) {
  const m = cardThumbFile.match(/\/(\d+)_/);
  return m ? String(parseInt(m[1], 10)) : null;
}

// details.php のレアリティアイコン画像ファイル名（例: ic_rare_rr.gif, ic_rare_sr_c.gif）から
// 抽出したコードを、既存cardData.jsonのレアリティ表記（RARITIES配列と同じ大文字表記）に変換する。
// 実データ調査（CLAUDE.md参照、180枚サンプリング）で確認できたのはこの6種のみ
const RARITY_CODE_MAP = { c_c: "C", u_c: "U", r_c: "R", rr: "RR", sr_c: "SR", ur_c: "UR" };

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// details.php から番号・総数・レアリティ・日本語名を取得する。
// 番号（img-regulation直後の "NNN / NNN" 表記）が取得できないカードはnullを返し、
// 呼び出し側で失敗扱いにする（絶対にやってはいけないこと: 番号未検証のまま取り込むこと）
async function fetchCardDetail(cardId) {
  const url = `${API_BASE}/card-search/details.php/card/${cardId}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      const numM = html.match(/&nbsp;(\d+)&nbsp;\/&nbsp;(\d+)&nbsp;/);
      if (!numM) return null;
      const rarM = html.match(/ic_rare_([a-z0-9_]+)\.gif/);
      const titleM = html.match(/<title>([^<]*)<\/title>/);
      const rawName = titleM ? titleM[1].replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ$/, "") : null;
      if (!rawName) return null;
      // 画像パスはdetails.php自身にも埋め込まれている（<img class="fit" src="...">）。
      // official-card-cache.jsonに載っていないcardId（extraCardIds、スキャン漏れの救済用）でも
      // ここから画像パスを取得できるため、cardThumbFileの別ソースとして使う
      const imgM = html.match(/<img class="fit" src="([^"]+)"/);
      return {
        local: numM[1],
        total: numM[2],
        rarity: rarM ? (RARITY_CODE_MAP[rarM[1]] ?? null) : "",
        jaName: decodeHtmlEntities(rawName),
        cardThumbFile: imgM ? imgM[1] : null,
      };
    } catch {
      if (i < 2) await sleep(1000 * (i + 1));
    }
  }
  return null;
}

async function downloadImage(cardThumbFile, destPath) {
  const url = `${API_BASE}${cardThumbFile}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": HEADERS["User-Agent"], "Referer": API_BASE + "/" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (r.status === 404) return null;
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 1000) return buf;
      }
    } catch {}
    await sleep(500 * (i + 1));
  }
  return null;
}

async function main() {
  if (!(await exists(CACHE_PATH))) {
    throw new Error(
      `${CACHE_PATH} が見つかりません。先に node scripts/scrape-official-images.mjs --rescan を実行してください。`
    );
  }
  const cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));
  const setMap = cache.setMap;

  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const existingCodes = new Set(cardData.map((s) => s.c));

  const report = { generatedAt: new Date().toISOString(), sets: {} };
  let anyAdded = false;

  for (const target of TARGET_SETS) {
    if (existingCodes.has(target.code)) {
      console.log(`[${target.code}] 既にcardData.jsonに存在するためスキップ`);
      continue;
    }
    const sourceKeys = target.sourceCacheKeys || [target.code];
    const officialCards = sourceKeys.flatMap((key) => setMap[key] || []);
    if (officialCards.length === 0) {
      throw new Error(
        `[${target.code}] official-card-cache.jsonに見つかりません（探索キー: ${sourceKeys.join(", ")}）。` +
        `--rescanを試すか、setCodeを確認してください。`
      );
    }

    // extraCardIds: official-card-cache.jsonのスキャン漏れで欠番になったcardIdを
    // 個別に補う（例: XY8-BbのゾロアークBREAK/フラージェスBREAKがキャッシュから漏れていた）。
    // cardThumbFileはキャッシュに無いため、details.php自身から取得する
    // excludeCardIds: 逆に、キャッシュには載っているがセット固有の番号を持たないカード
    // （例: CP4の基本エネルギー9種。details.phpで確認済み＝"NNN/NNN"表記自体が無い、
    // 汎用インサートで欠番/失敗ではない）を明示的に除外する。無検証で除外しないこと
    // （details.phpで番号なしと確認した上でのみリストに追加する）
    const excludeSet = new Set((target.excludeCardIds || []).map(String));
    const cacheJobs = officialCards
      .map((c) => ({ cardId: extractCardId(c.cardThumbFile), cardThumbFile: c.cardThumbFile }))
      .filter((j) => j.cardId && !excludeSet.has(j.cardId));
    const extraJobs = (target.extraCardIds || []).map((cardId) => ({ cardId: String(cardId), cardThumbFile: null }));
    const jobs = [...cacheJobs, ...extraJobs];

    console.log(`[${target.code}] ${jobs.length}枚（探索キー: ${sourceKeys.join(", ")}${extraJobs.length ? `, +extraCardIds×${extraJobs.length}` : ""}）を details.php で検証中...`);

    const details = [];
    const failed = [];
    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        const detail = await fetchCardDetail(job.cardId);
        // cardThumbFileはキャッシュ側の値を優先（同一のはずだが、既存の挙動を変えないため）。
        // 無ければdetails.php自身から取得した値にフォールバックする（extraCardIds用）。
        // 両方とも無ければ画像パスが取れていないため失敗扱いにする
        const cardThumbFile = job.cardThumbFile || detail?.cardThumbFile;
        if (detail && cardThumbFile) details.push({ ...detail, cardThumbFile });
        else failed.push(job.cardId);
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers);

    if (failed.length > MAX_FAILED_CARDS) {
      throw new Error(
        `[${target.code}] 番号取得に失敗したカード数(${failed.length})が上限(${MAX_FAILED_CARDS})を超えました。` +
        `不完全なデータをcardData.jsonに書き込まず中断します。失敗ID: [${failed.join(", ")}]`
      );
    }

    // 番号の重複・欠番・レアリティ未取得をチェックしてから採用する
    // （絶対にやってはいけないこと: 未検証データの投入、掲載順=番号順の無検証採用）
    //
    // 例外: 2デッキ同梱の対戦スタートセット（例: XYE）は、両デッキ共通のトレーナー/エネルギー
    // カードが公式サイト上で「デッキA用ページ」「デッキB用ページ」の2箇所にそれぞれ別cardIDで
    // 掲載されており、official-card-cache.jsonにも2件載る（実例: XYEの017/022スーパーボールが
    // cardID 031128と031144の2件。details.phpで両方確認したところ番号・カード名・イラストレーター
    // まで完全一致、画像も同一デザインの別スキャンだった）。これは「番号の奪い合い」ではなく
    // 同じ印刷カードの二重掲載なので、jaNameが完全一致する場合に限りスキップ（後勝ちを採用）する。
    // jaNameが食い違う場合は本来の異常（絶対にやってはいけないこと）としてthrowする
    const byLocal = new Map();
    for (const d of details) {
      const n = parseInt(d.local, 10);
      if (byLocal.has(n)) {
        const prev = byLocal.get(n);
        if (prev.jaName === d.jaName) continue;
        throw new Error(`[${target.code}] 番号 ${d.local} が重複しています（cardID差異を確認してください）。既存: ${prev.jaName} / 新規: ${d.jaName}`);
      }
      if (d.rarity === null) {
        throw new Error(`[${target.code}] cardID未知のレアリティコードを検出しました: ${JSON.stringify(d)}`);
      }
      byLocal.set(n, d);
    }
    const totals = new Set(details.map((d) => d.total));
    if (totals.size > 1) {
      throw new Error(`[${target.code}] 総数(total)が一致しません: ${[...totals].join(", ")}`);
    }
    const total = parseInt([...totals][0], 10);
    // 欠番チェックは1〜totalだけでなく1〜「実際に見つかった最大番号」まで行う
    // （scrape-missing-sets.mjs側でM2aのシークレット範囲欠落バグを機に導入した修正を
    // 移植。このスクリプト自体はBW/XY/CP/XYマークの取り込みで既に役目を終えており
    // 以後のフェーズでは使わないが、万一再実行された場合の安全のため同期しておく）
    const maxLocal = Math.max(...byLocal.keys());
    const missing = [];
    for (let n = 1; n <= maxLocal; n++) {
      if (!byLocal.has(n)) missing.push(n);
    }
    if (missing.length > 0) {
      throw new Error(`[${target.code}] 欠番があります（1〜${maxLocal}のうち。total=${total}）: ${missing.join(", ")}`);
    }

    const sortedLocals = [...byLocal.keys()].sort((a, b) => a - b);
    const k = sortedLocals.map((n) => {
      const d = byLocal.get(n);
      return [String(n).padStart(3, "0"), d.jaName, "", d.rarity];
    });

    const newSet = { c: target.code, ja: target.ja, en: "", sr: target.sr, of: total, y: target.y, k };
    if (target.codeAlias) newSet.codeAlias = target.codeAlias;
    cardData.push(newSet);
    anyAdded = true;

    console.log(`[${target.code}] 番号検証OK: ${k.length}枚（001〜${String(total).padStart(3, "0")}、失敗 ${failed.length}件）`);

    // 画像を取得
    const setTotal = computeSetTotal(newSet.k);
    let imgDownloaded = 0, imgSkipped = 0, imgFailed = 0;
    let idx2 = 0;
    const workers2 = Array.from({ length: CONCURRENCY }, async () => {
      while (idx2 < sortedLocals.length) {
        const n = sortedLocals[idx2++];
        const d = byLocal.get(n);
        const localId = String(n).padStart(3, "0");
        const dest = path.join(
          OUT_DIR, target.sr, target.code,
          buildFileName(d.jaName, target.code, localId, d.rarity, setTotal) + ".jpg"
        );
        if (await isUsableImage(dest)) { imgSkipped++; continue; }
        const buf = await downloadImage(d.cardThumbFile, dest);
        if (buf) { await writeFileAtomic(dest, buf); imgDownloaded++; }
        else imgFailed++;
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers2);

    console.log(`[${target.code}] 画像: 取得${imgDownloaded} スキップ${imgSkipped} 失敗${imgFailed}`);
    report.sets[target.code] = {
      cards: k.length, cardFailed: failed.length, cardFailedIds: failed,
      imgDownloaded, imgSkipped, imgFailed,
    };

    // 1セットごとにcardData.jsonへ書き込む（TARGET_SETS内の後続セットで例外が
    // 発生しても、ここまでに成功したセットの取り込みが失われないようにするため。
    // 「1セットずつ取り込み、都度受け入れ条件を確認する」運用と対応させている
    await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[${target.code}] cardData.json を更新しました。\n`);
  }

  if (!anyAdded) {
    console.log("\n追加対象はありませんでした（既に取り込み済み）。");
  }
  console.log("詳細: scripts/scrape-bw-xy-report.json");
}

main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
