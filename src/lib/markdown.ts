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

    // 箇条書き (字下げによるネスト対応。2 スペース = 1 階層)
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const m = /^([ \t]*)[-*+]\s+(.*)$/.exec(lines[i])!;
        const indent = m[1].replace(/\t/g, '  ').length;
        items.push({ depth: Math.floor(indent / 2), text: m[2] });
        i++;
      }
      out.push(renderNestedList(items, 'ul'));
      continue;
    }

    // 番号リスト (ネスト対応)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = /^([ \t]*)\d+\.\s+(.*)$/.exec(lines[i])!;
        const indent = m[1].replace(/\t/g, '  ').length;
        items.push({ depth: Math.floor(indent / 2), text: m[2] });
        i++;
      }
      out.push(renderNestedList(items, 'ol'));
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

/** 字下げ depth (0,1,2..) から HTML を組み立てる。深くなれば <li> の中に
 *  入れ子の <ul>/<ol> を作り、浅くなれば閉じる。階層リストで読みやすくする。 */
function renderNestedList(items: { depth: number; text: string }[], tag: 'ul' | 'ol'): string {
  if (items.length === 0) return '';
  const min = Math.min(...items.map(x => x.depth));
  const norm = items.map(x => ({ depth: Math.max(0, x.depth - min), text: x.text }));
  let html = '';
  let depth = -1;
  for (const it of norm) {
    if (depth < 0) {
      html += `<${tag}><li>` + inline(escapeHtml(it.text));
      depth = it.depth;
    } else if (it.depth > depth) {
      for (let d = depth; d < it.depth; d++) html += `<${tag}><li>`;
      html += inline(escapeHtml(it.text));
      depth = it.depth;
    } else if (it.depth < depth) {
      for (let d = depth; d > it.depth; d--) html += `</li></${tag}>`;
      html += `</li><li>` + inline(escapeHtml(it.text));
      depth = it.depth;
    } else {
      html += `</li><li>` + inline(escapeHtml(it.text));
    }
  }
  while (depth >= 0) { html += `</li></${tag}>`; depth--; }
  return html;
}
