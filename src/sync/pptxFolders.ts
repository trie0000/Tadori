// PPTX マニュアル取り込みフォルダの設定 (localStorage、サイト別)。
// 1 設定 = 1 SP ドキュメントライブラリフォルダ。複数登録可。
//
// ★ サイト分離 ★
// 旧バージョン (タスク #44 まで) はキー 'tadori:pptx:folders' に
// グローバル保存されていたため、サイトを切替えても同じ設定が見えていた。
// 修正後は 'tadori:pptx:folders:<siteUrl ハッシュ>' でサイトごとに分離。
//
// マイグレーション: 起動時に旧グローバルキーがあれば、現在のサイトに移管 (1 回のみ)。
// ※ 起動時にアクティブだったサイトに紐付くので、複数サイト運用していたユーザは
//   別サイトで再追加が必要になる。代替案はないので割り切る。
//
// 設計参照: docs/pptx-rag-design.md §4.3

import { siteHash } from '../sharepoint/spSites';

const LEGACY_KEY = 'tadori:pptx:folders';
const MIGRATED_KEY = 'tadori:pptx:folders:legacy-migrated';

function keyFor(siteUrl: string): string {
  return `tadori:pptx:folders:${siteHash(siteUrl)}`;
}

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

/** 旧 'tadori:pptx:folders' グローバルキーを現在サイトのキーへ移管 (1 回だけ)。
 *  既に移管済みなら何もしない。 */
function migrateLegacy(siteUrl: string): void {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) { localStorage.setItem(MIGRATED_KEY, '1'); return; }
    const cur = localStorage.getItem(keyFor(siteUrl));
    // 現在サイトに既設定があるなら上書きせず legacy を捨てる (安全側)
    if (!cur) localStorage.setItem(keyFor(siteUrl), legacy);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.setItem(MIGRATED_KEY, '1');
    console.log('[tadori] pptx folders: legacy 設定を現在サイトへ移管しました');
  } catch { /* noop */ }
}

function load(siteUrl: string): PptxFolderConfig[] {
  try {
    migrateLegacy(siteUrl);
    const raw = localStorage.getItem(keyFor(siteUrl));
    if (!raw) return [];
    const arr = JSON.parse(raw) as PptxFolderConfig[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function save(siteUrl: string, list: PptxFolderConfig[]): void {
  try { localStorage.setItem(keyFor(siteUrl), JSON.stringify(list)); } catch { /* quota */ }
}

export function listPptxFolders(siteUrl: string): PptxFolderConfig[] {
  return load(siteUrl);
}

export function addPptxFolder(siteUrl: string, cfg: Omit<PptxFolderConfig, 'lastSyncAt' | 'perFile'>): void {
  const list = load(siteUrl);
  // URL の重複は label を上書き
  const idx = list.findIndex(f => normalizeKey(f.url) === normalizeKey(cfg.url));
  if (idx >= 0) {
    list[idx] = { ...list[idx], label: cfg.label, recursive: cfg.recursive };
  } else {
    list.push({ ...cfg, lastSyncAt: 0, perFile: {} });
  }
  save(siteUrl, list);
}

export function removePptxFolder(siteUrl: string, url: string): void {
  const list = load(siteUrl).filter(f => normalizeKey(f.url) !== normalizeKey(url));
  save(siteUrl, list);
}

export function updatePptxFolderSync(siteUrl: string, url: string, perFile: Record<string, string>): void {
  const list = load(siteUrl);
  const idx = list.findIndex(f => normalizeKey(f.url) === normalizeKey(url));
  if (idx < 0) return;
  list[idx] = { ...list[idx], lastSyncAt: Date.now(), perFile };
  save(siteUrl, list);
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
