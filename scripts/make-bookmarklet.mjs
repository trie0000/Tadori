#!/usr/bin/env node
// bookmarklet URL 生成スクリプト。
//
// Usage:
//   node scripts/make-bookmarklet.mjs <SharePoint上のtadori.js URL>
//
// Example:
//   node scripts/make-bookmarklet.mjs \
//     "https://contoso.sharepoint.com/sites/tools/Shared%20Documents/tadori/dist/tadori.js"
//
// 出力された javascript: URL をブラウザのブックマーク URL に設定する。

const runtimeUrl = process.argv[2];
if (!runtimeUrl) {
  console.error('Usage: node scripts/make-bookmarklet.mjs <runtime-url>');
  process.exit(1);
}

// ランタイムを <script> タグで読み込む最小ローダー。
// 既存インスタンスがあればトグルオフ (再クリックで閉じる)。
const loaderCode = `(function(){
var r=document.getElementById('tadori-root');
if(r){r.remove();return;}
var s=document.createElement('script');
s.src=${JSON.stringify(runtimeUrl)}+'?_t='+Date.now();
document.head.appendChild(s);
})();`;

const bookmarklet = 'javascript:' + encodeURIComponent(loaderCode);
console.log('\n=== bookmarklet URL (ブラウザのブックマーク URL に貼り付け) ===\n');
console.log(bookmarklet);
console.log('\n=== 文字数 ===');
console.log(`${bookmarklet.length} 文字`);
