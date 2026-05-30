// IndexedDB によるセグメントキャッシュ。
// 起動のたびに SharePoint から全DLしないよう、DL済みセグメント(JSON)と最後に
// 見た manifest をブラウザにローカル保存する。次回は差分だけ取得すればよい。
//
// ★ サイト分離 ★
// 1 サイト = 1 IndexedDB ('tadori-<siteUrl ハッシュ>')。サイト切替時に
// 旧サイトの seg-* / manifest が新サイトの読み込みに混入するのを防ぐため。
// 旧バージョン ('tadori' 固定) のデータは listOldDatabases で削除候補に挙げる
// (現状は明示的な削除 API は提供しないが、最初の getEngine 時に検出 → 警告 →
// ブラウザのデータをクリアしてもらう運用)。

import { type Segment, type Manifest, parseSegment, serializeSegment, parseManifest, serializeManifest } from '../sync/segments';

/** 旧バージョン (サイト非分離) の DB 名。マイグレーション判定で参照する。 */
const LEGACY_DB_NAME = 'tadori';
const DB_VERSION = 1;
const STORE_SEG = 'segments';   // key = segment id, value = JSON text
const STORE_META = 'meta';      // key = 'manifest', value = JSON text

/** siteUrl から安定したハッシュ文字列を生成 (DB 名の suffix 用)。
 *  暗号強度は不要なので軽量な djb2 + base36 で十分。 */
function siteHash(siteUrl: string): string {
  const s = (siteUrl || '').toLowerCase().replace(/\/+$/, '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36); // unsigned 化して 36 進
}

/** サイトごとに分離した IndexedDB 名を返す。例: 'tadori-2vrxg9'  */
export function dbNameForSite(siteUrl: string): string {
  return `tadori-${siteHash(siteUrl)}`;
}

function open(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SEG)) db.createObjectStore(STORE_SEG);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 旧バージョン (サイト非分離) の DB を削除。1 回だけ呼べばよい。
 *  失敗 (= 既に無い、ブラウザが許可しない等) は無視。 */
export async function deleteLegacyDb(): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror   = () => resolve();
      req.onblocked = () => resolve();
    });
  } catch { /* noop */ }
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SegmentCache {
  private dbp: Promise<IDBDatabase> | null = null;
  private readonly name: string;

  /** siteUrl を渡すと該当サイト専用 DB を開く。省略時はレガシー DB ('tadori')
   *  にフォールバック (旧テスト互換目的のみ — 通常運用では siteUrl を渡す)。 */
  constructor(siteUrl?: string) {
    this.name = siteUrl ? dbNameForSite(siteUrl) : LEGACY_DB_NAME;
  }

  /** 現在の DB 名 (デバッグ用)。 */
  get dbName(): string { return this.name; }

  private db(): Promise<IDBDatabase> { return (this.dbp ??= open(this.name)); }

  async allIds(): Promise<string[]> {
    const db = await this.db();
    const keys = await tx<IDBValidKey[]>(db, STORE_SEG, 'readonly', s => s.getAllKeys());
    return keys.map(String);
  }

  async get(id: string): Promise<Segment | null> {
    const db = await this.db();
    const text = await tx<string | undefined>(db, STORE_SEG, 'readonly', s => s.get(id));
    return text ? parseSegment(text) : null;
  }

  async put(id: string, seg: Segment): Promise<void> {
    const db = await this.db();
    await tx(db, STORE_SEG, 'readwrite', s => s.put(serializeSegment(seg), id));
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    await tx(db, STORE_SEG, 'readwrite', s => s.delete(id));
  }

  async getManifest(): Promise<Manifest | null> {
    const db = await this.db();
    const text = await tx<string | undefined>(db, STORE_META, 'readonly', s => s.get('manifest'));
    return text ? parseManifest(text) : null;
  }

  async setManifest(m: Manifest): Promise<void> {
    const db = await this.db();
    await tx(db, STORE_META, 'readwrite', s => s.put(serializeManifest(m), 'manifest'));
  }

  /** すべてのセグメントと manifest を消す (取り込み済みメールの全削除用)。 */
  async clearAll(): Promise<void> {
    const db = await this.db();
    await tx(db, STORE_SEG, 'readwrite', s => s.clear());
    await tx(db, STORE_META, 'readwrite', s => s.clear());
  }
}
