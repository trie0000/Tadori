// トースト。右上 stack。
// info/ok は 2 秒で自動消滅。error は手動で閉じるまで残り、本文は選択可能 +
// 「コピー」ボタン付き (コンソールが使えない環境でエラー全文を取れるように)。
import { el } from '../lib/dom';
import { icons } from './icons';

let stack: HTMLElement | null = null;

function ensureStack(root: HTMLElement): HTMLElement {
  if (stack && root.contains(stack)) return stack;
  stack = el('div', { class: 'tdr-toast-stack' });
  root.appendChild(stack);
  return stack;
}

export function toast(root: HTMLElement, message: string, kind: 'info' | 'error' = 'info'): void {
  if (kind !== 'error') {
    const node = el('div', { class: 'tdr-toast' }, [message]);
    ensureStack(root).appendChild(node);
    setTimeout(() => node.remove(), 2000);
    return;
  }

  // エラー: 選択可能な本文 + コピー / 閉じる。クリックで勝手に消さない。
  const msg = el('div', { class: 'tdr-toast-msg' }, [message]);
  const copyBtn = el('button', { class: 'tdr-toast-btn' }, ['コピー']);
  const closeBtn = el('button', { class: 'tdr-toast-btn', 'aria-label': '閉じる', html: icons.close(14) });
  const node = el('div', { class: 'tdr-toast tdr-toast--error' }, [
    msg,
    el('div', { class: 'tdr-toast-actions' }, [copyBtn, closeBtn]),
  ]);

  copyBtn.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(message);
        copyBtn.textContent = 'コピーしました';
        setTimeout(() => { copyBtn.textContent = 'コピー'; }, 1500);
      } catch {
        // clipboard 不可時は本文を選択状態にして手動 Cmd/Ctrl+C を促す
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(msg);
        sel?.removeAllRanges();
        sel?.addRange(range);
        copyBtn.textContent = '選択しました (Cmd+C)';
        setTimeout(() => { copyBtn.textContent = 'コピー'; }, 2500);
      }
    })();
  });
  closeBtn.addEventListener('click', () => node.remove());

  ensureStack(root).appendChild(node);
}
