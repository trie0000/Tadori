// メール本文の表示ユーティリティ (Spira の sanitize.ts を移植)。
// - HTML メール: DOMPurify でサニタイズして HTML 描画 (white-space:normal)。
// - プレーンメール: pre-wrap で素直に表示 (折返しは dewrap で軽く整える)。
// これにより HTML メールの「.Body テキスト変換による毎行ダブり改行」が消える。

import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'a', 'b', 'i', 'em', 'strong', 'u', 'br', 'p', 'div', 'span',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'hr', 'small', 'sub', 'sup',
];
const ALLOWED_ATTR = [
  'href', 'title', 'alt', 'src', 'colspan', 'rowspan', 'style',
  'width', 'height', 'align', 'border', 'cellpadding', 'cellspacing',
];

DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitizeMailHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link', 'style'],
  });
}

/** HTML からプレーンテキストを抽出 (埋め込み・スニペット・RAG 用)。
 *  DOMParser はスクリプトを実行しないので安全。 */
export function htmlToText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

const HTML_BLOCK_RE = /<(br|p|div|table|tr|td|th|li|ul|ol|h[1-6]|blockquote|pre|hr|section|article)\b/i;

function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[　-鿿＀-￯゠-ヿ぀-ゟ]/.test(ch) ? 2 : 1;
  return w;
}

/** プレーンテキストのハードラップ (~76桁折返し) を軽く解消する。 */
export function dewrapPlainText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const WRAP_THRESHOLD = 46;
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, '');
    if (out.length === 0) { out.push(line); continue; }
    const prev = out[out.length - 1];
    if (prev.trim() === '' || line.trim() === '') { out.push(line); continue; }
    if (visualWidth(prev) >= WRAP_THRESHOLD) {
      const a = prev[prev.length - 1] ?? '';
      const b = line[0] ?? '';
      const joiner = (/[A-Za-z0-9,;:.!?)\]]/.test(a) && /[A-Za-z0-9([]/.test(b)) ? ' ' : '';
      out[out.length - 1] = prev + joiner + line.replace(/^[ \t]+/, '');
    } else {
      out.push(line);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** HTML メール本文を「新規発言」と「引用履歴」に分割する。
 *  blockquote / gmail_quote / Outlook の divRplyFwdMsg 等の最初の出現を引用開始とみなす。
 *  検出できなければ tail は空 (= 全部 head)。サニタイズはしない (描画側で sanitizeMailHtml)。 */
export function splitHtmlReplyHistory(html: string): { head: string; tail: string } {
  if (!html) return { head: '', tail: '' };
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;
    const selectors = [
      'blockquote',
      '.gmail_quote',
      '[id^="divRplyFwdMsg"]',
      '[id="appendonsend"]',
      '[id^="OLK_SRC_BODY_SECTION"]',
      '[id="reply-intro"]',
    ];
    const firstMatch = body.querySelector(selectors.join(','));
    if (!firstMatch) return { head: html, tail: '' };
    // body の直下子まで遡る (引用ブロックが入れ子になっていてもグループごと尾に回す)。
    let top: Node = firstMatch;
    while (top.parentNode && top.parentNode !== body) top = top.parentNode;
    if (top.parentNode !== body) return { head: html, tail: '' };
    const headParts: string[] = [];
    const tailParts: string[] = [];
    let mode: 'head' | 'tail' = 'head';
    for (const ch of Array.from(body.childNodes)) {
      if (ch === top) mode = 'tail';
      const s = ch.nodeType === 1 ? (ch as Element).outerHTML : (ch.textContent || '');
      (mode === 'head' ? headParts : tailParts).push(s);
    }
    return { head: headParts.join(''), tail: tailParts.join('') };
  } catch { return { head: html, tail: '' }; }
}

/** 本文を host 要素へ描画。isHtml なら HTML、そうでなければプレーン。 */
export function renderMailBody(host: HTMLElement, body: string, isHtml: boolean): void {
  if (isHtml && body.trim()) {
    const html = body.trim();
    // 「プレーンが HTML として渡された」(ブロックタグ無し) なら pre-wrap で改行温存、
    // 本物の HTML はタグ通り (normal) に描画して二重改行を防ぐ。
    host.style.whiteSpace = HTML_BLOCK_RE.test(html) ? 'normal' : 'pre-wrap';
    host.innerHTML = sanitizeMailHtml(html);
    return;
  }
  host.style.whiteSpace = 'pre-wrap';
  host.textContent = dewrapPlainText(body || '(本文なし)');
}
