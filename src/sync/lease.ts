// 書き込み担当の単一化 (リース選出)。複数人が同時に SharePoint のセグメントを
// 書き換えると壊れるため、調整用 List「Tadori Sync」の単一リース行を ETag 楽観
// ロックで奪い合い、勝った1人だけが書き込みできるようにする (ADR-012)。
//
// - 書き込み前に ensureWriter() でリースを取得/更新。取れなければ書き込み拒否。
// - リースは LEASE_MS で失効。担当が落ちたら別の人が次に奪取 (タイムアウト移譲)。
// - start()/stop() で定期ハートビート + リース更新も可能 (在席表示・自動移譲用)。

import { SharePointClient, type FieldSpec, type SpItem } from '../sharepoint/client';

const SYNC_LIST = 'Tadori Sync';
const LEASE_KEY = '__lease__';
const HEARTBEAT_MS = 30_000;
const LEASE_MS = 5 * 60_000;

const SYNC_FIELDS: FieldSpec[] = [
  { name: 'last_seen', type: 'datetime' },
  { name: 'holder', type: 'text' },
  { name: 'expires', type: 'datetime' },
];

function clientId(): string {
  try {
    let id = localStorage.getItem('tadori:client-id');
    if (!id) { id = 'c-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('tadori:client-id', id); }
    return id;
  } catch { return 'c-anon'; }
}

export class WriterLease {
  private readonly sp: SharePointClient;
  private readonly me = clientId();
  private listReady = false;
  private writer = false;
  private timer: number | null = null;

  constructor(siteUrl: string) { this.sp = new SharePointClient(siteUrl); }

  get id(): string { return this.me; }
  isWriter(): boolean { return this.writer; }

  /** 書き込み直前に呼ぶ。リースを取得/更新し、書き込み可なら true。 */
  async ensureWriter(): Promise<boolean> {
    await this.ensureList();
    await this.electOrRenew();
    return this.writer;
  }

  /** 在席ハートビート + リース更新を定期実行 (任意)。 */
  async start(): Promise<void> {
    await this.ensureList();
    await this.tick();
    this.timer = window.setInterval(() => { void this.tick(); }, HEARTBEAT_MS);
  }

  stop(): void {
    if (this.timer != null) { window.clearInterval(this.timer); this.timer = null; }
    void this.release();
  }

  private async ensureList(): Promise<void> {
    if (this.listReady) return;
    await this.sp.ensureList(SYNC_LIST, SYNC_FIELDS);
    this.listReady = true;
  }

  private async tick(): Promise<void> {
    try { await this.heartbeat(); await this.electOrRenew(); }
    catch (e) { console.warn('[tadori/lease] tick 失敗:', (e as Error).message); }
  }

  private async findRow(title: string): Promise<SpItem | null> {
    const rows = await this.sp.getItems(SYNC_LIST, `$select=Id&$filter=Title eq '${title}'&$top=1`);
    if (rows.length === 0) return null;
    return this.sp.getItem(SYNC_LIST, Number(rows[0].Id)); // ETag 付きで取り直す
  }

  private async heartbeat(): Promise<void> {
    const now = new Date().toISOString();
    const row = await this.findRow(this.me);
    if (row) await this.sp.updateItem(SYNC_LIST, row.Id, { last_seen: now }, '*');
    else await this.sp.createItem(SYNC_LIST, { Title: this.me, last_seen: now });
  }

  private async electOrRenew(): Promise<void> {
    const nowMs = Date.now();
    const until = () => new Date(nowMs + LEASE_MS).toISOString();
    const lease = await this.findRow(LEASE_KEY);

    if (!lease) {
      try { await this.sp.createItem(SYNC_LIST, { Title: LEASE_KEY, holder: this.me, expires: until() }); this.writer = true; }
      catch { this.writer = false; } // 同時 create 競合 → 次 tick で再判定
      return;
    }

    const holder = String(lease.holder ?? '');
    const expires = Date.parse(String(lease.expires ?? '')) || 0;

    if (holder === this.me || expires < nowMs) {
      // 自分の更新、または失効分の奪取。ETag 競合(412)なら奪えなかった = reader。
      this.writer = await this.sp.updateItem(SYNC_LIST, lease.Id, { holder: this.me, expires: until() }, lease.__etag);
    } else {
      this.writer = false; // 他者が有効なリース保持中
    }
  }

  private async release(): Promise<void> {
    if (!this.listReady || !this.writer) return;
    try {
      const lease = await this.findRow(LEASE_KEY);
      if (lease && String(lease.holder) === this.me) {
        await this.sp.updateItem(SYNC_LIST, lease.Id, { expires: new Date().toISOString() }, lease.__etag);
      }
    } catch { /* best-effort */ }
    this.writer = false;
  }
}

// ─── siteUrl ごとの共有インスタンス ──────────────────────────────────────────
let shared: WriterLease | null = null;
let sharedSite = '';

export function getLease(siteUrl: string): WriterLease {
  if (!shared || sharedSite !== siteUrl) { shared = new WriterLease(siteUrl); sharedSite = siteUrl; }
  return shared;
}
