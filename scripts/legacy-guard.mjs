// 使わなくなった古いスクリプトを、うっかり実行しても何も変えずに止める（2026-10-14）。
// 名前や並び順で画像・名前を対応づける古い処理は、高レアに通常版の画像を保存する（2,227枚の取り違えの原因）・
// S-P/SV-P の名前のずれ・直した発売年の上書きなどの事故を起こしたため。
// どうしても実行するときは、内容を理解した上で環境変数 PTCG_LEGACY=1 を付ける（子のスクリプトにも引き継がれる）。
export function refuseLegacy(name, reason) {
  if (process.env.PTCG_LEGACY === "1") return;
  console.error(`${name} は古いスクリプトのため止めました。\n理由: ${reason}\n今の手順は CLAUDE.md の「新しいカードの取り込み」を参照。実行する場合は PTCG_LEGACY=1 を付ける。`);
  process.exit(1);
}
