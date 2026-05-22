# 🎯 Tadori（辿り）— ML メール検索ツール

メーリングリスト（ML）の過去メールを「意味」で辿るセマンティック検索ツール。
委任先 M365 の制約下で動く、ブックマークレット型のクライアントサイドベクトル検索。

- 設計ドキュメント: Notion「🎯 Tadori - ML メール検索ツール」
- スタック: TypeScript / esbuild / SharePoint REST / Azure OpenAI / IndexedDB

## 現在地（Phase 0 → Phase 1 着手）

本格実装の前に、アーキテクチャの土台となる2つの前提を業務PCで検証する。

```
poc/
├── 01-sharepoint-cookie-auth.js   # ADR-007: Cookie 認証で List REST 読み書き
├── 02-azure-openai-embed.js       # ADR-004: 埋め込み256次元（relay 経由）
└── README.md
scripts/
├── tadori-ai-relay.ps1            # 社内プロキシ越えの AI 中継（Pure PowerShell）
├── tadori-ai-relay.env.example    # 中継の設定例（コピーして .env を作る）
└── tadori-ai-relay.bat            # ダブルクリック起動用 wrapper
```

## AI 中継サーバについて

ブラウザの `fetch()` は社内プロキシを per-request で指定できないため、
ローカルの PowerShell リレー（loopback で listen → 社内プロキシ経由で
ゲートウェイへ転送）を経由して Azure OpenAI を叩く。Spira の
`spira-ai-relay.ps1` から AI 中継部分のみを流用したもの。

```
[Tadori bookmarklet] --HTTP--> http://127.0.0.1:18080 --HTTPS via proxy--> Azure OpenAI
```

### セットアップ（業務PC / PowerShell）

```powershell
cd scripts
copy tadori-ai-relay.env.example tadori-ai-relay.env
notepad tadori-ai-relay.env        # TADORI_AI_TARGET / TADORI_AI_PROXY を設定
.\tadori-ai-relay.bat              # 起動（Ctrl+C で終了）
```

起動後、`poc/02` のベース URL（`http://localhost:18080`）で埋め込みを検証する。

## 制約（変更不可）

- Azure AD アプリ登録不可 → Cookie 認証 or 既存テナントの MSAL のみ
- Python ローカル実行不可 → クライアントロジックは JS/TS、中継は PowerShell のみ
- 外部 SaaS 不可 → 社内 Azure OpenAI 以外への送信なし
- メール本文は Microsoft クラウド内に留める
