// ベクトルDB エンジンの共有インスタンス。検索(vectorSearch)と書き込み(writer)が
// 同じ VectorDb / cache / store / sync を使い、書き込み後すぐ検索に反映されるように。

import { SharePointClient } from '../sharepoint/client';
import { SpVectorStore } from '../sync/spStore';
import { SegmentCache } from './cache';
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

/** siteUrl ごとのエンジンを返す。初回は一度同期してから返す。 */
export async function getEngine(siteUrl: string): Promise<Engine> {
  if (engine && engine.siteUrl === siteUrl) return engine;
  const db = new VectorDb();
  const store = new SpVectorStore(new SharePointClient(siteUrl));
  const cache = new SegmentCache();
  const sync = new VectorSync(store, cache, db);
  engine = { db, store, cache, sync, siteUrl };
  await sync.sync();
  return engine;
}
