// AI 利用料の集計トラッカー。
// - 1 処理ごとの履歴は持たず、当月の累計 (円・トークン) だけを localStorage に保持。
// - SharePoint List 'Tadori 利用料' に「ユーザー×月」で 1 行記録し、全員合計を出せる。
// - 月が変わると localStorage のキーが変わるので自動的にリセット (翌月 1 日〜)。

import { SharePointClient } from '../sharepoint/client';
import { chatYen, embedYen } from './pricing';

const LIST_TITLE = 'Tadori 利用料';
const LS_PREFIX = 'tadori:usage:';   // + YYYY-MM → { yen, tokens }
const LS_USER_KEY = 'tadori:usage:user-id';
const FLUSH_DELAY = 8000;            // 累計をまとめて SharePoint へ反映する間隔

interface MonthUsage { yen: number; tokens: number; }
export interface UserUsage { user: string; yen: number; tokens: number; }
export interface UsageTotals { month: string; total: number; ownYen: number; ownTokens: number; byUser: UserUsage[]; }

let sp: SharePointClient | null = null;
let listReady: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// 一度 SP への書込が失敗 (権限不足 / リスト作成不可 / スコープ違い等) したら、
// 同セッション中の再試行を停止する。Console を 404/403 で埋め尽くすのを防ぐ。
// 利用料の集計が止まるだけで、本体機能 (チャット / 取り込み) には影響しない。
let disabledForSession = false;

export function initUsage(siteUrl: string): void {
  try { sp = new SharePointClient(siteUrl); } catch { sp = null; }
}

export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function lsKey(month: string): string { return LS_PREFIX + month; }

function loadMonth(month: string): MonthUsage {
  try { const r = localStorage.getItem(lsKey(month)); if (r) return JSON.parse(r) as MonthUsage; } catch { /* noop */ }
  return { yen: 0, tokens: 0 };
}
function saveMonth(month: string, u: MonthUsage): void {
  try { localStorage.setItem(lsKey(month), JSON.stringify(u)); } catch { /* quota */ }
}

/** 現在ユーザーの識別子。SharePoint の文脈情報があれば優先、無ければ端末ローカル ID。 */
export function currentUser(): string {
  const ctx = (window as unknown as { _spPageContextInfo?: Record<string, string> })._spPageContextInfo;
  const u = ctx?.userLoginName || ctx?.userDisplayName || ctx?.userEmail;
  if (u) return u;
  let id = '';
  try { id = localStorage.getItem(LS_USER_KEY) || ''; } catch { /* noop */ }
  if (!id) {
    id = 'local-' + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem(LS_USER_KEY, id); } catch { /* noop */ }
  }
  return id;
}

function add(yen: number, tokens: number): void {
  if (tokens <= 0 && yen <= 0) return;
  const m = monthKey();
  const u = loadMonth(m);
  u.yen += yen;
  u.tokens += tokens;
  saveMonth(m, u);
  scheduleFlush();
}

export function recordChat(model: string, inputTokens: number, outputTokens: number): void {
  const tokens = (inputTokens || 0) + (outputTokens || 0);
  add(chatYen(model, tokens), tokens);
}

export function recordEmbed(tokens: number): void {
  add(embedYen(tokens), tokens);
}

function scheduleFlush(): void {
  if (!sp || disabledForSession) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { void flush().catch(() => { /* best-effort */ }); }, FLUSH_DELAY);
}

async function ensureList(): Promise<void> {
  if (!sp) throw new Error('no sp');
  if (disabledForSession) throw new Error('usage tracker disabled for this session');
  if (!listReady) {
    listReady = sp.ensureList(LIST_TITLE, [
      { name: 'Month', type: 'text' },
      { name: 'TadoriUser', type: 'text' },
      { name: 'Yen', type: 'number' },
      { name: 'Tokens', type: 'number' },
    ]).then(() => undefined).catch((e) => {
      // ensureList が失敗したら同セッション中の再試行を打ち切る。
      // よくある原因: 権限不足でリスト作成不可 / Tadori 起動サイトと書込先サイトが不一致。
      disabledForSession = true;
      console.warn(
        '[tadori] 利用料トラッカー無効化: SP リスト作成/取得に失敗しました。',
        '本体機能には影響しませんが、AI 利用料の集計は今セッション中は記録されません。',
        'エラー:', (e as Error).message,
      );
      listReady = null;
      throw e;
    });
  }
  await listReady;
}

/** 当月の自分の累計を SharePoint の自分の行へ反映 (絶対値で SET = 冪等)。
 *  失敗時は disabledForSession で同セッションの再試行を打ち切る (Console を 404/403 で埋め尽くさない)。 */
export async function flush(): Promise<void> {
  if (!sp || disabledForSession) return;
  const m = monthKey();
  const u = loadMonth(m);
  const user = currentUser();
  const title = `${m}|${user}`;
  try {
    await ensureList();
    const fields = { Title: title, Month: m, TadoriUser: user, Yen: Math.round(u.yen * 100) / 100, Tokens: u.tokens };
    const rows = await sp.getItems(LIST_TITLE, `$filter=Title eq '${title.replace(/'/g, "''")}'&$select=Id&$top=1`);
    if (rows.length && rows[0].Id) {
      await sp.updateItem(LIST_TITLE, rows[0].Id, fields, '*'); // 自分専用行なので無条件更新で可
    } else {
      await sp.createItem(LIST_TITLE, fields);
    }
  } catch (e) {
    // ensureList 通過後 (= List はある) で update/create が失敗するケースも、
    // 連発しないよう disable する。次セッションで再度試す。
    if (!disabledForSession) {
      disabledForSession = true;
      console.warn('[tadori] 利用料書込失敗、セッション中の再試行を停止:', (e as Error).message);
    }
    throw e;
  }
}

/** 当月の全員合計 + (開発者向け) ユーザー別内訳を取得。表示前に自分の分を flush する。 */
export async function fetchMonthlyTotals(): Promise<UsageTotals> {
  const m = monthKey();
  const own = loadMonth(m);
  const result: UsageTotals = { month: m, total: 0, ownYen: own.yen, ownTokens: own.tokens, byUser: [] };
  if (!sp) { result.total = own.yen; return result; }
  // 自分の分の反映 (flush) が失敗しても、集計表示は止めない。
  try { await flush(); } catch (e) { console.warn('[usage] flush 失敗:', e); }
  try {
    const rows = await sp.getItems(LIST_TITLE, `$filter=Month eq '${m}'&$select=TadoriUser,Yen,Tokens&$top=500`);
    for (const r of rows) {
      const yen = Number(r.Yen) || 0;
      result.total += yen;
      result.byUser.push({ user: String(r.TadoriUser ?? '?'), yen, tokens: Number(r.Tokens) || 0 });
    }
    result.byUser.sort((a, b) => b.yen - a.yen);
  } catch (e) {
    console.warn('[usage] 集計取得失敗:', e);
    result.total = own.yen; // 集計不能時は自分の分だけ
  }
  return result;
}
