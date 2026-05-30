// ベクトルDB エンジンの共有インスタンス。検索(vectorSearch)と書き込み(writer)が
// 同じ VectorDb / cache / store / sync を使い、書き込み後すぐ検索に反映されるように。

import { SharePointClient } from '../sharepoint/client';
import { SpVectorStore } from '../sync/spStore';
import { SegmentCache, deleteLegacyDb } from './cache';
import { VectorDb } from './store';
import { VectorSync } from '../sync/sync';

export interface Engine {
  db: VectorDb;
  store: SpVectorStore;
  cache: SegmentCache;
  sync: VectorSync;
  siteUrl: string;
}

let engine: Engine | null = null;
// 旧バージョンの非分離 'tadori' DB を 1 回だけ削除する (サイト間データ混入防止)。
// 初回 getEngine 呼出時にバックグラウンドで実行。
let legacyDeleted = false;

/** siteUrl ごとのエンジンを返す。初回は一度同期してから返す。
 *  IndexedDB はサイトごとに分離 (cache.dbNameForSite)。 */
export async function getEngine(siteUrl: string): Promise<Engine> {
  if (engine && engine.siteUrl === siteUrl) return engine;
  if (!legacyDeleted) { legacyDeleted = true; void deleteLegacyDb(); }
  const db = new VectorDb();
  const store = new SpVectorStore(new SharePointClient(siteUrl));
  const cache = new SegmentCache(siteUrl);  // ← siteUrl を渡してサイト別 DB に
  const sync = new VectorSync(store, cache, db);
  engine = { db, store, cache, sync, siteUrl };
  await sync.sync();
  return engine;
}

/** 取り込み済みメールを全削除 (ローカルDB + IndexedDB キャッシュ + SharePoint ファイル)。 */
export async function wipeImportedMails(siteUrl: string): Promise<void> {
  const eng = await getEngine(siteUrl);
  eng.db.clear();
  await eng.cache.clearAll();
  await eng.store.deleteAll();
  engine = null; // 次回 getEngine で空状態から再同期
}
