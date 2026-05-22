// 最小 DOM ヘルパ (Spira の el() 流儀)。
// children に文字列を渡すと textNode、HTMLElement はそのまま append。
// 属性 'html' は innerHTML、'style' は cssText、それ以外は setAttribute。

type Attrs = Record<string, string | undefined>;
type Child = string | Node;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'html') node.innerHTML = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** クエリクリアも兼ねた innerHTML 置換。 */
export function clear(node: HTMLElement): void {
  node.textContent = '';
}
