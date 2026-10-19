import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Windows でドライブ文字が小文字の場所（c:\…\node_modules\vitest）から vitest を起動すると、ワーカーの実行の準備（runner）は
// 「c:/…」の vitest に、テストのファイルの import "vitest" は「C:/…」の vitest に入り、別々の2つになる。テストのファイルの describe は
// runner の無い方を使うので、全部のファイルが「TypeError: Cannot read properties of undefined (reading 'config')」で止まる
// （2026-10-20 に再現：scripts/check-vitest-cwd.mjs）。起動した vitest と同じ書き方の場所を、テストのファイルの "vitest" にも使う。
// psa-kaitori の f7bc6b8 と同じ考え方。ただしこのフォルダの vitest 4.1 では、vitest の中の解決（vitest:resolve-core）が resolve.alias より先に
// "vitest" を決めてしまい alias が効かないので、enforce: "pre" のプラグインで、起動した側の file URL を外部のモジュールとして返す。
const cli = process.argv.find((a) => /[\\/]vitest[\\/]vitest\.mjs$/i.test(a) || /[\\/]vitest[\\/]dist[\\/]cli/i.test(a)) ?? "";
const lowerDrive = /^[a-z]:/.test(cli);
const vitestIndex = lowerDrive ? pathToFileURL(path.join(cli.replace(/[\\/](vitest\.mjs|dist[\\/]cli.*)$/i, ""), "dist", "index.js")).href : "";
const sameVitest = {
  name: "ptcg:same-vitest-drive",
  enforce: "pre",
  resolveId(id) {
    if (id === "vitest") return { id: vitestIndex, external: true };
  },
};

export default defineConfig({
  plugins: [...(vitestIndex ? [sameVitest] : []), react()],
  test: {
    environment: "node",
  },
});
