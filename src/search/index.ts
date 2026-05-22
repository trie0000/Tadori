// 検索の結線: SharePoint List から埋め込み済み行を取得 → クエリを埋め込み →
// cosine Top-K。IndexedDB キャッシュは後続フェーズ (今は都度 List から取得)。

import type { RuntimeSettings } from '../api/aiSettings';
import { SharePointClient } from '../sharepoint/client';
import { embedQueryFor } from '../embeddings/router';
import { decodeEmbedding } from '../lib/float16';
import { normalize, search as cosineSearch, type IndexedVector } from './cosine';
import { COLUMNS } from '../config';

export interface MailHit {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  score: number;
}

interface IndexedMail extends IndexedVector {
  meta: { subject: string; from: string; date: string; body: string };
}

/** List から embedding 列が入っている行を読み、検索インデックスを構築。 */
async function loadIndex(sp: SharePointClient, s: RuntimeSettings): Promise<IndexedMail[]> {
  const sel = ['Id', 'Title', 'Created', COLUMNS.embedding, 'Body', 'From'].join(',');
  const rows = await sp.getItems(
    s.listTitle,
    `$select=${sel}&$filter=${COLUMNS.embedding} ne null&$top=5000`,
  );
  const out: IndexedMail[] = [];
  for (const r of rows) {
    const b64 = r[COLUMNS.embedding];
    if (typeof b64 !== 'string' || !b64) continue;
    out.push({
      messageId: String(r.Id),
      vec: normalize(decodeEmbedding(b64)),
      meta: {
        subject: String(r.Title ?? '(件名なし)'),
        from: String((r as Record<string, unknown>).From ?? ''),
        date: String(r.Created ?? ''),
        body: String((r as Record<string, unknown>).Body ?? ''),
      },
    });
  }
  return out;
}

export async function searchMails(
  question: string,
  s: RuntimeSettings,
  siteUrl: string,
  topK: number,
): Promise<MailHit[]> {
  const sp = new SharePointClient(siteUrl);
  const index = await loadIndex(sp, s);
  if (index.length === 0) return [];

  const qvec = normalize(await embedQueryFor(question, s));

  const hits = cosineSearch(qvec, index, topK);
  const byId = new Map(index.map(m => [m.messageId, m]));
  return hits.map(h => {
    const m = byId.get(h.messageId)!;
    return { messageId: h.messageId, score: h.score, ...m.meta };
  });
}
