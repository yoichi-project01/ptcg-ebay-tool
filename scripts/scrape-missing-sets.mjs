#!/usr/bin/env node
/**
 * 未収録セットのカードデータ取得（全世代共通・フェーズ制）
 *
 * 背景: official-card-cache.json（322セット）に対し cardData.json は一部のみで、
 * 未収録セット・カード枚数が大量に残っている。本スクリプトは scripts/scrape-bw-xy.mjs
 * （BW・XY世代向けに確立した取得ロジック）をそのまま汎用化したもの。
 * ロジック自体はBW/XYで実績のあるものを一切変更していない。
 *
 * 番号・レアリティは pokemon-card.com の details.php から取得する（経路A）。
 * resultAPI.php（official-card-cache.json の元データ）はカード番号を含まないため、
 * この2つを組み合わせて使う: official-card-cache.json でカードID一覧を得て、
 * details.php で1枚ずつ番号・総数・レアリティ・(HTMLデコード済みの)日本語名を検証する。
 *
 * 対象セットは TARGET_SETS のホワイトリストに明記したものだけを処理する
 * （official-card-cache.jsonのキーを機械的に列挙しない。正体不明のセットが
 * 混入するのを防ぐため。BW/XY調査で正体不明の裸"BW"/"XY"キーが見つかった実例がある）。
 *
 * フェーズごとに TARGET_SETS へ追記していく運用とする（1セットずつ検証、
 * 失敗したら停止して報告。詳細は docs/task-missing-sets.md 相当の依頼文を参照）。
 *
 * 使い方:
 *   node scripts/scrape-missing-sets.mjs
 *
 * 前提: scripts/official-card-cache.json が存在すること
 *   （無ければ node scripts/scrape-official-images.mjs --rescan を先に実行）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");
const REPORT_PATH = path.join(__dirname, "scrape-missing-sets-report.json");

const API_BASE = "https://www.pokemon-card.com";
const CONCURRENCY = 3;
// フェーズ3再開時（2026-08-29）にMC取り込み中でCloudFrontのレート制限(HTTP 403)を
// 受けたため、400→800に引き上げた（ユーザー指示）。CONCURRENCYは3のまま維持
const DELAY_MS = 800;
const FETCH_TIMEOUT_MS = 15000;
// 失敗カード数がこの件数を超えたら、不完全なデータをcardData.jsonに書き込まず異常終了する
const MAX_FAILED_CARDS = 5;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

// === フェーズ1: S世代 初期（S1W/S1H/S1a/S2/S2a/S3/S3a） ===
// ja/y: TCGdex（https://api.tcgdex.net/v2/ja/sets/{id}）のname/releaseDateを直接取得（確度: 高）
// codeAlias: 7セット全件、details.phpのimg-regulation altテキストで機械的に確認し、
// S3の001/100（パラス）を画像でも目視照合済み（バッジ文字列"s3"・番号・レアリティが一致）。
// 印刷テンプレートは既存のS4以降と同じ「モダン」形式（Dマーク付き）であることを画像で確認済みのため、
// buildModernTitle等の既存分岐に変更は不要（旧裏/BW-XY特有の分岐パターンの複製は不要）。
// en: 取得しない（既存方針通り空欄のまま。TCGdexに英語版シリーズ情報があっても、過去に
// インドネシア語混入が見つかった経緯があるため、cardData.json内のデータを信頼した復元はしない）
const TARGET_SETS = [
  { code: "S1W", sourceCacheKeys: ["S1W"], ja: "ソード", sr: "S", y: 2019, codeAlias: "S1W" },
  { code: "S1H", sourceCacheKeys: ["S1H"], ja: "シールド", sr: "S", y: 2019, codeAlias: "S1H" },
  { code: "S1a", sourceCacheKeys: ["S1a"], ja: "VMAXライジング", sr: "S", y: 2020, codeAlias: "S1a" },
  { code: "S2", sourceCacheKeys: ["S2"], ja: "反逆クラッシュ", sr: "S", y: 2020, codeAlias: "S2" },
  { code: "S2a", sourceCacheKeys: ["S2a"], ja: "爆炎ウォーカー", sr: "S", y: 2020, codeAlias: "S2a" },
  { code: "S3", sourceCacheKeys: ["S3"], ja: "ムゲンゾーン", sr: "S", y: 2020, codeAlias: "S3" },
  { code: "S3a", sourceCacheKeys: ["S3a"], ja: "伝説の鼓動", sr: "S", y: 2020, codeAlias: "S3a" },

  // SD: 本弾7セット完了後に検証。official-card-cache.json上127枚、details.phpで
  // 全件1〜127の欠番・重複なしを事前確認済み（cardId 38273=フシギバナV=001/127から連番）。
  // codeAliasは画像を目視確認済み（バッジ"sD"、レアリティ表記なし＝V系スターター商品の仕様）。
  // ja/y: Web検索（確度: 中。「スタートデッキ100」、2021-12-17発売・790円という一致する
  // 複数の言及を確認）。SAは同じ探索キーの中に「スターターセットV 草/炎/水/雷/闘」という
  // 5つの異なる商品が同じ番号帯(001〜023/024)で重複しており（例: 001がセレビィV/ロコン/
  // シェルダー/ピカチュウ/ディグダの5通り）、単一セットとして表現できないため対象外とした
  // （どのカードがどのデッキに属するか、公式サイト上に判別手段が見つからなかった。
  // 推測で割り振らない。DP世代の種族単位番号問題と同種の「番号だけでは一意に特定できない」
  // ケースとして別タスク行きとする）
  { code: "SD", sourceCacheKeys: ["SD"], ja: "スタートデッキ100", sr: "S", y: 2021, codeAlias: "SD" },

  // === フェーズ2: SM世代 本弾（SM1S〜SM12a、35セット） ===
  // ja/y: TCGdex（https://api.tcgdex.net/v2/ja/sets/{id}）のname/releaseDateを直接取得
  // （確度: 高。SM1p/SM2p/SM3p/SM4p/SM5pはTCGdex側のid表記が"SM1+"/"sm2+"/"SM3+"/"SM4+"/"SM5+"
  // という別表記だが、cardCount.officialが001/0NNのNNNと一致することで対応関係を確認した）。
  // codeAlias: 35セット全件、details.phpのimg-regulation altテキストで確認（全件setCode＝
  // codeAliasと一致）。SM1S・SM9(TAG TEAM GX、&のHTMLエンティティ含む)・SM12a(全210枚中
  // 最大セット)の3セットを画像でも目視照合済み（バッジ・番号・レアリティ・"&"を含む
  // カード名の復号が正しく行われることを確認）。印刷テンプレートは既存のS/SV系と同じ
  // モダン形式であることを確認済みで、buildModernTitle等の既存分岐に変更は不要。
  // レアリティ: SM1p/SM2p/SM3p/SM4p/SM5p/SM8bはレアリティアイコンなし（rarity=""になる。
  // CP4/CP5等と同じ挙動）。それ以外はC/U/R/RR等の通常表記
  { code: "SM1S", sourceCacheKeys: ["SM1S"], ja: "コレクションサン", sr: "SM", y: 2016, codeAlias: "SM1S" },
  { code: "SM1M", sourceCacheKeys: ["SM1M"], ja: "コレクションムーン", sr: "SM", y: 2016, codeAlias: "SM1M" },
  { code: "SM1p", sourceCacheKeys: ["SM1p"], ja: "サン＆ムーン", sr: "SM", y: 2017, codeAlias: "SM1p" },
  { code: "SM2K", sourceCacheKeys: ["SM2K"], ja: "キミを待つ島々", sr: "SM", y: 2017, codeAlias: "SM2K" },
  { code: "SM2L", sourceCacheKeys: ["SM2L"], ja: "アローラの月光", sr: "SM", y: 2017, codeAlias: "SM2L" },
  { code: "SM2p", sourceCacheKeys: ["SM2p"], ja: "新たなる試練の向こう", sr: "SM", y: 2017, codeAlias: "SM2p" },
  { code: "SM3H", sourceCacheKeys: ["SM3H"], ja: "闘う虹を見たか", sr: "SM", y: 2017, codeAlias: "SM3H" },
  { code: "SM3N", sourceCacheKeys: ["SM3N"], ja: "光を喰らう闇", sr: "SM", y: 2017, codeAlias: "SM3N" },
  { code: "SM3p", sourceCacheKeys: ["SM3p"], ja: "ひかる伝説", sr: "SM", y: 2017, codeAlias: "SM3p" },
  { code: "SM4S", sourceCacheKeys: ["SM4S"], ja: "覚醒の勇者", sr: "SM", y: 2017, codeAlias: "SM4S" },
  { code: "SM4A", sourceCacheKeys: ["SM4A"], ja: "超次元の暴獣", sr: "SM", y: 2017, codeAlias: "SM4A" },
  { code: "SM4p", sourceCacheKeys: ["SM4p"], ja: "GXバトルブースト", sr: "SM", y: 2017, codeAlias: "SM4p" },
  { code: "SM5S", sourceCacheKeys: ["SM5S"], ja: "ウルトラサン", sr: "SM", y: 2017, codeAlias: "SM5S" },
  { code: "SM5M", sourceCacheKeys: ["SM5M"], ja: "ウルトラムーン", sr: "SM", y: 2017, codeAlias: "SM5M" },
  { code: "SM5p", sourceCacheKeys: ["SM5p"], ja: "ウルトラフォース", sr: "SM", y: 2018, codeAlias: "SM5p" },
  { code: "SM6", sourceCacheKeys: ["SM6"], ja: "禁断の光", sr: "SM", y: 2018, codeAlias: "SM6" },
  { code: "SM6a", sourceCacheKeys: ["SM6a"], ja: "ドラゴンストーム", sr: "SM", y: 2018, codeAlias: "SM6a" },
  { code: "SM6b", sourceCacheKeys: ["SM6b"], ja: "チャンピオンロード", sr: "SM", y: 2018, codeAlias: "SM6b" },
  { code: "SM7", sourceCacheKeys: ["SM7"], ja: "裂空のカリスマ", sr: "SM", y: 2018, codeAlias: "SM7" },
  { code: "SM7a", sourceCacheKeys: ["SM7a"], ja: "迅雷スパーク", sr: "SM", y: 2018, codeAlias: "SM7a" },
  { code: "SM7b", sourceCacheKeys: ["SM7b"], ja: "フェアリーライズ", sr: "SM", y: 2018, codeAlias: "SM7b" },
  { code: "SM8", sourceCacheKeys: ["SM8"], ja: "超爆インパクト", sr: "SM", y: 2018, codeAlias: "SM8" },
  { code: "SM8a", sourceCacheKeys: ["SM8a"], ja: "ダークオーダー", sr: "SM", y: 2018, codeAlias: "SM8a" },
  { code: "SM8b", sourceCacheKeys: ["SM8b"], ja: "GXウルトラシャイニー", sr: "SM", y: 2018, codeAlias: "SM8b" },
  { code: "SM9", sourceCacheKeys: ["SM9"], ja: "タッグボルト", sr: "SM", y: 2018, codeAlias: "SM9" },
  { code: "SM9a", sourceCacheKeys: ["SM9a"], ja: "ナイトユニゾン", sr: "SM", y: 2019, codeAlias: "SM9a" },
  { code: "SM9b", sourceCacheKeys: ["SM9b"], ja: "フルメタルウォール", sr: "SM", y: 2019, codeAlias: "SM9b" },
  { code: "SM10", sourceCacheKeys: ["SM10"], ja: "ダブルブレイズ", sr: "SM", y: 2019, codeAlias: "SM10" },
  { code: "SM10a", sourceCacheKeys: ["SM10a"], ja: "ジージーエンド", sr: "SM", y: 2019, codeAlias: "SM10a" },
  { code: "SM10b", sourceCacheKeys: ["SM10b"], ja: "スカイレジェンド", sr: "SM", y: 2019, codeAlias: "SM10b" },
  { code: "SM11", sourceCacheKeys: ["SM11"], ja: "ミラクルツイン", sr: "SM", y: 2019, codeAlias: "SM11" },
  { code: "SM11a", sourceCacheKeys: ["SM11a"], ja: "リミックスバウト", sr: "SM", y: 2019, codeAlias: "SM11a" },
  { code: "SM11b", sourceCacheKeys: ["SM11b"], ja: "ドリームリーグ", sr: "SM", y: 2019, codeAlias: "SM11b" },
  { code: "SM12", sourceCacheKeys: ["SM12"], ja: "オルタージェネシス", sr: "SM", y: 2019, codeAlias: "SM12" },
  { code: "SM12a", sourceCacheKeys: ["SM12a"], ja: "TAG TEAM GX タッグオールスターズ", sr: "SM", y: 2019, codeAlias: "SM12a" },

  // === フェーズ2続き: SM世代 文字コード系（SMA〜SMN、14セット） ===
  // 着手前にSA（フェーズ1で対象外にした「5商品が番号帯を共有」パターン）と同種の
  // リスクがないか、全14セットについて事前に(番号, 総数, 日本語名)の組み合わせを
  // 検証した。SMA/SMHは複数の商品名（スターターセット草/炎/水、GXスタートデッキ各種）に
  // 対応するとWeb検索で分かったが、実際には商品間で番号を共有しておらず1つの連続した
  // 番号帯（SMA=1-59, SMH=1-131）として一貫していることを確認済み（同一番号に異なる
  // カード名が対応する例は0件）。SAのような一意特定不可能なケースには該当しない。
  // codeAlias: 14セット全件、details.phpのimg-regulation altテキストで確認（全件setCode＝
  // codeAliasと一致）。レアリティアイコンは14セット全件で確認できず（rarity=""になる。
  // XYA〜XYH・CP4/CP5と同じ、構築済みデッキ専用商品の仕様）。
  // ja/y: TCGdexに項目が無いため、Web検索（トレ研ポケカのエキスパンションマーク一覧）に基づく
  // （確度: 中。XYA〜XYHの時と同じ情報源）。SMA/SMHは複数商品名が対応するため、代表的な
  // 商品名を1つ選ぶのではなく複数名を併記した
  // 基本エネルギー9種（cardId 33218-33226）はdetails.phpで確認したところ番号表記が
  // 無い汎用インサートだったため除外した（CP4等と同じ既知パターン）
  {
    code: "SMA", sourceCacheKeys: ["SMA"],
    excludeCardIds: [33218, 33219, 33220, 33221, 33222, 33223, 33224, 33225, 33226],
    ja: "スターターセット草/炎/水（ジュナイパーGX/ガオガエンGX/アシレーヌGX）", sr: "SM", y: 2016, codeAlias: "SMA",
  },
  // SMBのキャッシュは001-006/018のみで、007-018/018は別キー"SM-XY"に格納されていた
  // （XY6-B/XY6等と同じ「1商品が複数キーに分裂」パターン。ただしこちらは商品内でカードの
  // 印刷バッジ自体が"SMB"と"SM-XY"の2種に分かれている実例＝XY時代のキャラクター
  // （N・フラダリ・プラターヌ博士等）の再録カードに"SM-XY"という別マークが付与されている）。
  // sourceCacheKeysを両方指定してマージした。裸の"SM-XY"を独立商品として誤って
  // 取り込まないよう、TARGET_SETSには"SM-XY"単体のエントリを別途追加していない。
  // 【既知の精度限界】codeAlias（画面表示用の型番）はセット単位の1値しか持てないため
  // "SMB"を設定しているが、007-018番のカードは実物の印字が"SMB"ではなく"XY"（画像で
  // 目視確認済み）。この12枚に限りcodeAliasの表示が実物と一致しない。CLAUDE.md参照
  {
    code: "SMB", sourceCacheKeys: ["SMB", "SM-XY"],
    excludeCardIds: [33190, 33191, 33192, 33193, 33194, 33195, 33196, 33197, 33198],
    ja: "プレミアムトレーナーボックス（サン&ムーン）", sr: "SM", y: 2016, codeAlias: "SMB",
  },
  { code: "SMC", sourceCacheKeys: ["SMC"], ja: "スターターセット改造「カプ・ブルルGX」", sr: "SM", y: 2017, codeAlias: "SMC" },
  { code: "SMD", sourceCacheKeys: ["SMD"], ja: "30枚デッキ対戦セット「サトシVSロケット団」", sr: "SM", y: 2017, codeAlias: "SMD" },
  { code: "SME", sourceCacheKeys: ["SME"], ja: "スターターセット伝説 ソルガレオGX ルナアーラGX", sr: "SM", y: 2017, codeAlias: "SME" },
  // SMFのキャッシュは001-012/020のみで、013-020/020は正体不明の裸"XY"キー
  // （396枚、多数の無関係な商品の再録カードが混在する共有プール。BW/XY調査時に
  // 「正体不明のため対象外」としていたもの）に格納されていた。裸"XY"キーを丸ごと
  // sourceCacheKeysでマージすると無関係なカードまで大量に混入するため、SMFに属する
  // 8枚のcardIdのみをextraCardIdsで個別指定した（1つずつdetails.phpで番号013-020/020と
  // 確認済み）。【既知の精度限界】SMBと同様、013-020番の8枚は実物の印字が"SMF"ではなく
  // "XY"（画像で目視確認済み）。codeAliasの表示はこの8枚には一致しない
  {
    code: "SMF", sourceCacheKeys: ["SMF"],
    extraCardIds: [34527, 34528, 34529, 34530, 34531, 34532, 34533, 34534],
    ja: "プレミアムトレーナーボックス ウルトラサン・ウルトラムーン", sr: "SM", y: 2017, codeAlias: "SMF",
  },
  // 同じパターン: SMGのキャッシュは001-012/041のみで、013-041/041(29枚)が裸"XY"キーに
  // 格納されていた。全29枚をextraCardIdsで個別指定した。【既知の精度限界】013-041番の
  // 29枚は実物の印字が"SMG"ではなく"XY"（画像で目視確認済み）
  {
    code: "SMG", sourceCacheKeys: ["SMG"],
    extraCardIds: [34637, 34638, 34639, 34640, 34641, 34642, 34643, 34644, 34645, 34646, 34647, 34648, 34649, 34650, 34651, 34652, 34653, 34654, 34655, 34656, 34657, 34658, 34659, 34660, 34661, 34662, 34663, 34664, 34665],
    ja: "デッキビルドBOX「ウルトラサン」「ウルトラムーン」", sr: "SM", y: 2018, codeAlias: "SMG",
  },
  { code: "SMH", sourceCacheKeys: ["SMH"], ja: "GXスタートデッキ（各種）", sr: "SM", y: 2018, codeAlias: "SMH" },
  { code: "SMI", sourceCacheKeys: ["SMI"], ja: "スターターセット「炎のブースターGX」ほか", sr: "SM", y: 2018, codeAlias: "SMI" },
  { code: "SMJ", sourceCacheKeys: ["SMJ"], ja: "プレミアムトレーナーボックス TAG TEAM GX", sr: "SM", y: 2018, codeAlias: "SMJ" },
  { code: "SMK", sourceCacheKeys: ["SMK"], ja: "トレーナーバトルデッキシリーズ", sr: "SM", y: 2019, codeAlias: "SMK" },
  {
    code: "SML", sourceCacheKeys: ["SML"],
    excludeCardIds: [36493, 36494, 36516, 36517, 36539, 36540],
    ja: "ファミリーポケモンカードゲーム", sr: "SM", y: 2019, codeAlias: "SML",
  },
  { code: "SMM", sourceCacheKeys: ["SMM"], ja: "スターターセット TAG TEAM GX", sr: "SM", y: 2019, codeAlias: "SMM" },
  { code: "SMN", sourceCacheKeys: ["SMN"], ja: "デッキビルドBOX「TAG TEAM GX」", sr: "SM", y: 2019, codeAlias: "SMN" },

  // === フェーズ3: M（メガ）世代の欠落分 ===
  // フェーズ3再開（2026-08-29、DELAY_MS=800に引き上げ後）。ユーザー指示で小さいセットから
  // 順に処理する。MG(34枚)は事前検証でSA（フェーズ1で対象外にした「複数商品が番号帯を共有」
  // パターン）と同型の衝突を確認したため対象外（k[0]-k[8]相当の9番号で異なるカード名が
  // 衝突。詳細はCLAUDE.md）。
  //
  // 【重要】MDB・MPS08・MMB-P・MMB-Sは画像確認の結果、2025年以降のMEGAシリーズとは
  // 無関係の旧世代カードと判明したため、このフェーズには含めていない（詳細はCLAUDE.md）:
  // - MDB: 001/046=ビクティニの実画像で©2012表記を確認（BW期）
  // - MPS08: 001/009=氷空のシェイミの実画像がDP期特有の小サイズ・"Lv.62"表記
  // - MMB-P/MMB-S: 001/049=リザードンEXの実画像で©2015表記を確認（XY期、
  //   "メガマスターデッキビルドBOX"のM="Master"であって"MEGA"ではないと判明）
  { code: "MA", sourceCacheKeys: ["MA"], ja: "プレミアムトレーナーボックス MEGA", sr: "M", y: 2025, codeAlias: "MA" },
  { code: "MBD", sourceCacheKeys: ["MBD"], ja: "スターターセットMEGA「メガディアンシーex」", sr: "M", y: 2025, codeAlias: "MBD" },
  { code: "MBG", sourceCacheKeys: ["MBG"], ja: "スターターセットMEGA「メガゲンガーex」", sr: "M", y: 2025, codeAlias: "MBG" },
  { code: "M5", sourceCacheKeys: ["M5"], ja: "アビスアイ", sr: "M", y: 2026, codeAlias: "M5" },
  { code: "M4", sourceCacheKeys: ["M4"], ja: "ニンジャスピナー", sr: "M", y: 2026, codeAlias: "M4" },
  // M-Pキャッシュ(114枚)は実際には2種の別物が混在していた: 23枚は"MP1"バッジ（総数023で
  // 一貫、正常に番号が振られた単一商品）、残り91枚は"M-P"バッジのままだが番号("NNN/NNN")
  // 自体が印字されていない個別プロモカード（S-P/SV-P同様、位置マッチング方式の別スクリプトが
  // 必要な種類のプロモで、本スクリプトの対象外）。前者のみ"MP1"として取り込み、
  // 後者91枚のcardIdは明示的にexcludeCardIdsで除外した
  {
    code: "MP1", sourceCacheKeys: ["M-P"],
    excludeCardIds: [48247,48248,48249,48250,48255,48256,48257,48258,48259,48260,48317,48321,48330,48480,48481,48482,48483,49621,49714,49715,49716,50036,50035,50037,50172,50038,50173,50174,50175,50176,50301,48251,48252,48253,48340,48316,48479,48484,48331,48485,48486,50179,49624,49628,49630,49717,50039,50040,50041,50171,50177,50178,48318,48319,48320,50042,50043,50044,50045,50046,50047,50168,50169,50170,50180,50181,50182,48332,48333,48334,48336,48335,48337,48338,48339,48308,48309,48310,48311,48312,48313,48314,48315,48322,48323,48324,48325,48326,48327,48328,48329],
    ja: "プロモカードパック第1弾", sr: "M", y: 2025, codeAlias: "MP1",
  },
  // 初回実行時にcardId 49982（222/193ジャミングタワー、SR）が一時的な通信エラーで
  // 取得失敗（1件のみ、MAX_FAILED_CARDS未満のため許容されカードデータ書き込み自体は
  // 成功したが、222番が総数193を超える「secret」範囲だったため1〜totalの欠番チェックに
  // 引っかからず気づかれにくい欠落になっていた）。cardData.jsonから該当セットを一度削除し、
  // extraCardIdsで明示的に再取得して補完した
  { code: "M2a", sourceCacheKeys: ["M2a"], extraCardIds: [49982], ja: "MEGAドリームex", sr: "M", y: 2025, codeAlias: "M2a" },
  // MC(774枚、全セット中最大)は着手前に画像で中身を確認するようユーザー指示があった。
  // 001/742=エリカのナゾノクサの実画像で©2025表記・"MC"バッジを確認済み、Web検索で
  // "MC"="MEGA Collection"（スタートデッキ100 バトルコレクション、2025-12-19発売の
  // ランダム封入デッキ商品の母集団プール）と判明した。フェーズ1のSD（スタートデッキ100）と
  // 同じ構造（1つの連続した番号帯を持つ単一の母集団プール）であることを事前に
  // 全774枚検証して確認済み（総数742で統一・欠番0・重複0・レアリティアイコン無し
  // ＝V/メガ系スターター商品の仕様・基本エネルギー8種のみ無番号）。
  {
    code: "MC", sourceCacheKeys: ["MC"],
    excludeCardIds: [49459, 49460, 49461, 49462, 49463, 49464, 49465, 49466],
    ja: "スタートデッキ100 バトルコレクション", sr: "M", y: 2025, codeAlias: "MC",
  },

  // === フェーズ5: LEGEND世代（2009〜2010年） ===
  // 番号形式はBW/XYと同じNNN/NNN。ただしLEGENDカード（2枚1組で1枚として機能する
  // カード。例:「エンテイ&ライコウLEGEND」）はofficial-card-cache.jsonのスキャンから
  // 全件漏れていることが判明した（BREAKカードの数枚単位の漏れとは規模が異なる、
  // LEGENDカードという種別まるごとの漏れ）。周辺cardIdを探索して発見し、extraCardIdsで
  // 個別に補った。1件のdetails.phpページに(上)(下)両方の番号・レアリティが埋め込まれて
  // いることが分かったため、parseCardDetailsFromHtml側で1cardIdから2件返せるよう
  // 対応済み（詳細はCLAUDE.md・同関数のコメント参照）。
  // ja/y: TCGdex（https://api.tcgdex.net/v2/ja/sets/{id}）から取得（確度: 高）。
  // codeAliasは7セット全件、details.phpのimg-regulation altテキストで確認（全件一致）。
  // レアリティ: c/u/r/sという1文字コード（BW/XY以降と異なる命名規則）とssを新規確認。
  // c→C, u→U, r→Rは既存表記と一致。s→RH（Rare Holo）、ss→LEGENDはいずれも英語版TCGの
  // 公式レアリティ名としてRARITIES配列に新規追加した（src/App.jsx参照）。
  {
    code: "L1-Bhg", sourceCacheKeys: ["L1-Bhg"], extraCardIds: [25027],
    ja: "ハートゴールドコレクション", sr: "L", y: 2009, codeAlias: "L1-Bhg",
  },
  {
    code: "L1-Bss", sourceCacheKeys: ["L1-Bss"], extraCardIds: [25186],
    ja: "ソウルシルバーコレクション", sr: "L", y: 2009, codeAlias: "L1-Bss",
  },
  {
    code: "L2-B", sourceCacheKeys: ["L2-B"], extraCardIds: [25693, 25697, 25701],
    ja: "よみがえる伝説", sr: "L", y: 2010, codeAlias: "L2-B",
  },
  {
    code: "L3-B", sourceCacheKeys: ["L3-B"], extraCardIds: [26170, 26171, 26172],
    ja: "頂上大激突", sr: "L", y: 2010, codeAlias: "L3-B",
  },
  {
    code: "LL", sourceCacheKeys: ["LL"], extraCardIds: [26067],
    ja: "強化パック ロストリンク", sr: "L", y: 2010, codeAlias: "LL",
  },
  // L2-Sb/L2-Shは構築済みデッキと思われるが、TCGdex・Web検索とも商品名を確認できな
  // かったため ja は空欄のまま（推測で埋めない）。番号衝突（SA/MG型）は事前検証で
  // 無いことを確認済み（各19枚+secret1枚、重複なし、欠番なし）
  { code: "L2-Sb", sourceCacheKeys: ["L2-Sb"], ja: "", sr: "L", y: 2010, codeAlias: "L2-Sb" },
  { code: "L2-Sh", sourceCacheKeys: ["L2-Sh"], ja: "", sr: "L", y: 2010, codeAlias: "L2-Sh" },

  // === フェーズ6-1: SV系の未収録セット ===
  // 事前検証で全8セットとも番号衝突（SA/MG型）・欠番（M2a型のtotal超過範囲含む）とも
  // 無いことを確認済み。レアリティアイコンは全セットで無し（rarity=""になる。
  // 構築済みデッキ/スターター商品の既知パターン）。codeAliasは全セット画像で
  // 目視確認済み（SVI/SVM/SVODの3セットは実カード画像でも照合、©2023-2025表記を確認）。
  // ja/yはWeb検索（トレ研ポケカの一覧・各商品の公式発表記事）に基づく（確度: 高、
  // 複数の情報源で日付が一致）
  // 基本エネルギー8種（cardId 45440,45441,45464,45465,45489,45490,45513,45514）は
  // details.phpで確認したところ番号表記自体が無い汎用インサートだったため除外した
  {
    code: "SVI", sourceCacheKeys: ["SVI"],
    excludeCardIds: [45440, 45441, 45464, 45465, 45489, 45490, 45513, 45514],
    ja: "バトルアカデミー", sr: "SV", y: 2024, codeAlias: "SVI",
  },
  { code: "SVM", sourceCacheKeys: ["SVM"], ja: "スタートデッキGenerations", sr: "SV", y: 2024, codeAlias: "SVM" },
  { code: "SVG", sourceCacheKeys: ["SVG"], ja: "スペシャルデッキセットex フシギバナ・リザードン・カメックス", sr: "SV", y: 2023, codeAlias: "SVG" },
  { code: "SVN", sourceCacheKeys: ["SVN"], ja: "デッキビルドBOX バトルパートナーズ", sr: "SV", y: 2025, codeAlias: "SVN" },
  { code: "SVJL", sourceCacheKeys: ["SVJL"], ja: "バトルマスターデッキ テラスタル「リザードンex」", sr: "SV", y: 2024, codeAlias: "SVJL" },
  { code: "SVJP", sourceCacheKeys: ["SVJP"], ja: "バトルマスターデッキ「パオジアンex」", sr: "SV", y: 2024, codeAlias: "SVJP" },
  { code: "SVOD", sourceCacheKeys: ["SVOD"], ja: "スターターセットex「ダイゴのダンバル&メタグロスex」", sr: "SV", y: 2025, codeAlias: "SVOD" },
  { code: "SVOM", sourceCacheKeys: ["SVOM"], ja: "スターターセットex「マリィのモルペコ&オーロンゲex」", sr: "SV", y: 2025, codeAlias: "SVOM" },

  // === フェーズ6-3: 記念・特殊セット ===
  // 事前調査でWCP/20th/SM0/SMP1/SMP2/WCS23の6セットは番号あり（衝突・欠番なし）、
  // ENE(85枚)は基本エネルギーのみで全件無番号と確認（対象外、未着手リストに記録）。
  // 【重要】WCPは画像確認の結果、2007年発売の「ワールドチャンピオンズパック」と判明した
  // （フェーズ3のMDB/MPS08/MMB-P/MMB-Sと同種のDP世代該当）。ただしDP除外の理由だった
  // 「DPBP種族単位通し番号・印刷バリエーション判別不可」問題はここには当てはまらない
  // （WCPは001/108という独立した連番で、CPr/CPs/CPmと同型）。CPr/CPs/CPmと同じ判断で
  // 取り込んだ。
  // 20thは"CP6"（拡張パック20th Anniversary、フェーズ4で取り込み済み）とは別物と判明
  // （cardIdの範囲が完全に重複していないことを確認済み）。実体は2016年発売の
  // 「ポケットモンスターカードゲーム スターターパック」（1996年第1弾スターターパックの
  // 20周年復刻版）。
  { code: "WCP", sourceCacheKeys: ["WCP"], ja: "ワールドチャンピオンズパック", sr: "DP", y: 2007, codeAlias: "WCP" },
  // 基本エネルギー7種（cardId 31728-31734）は番号表記が無い汎用インサートのため除外
  {
    code: "20th", sourceCacheKeys: ["20th"],
    excludeCardIds: [31728, 31729, 31730, 31731, 31732, 31733, 31734],
    ja: "ポケットモンスターカードゲーム スターターパック", sr: "XY", y: 2016, codeAlias: "20th",
  },
  { code: "SM0", sourceCacheKeys: ["SM0"], ja: "ピカチュウと新しい仲間たち", sr: "SM", y: 2016, codeAlias: "SM0" },
  { code: "SMP1", sourceCacheKeys: ["SMP1"], ja: "月刊コロコロコミック2017年1月号付録「イワンコ全力デッキ」", sr: "SM", y: 2017, codeAlias: "SMP1" },
  { code: "SMP2", sourceCacheKeys: ["SMP2"], ja: "名探偵ピカチュウ", sr: "SM", y: 2019, codeAlias: "SMP2" },
  { code: "WCS23", sourceCacheKeys: ["WCS23"], ja: "ポケモンワールドチャンピオンシップス2023横浜 記念デッキ「ピカチュウ」", sr: "SV", y: 2023, codeAlias: "WCS23" },
];

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// resultAPI.phpのcardNameViewText同様、details.phpの<title>もHTMLエスケープされて
// 返る場合がある（過去の実例: S-PのTAG TEAMカード"グズマ&amp;ハラ"）。無条件で適用する
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
export function extractCardId(cardThumbFile) {
  const m = cardThumbFile.match(/\/(\d+)_/);
  return m ? String(parseInt(m[1], 10)) : null;
}

// details.php のレアリティアイコン画像ファイル名（例: ic_rare_rr.gif, ic_rare_sr_c.gif）から
// 抽出したコードを、既存cardData.jsonのレアリティ表記（RARITIES配列と同じ大文字表記）に変換する。
// BW/XY調査（180枚サンプリング）で確認できたのは元々6種のみだったが、フェーズ2で新規に
// 3種を追加確認した: s_2→"S"（SM8b「GXウルトラシャイニー」161-205番台の色違いレア）、
// ssr→"SSR"（同206番台以降のGXシャイニー）、tr→"TR"（SM9「タッグボルト」092-095番台の
// トレーナーズレア。カード面に直接"TR"と印字されているのを画像で確認済み。Web検索で
// 「トレーナーズレア」の略と確認）。SとSSRはsrc/App.jsxのRARITIES配列に元々定義済みだったが、
// TRは今回新規追加した（RARITIES/RARITY_EN_LABELS/HOLO_RARITIES、src/App.jsx）。
// 未知のコードが出た場合は呼び出し側で例外を投げる（不明なレアリティを無検証で採用しない）。
// "s_2"の"_2"の意味は未確認のため、将来的に別の数字サフィックス（s_1等）が出た場合は
// 無条件でSに丸めず個別に確認すること
// chr→"CHR"（SM11b「ドリームリーグ」050/049コータス等で確認。RARITIES配列に元々
// 定義済みの"CHR"=Character Rareと一致、追加のUI側変更は不要）
// ar→"AR"（フェーズ3のM4「ニンジャスピナー」084/083ハリマロン（総数83超の追加収録分）で
// 確認。RARITIES配列に元々定義済みの"AR"=Art Rareと一致、追加のUI側変更は不要）
// sar→"SAR"（同M4 115/083メガフラエッテexで確認。RARITIES配列に元々定義済みの
// "SAR"=Special Art Rareと一致、追加のUI側変更は不要）
// ma→"MA"（M2a「MEGAドリームex」224/193メガユキメノコexで確認。カード面に直接"MA"と
// 印字されているのを画像で確認済み。Web検索で「メガアタックレア」（MEGAシリーズで
// 新設された固有のレアリティ、技名が大きく英語でデザインされたアメコミ風イラスト）と
// 確認したため、RARITIES配列に新規追加した（RARITIES/RARITY_EN_LABELS/HOLO_RARITIES、
// src/App.jsx。英語表記"Mega Attack Rare"は直訳）
// フェーズ5（LEGEND世代、2009年前後）で、それ以前の世代とは異なるレアリティアイコン
// 命名規則（ic_rare_{code}.gif の{code}が"c_c"等ではなく"c"/"u"/"r"/"s"の1文字）を
// 発見した。c→C、u→U、r→Rは既存表記と一致。sは「r」と同じ★マークだがホロ箔押し加工が
// ある通常レア＝英語版TCGで1999年から使われている公式レアリティ名"Rare Holo"と確認
// （L1-Bhg 003/070スピアー=r＝非ホロ星、025/070オーダイル=s＝ホロ星、を画像で比較確認）。
// ssはLEGENDカード（2枚1組。詳細はparseCardDetailsFromHtmlのコメント参照）専用の
// レアリティコード。英語版TCGが公式に"LEGEND"というレアリティ/シリーズ名をそのまま
// 使っているため、そのままRARITIESに追加した（Web検索で確認）
// csr→"CSR"（既存の"CSR"=Character Super Rareと一致、追加のUI側変更は不要。
// 既存セットへのシークレット追加パッチ作業中、S9a「バトルリージョン」083/067
// スターミーVで発見。2026-08-30）
const RARITY_CODE_MAP = { c_c: "C", u_c: "U", r_c: "R", rr: "RR", sr_c: "SR", ur_c: "UR", s_2: "S", ssr: "SSR", tr: "TR", chr: "CHR", ar: "AR", sar: "SAR", ma: "MA", c: "C", u: "U", r: "R", s: "RH", ss: "LEGEND", csr: "CSR", hr: "HR" };

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// details.php から番号・総数・レアリティ・日本語名を取得する。
// 番号（img-regulation直後の "NNN / NNN" 表記）が取得できないカードは空配列を返し、
// 呼び出し側で失敗扱いにする（絶対にやってはいけないこと: 番号未検証のまま取り込むこと）
//
// 【LEGEND世代の特殊構造（2026-08-30発見）】LEGENDカード（2枚1組で1枚として機能する
// カード。例:「エンテイ&ライコウLEGEND」）は、details.phpの1ページに(上)(下)両方の
// 番号・レアリティが埋め込まれている（例: "063/080 (上)" と "064/080 (下)" が同一ページ内に
// 連続して出現）。単純な.match()（最初の1件のみ取得）ではこれを見落とし、下半分の番号が
// official-card-cache.jsonのスキャンにも周辺cardIdの探索にも一切ヒットしないという事象を
// 引き起こしていた（フェーズ5着手時に発覚）。.matchAll()で全件抽出し、番号とレアリティを
// 件数分ペアにして返すことで、上下どちらも「details.phpから直接検証済み」のデータとして
// 扱えるようにした。画像は1ページに1つしか無い（上下を1枚の画像で表現している）ため、
// 複数件を返す場合はcardThumbFileを共有する
// details.php のHTML本文から番号・総数・レアリティ・日本語名・画像パスを抽出する
// 純粋関数。ネットワークI/Oから切り離してテストできるようexportしている
export function parseCardDetailsFromHtml(html) {
  const numMs = [...html.matchAll(/&nbsp;(\d+)&nbsp;\/&nbsp;(\d+)\s*&nbsp;/g)];
  if (numMs.length === 0) return [];
  const rarMs = [...html.matchAll(/ic_rare_([a-z0-9_]+)\.gif/g)];
  const titleM = html.match(/<title>([^<]*)<\/title>/);
  const rawName = titleM ? titleM[1].replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ$/, "") : null;
  if (!rawName) return [];
  // 画像パスはdetails.php自身にも埋め込まれている（<img class="fit" src="...">）。
  // official-card-cache.jsonに載っていないcardId（extraCardIds、スキャン漏れの救済用）でも
  // ここから画像パスを取得できるため、cardThumbFileの別ソースとして使う
  const imgM = html.match(/<img class="fit" src="([^"]+)"/);
  const jaName = decodeHtmlEntities(rawName);
  const cardThumbFile = imgM ? imgM[1] : null;
  return numMs.map((numM, idx) => ({
    local: numM[1],
    total: numM[2],
    rarity: rarMs[idx] ? (RARITY_CODE_MAP[rarMs[idx][1]] ?? null) : "",
    jaName,
    cardThumbFile,
  }));
}

export async function fetchCardDetail(cardId) {
  const url = `${API_BASE}/card-search/details.php/card/${cardId}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      return parseCardDetailsFromHtml(html);
    } catch {
      if (i < 2) await sleep(1000 * (i + 1));
    }
  }
  return [];
}

export async function downloadImage(cardThumbFile, destPath) {
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

// details.php から取得した詳細（{local, total, jaName, rarity}の配列）を検証し、
// cardData.json の k 配列（[localId, jaName, "", rarity][]）と total を組み立てる。
// 呼び出し側（main）と独立してテストできるよう関数として切り出した
// （2026-08-29、M2aのシークレット範囲欠落バグの再発防止テストのため）。
//
// 例外: 2デッキ同梱の対戦スタートセット等は、両デッキ共通のトレーナー/エネルギーカードが
// 公式サイト上で別cardIDとして2重に掲載されていることがある（BW/XY調査のXYEで実例あり）。
// jaNameが完全一致する場合に限りスキップ（後勝ちを採用）する。
// jaNameが食い違う場合は本来の異常（絶対にやってはいけないこと）としてthrowする
export function validateAndBuildK(details, code) {
  const byLocal = new Map();
  for (const d of details) {
    const n = parseInt(d.local, 10);
    if (byLocal.has(n)) {
      const prev = byLocal.get(n);
      if (prev.jaName === d.jaName) continue;
      throw new Error(`[${code}] 番号 ${d.local} が重複しています（cardID差異を確認してください）。既存: ${prev.jaName} / 新規: ${d.jaName}`);
    }
    if (d.rarity === null) {
      throw new Error(`[${code}] cardID未知のレアリティコードを検出しました: ${JSON.stringify(d)}`);
    }
    byLocal.set(n, d);
  }
  const totals = new Set(details.map((d) => d.total));
  if (totals.size > 1) {
    throw new Error(`[${code}] 総数(total)が一致しません: ${[...totals].join(", ")}`);
  }
  const total = parseInt([...totals][0], 10);
  // 欠番チェックは 1〜total だけでなく、1〜「実際に見つかった最大番号」まで行う。
  // シークレットカード等でtotalを超える番号（例: 001/742のセットに766/742が
  // 存在する）は連番であることが期待できるため、この範囲の欠落も検出できる
  // （M2aで一時的な通信エラーにより766番付近の1枚が総数(193)超過範囲だったために
  // 旧チェックをすり抜けて欠落したまま書き込まれた実例があったため、2026-08-29に
  // 範囲をmaxLocalまで拡張した）
  const maxLocal = Math.max(...byLocal.keys());
  const missing = [];
  for (let n = 1; n <= maxLocal; n++) {
    if (!byLocal.has(n)) missing.push(n);
  }
  if (missing.length > 0) {
    throw new Error(`[${code}] 欠番があります（1〜${maxLocal}のうち。total=${total}）: ${missing.join(", ")}`);
  }

  const sortedLocals = [...byLocal.keys()].sort((a, b) => a - b);
  const k = sortedLocals.map((n) => {
    const d = byLocal.get(n);
    return [String(n).padStart(3, "0"), d.jaName, "", d.rarity];
  });
  // byLocalも返す: cardThumbFile（画像ダウンロード用）はcardData.jsonのk配列には
  // 保存しないが、main()側の画像取得ループが同じ検証済みデータを再利用できるようにする
  return { k, total, byLocal };
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
    // 個別に補う（BW/XYでBREAK進化カードの欠落が繰り返し見つかった）。
    // cardThumbFileはキャッシュに無いため、details.php自身から取得する
    // excludeCardIds: 逆に、キャッシュには載っているがセット固有の番号を持たないカード
    // （例: 基本エネルギーの汎用インサート。details.phpで確認済み＝"NNN/NNN"表記自体が無い）
    // を明示的に除外する。無検証で除外しないこと
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
        const cardDetails = await fetchCardDetail(job.cardId);
        // cardThumbFileはキャッシュ側の値を優先（同一のはずだが、既存の挙動を変えないため）。
        // 無ければdetails.php自身から取得した値にフォールバックする（extraCardIds用）。
        // 両方とも無ければ画像パスが取れていないため失敗扱いにする。
        // LEGENDカードは1件のjobから2件（上下）のdetailsが返ることがある
        const cardThumbFile = job.cardThumbFile || cardDetails[0]?.cardThumbFile;
        if (cardDetails.length > 0 && cardThumbFile) {
          for (const d of cardDetails) details.push({ ...d, cardThumbFile });
        } else {
          failed.push(job.cardId);
        }
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
    const { k, total, byLocal } = validateAndBuildK(details, target.code);
    const sortedLocals = [...byLocal.keys()].sort((a, b) => a - b);

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
  console.log("詳細: scripts/scrape-missing-sets-report.json");
}

// このファイルは validateAndBuildK をテストからimportできるようexportしているため、
// CLIから直接実行された場合のみ main() を走らせる（importしただけでスクレイピングが
// 走ってしまうのを防ぐ。check-row-alignment.mjsと同じガード方式）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
