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
