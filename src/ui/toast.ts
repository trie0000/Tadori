// トースト。右上 stack。Spira (src/components/toast.ts) と同じ作り。
// × で閉じるだけ。本文はデフォルトで選択可能 (マウスでドラッグ → コピー)。
// ok/info は 2 秒、warn は 3 秒、error は手動で閉じるまで残る。
import { el } from '../lib/dom';
import { icons } from './icons';

type Variant = 'default' | 'ok' | 'warn' | 'error';

let stack: HTMLElement | null = null;

function ensureStack(root: HTMLElement): HTMLElement {
  if (stack && root.contains(stack)) return stack;
  stack = el('div', { class: 'tdr-toast-stack', role: 'status', 'aria-live': 'polite' });
  root.appendChild(stack);
  return stack;
}

export function toast(root: HTMLElement, msg: string, variant: Variant = 'default', durationMs?: number): void {
  const cls = ['tdr-toast'];
  if (variant !== 'default') cls.push(`tdr-toast--${variant}`);

  const closeBtn = el('button', {
    class: 'tdr-iconbtn',
    'aria-label': '閉じる',
    style: 'width:22px;height:22px;flex-shrink:0;color:var(--ink-3)',
    html: icons.close(14),
  });

  const node = el('div', {
    class: cls.join(' '),
    style: 'display:flex;align-items:flex-start;gap:var(--s-3)',
  }, [
    el('div', { style: 'flex:1;min-width:0;word-break:break-word' }, [msg]),
    closeBtn,
  ]);

  function dismiss(): void {
    if (!node.isConnected) return;
    node.style.transition = 'opacity .15s, transform .15s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(-4px)';
    setTimeout(() => node.remove(), 160);
  }

  closeBtn.addEventListener('click', e => { e.stopPropagation(); dismiss(); });

  ensureStack(root).appendChild(node);

  const ttl = durationMs ?? (variant === 'error' ? 0 : variant === 'warn' ? 3000 : 2000);
  if (ttl > 0) setTimeout(dismiss, ttl);
}
