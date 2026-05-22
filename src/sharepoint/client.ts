// SharePoint List REST クライアント。PoC 01 で Cookie 認証 READ を確認済み。
// 全リクエストは credentials:'include' でブラウザの既存セッション Cookie を借用。
// 書き込みは FormDigest + ETag (If-Match) による楽観ロック (ADR-005)。

export interface SpItem {
  Id: number;
  __etag: string;
  [field: string]: unknown;
}

export type FieldType = 'text' | 'note' | 'number' | 'datetime' | 'boolean';
export interface FieldSpec {
  /** 列の表示名 = 内部名 (ASCII + アンダースコアなら内部名は表示名と一致)。 */
  name: string;
  type: FieldType;
}

/** SP REST `/fields` POST 用の型付きペイロード (odata=verbose)。 */
function toFieldSchema(f: FieldSpec): Record<string, unknown> {
  switch (f.type) {
    case 'text':     return { __metadata: { type: 'SP.FieldText' }, FieldTypeKind: 2, Title: f.name };
    case 'note':     return { __metadata: { type: 'SP.FieldMultiLineText' }, FieldTypeKind: 3, Title: f.name, RichText: false, NumberOfLines: 6 };
    case 'number':   return { __metadata: { type: 'SP.FieldNumber' }, FieldTypeKind: 9, Title: f.name };
    case 'datetime': return { __metadata: { type: 'SP.FieldDateTime' }, FieldTypeKind: 4, Title: f.name, DisplayFormat: 1 };
    case 'boolean':  return { __metadata: { type: 'SP.Field' }, FieldTypeKind: 8, Title: f.name };
  }
}

export class SharePointClient {
  private digest: string | null = null;
  private digestAt = 0;

  /** @param siteUrl 末尾スラッシュなしのサイト絶対 URL。 */
  constructor(private readonly siteUrl: string) {}

  private listApi(listTitle: string): string {
    return `${this.siteUrl}/_api/web/lists/getbytitle('${encodeURIComponent(listTitle)}')`;
  }

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return {
      Accept: 'application/json;odata=nometadata',
      ...extra,
    };
  }

  /** FormDigest を取得・キャッシュ (有効期限は余裕を見て 20 分)。書き込み前に必須。 */
  async getFormDigest(): Promise<string> {
    const now = Date.now();
    if (this.digest && now - this.digestAt < 20 * 60_000) return this.digest;
    const res = await fetch(`${this.siteUrl}/_api/contextinfo`, {
      method: 'POST',
      headers: await this.headers(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`contextinfo HTTP ${res.status}`);
    const json = await res.json() as { FormDigestValue?: string };
    if (!json.FormDigestValue) throw new Error('FormDigestValue missing');
    this.digest = json.FormDigestValue;
    this.digestAt = now;
    return this.digest;
  }

  /** OData クエリでアイテムを取得。$filter / $select / $top などを渡す。 */
  async getItems(listTitle: string, query: string): Promise<SpItem[]> {
    const url = `${this.listApi(listTitle)}/items?${query}`;
    const res = await fetch(url, { headers: await this.headers(), credentials: 'include' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`getItems HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const json = await res.json() as { value: SpItem[] };
    return json.value ?? [];
  }

  /** 新規アイテムを作成。fields は列の内部名 → 値。作成された Id を返す。 */
  async createItem(listTitle: string, fields: Record<string, unknown>): Promise<number> {
    const digest = await this.getFormDigest();
    const res = await fetch(`${this.listApi(listTitle)}/items`, {
      method: 'POST',
      headers: await this.headers({
        'Content-Type': 'application/json;odata=nometadata',
        'X-RequestDigest': digest,
      }),
      credentials: 'include',
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`createItem HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const json = await res.json() as { Id?: number };
    return json.Id ?? 0;
  }

  /** リストが無ければ作成し、不足列を追加する (冪等)。新規作成したら true を返す。 */
  async ensureList(listTitle: string, fields: FieldSpec[]): Promise<boolean> {
    const existed = await this.listExists(listTitle);
    if (!existed) await this.createList(listTitle);
    // 列追加は best-effort (権限不足等で失敗しても致命にしない)。
    try { await this.ensureFields(listTitle, fields); }
    catch (e) { console.warn('[tadori] ensureFields 失敗:', (e as Error).message); }
    return !existed;
  }

  private async listExists(listTitle: string): Promise<boolean> {
    const res = await fetch(`${this.listApi(listTitle)}?$select=Id`, {
      headers: await this.headers(),
      credentials: 'include',
    });
    if (res.status === 404) return false;
    return res.ok;
  }

  private async createList(listTitle: string): Promise<void> {
    const digest = await this.getFormDigest();
    const res = await fetch(`${this.siteUrl}/_api/web/lists`, {
      method: 'POST',
      headers: {
        Accept: 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose',
        'X-RequestDigest': digest,
      },
      credentials: 'include',
      body: JSON.stringify({
        __metadata: { type: 'SP.List' },
        Title: listTitle,
        BaseTemplate: 100, // 汎用リスト
        AllowContentTypes: true,
        ContentTypesEnabled: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`createList HTTP ${res.status} ${body.slice(0, 300)}`);
    }
  }

  private async ensureFields(listTitle: string, fields: FieldSpec[]): Promise<void> {
    const existing = await this.listFieldNames(listTitle);
    const digest = await this.getFormDigest();
    for (const f of fields) {
      if (existing.has(f.name)) continue;
      const res = await fetch(`${this.listApi(listTitle)}/fields`, {
        method: 'POST',
        headers: {
          Accept: 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose',
          'X-RequestDigest': digest,
        },
        credentials: 'include',
        body: JSON.stringify(toFieldSchema(f)),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`addField(${f.name}) HTTP ${res.status} ${body.slice(0, 200)}`);
      }
    }
  }

  private async listFieldNames(listTitle: string): Promise<Set<string>> {
    const res = await fetch(`${this.listApi(listTitle)}/fields?$select=InternalName,Title,StaticName&$top=500`, {
      headers: await this.headers(),
      credentials: 'include',
    });
    const set = new Set<string>();
    if (!res.ok) return set;
    const json = await res.json() as { value?: { InternalName?: string; Title?: string; StaticName?: string }[] };
    for (const f of json.value ?? []) {
      if (f.InternalName) set.add(f.InternalName);
      if (f.StaticName) set.add(f.StaticName);
      if (f.Title) set.add(f.Title);
    }
    return set;
  }

  /** 単一アイテムを ETag 付きで取得 (try-claim の前段)。 */
  async getItem(listTitle: string, id: number, select?: string): Promise<SpItem> {
    const sel = select ? `?$select=${select}` : '';
    const res = await fetch(`${this.listApi(listTitle)}/items(${id})${sel}`, {
      headers: await this.headers(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`getItem(${id}) HTTP ${res.status}`);
    const etag = res.headers.get('ETag') ?? '*';
    const json = await res.json() as SpItem;
    return { ...json, __etag: etag };
  }

  /** ETag 楽観ロックで MERGE 更新。412 (競合) は false を返す。
   *  ETag を '*' にすると無条件更新 (claim 競合検証には使わないこと)。 */
  async updateItem(
    listTitle: string,
    id: number,
    fields: Record<string, unknown>,
    etag: string,
  ): Promise<boolean> {
    const digest = await this.getFormDigest();
    const res = await fetch(`${this.listApi(listTitle)}/items(${id})`, {
      method: 'POST',
      headers: await this.headers({
        'Content-Type': 'application/json;odata=nometadata',
        'X-RequestDigest': digest,
        'IF-MATCH': etag,
        'X-HTTP-Method': 'MERGE',
      }),
      credentials: 'include',
      body: JSON.stringify(fields),
    });
    if (res.status === 412) return false; // 楽観ロック競合 → 別クライアントが先取り
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`updateItem(${id}) HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    return true;
  }
}
