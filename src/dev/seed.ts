// テスト用シードデータ投入 (開発者モード)。
// サンプルメールを Voyage で埋め込み、Float16 Base64 にして SharePoint List へ作成する。
// List 側に Body / From / embedding 列が存在している前提。

import type { RuntimeSettings } from '../api/aiSettings';
import { SharePointClient } from '../sharepoint/client';
import { embedDocsFor } from '../embeddings/router';
import { encodeEmbedding } from '../lib/float16';
import { normalize } from '../search/cosine';
import { COLUMNS, TADORI_LIST_FIELDS } from '../config';

export interface SampleMail {
  subject: string;
  from: string;
  body: string;
}

export const SAMPLE_MAILS: SampleMail[] = [
  { subject: '【総務】春の懇親会のご案内', from: 'soumu@example.co.jp',
    body: 'お疲れさまです、総務部です。\n春の懇親会を 5 月 23 日(金) 18:30 より本社 10F ラウンジにて開催します。会費は 3,000 円、当日受付にて集金します。出欠は 5 月 16 日までにこのメールへ返信してください。当日は軽食とドリンクをご用意しています。' },
  { subject: 'Re: 春の懇親会のご案内', from: 'tanaka@example.co.jp',
    body: '田中です。懇親会、出席します。場所は 10F ラウンジで合っていますか? 18:30 開始だと少し遅れるかもしれません。' },
  { subject: '【情シス】社内 Wi-Fi メンテナンスのお知らせ', from: 'it-support@example.co.jp',
    body: '情報システム部です。5 月 20 日(火) 22:00〜24:00 に社内 Wi-Fi のメンテナンスを実施します。該当時間帯は無線接続が断続的に切断されます。有線接続は影響ありません。' },
  { subject: '経費精算システム切替の件', from: 'keiri@example.co.jp',
    body: '経理部です。6 月 1 日より経費精算システムを新システムへ切り替えます。旧システムでの申請は 5 月 25 日締め切りです。マニュアルは共有フォルダに格納しました。' },
  { subject: '【人事】健康診断の予約について', from: 'jinji@example.co.jp',
    body: '人事部です。今年度の定期健康診断の予約を開始しました。予約サイトより 5 月末までにご予約ください。受診期間は 6 月 1 日〜30 日です。' },
  { subject: '【総務】オフィス移転に伴う座席変更', from: 'soumu@example.co.jp',
    body: '総務部です。7 月のオフィス移転に伴い、各部署の座席レイアウトを変更します。新しい座席表は来週共有します。私物は 6 月末までに整理をお願いします。' },
  { subject: 'プロジェクト定例の時間変更', from: 'pm@example.co.jp',
    body: 'お疲れさまです。来週からプロジェクト定例を毎週火曜 10:00 → 水曜 15:00 に変更します。カレンダー招待を更新しましたのでご確認ください。' },
  { subject: '【セキュリティ】不審メールに関する注意喚起', from: 'security@example.co.jp',
    body: 'セキュリティ室です。請求書を装った不審なメールが社内で確認されています。添付ファイルや URL は開かず、情シスへ転送して報告してください。' },
];

export interface SeedResult {
  created: number;
  /** 埋め込みまで付けられたか (false なら本文のみ投入 = まだ検索対象外)。 */
  embedded: boolean;
  errors: string[];
}

/** サンプルメールを List に投入する。onProgress で進捗を通知。 */
export async function seedTestData(
  s: RuntimeSettings,
  siteUrl: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SeedResult> {
  const sp = new SharePointClient(siteUrl);
  const total = SAMPLE_MAILS.length;

  // リストが無ければ自動作成 (列も追加)
  await sp.ensureList(s.listTitle, TADORI_LIST_FIELDS);

  // 埋め込みは best-effort: プロバイダ未設定/失敗でも本文だけは投入する。
  let vecs: Float32Array[] | null = null;
  try {
    vecs = await embedDocsFor(SAMPLE_MAILS.map(m => m.body), s);
  } catch (e) {
    console.warn('[tadori] seed: 埋め込みをスキップ (本文のみ投入):', (e as Error).message);
    vecs = null;
  }

  const errors: string[] = [];
  let created = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < total; i++) {
    const m = SAMPLE_MAILS[i];
    const fields: Record<string, unknown> = {
      Title: m.subject,
      Body: m.body,
      From: m.from,
      [COLUMNS.isMl]: true,
    };
    if (vecs) {
      fields[COLUMNS.embedding] = encodeEmbedding(normalize(vecs[i]));
      fields[COLUMNS.embeddedAt] = now;
      fields[COLUMNS.ragStatus] = 'indexed';
    } else {
      // 埋め込み未付与 = まだ検索対象外。後でプロバイダ設定後に再投入で埋め込まれる。
      fields[COLUMNS.ragStatus] = 'pending';
    }
    try {
      await sp.createItem(s.listTitle, fields);
      created++;
    } catch (e) {
      errors.push(`${m.subject}: ${e instanceof Error ? e.message : String(e)}`);
    }
    onProgress?.(i + 1, total);
  }

  return { created, embedded: vecs !== null, errors };
}
