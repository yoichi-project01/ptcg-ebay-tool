# 修正依頼: 少額・同梱割引戦略への対応

## 背景と方針

出品戦略が固まったので、それに合わせてツールを調整する。

- **eBayアカウントは新規**。出品上限は月10品・総額$500。ストア契約なし
- **少額カード（$5〜20程度）を単品出品し、同梱割引で1発送にまとめる**戦略を採る
- 送料は小形包装物（書留）等で**1発送あたり1,300円前後（約$9）**。カード枚数によらず一定
- 当面の目標は利益ではなく、**90日間の良好な取引実績を積んで出品上限を解除すること**

この前提から、以下の3点が現在のツールと噛み合っていない。

### 前提が変わったこと（重要）

**CSV一括出品機能は当面使えない。** File Exchange はストア契約が前提であり、
そもそも月10品の上限下では一括出品する意味がない。写真もeBayへ直接アップロードする方針で、
`PicURL` に公開URLを置く運用とも合わない。

**実装済みのCSV機能は削除せず、そのまま残すこと。** 上限が解除された後に使う。
ただし今回のタスクでCSV関連の改修は一切行わない。前回積み残した
「鑑定品のCSV行への警告」（前回依頼のタスク6）も保留とする。

---

## タスク1: 発送方法の選択と説明文の連動（最優先）

### 問題

`buildSingleDesc` / `buildPackDesc` の配送・梱包に関する記述が固定文になっており、
**実態と無関係に出力される**。現在まだ発送実績がないため、以下はすべて未検証の約束である。

```
- Tracking number provided for all orders
- Estimated delivery: 7-14 days
- Protected with a penny sleeve + toploader, waterproof packaging and a rigid mailer
- Stored in a smoke-free environment, kept sleeved
```

特に到着日数が問題で、小形包装物（航空便）は**1〜3週間**かかる。
「7-14 days」と書いて3週間かかれば、それだけで低評価の理由になる。
新規セラーは評価が数件しかないため、1件の低評価が上限解除の妨げになる。

### 実装

#### 1-1. 発送方法の定数を追加

```js
// 日本から少額カードを送る場合の現実的な選択肢。
// 日数は保守的に長めに設定してある。実際に発送して実績が出たら、
// その値に更新すること（短く書いて遅れるより、長く書いて早く着くほうが評価が良い）。
export const SHIPPING_METHODS = [
  { code: "smallpacket_reg", ja: "小形包装物（書留）",     en: "Registered Air Small Packet", tracking: true,  days: "2-3 weeks" },
  { code: "smallpacket",     ja: "小形包装物（追跡なし）", en: "Air Small Packet",            tracking: false, days: "2-4 weeks" },
  { code: "epacket_light",   ja: "eパケットライト",        en: "ePacket Light",               tracking: true,  days: "1-3 weeks" },
  { code: "cpass",           ja: "CPaSS",                  en: "CPaSS",                       tracking: true,  days: "1-2 weeks" },
];
```

`DEFAULT_FORM` に `shippingMethod: "smallpacket_reg"` を追加する。
これは `shipFrom` / `handlingDays` と同じく**出品ごとに変わらない項目**なので、
`PER_LISTING_FIELDS`（カード切り替え時にリセットされる項目）には**含めないこと**。

#### 1-2. 説明文を発送方法に連動させる

- `tracking: false` のときは追跡番号に関する記述を出さない
- `days` を到着目安としてそのまま使う（固定の「7-14 days」を廃止）
- 発送方法の英語名を明記する（`Shipped via Registered Air Small Packet` 等）

#### 1-3. 梱包の記述を選択式にする

少額カードに `rigid mailer` は送料倒れになるため、実態と合わない。
簡易梱包と厳重梱包を選べるようにする。

```js
export const PACKING_LEVELS = [
  { code: "standard", en: "Shipped in a penny sleeve and top loader, protected with cardboard and a water-resistant envelope." },
  { code: "premium",  en: "Shipped in a penny sleeve and top loader, protected with a team bag, cardboard, and a rigid waterproof mailer." },
];
```

`DEFAULT_FORM` に `packingLevel: "standard"` を追加（これも出品ごとにリセットしない）。

#### 1-4. 保管環境の記述をチェックボックスにする

`Stored in a smoke-free environment, kept sleeved.` は事実主張なので、
該当する場合のみ出力する。`DEFAULT_FORM` に `smokeFree: true` を追加し、
UIでオンオフできるようにする。

#### 1-5. 発送までの営業日の既定値を変更する

`DEFAULT_FORM` の `handlingDays` が現在 `"1-2"` になっている。これも
「守れなかったときに defect（欠陥取引）になる約束」であり、1-1〜1-4 と同性質の問題。

eBay は発送遅延をセラー評価の指標として扱っており、新規セラーにとっては
出品上限の解除を遅らせる要因になる。**まだ発送実績がない状態で1〜2営業日を
宣言するのはリスクが高い。**

- 既定値を `"1-2"` から `"3"` に変更する
- ヒント文を追加する:
  ```
  発送遅延は評価の欠陥として記録され、出品上限の解除を遅らせます。
  実績が出るまでは余裕を持たせてください。短縮は簡単ですが、
  延長は評価を落とした後になります。
  ```

### 受け入れ条件

- `tracking: false` の発送方法を選んだとき、説明文に `Tracking` の語が一切出ない
- 到着目安が `SHIPPING_METHODS` の `days` と一致する
- `smokeFree` を false にすると該当の一文が消える
- `handlingDays` の既定値が `"3"` になっている
- 上記をテストで確認する（`buildSingleDesc` は既に export 済み）

---

## タスク2: 同梱案内の追加

### 背景

**少額戦略の生命線。** 送料$9はカード1枚あたりではなく1発送あたりの固定費なので、
バイヤーに複数枚買ってもらえるかどうかで採算が決まる。

現在の説明文にはこの案内が一切ない。バイヤーは「まとめ買いで送料が安くなる」ことを
知らないまま1枚だけ買うか、送料の高さを見て離脱する。

### 実装

`DEFAULT_FORM` に `combinedShipping: true` を追加（出品ごとにリセットしない）。
true のとき、説明文の Shipping セクションに以下を追加する。

```
- Combined shipping available: buy multiple items and pay shipping only once
- Please add all items to your cart and request a combined invoice before paying
```

「支払い前に同梱請求書を依頼してください」の一文は重要。
バイヤーが個別に支払ってしまうと同梱できず、送料を返金する手間が発生する。

タイトルには含めない（80文字の枠を使うほどの検索価値はない）。

### 受け入れ条件

- `combinedShipping` が true のとき、上記2行が説明文に出る
- false のとき出ない
- パックモードの説明文にも同様に適用する

---

## タスク3: 利益計算を同梱前提に直す

### 問題1: 手数料率のデフォルトが低すぎる

現在 `ebayFeePercent: "13.25"` だが、日本から eBay.com で売る場合の実効レートは
**17〜20%**。内訳は落札手数料13.25〜15.3%＋国際取引手数料1.35%＋為替手数料約2%。

デフォルトを `"18"` に変更し、ヒント文を以下のようにする。

```
落札手数料・国際取引手数料・為替手数料を合算した実効レート。
初期値18%は概算。取引実績が出たら、Seller Hubの請求明細から
「売上に対する手数料合計」を逆算して実測値に置き換えること。
```

### 問題2: 送料と固定手数料が1件あたりで計算されている

`calcProfit` は以下のようになっている。

```js
const feeUsd = sellPriceUsd * (feePercent / 100) + fixedFeeUsd;
const profitUsd = sellPriceUsd - feeUsd - shippingCostUsd - costUsd;
```

同梱割引を使う場合、**送料もeBayの固定手数料（$0.40）も1注文あたり**なので、
1回の注文で3枚売れれば1枚あたりの負担は1/3になる。現在の計算は常に1枚分を引くため、
利益を過小評価する。少額カードでは送料の比重が大きいため、誤差が支配的になる。

### 実装

`DEFAULT_FORM` に `expectedItemsPerOrder: "1"` を追加（出品ごとにリセットしない）。

```js
export function calcProfit(f) {
  // ...既存の parse 処理...
  const itemsPerOrder = Math.max(1, parseFloat(f.expectedItemsPerOrder) || 1);

  const costUsd = (costJpy + extraCostJpy) / rate;
  // 送料とeBayの固定手数料は「1注文あたり」なので、同梱枚数で按分する
  const perItemShipping = shippingCostUsd / itemsPerOrder;
  const perItemFixedFee = fixedFeeUsd / itemsPerOrder;
  const feeUsd = sellPriceUsd * (feePercent / 100) + perItemFixedFee;
  const profitUsd = sellPriceUsd - feeUsd - perItemShipping - costUsd;
  // ...
}
```

`computeRecommendedPrice` も同じ按分を反映させること
（`(fixedFeeUsd + shippingCostUsd + costUsd) / denom` の部分）。

UIには以下のヒントを添える。

```
1回の注文で何枚まとめて買われるかの想定。同梱割引を使う場合、
送料とeBay固定手数料はこの枚数で按分される。
実績が出るまでは1〜2で保守的に見積もること。
```

### 問題3: 概算である旨の注記がない

利益計算セクションの末尾に一文追加する。

```
※ 関税（DDP）、返品、Promoted Listings の費用は含まれていません。
```

2025年に米国の少額免税が廃止され、DDPが義務化されている。少額商品でも関税が
乗るため、この計算だけで採算を判断すると実態とずれる可能性がある。

### 受け入れ条件

- `expectedItemsPerOrder` が2のとき、1のときと比べて利益が
  「送料の半分＋固定手数料の半分」だけ増えることをテストで確認
- `expectedItemsPerOrder` が空文字や0のとき1として扱われる（ゼロ除算しない）
- `computeRecommendedPrice` にも按分が反映されている
- デフォルト手数料率が18になっている

---

---

## タスク4: 状態表記の定型フレーズ化

### 背景

`conditionNotes` は自由記述。少額カードはプレイド品が多く、**状態の説明が
INAD（Item Not As Described）クレームの主因**になる。日本語のカード用語を
英語にするのは慣れが要り、表現がブレると認識違いにつながる。

### 実装

チェックボックスで選ぶと英文が組み立てられる形にする。自由記述欄は残し、
定型フレーズと併用できるようにすること（特殊な状態は自由記述でしか書けないため）。

```js
export const CONDITION_PHRASES = [
  { code: "edge_white",   ja: "縁の白かけ",         en: "slight edge whitening" },
  { code: "corner_white", ja: "角の白かけ",         en: "minor corner whitening" },
  { code: "scratch",      ja: "表面のキズ",         en: "light surface scratches" },
  { code: "bend",         ja: "反り",               en: "a slight bend" },
  { code: "dent",         ja: "へこみ・押し跡",     en: "a small indentation" },
  { code: "factory",      ja: "初期キズ（製造時）", en: "a factory print defect" },
  { code: "offcenter",    ja: "センタリングずれ",   en: "off-center centering" },
  { code: "clean",        ja: "目立った傷や汚れなし", en: "no major flaws" },
];
```

`DEFAULT_FORM` に `conditionPhrases: []` を追加する。
これは**出品ごとに変わる項目**なので `PER_LISTING_FIELDS` に**含めること**
（前のカードの傷メモが残ると事故になる）。

説明文では、選択されたフレーズを自然な英文に組み立てる。

```
Condition notes: This card has slight edge whitening and light surface scratches.
```

`clean`（目立った傷なし）が選ばれた場合は他と併記せず、単独で出力する。

### 受け入れ条件

- 複数選択したとき、`and` で自然につながる英文になる
- `clean` と他のフレーズが同時に出力されない
- 自由記述の `conditionNotes` と併用できる
- カードを切り替えると選択がリセットされる

---

## タスク5: 出品枠カウンター

### 背景

新規アカウントの出品上限は**月10品・総額$500**。出品するたびに減る資源だが、
ツールはこれを認識していない。$500上限は高額カード1枚で使い切ることもあるため、
「何を先に出すか」の判断に直結する。

履歴に `savedAt` と `sellPriceUsd` が入っているので、今月分を集計すれば残量が出せる。

### 実装

履歴セクションの上部に表示する。

```js
const thisMonth = history.filter((e) => {
  const d = new Date(e.savedAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
});
const usedCount = thisMonth.length;
const usedValue = thisMonth.reduce((a, e) => a + (parseFloat(e.f.sellPriceUsd) || 0), 0);
```

表示例:

```
今月の出品枠: 6/10品  $180/$500  （残り 4品 / $320）
```

さらに、現在作成中の出品が残枠を超える場合は生成結果カードに警告を出す。

```
この価格($400)は今月の残枠($320)を超えます
```

上限値は `LISTING_LIMIT_COUNT = 10` / `LISTING_LIMIT_VALUE_USD = 500` として
定数化し、UIから編集できるようにする（**90日程度で上限が解除・引き上げされるため、
ハードコードすると使えなくなる**）。値は localStorage に保存する。

### 重要な注意（コメントとして残すこと）

eBay の上限は「出品数と落札数の合計」で数え、月末にリセットされる。
一方この集計は「ツールで作った出品」であって「実際にeBayに出した出品」ではない。
**あくまで目安であり、正確な残量は Seller Hub で確認する必要がある**旨を
UIにも明記すること。

### 受け入れ条件

- 月をまたぐと集計がリセットされる
- 上限値をUIから変更でき、リロードしても保持される
- 「目安である」旨がUIに表示されている

---

## タスク6: 細かい改善

### 6-1. 為替レートの最終更新日を表示する

`exchangeRate` は既定値 `"155"` の固定値で、更新の仕組みがない。少額カードは
利幅が薄いため、10円ずれると採算判断が変わる。

自動取得はしない（依存が増えるため）。`exchangeRateUpdatedAt` を持たせ、
値が変更されたら日付を記録して表示するだけでよい。

```
為替レート: 155 円/USD（最終更新: 2026-08-04）
```

### 6-2. CSV専用項目を折りたたむ

`quantity` / `picUrl` / `bestOfferEnabled` は CSV 出力にしか使われていない。
CSVを使わない現状では「チェックしても何も起きない」状態で、混乱の元になる。

これらを `<details><summary>CSV一括出品用の設定（現在未使用）</summary>` で
折りたたむ。**削除はしないこと**（上限解除後に使う）。

### 受け入れ条件

- 為替レートを変更すると更新日が記録・表示される
- CSV専用項目が折りたたまれ、既定で閉じている

---

## 優先順位

1. **タスク1**（発送記述・発送営業日） — 虚偽記載と defect の回避。出品開始前に必須
2. **タスク4**（状態表記） — INADクレームの予防。少額品で最も効く
3. **タスク2**（同梱案内） — 少額戦略が成立するかどうかに直結
4. **タスク5**（出品枠カウンター） — 月10品・$500の管理
5. **タスク3**（利益計算） — 何を仕入れるかの判断精度
6. **タスク6**（細かい改善） — 余力があれば

すべて既存の仕組みへの追加で、新しい概念は入らない。

---

## やらないこと

- CSV関連の改修（前回依頼のタスク6を含む）。上限解除後に再開する
- ロット出品モードの実装。単品＋同梱で進める方針が決まっているため
- BW・XY世代のデータ取得。別依頼書（`docs/task-bw-xy.md`）で管理しており、
  優先度は今回のタスクより低い
- **返品ポリシーの記述**。説明文に返品に関する記載がない点は認識しているが、
  eBay側のビジネスポリシー設定を先に決める必要がある。説明文とポリシーが
  食い違うと、ケース発生時に不利になる。**設定が決まってから別途依頼する**

## 注意

- 着手前と完了後に `npx vitest run` を実行し、既存テストが通ることを確認する
- 新規フィールドはすべて `DEFAULT_FORM` に追加し、`PER_LISTING_FIELDS` には
  含めないこと（カードを切り替えるたびに発送設定がリセットされるのは不便なため）
- `loadFromHistory` は `{ ...DEFAULT_FORM, ...entry.f }` でマージしているため、
  過去の履歴を読んでも新規フィールドは既定値で埋まる。この挙動を壊さないこと
