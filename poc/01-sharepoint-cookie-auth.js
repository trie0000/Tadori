/**
 * PoC 01: SharePoint Cookie 認証で REST API が叩けるか検証
 *
 * 【目的】ADR-007 の前提検証。Azure AD アプリ登録なしで、
 *        ブラウザの既存 SharePoint セッション Cookie を使って
 *        List の読み取り・書き込みができるかを確認する。
 *
 * 【実行方法】
 *   1. 業務PCの Edge で対象 SharePoint サイトを開く（ログイン済み状態）
 *   2. F12 で DevTools → Console タブ
 *   3. 下の SITE_URL / LIST_TITLE を埋めてから、このファイル全体を貼って実行
 *
 * 【見るべき結果】
 *   - [READ]  200 で items が返れば読み取りOK（Cookie認証成立）
 *   - [WRITE] 204/200 で更新できれば書き込みOK（try-claim が成立する）
 *   - 401/403 が出たら → 条件付きアクセスで阻害 → MSAL フォールバック検討
 */

// ===== ここを埋める =====
const SITE_URL = "https://YOURTENANT.sharepoint.com/sites/YOURSITE"; // 末尾スラッシュなし
const LIST_TITLE = "受信メールリスト";
const TEST_WRITE = false; // 書き込みも試すなら true（既存1件を no-op 更新する）
// ========================

(async () => {
  const api = `${SITE_URL}/_api/web/lists/getbytitle('${encodeURIComponent(LIST_TITLE)}')`;

  // 書き込みに必要な FormDigest を取得（Cookie 認証で発行される）
  async function getDigest() {
    const r = await fetch(`${SITE_URL}/_api/contextinfo`, {
      method: "POST",
      headers: { Accept: "application/json;odata=nometadata" },
      credentials: "include",
    });
    if (!r.ok) throw new Error(`contextinfo ${r.status}`);
    const j = await r.json();
    return j.FormDigestValue || j.d?.GetContextWebInformation?.FormDigestValue;
  }

  // --- READ ---
  try {
    const r = await fetch(`${api}/items?$top=3`, {
      headers: { Accept: "application/json;odata=nometadata" },
      credentials: "include",
    });
    console.log("[READ] status:", r.status);
    if (r.ok) {
      const j = await r.json();
      const items = j.value || j.d?.results || [];
      console.log("[READ] OK ✅ 取得件数:", items.length);
      console.log("[READ] 1件目のフィールド名:", items[0] ? Object.keys(items[0]) : "(0件)");
    } else {
      console.warn("[READ] 失敗 ❌ 本文:", (await r.text()).slice(0, 500));
    }
  } catch (e) {
    console.error("[READ] 例外:", e);
  }

  // --- WRITE (任意) ---
  if (TEST_WRITE) {
    try {
      const digest = await getDigest();
      console.log("[WRITE] FormDigest 取得:", digest ? "OK" : "なし");

      // 既存1件の ETag を取得し、同じ Title で no-op MERGE 更新を試す
      const head = await fetch(`${api}/items?$top=1&$select=Id`, {
        headers: { Accept: "application/json;odata=nometadata" },
        credentials: "include",
      });
      const item = (await head.json()).value?.[0];
      if (!item) return console.warn("[WRITE] 更新対象なし（List が空）");

      const detail = await fetch(`${api}/items(${item.Id})`, {
        headers: { Accept: "application/json;odata=nometadata" },
        credentials: "include",
      });
      const etag = detail.headers.get("ETag");
      console.log("[WRITE] 対象 Id:", item.Id, "ETag:", etag);

      const w = await fetch(`${api}/items(${item.Id})`, {
        method: "POST",
        headers: {
          Accept: "application/json;odata=nometadata",
          "Content-Type": "application/json;odata=nometadata",
          "X-RequestDigest": digest,
          "IF-MATCH": etag, // 楽観ロックの検証（412 が出れば衝突制御が機能）
          "X-HTTP-Method": "MERGE",
        },
        credentials: "include",
        body: JSON.stringify({}), // no-op
      });
      console.log("[WRITE] status:", w.status, w.status === 204 ? "OK ✅" : "");
      if (!w.ok) console.warn("[WRITE] 本文:", (await w.text()).slice(0, 500));
    } catch (e) {
      console.error("[WRITE] 例外:", e);
    }
  }
})();
