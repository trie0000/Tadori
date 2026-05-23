// メール本文のクリーニング (返信履歴・署名の除去 + 長さ制限)。取込/インポート共通。
// 方針: 本文中の「> 引用」はベクトル化対象として残す。落とすのは「前回返信の履歴」
// (帰属行/ヘッダブロック/区切り線) 以降だけ。

// 返信履歴・署名の開始を示す行。最初に一致した行以降を丸ごと落とす。
const REPLY_MARKERS: RegExp[] = [
  /^\s*-{2,}\s*$/,                                                  // 署名区切り (-- など)
  /^\s*_{5,}\s*$/,                                                  // Outlook の罫線 ____
  /^\s*[-=]{3,}\s*(Original Message|元のメッセージ|転送されたメッセージ).*$/i,
  /^\s*(From|差出人|送信者|Sent|送信日時|To|宛先|Cc|Subject|件名)\s*[:：]/i,  // 返信ヘッダブロック
  /^\s*On\b.*\bwrote\s*[:：]?\s*$/i,                                // On <date>, <name> wrote:
  /^.{0,80}(さんは|より|から).{0,40}(書きました|送信されました|次のように).*[:：]?\s*$/, // 〜さんは…と書きました：
  /^\s*\d{4}年\d{1,2}月\d{1,2}日.*[:：]\s*$/,                       // 2026年5月20日(火) … :
  /^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\b.*\bwrote\s*[:：]?\s*$/i,       // 2026-05-20 ... wrote:
];

/** 本文を「新規発言部分」と「引用履歴部分」に分割。表示時のトグル用にも使う。 */
export function splitReplyHistory(raw: string): { head: string; tail: string } {
  const lines = (raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  let cut = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (REPLY_MARKERS.some(re => re.test(lines[i]))) { cut = i; break; }
  }
  return {
    head: lines.slice(0, cut).join('\n').trim(),
    tail: lines.slice(cut).join('\n').trim(),
  };
}

export function cleanBody(raw: string): string {
  return splitReplyHistory(raw).head.slice(0, 8000);
}
