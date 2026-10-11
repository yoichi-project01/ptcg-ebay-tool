// cardData.json を書き換えたスクリプトの最後に、カードの種類の一覧（src/cardKinds.json）を作り直す（2026-10-11）。
// 種類の判定は英語名（Bulbapedia の一覧と結び付けるとき）と日本語名を使うので、カードを足したときと英語名を入れたときに必要。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-card-kinds.mjs");
export function rebuildCardKinds() {
  if (process.env.CARD_DATA_PATH) return; // 確認用に別の cardData を読んでいるときは作り直さない
  console.log("カードの種類の一覧（src/cardKinds.json）を作り直します");
  execFileSync(process.execPath, [SCRIPT, "--write"], { stdio: "inherit" });
}
