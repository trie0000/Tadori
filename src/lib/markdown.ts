// 読み取り専用の軽量 Markdown → HTML レンダラ (AI 回答のリッチ表示用)。
// 入力は LLM 生成テキストなので、まず HTML エスケープしてから自前のタグだけを
// 組み立てる (XSS 防止)。対応: 見出し / 箇条書き・番号リスト / 引用 / コード
// フェンス・インラインコード / 太字・斜体 / リンク / 段落・改行 / 水平線。

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** インライン装飾。s は HTML エスケープ済み前提。 */
function inline(s: string): string {
  let out = s;
  // インラインコード (中の * 等を装飾対象から保護)
  out = out.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`);
  // 太字 → 斜体 の順
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // リンク [text](https://...)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  return out;
}

const BLOCK_START = /^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+\.\s)/;

export function renderMarkdown(md: string): string {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // コードフェンス ```
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 閉じフェンスを飛ばす
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 見出し
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { const lvl = h[1].length; out.push(`<h${lvl}>${inline(escapeHtml(h[2]))}</h${lvl}>`); i++; continue; }

    // 水平線
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(escapeHtml(buf.join(' ')))}</blockquote>`);
      continue;
    }

    // 箇条書き
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      out.push('<ul>' + buf.map(b => `<li>${inline(escapeHtml(b))}</li>`).join('') + '</ul>');
      continue;
    }

    // 番号リスト
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push('<ol>' + buf.map(b => `<li>${inline(escapeHtml(b))}</li>`).join('') + '</ol>');
      continue;
    }

    // 空行
    if (/^\s*$/.test(line)) { i++; continue; }

    // 段落 (空行 or 別ブロック開始まで)
    const buf: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(escapeHtml(buf.join('\n'))).replace(/\n/g, '<br>')}</p>`);
  }

  return out.join('\n');
}
