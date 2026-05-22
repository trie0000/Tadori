# Tadori UI デザインブリーフ（claude.design 用）

このファイルを claude.design にそのまま貼り、必要なら Spira の実画面スクショを
添付する。**目的: Spira と同一のデザイン言語で Tadori の画面を作る。**

---

## 0. 大前提

- Tadori は SharePoint / OWA のページ**上に被せて表示する注入型 UI**（独立アプリではない）。
- ホストページの CSS に汚染されないよう、ルート要素に `all: initial` を当て、
  超高 z-index（20億台）で最前面に出す。Spira と同じ方式。
- **デザイントークン（下記）は Spira からそのまま流用する。新しい色を作らない。**
  これが「Spira と同じ見た目」を保証する唯一の確実な方法。

## 1. デザイン言語（一言で）

「紙と墨と苔色」。暖色オフホワイトの紙地（paper）に、墨色（ink）の文字、
差し色は彩度を抑えた苔グリーン（moss green）。青を使わない暖かい影。
和文フォント（Meiryo 基準）。情報密度は高め、角丸は控えめ。

## 2. デザイントークン（Spira app.css より、そのままコピー可）

```css
:root {
  /* text */
  --ink: #2a2a26; --ink-3: #7a766c; --ink-4: #a8a39a;
  /* surface (paper) */
  --paper: #fafaf7; --paper-2: #f3f1ea; --paper-2-strong: #ece8de; --paper-3: #e8e4d8;
  /* line */
  --line: rgba(42,42,38,0.12); --line-strong: rgba(42,42,38,0.18);
  /* accent — moss green */
  --accent: #7a8a78; --accent-soft: rgba(122,138,120,0.18); --accent-strong: #5e6f5c;
  /* status */
  --danger: #b8534a; --warn: #c47f1c; --ok: #2f6f5e;
  --hl: rgba(196,174,96,0.35); /* 検索ハイライト用の山吹色 */
  /* type */
  --font-sans: "Meiryo","メイリオ","Hiragino Sans","Yu Gothic UI",-apple-system,"Segoe UI",system-ui,sans-serif;
  --font-mono: ui-monospace,"Cascadia Mono","Consolas",monospace;
  --fs-xs:11px; --fs-sm:12px; --fs-md:13px; --fs-base:15px; --fs-lg:16px; --fs-xl:18px;
  --fs-h3:22px; --fs-h2:28px; --fs-h1:36px;
  --lh-base:1.75; --lh-tight:1.35;
  /* spacing (4px base) */
  --s-1:4px; --s-2:6px; --s-3:8px; --s-4:10px; --s-5:12px; --s-6:14px; --s-7:18px; --s-8:22px; --s-9:28px; --s-10:40px;
  /* radius (控えめ) */
  --r-1:2px; --r-2:4px; --r-3:6px; --r-4:8px;
  /* shadow (暖色、青なし) */
  --shadow-panel: 0 8px 20px rgba(42,42,38,0.10);
  --shadow-modal: 0 0 0 1px rgba(42,42,38,0.06), 0 4px 12px rgba(42,42,38,0.10), 0 16px 40px rgba(42,42,38,0.18);
  /* chrome 寸法 */
  --topbar-h:44px; --side-w:200px; --toolbar-h:38px; --gutter:16px;
}
```

ダークモードあり（紙地 #1d1b18 / 墨 #e8e4d8 に反転）。フォントサイズは sm/中/lg の
3 段階を `data-font-size` 属性で切替（Spira と同じ）。

## 3. コンポーネント語彙（Spira と同じ命名・見た目）

- **ボタン**: primary（accent 塗り・白文字）/ ghost（枠線のみ）/ danger / icon。高さ 28〜32px、角丸 --r-2。
- **バッジ/チップ**: fill / ok / warn / danger / muted。小さめ、--fs-sm。
- **入力**: テキスト/セレクト/検索ボックス（左に虫眼鏡、paper-2 地）。
- **モーダル**: 暖色の三段影、backdrop は半透明。
- **トースト**: 右上、--z-toast。
- **テーブル/リスト**: 行区切りは --line、ホバーで paper-2。

## 4. Tadori で必要な画面（ここを claude.design に設計させる）

Spira は topbar+sidebar+main のフルシェルだが、Tadori は**検索が主役**なので
以下の 3 面を中心に。レイアウトは Spira の chrome（topbar/sidebar）を踏襲するか、
軽量パネル単体にするかは提案してほしい。

### (A) 検索パネル ★最重要
- 上部に大きめの検索ボックス（プレースホルダ「メール内容を意味で検索…」）
- 直下に件数・所要時間（例: 「1,240 件中 上位 20 件 / 38ms」）
- 結果リスト: 1 行 = 件名（強調）/ 送信者・日時（muted）/ 本文スニペット（--hl で
  クエリ周辺をハイライト）/ 右に「OWA で開く」リンク。
- 各行クリックで詳細プレビュー（右ペイン or 展開）。

### (B) 取り込み状況（Sticky モード）
- 小さなステータスバッジ: 稼働中/停止、claimed/embedded/indexed の件数、最終同期時刻。
- トグルで取り込みループの ON/OFF。

### (C) 設定モーダル
- 中継サーバ URL、デプロイ名、API キー、対象 ML アドレス、次元数、同期間隔。
- Spira の設定モーダル（settingsModal）と同じ見た目に。

## 4.5. モーダル & 設定フォームの寸法（Spira そのまま — ここを統一）

### モーダル外枠（Spira app.css そのまま使う）
```css
.modal-backdrop {
  position: fixed; inset: 0; z-index: var(--z-modal);
  background: rgba(15,15,15,0.45); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: var(--s-7);              /* 18px — 画面端との余白 */
}
.modal {
  background: var(--paper); border: 1px solid var(--line-strong);
  border-radius: var(--r-3);        /* 6px */
  box-shadow: var(--shadow-modal);
  padding: var(--s-7);              /* 18px — モーダル内側の余白 */
  width: 100%; max-width: 560px;    /* 標準。大きい設定は lg=1000px */
  max-height: calc(100vh - var(--s-10)); overflow: auto;
}
.modal-header { display:flex; align-items:center; gap:var(--s-3); margin-bottom:var(--s-5); } /* 下 12px */
.modal-title  { font-size: var(--fs-lg); font-weight: 600; color: var(--ink); margin: 0; }
.modal-body   { font-size: var(--fs-md); color: var(--ink); }
.modal-footer { display:flex; justify-content:flex-end; gap:var(--s-3); margin-top:var(--s-7); } /* 上 18px、ボタンは右寄せ */
```
- **マージンの要点**: backdrop も modal も内側余白は `--s-7`(18px)。header 下は `--s-5`(12px)、
  footer 上は `--s-7`(18px)、footer ボタンは**右寄せ・gap 8px**。これを崩さない。

### 設定項目のレイアウト（2 通り。Spira はこの 2 つだけ使う）

**(1) 2 列グリッド** — ラベルと入力を横並びにする標準形（AI 設定で使用）:
```css
.field-grid {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);  /* ラベル120px / 入力可変 */
  gap: var(--s-3) var(--s-4);                    /* 行間8px 列間10px */
  align-items: center;
}
/* ラベルは右寄せ・muted・小さめ */
.field-grid > label {
  color: var(--ink-3); font-size: var(--fs-sm);
  justify-self: end; text-align: right; white-space: nowrap;
  align-self: center;
}
/* textarea 行のラベルだけ上揃え: align-self:start; padding-top:8px */
```

**(2) 縦積みフィールド** — ラベルを入力の上に置く形（`.spira-field`）:
```css
.field { display: flex; flex-direction: column; gap: var(--s-2); margin-bottom: var(--s-5); }
.field-label { font-size: var(--fs-sm); color: var(--ink-3); font-weight: 500; }
```

### 補足テキスト（ヒント）
入力の下の注記は必ずこの体裁:
```css
.field-hint { font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.6; margin: var(--s-2) 0 0; }
```

### 入力コントロール
すべて `.spira-input`（= Tadori では `.input`）。select は `width:100%` か固定幅（例 260px）。
パスワード系（API キー）は `type="password"` + `autocomplete="off"`。

### Tadori 設定モーダルの項目（上記グリッドに流し込む）
中継サーバ URL / デプロイ名 / API キー(password) / 対象 ML アドレス(textarea) /
次元数(select) / 同期間隔(select)。各項目の下にヒント文を `.field-hint` で。

## 5. claude.design への指示文（コピペ用）

> 添付のデザイントークンとスクリーンショットに完全準拠して、「Tadori」という
> SharePoint 上に注入されるメール意味検索ツールの UI を設計してください。配色・
> フォント・余白・角丸・影は添付トークンの CSS 変数だけを使い、新しい色や
> フォントを足さないこと。和文（日本語）UI。画面は (A) 検索パネル、(B) 取り込み
> 状況バッジ、(C) 設定モーダル の 3 つ。トーンは Spira と同じ「紙と墨と苔色」。
> 出力は各画面の HTML + これらの CSS 変数を参照する CSS で。
>
> **モーダルと設定フォームは「4.5 モーダル & 設定フォームの寸法」の数値を厳密に
> 守ること**: モーダル内側余白 18px(--s-7)、header 下 12px(--s-5)、footer 上 18px・
> ボタン右寄せ、設定項目はラベル 120px の 2 列グリッド（ラベルは右寄せ・muted・
> --fs-sm）、ヒント文は --fs-xs・ink-3・行高 1.6。これらを Spira と完全一致させる。
