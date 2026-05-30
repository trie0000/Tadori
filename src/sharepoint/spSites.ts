// SharePoint サイト選択 (Tadori 用)。
//
// Tadori は bookmarklet で起動された SP ページの _spPageContextInfo から
// siteUrl を取るのが基本だが、運用上は複数の SP サイトを切り替えたい
// ことが多い (Spira と同じ事情)。
//
// このモジュール:
//   - ユーザーがアクセス可能な SP サイト一覧を取得 (Search API)
//   - 直近選択したサイトを localStorage に記憶
//   - recent 履歴 (上位 8 件) を別キーで保存 (Search API が引かない時の救済)
//
// 設計は Spira の src/utils/spSites.ts をそのまま踏襲。名前空間だけ tadori: に分離。

const STORAGE_KEY = 'tadori:selected-site-url';
const RECENT_KEY = 'tadori:recent-site-urls';
const RECENT_LIMIT = 8;

export interface SpSite {
  url: string;
  title: string;
}

export interface RecentSite extends SpSite {
  /** 最終利用時刻 (ISO)。ソート用。 */
  lastUsedAt: string;
}

/** ユーザーがアクセス可能な SP サイト一覧を取得。
 *  SP Search API (contentclass:STS_Site) を叩く。失敗時は空配列。
 *  注意: テナント側ポリシーで Search API を絞っていると 0 件返るので、その時は
 *       recent 履歴 + 手入力に fallback する。 */
export async function listAccessibleSites(originUrl: string): Promise<SpSite[]> {
  // originUrl は tenant root (https://contoso.sharepoint.com) を想定。
  // 検索は tenant 全体を対象に投げてくれるので、起動サイトに依らない。
  const url =
    `${originUrl}/_api/search/query?querytext='contentclass:STS_Site'` +
    `&trimduplicates=false&rowlimit=500` +
    `&selectproperties='Title,Path,SPSiteUrl'`;
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      PrimaryQueryResult?: {
        RelevantResults?: {
          Table?: {
            Rows?: Array<{ Cells: Array<{ Key: string; Value: string }> }>;
          };
        };
      };
    };
    const rows = data.PrimaryQueryResult?.RelevantResults?.Table?.Rows ?? [];
    const out: SpSite[] = [];
    for (const row of rows) {
      const cells = new Map(row.Cells.map(c => [c.Key, c.Value]));
      const siteUrl = cells.get('SPSiteUrl') ?? cells.get('Path') ?? '';
      const title = cells.get('Title') ?? siteUrl;
      if (!siteUrl) continue;
      out.push({ url: siteUrl, title });
    }
    // 重複排除 + アルファベット順 (日本語タイトルは locale ソート)
    const seen = new Set<string>();
    const dedup = out.filter(s => { if (seen.has(s.url)) return false; seen.add(s.url); return true; });
    dedup.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    return dedup;
  } catch {
    return [];
  }
}

/** 選択された SP サイト URL を取得 (なければ null)。 */
export function getSelectedSiteUrl(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch { return null; }
}

/** 選択された SP サイト URL を保存 (+ recent 履歴にも追記)。 */
export function setSelectedSiteUrl(url: string, title?: string): void {
  try { localStorage.setItem(STORAGE_KEY, url); }
  catch { /* noop */ }
  pushRecentSite(url, title ?? url);
}

/** 選択を解除 (テスト/リセット用)。 */
export function clearSelectedSiteUrl(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

/** recent 履歴を取得 (新しい順)。 */
export function getRecentSites(): RecentSite[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: RecentSite[] = [];
    for (const it of parsed) {
      if (!it || typeof it !== 'object') continue;
      const r = it as Partial<RecentSite>;
      if (!r.url) continue;
      out.push({
        url: String(r.url),
        title: String(r.title ?? r.url),
        lastUsedAt: String(r.lastUsedAt ?? ''),
      });
    }
    out.sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));
    return out;
  } catch { return []; }
}

function pushRecentSite(url: string, title: string): void {
  try {
    const existing = getRecentSites().filter(s => s.url !== url);
    const next: RecentSite[] = [
      { url, title, lastUsedAt: new Date().toISOString() },
      ...existing,
    ].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* noop */ }
}

/** 表示用タイトルを後から更新 (起動後に fetchSiteTitle が取れたら recent も更新)。 */
export function refreshRecentSiteTitle(url: string, title: string): void {
  try {
    const list = getRecentSites();
    let changed = false;
    for (const r of list) {
      if (r.url === url && r.title !== title) { r.title = title; changed = true; }
    }
    if (changed) localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* noop */ }
}

/** SP サイトの表示名 (web.Title) を REST で取得。失敗時は null。 */
export async function fetchSiteTitle(siteUrl: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${siteUrl}/_api/web?$select=Title`,
      { credentials: 'include', headers: { Accept: 'application/json;odata=nometadata' } },
    );
    if (!res.ok) return null;
    const json = await res.json() as { Title?: string };
    return json.Title?.trim() || null;
  } catch {
    return null;
  }
}

/** location から現在の SP サイト URL を推定 (フォールバック用)。
 *  _spPageContextInfo > /sites/<x> /teams/<x> 抽出 > location.origin の順。 */
export function detectCurrentSiteUrl(): string {
  const ctx = (window as unknown as { _spPageContextInfo?: { webAbsoluteUrl?: string } })._spPageContextInfo;
  if (ctx?.webAbsoluteUrl) return ctx.webAbsoluteUrl;
  const m = location.pathname.match(/^(\/sites\/[^/]+|\/teams\/[^/]+)/i);
  return location.origin + (m ? m[0] : '');
}

/** テナント origin (https://host) だけ取り出す。Search API のベース URL 用。 */
export function tenantOrigin(siteUrl?: string | null): string {
  const base = siteUrl || detectCurrentSiteUrl();
  try { return new URL(base).origin; } catch { return location.origin; }
}

/** siteUrl から安定したハッシュ文字列を生成 (localStorage / IndexedDB のキー suffix 用)。
 *  暗号強度は不要なので djb2 + base36 の軽量実装。
 *  大文字小文字無視 + 末尾スラッシュ無視で正規化してから計算。 */
export function siteHash(siteUrl: string): string {
  const s = (siteUrl || '').toLowerCase().replace(/\/+$/, '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
