# Tadori PoC — Phase 1 前の前提検証

本格実装の前に「これがダメなら路線変更」な2つの前提を業務PCで潰す。
どちらも Edge DevTools の Console に貼って実行する。

## 01-sharepoint-cookie-auth.js
SharePoint の既存ログインセッション（Cookie）だけで List の REST API を
読み書きできるかを検証する（ADR-007）。

- `SITE_URL` / `LIST_TITLE` を埋める
- READ が 200 で通れば Cookie 認証 OK
- `TEST_WRITE = true` で ETag 楽観ロック（try-claim）も確認できる
- 401/403 が出たら条件付きアクセスで阻害 → MSAL Public Client フォールバックを検討

## 02-azure-openai-embed.js
社内 Azure OpenAI で `text-embedding-3-small` × `dimensions=256` が
叩けるかを検証する（ADR-004）。

- `ENDPOINT` / `DEPLOYMENT` / 認証方式を埋める
- 200 で 256 次元が返れば OK

## 結果の記録先
両方の結果（status / 詰まった点 / 確定した認証方式）を Notion の
「📝 設計変更ログ」または「🔁 ハンドオフログ」に残すと次フェーズで参照できる。

## この2つが通ったら
Phase 1 の残り（runtime.js 雛形 / SharePoint 追加列作成）に進む。
それまで monorepo は組まない（認証方式で構成が変わるため）。
