import { useState, useMemo } from "react";
import CARD_DATA from "./cardData.json";
import IMAGE_INDEX from "./imageIndex.json";

// ---------- 定数 ----------
const RARITIES = ["", "SAR", "SR", "AR", "UR", "RR", "RRR", "CHR", "CSR", "HR", "SSR", "S", "ACE", "BWR", "R", "U", "C", "PROMO"];
const CONDITIONS = [
  { code: "NM", label: "NM（ほぼ完美品）", en: "Near Mint" },
  { code: "NM/M", label: "NM/M（完美品に近い）", en: "Near Mint / Mint" },
  { code: "LP", label: "LP（軽い使用感）", en: "Lightly Played" },
  { code: "MP", label: "MP（目立つ傷あり）", en: "Moderately Played" },
  { code: "HP", label: "HP（大きなダメージ）", en: "Heavily Played" },
];
const PRODUCT_TYPES = [
  { code: "pack", label: "ブースターパック" },
  { code: "box", label: "ブースターBOX" },
];
const SERIE_ORDER = { M: 0, SV: 1, S: 2, SM: 3, XYb: 4, XY: 5, BW: 6, L: 7, DPt: 8, DP: 9, PCG: 10, ADV: 11, e: 12, VS: 13, web: 14, neo: 15, PMCG: 16 };
const PRINT_VARIANTS = [
  { code: "", label: "指定しない" },
  { code: "1st Edition", label: "1st Edition（初期版・マークあり）" },
  { code: "Unlimited", label: "Unlimited（通常版・マークなし）" },
];
// 1st Edition マークが存在する世代（拡張パック〜ジム拡張2）
const PRINT_VARIANT_SET_RE = /^PMCG[1-6]$/i;
const GRADING_COMPANIES = ["", "PSA", "BGS", "CGC", "SGC"];
const GRADE_LABELS = {
  "10": "GEM MINT", "9.5": "MINT", "9": "MINT", "8.5": "NM-MT", "8": "NM-MT",
  "7.5": "NM", "7": "NM", "6.5": "EX-MT", "6": "EX-MT", "5.5": "EX", "5": "EX",
  "4": "VG-EX", "3": "VG", "2": "GOOD", "1": "PR",
};
function gradeLabelText(grade) {
  return GRADE_LABELS[String(grade).trim()] || "";
}
const HISTORY_KEY = "ptcg-ebay-tool:history";
const HISTORY_LIMIT = 60;

const holoGrad =
  "linear-gradient(120deg,#7de2ff 0%,#a78bfa 30%,#f9a8d4 55%,#fde68a 80%,#7de2ff 100%)";

// ---------- 検索 ----------
function normalize(s) {
  return s
    .replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .toLowerCase()
    .trim();
}
function pad3(n) {
  return String(n).padStart(3, "0");
}
function searchCards(query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const results = [];
  for (const s of CARD_DATA) {
    const setKey = normalize(s.ja + " " + s.en + " " + s.c);
    for (const k of s.k) {
      const [, ja, en, rarity] = k;
      const nameKey = normalize(ja + " " + en);
      let nameScore = 0;
      let ok = true;
      for (const t of tokens) {
        if (nameKey === t) nameScore = Math.max(nameScore, 3);
        else if (normalize(ja) === t || normalize(en) === t) nameScore = Math.max(nameScore, 3);
        else if (nameKey.startsWith(t)) nameScore = Math.max(nameScore, 2);
        else if (nameKey.includes(t)) nameScore = Math.max(nameScore, 1);
        else if (rarity && t === normalize(rarity)) nameScore = Math.max(nameScore, 1);
        else if (setKey.includes(t)) nameScore = Math.max(nameScore, 1);
        else { ok = false; break; }
      }
      if (ok && nameScore > 0) results.push({ set: s, card: k, score: nameScore });
    }
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sa = SERIE_ORDER[a.set.sr] ?? 99;
    const sb = SERIE_ORDER[b.set.sr] ?? 99;
    if (sa !== sb) return sa - sb;
    if (a.set.c !== b.set.c) return b.set.c.localeCompare(a.set.c);
    return b.card[0].localeCompare(a.card[0]);
  });
  return results.slice(0, 24);
}
function cardNoOf(setObj, local) {
  if (setObj.of > 0 && /^\d+$/.test(local)) return `${pad3(local)}/${pad3(setObj.of)}`;
  return "";
}
// ローカルにスクレイピング済み画像があればそのパスを返す
function localImage(setObj, local) {
  const n = parseInt(local, 10);
  const key = `${setObj.c}/${isNaN(n) ? local : n}`;
  return IMAGE_INDEX[key] ? `/${IMAGE_INDEX[key]}` : null;
}

// ---------- タイトル ----------
function buildSingleTitle(f) {
  const printVariant = PRINT_VARIANT_SET_RE.test(f.setCode) ? f.printVariant : "";
  const isGraded = f.graded && f.gradingCompany && f.grade.trim();
  const conditionToken = isGraded
    ? [f.gradingCompany, f.grade.trim(), gradeLabelText(f.grade)].filter(Boolean).join(" ")
    : f.condition;
  return [f.pokemonEn, f.rarity, f.cardNo, f.setCode, f.setNameEn, printVariant, "Japanese Pokemon Card", conditionToken]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
function buildPackTitle(f) {
  const type = f.productType === "box" ? "Booster Box" : "Booster Pack";
  return ["Pokemon Card", f.setNameEn, f.setCode, "Japanese", "Factory Sealed", type,
    f.productType === "box" && f.shrink ? "w/ Shrink" : ""]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

// ---------- eBay相場検索 ----------
function buildEbaySearchQuery(f, mode) {
  if (mode === "single") {
    return [f.pokemonEn, f.rarity, f.cardNo, f.setCode].filter(Boolean).join(" ");
  }
  const type = f.productType === "box" ? "Booster Box" : "Booster Pack";
  return [f.setNameEn, f.setCode, "Japanese", type].filter(Boolean).join(" ");
}
function buildEbaySearchUrl(query, { sold = false } = {}) {
  if (!query.trim()) return "";
  const params = new URLSearchParams({ _nkw: query });
  if (sold) { params.set("LH_Sold", "1"); params.set("LH_Complete", "1"); }
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

// ---------- 利益計算 ----------
function calcProfit(f) {
  const rate = parseFloat(f.exchangeRate);
  const sellPriceUsd = parseFloat(f.sellPriceUsd);
  if (!rate || rate <= 0 || !sellPriceUsd || sellPriceUsd <= 0) return null;
  const costJpy = parseFloat(f.costJpy) || 0;
  const extraCostJpy = parseFloat(f.extraCostJpy) || 0;
  const feePercent = parseFloat(f.ebayFeePercent) || 0;
  const shippingCostUsd = parseFloat(f.shippingCostUsd) || 0;

  const costUsd = (costJpy + extraCostJpy) / rate;
  const feeUsd = sellPriceUsd * (feePercent / 100);
  const profitUsd = sellPriceUsd - feeUsd - shippingCostUsd - costUsd;
  const marginPercent = (profitUsd / sellPriceUsd) * 100;
  return { costUsd, feeUsd, profitUsd, marginPercent, profitJpy: profitUsd * rate };
}

// ---------- 出品履歴（localStorage） ----------
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function saveHistoryToStorage(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch {}
}
function historyImage(entry) {
  const local = entry.f.cardNo ? entry.f.cardNo.split("/")[0] : "";
  const n = parseInt(local, 10);
  if (!entry.f.setCode || isNaN(n)) return null;
  const key = `${entry.f.setCode}/${n}`;
  return IMAGE_INDEX[key] ? `/${IMAGE_INDEX[key]}` : null;
}

// ---------- 説明文 ----------
function buildSingleDesc(f) {
  const notes = f.conditionNotes.trim();
  const inScope = PRINT_VARIANT_SET_RE.test(f.setCode);
  const printVariant = inScope ? f.printVariant : "";
  const printNote = inScope ? f.printVariantNote.trim() : "";
  const isGraded = f.graded && f.gradingCompany && f.grade.trim();
  const label = isGraded ? gradeLabelText(f.grade) : "";
  const certNumber = isGraded ? f.certNumber.trim() : "";

  let conditionLine;
  if (isGraded) {
    conditionLine = `Professionally Graded — ${f.gradingCompany} ${f.grade.trim()}${label ? ` (${label})` : ""}`;
  } else {
    const cond = CONDITIONS.find((c) => c.code === f.condition);
    conditionLine = `${cond ? `${cond.en} (${cond.code})` : f.condition || "See photos"} — please see photos for the actual condition.`;
  }

  const conditionNotesBlock = isGraded
    ? `${notes ? `- ${notes}` : "- No notes on the slab/case. Please check all photos before purchase."}
- Card is professionally graded and sealed in its original ${f.gradingCompany} holder.
- Shipped securely wrapped in bubble wrap inside a rigid box.`
    : `${notes ? `- ${notes}` : "- No major flaws noted. Please check all photos before purchase."}
- Stored in a smoke-free environment, kept sleeved.`;

  return `Thank you for checking out my listing!

■ Card Details
- Card: ${f.pokemonEn || "[Pokemon name]"} ${f.rarity || ""} ${f.cardNo || ""}
- Set: ${f.setNameEn || "[Set name]"}${f.setCode ? ` (${f.setCode})` : ""}
- Language: Japanese
${printVariant ? `- Print: ${printVariant}\n` : ""}${printNote ? `- Print Note: ${printNote}\n` : ""}- Condition: ${conditionLine}
${certNumber ? `- Certification #: ${certNumber}\n` : ""}- The exact card pictured is the one you will receive.

■ Condition Notes
${conditionNotesBlock}

■ Shipping from Japan
- Ships from ${f.shipFrom || "Japan"} within ${f.handlingDays || "1-2"} business days
- Protected with a penny sleeve + toploader, waterproof packaging and a rigid mailer
- Tracking number provided for all orders
- Estimated delivery: 7-14 days depending on your country and customs

Please feel free to message me with any questions.
Thank you and happy collecting!`;
}
function buildPackDesc(f) {
  const isBox = f.productType === "box";
  const item = isBox
    ? `1x Factory Sealed Booster Box${f.packsPerBox ? ` (${f.packsPerBox} packs)` : ""}${f.shrink ? ", shrink wrap intact" : ""}`
    : `1x Factory Sealed Booster Pack${f.cardsPerPack ? ` (${f.cardsPerPack} cards per pack)` : ""}`;
  return `Thank you for visiting my listing!

■ Item Description
- Pokemon Card Game — Japanese version
- Set: ${f.setNameEn || "[Set name]"}${f.setCode ? ` (${f.setCode})` : ""}
- ${item}
- Language: Japanese
- Condition: New / Factory Sealed, never opened
- Our packs are NEVER weighed or searched — pulled directly from a sealed booster box

■ Shipping from Japan
- Ships from ${f.shipFrom || "Japan"} within ${f.handlingDays || "1-2"} business days
- All items shipped with a tracking number
- Protected with rigid materials and waterproof packaging
- Estimated delivery: 7-14 days (varies by country and customs)

■ Note
- Pull results (which cards you get) are based on luck — no refunds based on pack contents
- If you have any questions, feel free to message me. I usually reply within 24 hours

Thank you for looking! Happy collecting!`;
}

// ---------- クリップボード ----------
async function copyText(text, setDone) {
  try {
    await navigator.clipboard.writeText(text);
    setDone(true);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); setDone(true); } finally { document.body.removeChild(ta); }
  }
  setTimeout(() => setDone(false), 1600);
}

// ---------- UI部品 ----------
function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#3b4256", letterSpacing: "0.04em", marginBottom: 5 }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: 11, color: "#8b93a7", marginTop: 4 }}>{hint}</span>}
    </label>
  );
}
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: "1.5px solid #d9deea", background: "#fff", fontSize: 14, color: "#1a2238", outline: "none",
};
function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => copyText(text, setDone)} style={{
      padding: "8px 16px", borderRadius: 999, border: "none", cursor: "pointer",
      fontSize: 13, fontWeight: 700, color: done ? "#0a6e3f" : "#fff",
      background: done ? "#d3f5e3" : "#1a2238", transition: "all .2s",
    }}>{done ? "コピーしました ✓" : label}</button>
  );
}
function CardImage({ src, name }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div style={{
        width: "100%", aspectRatio: "63/88", borderRadius: 8,
        background: "linear-gradient(160deg,#e8ebf4,#d5daea)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 8, boxSizing: "border-box",
      }}>
        <span style={{ fontSize: 11, color: "#5b6478", textAlign: "center", lineHeight: 1.5 }}>
          {name}<br /><span style={{ fontSize: 10, color: "#8b93a7" }}>画像なし</span>
        </span>
      </div>
    );
  }
  return (
    <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} style={{
      width: "100%", aspectRatio: "63/88", objectFit: "contain", borderRadius: 8, background: "#eef0f7", display: "block",
    }} />
  );
}

// ---------- メイン ----------
export default function App() {
  const [mode, setMode] = useState("single");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const imageCount = Object.keys(IMAGE_INDEX).length;

  const [f, setF] = useState({
    setNameJa: "", setNameEn: "", setCode: "", shipFrom: "Osaka, Japan", handlingDays: "1-2",
    pokemonJa: "", pokemonEn: "", rarity: "", cardNo: "", condition: "NM", conditionNotes: "",
    printVariant: "", printVariantNote: "",
    graded: false, gradingCompany: "", grade: "", certNumber: "",
    costJpy: "", extraCostJpy: "", exchangeRate: "155", sellPriceUsd: "", ebayFeePercent: "13.25", shippingCostUsd: "",
    productType: "pack", cardsPerPack: "", packsPerBox: "30", shrink: true,
  });
  const set = (k) => (e) =>
    setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const [history, setHistory] = useState(() => loadHistory());

  const candidates = useMemo(
    () => (searchQuery.trim().length >= 2 ? searchCards(searchQuery) : []),
    [searchQuery]
  );
  const title = useMemo(() => (mode === "single" ? buildSingleTitle(f) : buildPackTitle(f)), [mode, f]);
  const desc = useMemo(() => (mode === "single" ? buildSingleDesc(f) : buildPackDesc(f)), [mode, f]);
  const over = title.length > 80;
  const ebayQuery = useMemo(() => buildEbaySearchQuery(f, mode), [f, mode]);
  const ebaySoldUrl = useMemo(() => buildEbaySearchUrl(ebayQuery, { sold: true }), [ebayQuery]);
  const ebayActiveUrl = useMemo(() => buildEbaySearchUrl(ebayQuery), [ebayQuery]);
  const profit = useMemo(() => calcProfit(f), [f]);

  const saveCurrentToHistory = () => {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      savedAt: new Date().toISOString(),
      mode, f, title, desc,
    };
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, HISTORY_LIMIT);
      saveHistoryToStorage(next);
      return next;
    });
  };
  const loadFromHistory = (entry) => {
    setMode(entry.mode);
    setF(entry.f);
    const local = entry.f.cardNo ? entry.f.cardNo.split("/")[0] : "";
    const n = parseInt(local, 10);
    setSelectedKey(entry.f.setCode && !isNaN(n) ? `${entry.f.setCode}/${n}` : "");
  };
  const deleteHistoryEntry = (id) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistoryToStorage(next);
      return next;
    });
  };

  const applyCandidate = (r) => {
    const [local, ja, en, rarity] = r.card;
    setSelectedKey(r.set.c + "/" + local);
    setF((p) => ({
      ...p,
      pokemonJa: ja, pokemonEn: en || p.pokemonEn,
      rarity: RARITIES.includes(rarity) ? rarity : "",
      cardNo: cardNoOf(r.set, local), setCode: r.set.c,
      setNameJa: r.set.ja, setNameEn: r.set.en || p.setNameEn,
    }));
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#f2f4f9",
      fontFamily: '"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic Medium",Meiryo,sans-serif',
      color: "#1a2238", padding: "28px 16px 60px",
    }}>
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <header style={{ marginBottom: 22 }}>
          <div style={{ display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", color: "#5b6478", marginBottom: 6 }}>
            EBAY LISTING GENERATOR
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>ポケカ出品文メーカー</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#5b6478" }}>
            内蔵データベース（12,654枚）から候補を選ぶだけで、eBay用の英語タイトルと説明文を自動生成します。
            {imageCount > 0
              ? ` ローカル画像 ${imageCount.toLocaleString()} 枚を読み込み済み。`
              : " （画像は npm run images でダウンロードすると表示されます）"}
          </p>
        </header>

        <div style={{ display: "inline-flex", background: "#e4e8f2", borderRadius: 999, padding: 4, marginBottom: 20 }}>
          {[{ k: "single", label: "シングルカード" }, { k: "pack", label: "未開封パック / BOX" }].map((t) => (
            <button key={t.k} onClick={() => setMode(t.k)} style={{
              padding: "8px 20px", borderRadius: 999, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 700, color: mode === t.k ? "#fff" : "#3b4256",
              background: mode === t.k ? "#1a2238" : "transparent", transition: "all .2s",
            }}>{t.label}</button>
          ))}
        </div>

        {mode === "single" && (
          <section style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 4px rgba(26,34,56,.06)", marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800 }}>カード名で検索</h2>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#8b93a7" }}>
              入力すると内蔵データから即座に候補を表示します。「リザードン SAR」「ピカチュウ SV2a」のようにレアリティやセット型番で絞り込みもできます。
            </p>
            <input style={{ ...inputStyle, fontSize: 15, padding: "12px 14px" }} value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="例: リザードンex / ナゾノクサ / ピカチュウ SAR" />
            {searchQuery.trim().length >= 2 && candidates.length === 0 && (
              <div style={{ fontSize: 12.5, color: "#c0392b", marginTop: 12 }}>
                候補が見つかりませんでした。表記を変えるか、下のフォームに手動で入力してください。
              </div>
            )}
            {candidates.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginTop: 16, maxHeight: 560, overflowY: "auto" }}>
                {candidates.map((r) => {
                  const [local, ja, en, rarity] = r.card;
                  const key = r.set.c + "/" + local;
                  const sel = selectedKey === key;
                  return (
                    <button key={key} onClick={() => applyCandidate(r)} style={{
                      textAlign: "left", cursor: "pointer", borderRadius: 12, padding: 10,
                      border: sel ? "2px solid #7c6cf0" : "2px solid #e4e8f2",
                      background: sel ? "#f4f2ff" : "#fafbfe", transition: "all .15s", fontFamily: "inherit",
                    }}>
                      <CardImage src={localImage(r.set, local)} name={ja || en} />
                      <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 800, color: "#1a2238", lineHeight: 1.4 }}>{ja || en}</div>
                      <div style={{ fontSize: 11.5, color: "#5b6478", marginTop: 2, lineHeight: 1.5 }}>
                        {[rarity, cardNoOf(r.set, local)].filter(Boolean).join(" · ") || "レアリティ未登録"}<br />
                        {r.set.ja || r.set.en} ({r.set.c})
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11, fontWeight: 800, color: sel ? "#5b48d6" : "#7c6cf0" }}>
                        {sel ? "✓ 入力済み" : "このカードを使う →"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
          <section style={{ flex: "1 1 340px", minWidth: 300, background: "#fff", borderRadius: 16, padding: "22px 22px 12px", boxShadow: "0 1px 4px rgba(26,34,56,.06)" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>カード情報の入力</h2>
            {mode === "single" && (
              <>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}><Field label="ポケモン名（日本語）"><input style={inputStyle} value={f.pokemonJa} onChange={set("pokemonJa")} placeholder="例: リザードンex" /></Field></div>
                  <div style={{ flex: 1 }}><Field label="ポケモン名（英語）"><input style={inputStyle} value={f.pokemonEn} onChange={set("pokemonEn")} placeholder="例: Charizard ex" /></Field></div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}><Field label="レアリティ"><select style={inputStyle} value={f.rarity} onChange={set("rarity")}>{RARITIES.map((r) => <option key={r} value={r}>{r || "選択してください"}</option>)}</select></Field></div>
                  <div style={{ flex: 1 }}><Field label="カード番号" hint="例: 201/165"><input style={inputStyle} value={f.cardNo} onChange={set("cardNo")} placeholder="201/165" /></Field></div>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><Field label="セット名（日本語）"><input style={inputStyle} value={f.setNameJa} onChange={set("setNameJa")} placeholder="例: ポケモンカード151" /></Field></div>
              <div style={{ flex: 1 }}><Field label="セット名（英語）"><input style={inputStyle} value={f.setNameEn} onChange={set("setNameEn")} placeholder="例: Pokemon 151" /></Field></div>
            </div>
            <Field label="セット型番" hint="例: SV2a / sv9 / M2"><input style={inputStyle} value={f.setCode} onChange={set("setCode")} placeholder="SV2a" /></Field>
            {mode === "single" ? (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#3b4256" }}>
                  <input type="checkbox" checked={f.graded} onChange={set("graded")} />鑑定品として出品（PSA / BGS / CGC / SGC など）
                </label>
                {f.graded ? (
                  <>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <Field label="鑑定会社">
                          <select style={inputStyle} value={f.gradingCompany} onChange={set("gradingCompany")}>
                            {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c || "選択してください"}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div style={{ flex: 1 }}><Field label="グレード" hint="例: 10 / 9.5"><input style={inputStyle} value={f.grade} onChange={set("grade")} placeholder="10" /></Field></div>
                    </div>
                    <Field label="鑑定書番号（任意）"><input style={inputStyle} value={f.certNumber} onChange={set("certNumber")} placeholder="例: 12345678" /></Field>
                    <Field label="スラブの状態メモ（英語・任意）" hint="ケースの傷など、あれば記載">
                      <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={f.conditionNotes} onChange={set("conditionNotes")} placeholder="例: Small scratch on the case back" />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="状態（コンディション）" hint="迷ったら1段階低めが安全です">
                      <select style={inputStyle} value={f.condition} onChange={set("condition")}>{CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}</select>
                    </Field>
                    <Field label="状態の補足（英語・任意）" hint="例: Tiny whitening on the back bottom edge (see photo #4)">
                      <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={f.conditionNotes} onChange={set("conditionNotes")} placeholder="傷や白かけがあれば正直に記載" />
                    </Field>
                  </>
                )}
                {PRINT_VARIANT_SET_RE.test(f.setCode) && (
                  <>
                    <Field label="印刷バリエーション" hint="拡張パック〜ジム拡張2（PMCG1〜6）は1st Editionマークの有無で価値が変わります">
                      <select style={inputStyle} value={f.printVariant} onChange={set("printVariant")}>
                        {PRINT_VARIANTS.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                      </select>
                    </Field>
                    <Field label="その他の印刷差異（英語・任意）" hint="例: Old back design / Miscut / Error card">
                      <input style={inputStyle} value={f.printVariantNote} onChange={set("printVariantNote")} placeholder="旧裏面・エラーカードなど" />
                    </Field>
                  </>
                )}
              </>
            ) : (
              <>
                <Field label="商品タイプ"><select style={inputStyle} value={f.productType} onChange={set("productType")}>{PRODUCT_TYPES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></Field>
                {f.productType === "pack" ? (
                  <Field label="1パックのカード枚数（任意）"><input style={inputStyle} value={f.cardsPerPack} onChange={set("cardsPerPack")} placeholder="例: 5" /></Field>
                ) : (
                  <>
                    <Field label="1BOXのパック数"><input style={inputStyle} value={f.packsPerBox} onChange={set("packsPerBox")} placeholder="30" /></Field>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#3b4256" }}>
                      <input type="checkbox" checked={f.shrink} onChange={set("shrink")} />シュリンク付き
                    </label>
                  </>
                )}
              </>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><Field label="発送元"><input style={inputStyle} value={f.shipFrom} onChange={set("shipFrom")} /></Field></div>
              <div style={{ flex: 1 }}><Field label="発送までの営業日"><input style={inputStyle} value={f.handlingDays} onChange={set("handlingDays")} /></Field></div>
            </div>

            <div style={{ marginTop: 8, paddingTop: 16, borderTop: "1.5px solid #eef0f7" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 13.5, fontWeight: 800 }}>利益計算（任意）</h3>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "#8b93a7" }}>
                上の「eBayで相場を見る」で確認した金額を想定売値に入れると、手数料・仕入れ値を差し引いた利益が分かります。
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="仕入れ値（円）"><input style={inputStyle} inputMode="decimal" value={f.costJpy} onChange={set("costJpy")} placeholder="例: 3000" /></Field></div>
                <div style={{ flex: 1 }}><Field label="諸経費（円・任意）" hint="送料・スリーブ等"><input style={inputStyle} inputMode="decimal" value={f.extraCostJpy} onChange={set("extraCostJpy")} placeholder="例: 200" /></Field></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="想定売値（USD）"><input style={inputStyle} inputMode="decimal" value={f.sellPriceUsd} onChange={set("sellPriceUsd")} placeholder="例: 45" /></Field></div>
                <div style={{ flex: 1 }}><Field label="発送実費（USD・任意）"><input style={inputStyle} inputMode="decimal" value={f.shippingCostUsd} onChange={set("shippingCostUsd")} placeholder="例: 5" /></Field></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="為替レート（円/USD）"><input style={inputStyle} inputMode="decimal" value={f.exchangeRate} onChange={set("exchangeRate")} /></Field></div>
                <div style={{ flex: 1 }}><Field label="eBay手数料率（%）" hint="目安の値です"><input style={inputStyle} inputMode="decimal" value={f.ebayFeePercent} onChange={set("ebayFeePercent")} /></Field></div>
              </div>
              {profit && (
                <div style={{
                  borderRadius: 10, padding: "12px 14px", marginTop: 4, marginBottom: 14,
                  background: profit.profitUsd >= 0 ? "#eafaf1" : "#fdecea",
                  border: `1.5px solid ${profit.profitUsd >= 0 ? "#bfead2" : "#f3c6c0"}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: profit.profitUsd >= 0 ? "#0a6e3f" : "#a3352b" }}>
                    想定利益: ${profit.profitUsd.toFixed(2)}（約 ¥{Math.round(profit.profitJpy).toLocaleString()}） ／ 利益率: {profit.marginPercent.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: "#5b6478", marginTop: 4 }}>
                    仕入れ原価 ${profit.costUsd.toFixed(2)} ＋ eBay手数料 ${profit.feeUsd.toFixed(2)} を差し引いた金額です。
                  </div>
                </div>
              )}
            </div>
          </section>

          <section style={{ flex: "1 1 420px", minWidth: 320 }}>
            <div style={{ borderRadius: 18, padding: 3, background: holoGrad, boxShadow: "0 4px 18px rgba(120,110,220,.18)", marginBottom: 18 }}>
              <div style={{ background: "#fff", borderRadius: 15, padding: "20px 22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>タイトル</h2>
                  <span style={{ fontSize: 12, fontWeight: 800, color: over ? "#c0392b" : "#5b6478" }}>{title.length} / 80 文字</span>
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.5, fontWeight: 600, padding: "12px 14px", borderRadius: 10, background: "#f6f7fb", border: over ? "1.5px solid #e5b3ad" : "1.5px solid transparent", minHeight: 24, wordBreak: "break-word" }}>
                  {title || "入力するとここにタイトルが表示されます"}
                </div>
                {over && <div style={{ fontSize: 12, color: "#c0392b", marginTop: 6 }}>eBayのタイトル上限は80文字です。セット名や状態表記を短くしてください。</div>}
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <CopyBtn text={title} label="タイトルをコピー" />
                  {ebaySoldUrl && (
                    <a href={ebaySoldUrl} target="_blank" rel="noopener noreferrer" style={{
                      padding: "8px 16px", borderRadius: 999, textDecoration: "none",
                      fontSize: 13, fontWeight: 700, color: "#1a2238", background: "#fff",
                      border: "1.5px solid #d9deea",
                    }}>eBayで相場を見る（売却済み）</a>
                  )}
                  {ebayActiveUrl && (
                    <a href={ebayActiveUrl} target="_blank" rel="noopener noreferrer" style={{
                      padding: "8px 16px", borderRadius: 999, textDecoration: "none",
                      fontSize: 13, fontWeight: 700, color: "#1a2238", background: "#fff",
                      border: "1.5px solid #d9deea",
                    }}>現在の出品を見る</a>
                  )}
                  <button onClick={saveCurrentToHistory} style={{
                    padding: "8px 16px", borderRadius: 999, border: "1.5px solid #d9deea", cursor: "pointer",
                    fontSize: 13, fontWeight: 700, color: "#1a2238", background: "#fff",
                  }}>履歴に保存</button>
                </div>
              </div>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 4px rgba(26,34,56,.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>説明文</h2>
                <CopyBtn text={desc} label="説明文をコピー" />
              </div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13, lineHeight: 1.75, color: "#2a3145", background: "#f6f7fb", borderRadius: 10, padding: "14px 16px", maxHeight: 460, overflowY: "auto" }}>
                {desc}
              </pre>
            </div>
            <p style={{ fontSize: 11.5, color: "#8b93a7", marginTop: 12, lineHeight: 1.7 }}>
              ヒント: タイトルは「Title」欄に、説明文は「Item description」欄に貼り付けてください。
              Condition欄の選択（Ungraded - Near mint or better など）は説明文と矛盾しないように選びましょう。
            </p>
          </section>
        </div>

        {history.length > 0 && (
          <section style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 4px rgba(26,34,56,.06)", marginTop: 20 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800 }}>保存した出品（履歴）</h2>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#8b93a7" }}>
              「履歴に保存」で保存した内容です。ブラウザ内（localStorage）にのみ保存され、他の端末とは共有されません。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
              {history.map((entry) => (
                <div key={entry.id} style={{ borderRadius: 12, padding: 10, border: "2px solid #e4e8f2", background: "#fafbfe" }}>
                  <CardImage src={historyImage(entry)} name={entry.f.pokemonJa || entry.f.pokemonEn || entry.f.setNameJa} />
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 800, color: "#1a2238", lineHeight: 1.4 }}>
                    {entry.f.pokemonJa || entry.f.pokemonEn || (entry.mode === "pack" ? entry.f.setNameJa : "(未入力)")}
                  </div>
                  <div style={{ fontSize: 11, color: "#5b6478", marginTop: 2, lineHeight: 1.5 }}>
                    {[entry.f.rarity, entry.f.cardNo].filter(Boolean).join(" · ")}<br />
                    {entry.f.setNameJa || entry.f.setNameEn} ({entry.f.setCode})<br />
                    {new Date(entry.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                    <button onClick={() => loadFromHistory(entry)} style={{
                      flex: 1, padding: "6px 8px", borderRadius: 999, border: "none", cursor: "pointer",
                      fontSize: 11, fontWeight: 800, color: "#5b48d6", background: "#f4f2ff",
                    }}>読み込む</button>
                    <button onClick={() => deleteHistoryEntry(entry.id)} style={{
                      padding: "6px 10px", borderRadius: 999, border: "none", cursor: "pointer",
                      fontSize: 11, fontWeight: 800, color: "#a3352b", background: "#fdecea",
                    }}>削除</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
