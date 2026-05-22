// トースト。右上 stack。ok/info は 2 秒、error は手動 dismiss。
import { el } from '../lib/dom';

let stack: HTMLElement | null = null;

function ensureStack(root: HTMLElement): HTMLElement {
  if (stack && root.contains(stack)) return stack;
  stack = el('div', { class: 'tdr-toast-stack' });
  root.appendChild(stack);
  return stack;
}

export function toast(root: HTMLElement, message: string, kind: 'info' | 'error' = 'info'): void {
  const node = el('div', { class: 'tdr-toast' }, [message]);
  ensureStack(root).appendChild(node);
  if (kind !== 'error') {
    setTimeout(() => node.remove(), 2000);
  } else {
    node.style.cursor = 'pointer';
    node.addEventListener('click', () => node.remove());
  }
}
