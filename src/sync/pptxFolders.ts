// PPTX マニュアル取り込みフォルダの設定 (localStorage)。
// 1 設定 = 1 SP ドキュメントライブラリフォルダ。複数登録可。
//
// 各フォルダ単位で:
//   - サブフォルダ再帰の有無
//   - 前回同期時刻 (増分判定用ヒント)
//   - 前回のファイル別最終更新時刻 (per-file 増分判定の真正値)
// を保持する。per-file の精密な状態は SP の Tadori Sync List 側にも meta 行と
// して書き、複数端末でも一貫性が取れる (このファイルは UI 表示の高速化用)。
//
// 設計参照: docs/pptx-rag-design.md §4.3

const KEY = 'tadori:pptx:folders';

export interface PptxFolderConfig {
  /** 表示用 URL (絶対 URL or serverRelativeUrl。入力されたまま保持)。 */
  url: string;
  /** ユーザ任意のラベル (省略時は URL 末尾セグメント)。 */
  label?: string;
  /** サブフォルダも再帰的に走査するか。 */
  recursive: boolean;
  /** 最後に同期した UNIX ms (UI 表示用。0 = 未同期)。 */
  lastSyncAt: number;
  /** 前回同期時のファイル別最終更新時刻 (filename → ISO8601)。増分判定の高速ヒント。 */
  perFile: Record<string, string>;
}

function load(): PptxFolderConfig[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PptxFolderConfig[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function save(list: PptxFolderConfig[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
}

export function listPptxFolders(): PptxFolderConfig[] {
  return load();
}

export function addPptxFolder(cfg: Omit<PptxFolderConfig, 'lastSyncAt' | 'perFile'>): void {
  const list = load();
  // URL の重複は label を上書き
  const idx = list.findIndex(f => normalizeKey(f.url) === normalizeKey(cfg.url));
  if (idx >= 0) {
    list[idx] = { ...list[idx], label: cfg.label, recursive: cfg.recursive };
  } else {
    list.push({ ...cfg, lastSyncAt: 0, perFile: {} });
  }
  save(list);
}

export function removePptxFolder(url: string): void {
  const list = load().filter(f => normalizeKey(f.url) !== normalizeKey(url));
  save(list);
}

export function updatePptxFolderSync(url: string, perFile: Record<string, string>): void {
  const list = load();
  const idx = list.findIndex(f => normalizeKey(f.url) === normalizeKey(url));
  if (idx < 0) return;
  list[idx] = { ...list[idx], lastSyncAt: Date.now(), perFile };
  save(list);
}

/** URL 比較用キー (末尾スラッシュ / URL エンコード差を吸収)。 */
export function normalizeKey(url: string): string {
  let s = url.trim().replace(/\/+$/, '').toLowerCase();
  try { s = decodeURIComponent(s); } catch { /* keep raw */ }
  return s;
}

/** URL から表示用ラベル (末尾セグメント) を推測。 */
export function deriveLabel(url: string): string {
  try {
    const u = url.replace(/\/+$/, '');
    const i = u.lastIndexOf('/');
    if (i < 0) return u;
    return decodeURIComponent(u.slice(i + 1));
  } catch { return url; }
}
