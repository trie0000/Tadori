// 新方式の検索エントリ。SharePoint のセグメントをブラウザ内ベクトルDBへ同期し、
// クエリを埋め込み → 総当たり cosine で Top-K。List 列方式 (旧 searchMails) の置換。

import { getEngine } from '../db/engine';
import { embedQueryFor } from '../embeddings/router';
import type { MailRecord } from '../db/store';
import type { RuntimeSettings } from '../api/aiSettings';
import { getExcludedOneNotePageIds } from '../onenote/exclude';

export interface MailHit {
  messageId: string;
  internetMessageId: string;
  conversationId: string;
  kind: 'mail' | 'onenote' | 'doc';
  chunkIdx?: number;
  chunkCount?: number;
  docPath?: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  body: string;
  isHtml: boolean;
  score: number;
}

function toHit(record: MailRecord, score: number): MailHit {
  return {
    messageId: record.messageId,
    internetMessageId: record.internetMessageId,
    conversationId: record.conversationId,
    kind: record.kind ?? 'mail',
    chunkIdx: record.chunkIdx,
    chunkCount: record.chunkCount,
    docPath: record.docPath,
    subject: record.subject,
    from: record.from,
    to: record.to,
    cc: record.cc,
    date: record.date,
    body: record.body,
    isHtml: record.isHtml,
    score,
  };
}

/** 手動再同期 (取り込み後など)。 */
export async function resyncVectors(siteUrl: string): Promise<void> {
  const eng = await getEngine(siteUrl);
  await eng.sync.sync();
}

export async function searchVectors(
  question: string,
  s: RuntimeSettings,
  siteUrl: string,
  topK: number,
): Promise<MailHit[]> {
  const eng = await getEngine(siteUrl);
  if (eng.db.size === 0) return [];
  const qvec = await embedQueryFor(question, s);
  const excluded = getExcludedOneNotePageIds();
  // 1 OneNote ページが多数チャンクに分かれている場合、固定 over-pull だとデデュープ後に
  // topK 未満で返るリスクがある (codex review 指摘)。
  // dedup 後の件数が topK に達するまで pull を 2 倍ずつ拡張しつつ再検索する。
  // db.search はメモリ内の全件ソートなので、pull が増えてもコストはほぼ一定 (slice の長さが変わるだけ)。
  let pull = Math.max(topK * 3, topK + excluded.size + 20);
  const dbSize = eng.db.size;
  let deduped: ReturnType<typeof eng.db.search> = [];
  // 多くても全件まで広げて打ち切り (無限ループを避ける)。
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = eng.db.search(qvec, pull, question, s.ragKeywordWeight)
      .filter(({ record }) => !(record.kind === 'onenote' && excluded.has(record.conversationId)));
    const seenPageIds = new Set<string>();
    deduped = [];
    for (const h of raw) {
      // 同じページから複数チャンクが上位に来た場合、最高スコアの 1 件だけ採用 (LLM へ重複文脈を渡さない)。
      if (h.record.kind === 'onenote' && h.record.conversationId) {
        if (seenPageIds.has(h.record.conversationId)) continue;
        seenPageIds.add(h.record.conversationId);
      }
      deduped.push(h);
      if (deduped.length >= topK) break;
    }
    if (deduped.length >= topK) break;
    if (pull >= dbSize) break; // 全件取り切ったらこれ以上増えない
    pull = Math.min(pull * 2, dbSize);
  }
  return deduped.map(({ record, score }) => toHit(record, score));
}

/** 同一スレッド (conversationId) の全メールを時系列で返す (経緯要約用)。 */
export async function getThread(siteUrl: string, conversationId: string): Promise<MailHit[]> {
  const eng = await getEngine(siteUrl);
  // 除外指定された OneNote ページは要約対象からも外す (チャンク全部 = 親ページごと)。
  const excluded = getExcludedOneNotePageIds();
  if (excluded.has(conversationId)) return [];
  return eng.db.byConversation(conversationId).map(r => toHit(r, 1));
}
