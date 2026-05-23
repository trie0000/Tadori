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
  // 多めに引いてから (a) 除外フィルタ (b) 同一 OneNote ページ内のチャンク重複排除 をかける。
  // 重複排除は OneNote だけに適用 (メールは conversationId=スレッド ID で別メールが同 ID を持つので畳んではいけない)。
  const pull = Math.max(topK * 3, topK + excluded.size + 20);
  const raw = eng.db.search(qvec, pull, question, s.ragKeywordWeight)
    .filter(({ record }) => !(record.kind === 'onenote' && excluded.has(record.conversationId)));
  const seenPageIds = new Set<string>();
  const deduped: typeof raw = [];
  for (const h of raw) {
    // 同じページから複数チャンクが上位に来た場合、最高スコアの 1 件だけ採用 (LLM へ重複文脈を渡さない)。
    if (h.record.kind === 'onenote' && h.record.conversationId) {
      if (seenPageIds.has(h.record.conversationId)) continue;
      seenPageIds.add(h.record.conversationId);
    }
    deduped.push(h);
    if (deduped.length >= topK) break;
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
