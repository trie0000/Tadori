// 開発者モード — localStorage の単純フラグ。
// 有効時のみ Claude API / Voyage 直接利用などの実験的設定を表示する。
// (Spira の src/utils/devMode.ts と同じ流儀。Tadori は独自キー。)

const KEY = 'tadori:developer-mode';

export function isDeveloperMode(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDeveloperMode(v: boolean): void {
  try {
    if (v) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch (e) {
    console.warn('[tadori/devMode] localStorage 書込失敗:', (e as Error).message);
  }
}
