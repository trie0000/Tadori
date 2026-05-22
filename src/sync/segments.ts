// ベクトルDBの配布フォーマット (SharePoint 上に置く)。
//
// 設計 (このリポジトリの設計ログ参照):
//   - ベクトルDB 本体は各 relay のローカル SQLite。SharePoint には「追記専用の
//     セグメント群 + manifest」を置き、各 relay が差分だけ取り込んで同期する。
//   - セグメントは封印後 不変。更新/削除は新しいレコード (op) を後続セグメントへ
//     追記し、seq 昇順・message-id 単位の last-writer-wins でローカルに収束させる。
//   - 1 セグメント ≒ 1,000 件で封印・ロール。容量回収はコンパクションで世代更新。

export type SegmentOp = 'upsert' | 'delete';

export interface SegmentRecord {
  /** 全体で単調増加する適用順。message-id 単位で最大 seq が勝つ。 */
  seq: number;
  op: SegmentOp;
  messageId: string;
  // op='upsert' のときのみ以下を持つ (delete は messageId だけの tombstone)。
  subject?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  /** 受信日時 (ISO)。SharePoint の Created とは別に実受信日を保持。 */
  date?: string;
  /** クリーニング済み本文 (検索結果表示 + RAG 用)。 */
  body?: string;
  /** 埋め込みベクトル (Base64 Float16, src/lib/float16.ts)。 */
  emb?: string;
}

export interface Segment {
  id: string;
  generation: number;
  records: SegmentRecord[];
}

export interface ManifestOpen {
  id: string;
  hash: string;
  count: number;
}

export interface Manifest {
  /** 単調増加。条件付 GET の補助・変化検知に使う。 */
  version: number;
  /** コンパクション世代。変わったら relay は集合を作り直す。 */
  generation: number;
  /** 封印済みセグメント id (不変・一度DLしたら再取得しない)。 */
  sealed: string[];
  /** 追記中セグメント (小・hash 変化で再取得)。無ければ null。 */
  open: ManifestOpen | null;
  /** 最終更新 ISO。 */
  updatedAt: string;
}

export const SEGMENT_CAP = 1000; // 1 セグメントの最大レコード数 (封印トリガ)

export function emptyManifest(): Manifest {
  return { version: 0, generation: 1, sealed: [], open: null, updatedAt: new Date().toISOString() };
}

export function serializeSegment(seg: Segment): string {
  return JSON.stringify(seg);
}

export function parseSegment(text: string): Segment {
  const o = JSON.parse(text) as Segment;
  if (!o || !Array.isArray(o.records)) throw new Error('壊れたセグメント');
  return o;
}

export function serializeManifest(m: Manifest): string {
  return JSON.stringify(m);
}

export function parseManifest(text: string): Manifest {
  const o = JSON.parse(text) as Manifest;
  if (!o || !Array.isArray(o.sealed)) throw new Error('壊れた manifest');
  return o;
}

/** open セグメントの変化検知用の軽量ハッシュ (FNV-1a 32bit)。 */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** relay が持っていない封印セグメント id を返す (差分DLの対象)。 */
export function missingSealed(manifest: Manifest, haveIds: ReadonlySet<string>): string[] {
  return manifest.sealed.filter(id => !haveIds.has(id));
}
