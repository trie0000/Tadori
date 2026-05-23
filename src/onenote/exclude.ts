// OneNote の取り込み済みページのうち、検索/更新チェック対象から外したい
// page-id 集合を localStorage に持つ。設定 UI のチェックボックスでトグルする。

const KEY = 'tadori:onenote:excluded';

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch { return new Set(); }
}

function write(s: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* quota: 諦める */ }
}

/** 現在の除外 page-id 集合を取得 (検索フィルタ用)。 */
export function getExcludedOneNotePageIds(): Set<string> { return read(); }

/** 除外集合を上書き保存 (UI で確定したタイミングで呼ぶ)。 */
export function setExcludedOneNotePageIds(ids: Iterable<string>): void { write(new Set(ids)); }
