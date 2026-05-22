/**
 * PoC 02: 社内 Azure OpenAI で埋め込みが取れるか検証
 *
 * 【目的】ADR-004 の前提検証。text-embedding-3-small を dimensions=256 で
 *        呼び出し、256次元のベクトルが返るかを確認する。
 *        認証方式（API Key か Cookie/AAD トークンか）の確定もここで行う。
 *
 * 【実行方法】
 *   業務PCの Edge DevTools Console に貼る。
 *   エンドポイント仕様が不明なら、まず社内ポータルで Azure OpenAI の
 *   「エンドポイント URL / デプロイ名 / 認証方式」を確認してから埋める。
 *
 * 【見るべき結果】
 *   - 200 で data[0].embedding.length === 256 なら成功 ✅
 *   - 401 → 認証方式が違う（Key/Token の与え方を変える）
 *   - 404 → デプロイ名 or api-version が違う
 */

// ===== ここを埋める =====
// 社内プロキシ越えのため、直叩きではなく PowerShell 中継サーバ
// (scripts/tadori-ai-relay.ps1) を経由する。relay を起動した状態で実行する。
//   PS> cd scripts; copy tadori-ai-relay.env.example tadori-ai-relay.env
//   PS> notepad tadori-ai-relay.env   # TADORI_AI_TARGET / TADORI_AI_PROXY を設定
//   PS> .\tadori-ai-relay.bat
const ENDPOINT = "http://localhost:18080"; // ← 中継サーバの listen URL
const DEPLOYMENT = "text-embedding-3-small"; // デプロイ名
const API_VERSION = "2024-02-01";
const AUTH = {
  // どちらか一方を使う。社内方式に合わせて切り替え。relay が target へ転送する。
  apiKey: "", // "api-key" ヘッダ方式なら値を入れる
  bearer: "", // AAD トークン方式なら "Bearer ..." を入れる
};
// ========================

(async () => {
  // relay は受け取った path をそのまま target へ転送する。
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/embeddings?api-version=${API_VERSION}`;
  const headers = { "Content-Type": "application/json" };
  if (AUTH.apiKey) headers["api-key"] = AUTH.apiKey;
  if (AUTH.bearer) headers["Authorization"] = AUTH.bearer;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      credentials: "omit", // relay 経由なので Cookie 不要
      body: JSON.stringify({
        input: ["これはTadoriの埋め込み検証用テスト文です。", "second test sentence"],
        dimensions: 256,
      }),
    });
    console.log("[EMBED] status:", r.status);
    if (!r.ok) {
      console.warn("[EMBED] 失敗 ❌ 本文:", (await r.text()).slice(0, 600));
      return;
    }
    const j = await r.json();
    const dim = j.data?.[0]?.embedding?.length;
    console.log("[EMBED] OK ✅ 件数:", j.data?.length, "次元:", dim);
    console.log("[EMBED] usage:", j.usage);
    if (dim !== 256) console.warn("⚠️ dimensions=256 が効いていない可能性。返り次元:", dim);

    // バイト見積（Float16 → Base64）の確認用
    const approxBytesPerVec = Math.ceil((dim * 2) / 3) * 4; // base64 概算
    console.log(`[EMBED] 1ベクトル概算 ${approxBytesPerVec}B → 37,500件で約 ${Math.round(approxBytesPerVec * 37500 / 1e6)}MB`);
  } catch (e) {
    console.error("[EMBED] 例外:", e);
  }
})();
