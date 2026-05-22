// Outlook からの既存メールインポート。
// ローカル relay (tadori-ai-relay.ps1 の /tadori/outlook/import) が Outlook COM で
// To/Cc 条件 + 受信期間でメールを読み出して返す。それを埋め込み → List 保存する。

import type { RuntimeSettings } from '../api/aiSettings';
import { SharePointClient } from '../sharepoint/client';
import { embedDocsFor } from '../embeddings/router';
import { encodeEmbedding } from '../lib/float16';
import { normalize } from '../search/cosine';
import { COLUMNS, TADORI_LIST_FIELDS } from '../config';

export interface OutlookMail {
  messageId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  body: string;
}

export interface ImportFilter {
  to: string[];
  cc: string[];
  since?: string; // ISO date (YYYY-MM-DD)
  until?: string;
  max?: number;
}

export interface ImportResult {
  fetched: number;
  created: number;
  embedded: boolean;
  errors: string[];
}

/** relay 経由で Outlook からメールを取得。 */
export async function fetchOutlookMails(relayBaseUrl: string, f: ImportFilter): Promise<OutlookMail[]> {
  if (!relayBaseUrl) throw new Error('中継サーバ URL が未設定です (AI 接続で設定)');
  const p = new URLSearchParams();
  if (f.to.length) p.set('to', f.to.join(';'));
  if (f.cc.length) p.set('cc', f.cc.join(';'));
  if (f.since) p.set('since', f.since);
  if (f.until) p.set('until', f.until);
  if (f.max) p.set('max', String(f.max));

  const url = `${relayBaseUrl.replace(/\/+$/, '')}/tadori/outlook/import?${p.toString()}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(`Outlook インポート失敗: HTTP ${res.status} ${b.slice(0, 300)}`);
  }
  const json = await res.json() as { mails?: OutlookMail[] };
  return json.mails ?? [];
}

/** 本文の引用・署名をざっくり除去し、長さを制限する。 */
function cleanBody(raw: string): string {
  let t = (raw ?? '').replace(/\r\n/g, '\n');
  // 返信ヘッダ (From:/差出人: 以降) や区切り線以降をカット
  const m = t.search(/\n-{2,}\s*\n|^(From|差出人|送信者):.*$/m);
  if (m > 0) t = t.slice(0, m);
  // 引用行 (> ...) を除去
  t = t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n');
  return t.trim().slice(0, 8000);
}

/** Outlook から取得 → 埋め込み (best-effort) → List 保存。 */
export async function importFromOutlook(
  s: RuntimeSettings,
  siteUrl: string,
  f: ImportFilter,
  onProgress?: (phase: 'fetch' | 'embed' | 'store', done: number, total: number) => void,
): Promise<ImportResult> {
  onProgress?.('fetch', 0, 0);
  const mails = await fetchOutlookMails(s.relayBaseUrl, f);
  if (mails.length === 0) return { fetched: 0, created: 0, embedded: false, errors: [] };

  const sp = new SharePointClient(siteUrl);
  await sp.ensureList(s.listTitle, TADORI_LIST_FIELDS);

  const bodies = mails.map(m => cleanBody(m.body));

  // 埋め込みは best-effort: 失敗しても本文だけ投入する。
  let vecs: Float32Array[] | null = null;
  try {
    onProgress?.('embed', 0, mails.length);
    vecs = await embedDocsFor(bodies, s);
  } catch (e) {
    console.warn('[tadori] import: 埋め込みをスキップ (本文のみ投入):', (e as Error).message);
    vecs = null;
  }

  const errors: string[] = [];
  let created = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < mails.length; i++) {
    const m = mails[i];
    const fields: Record<string, unknown> = {
      Title: m.subject || '(件名なし)',
      Body: bodies[i],
      From: m.from,
      [COLUMNS.isMl]: true,
    };
    if (vecs) {
      fields[COLUMNS.embedding] = encodeEmbedding(normalize(vecs[i]));
      fields[COLUMNS.embeddedAt] = now;
      fields[COLUMNS.ragStatus] = 'indexed';
    } else {
      fields[COLUMNS.ragStatus] = 'pending';
    }
    try {
      await sp.createItem(s.listTitle, fields);
      created++;
    } catch (e) {
      errors.push(`${m.subject}: ${e instanceof Error ? e.message : String(e)}`);
    }
    onProgress?.('store', i + 1, mails.length);
  }

  return { fetched: mails.length, created, embedded: vecs !== null, errors };
}
