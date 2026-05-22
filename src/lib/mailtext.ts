// メール本文のクリーニング (引用・署名除去 + 長さ制限)。取込/インポート共通。

export function cleanBody(raw: string): string {
  let t = (raw ?? '').replace(/\r\n/g, '\n');
  // 返信ヘッダ (From:/差出人:/送信者: 以降) や区切り線以降をカット
  const m = t.search(/\n-{2,}\s*\n|^(From|差出人|送信者):.*$/m);
  if (m > 0) t = t.slice(0, m);
  // 引用行 (> ...) を除去
  t = t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n');
  return t.trim().slice(0, 8000);
}
