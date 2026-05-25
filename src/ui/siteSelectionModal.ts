// SP サイト選択モーダル (Tadori 起動時 / トップバー「サイト切替」)。
//
// Spira の同名モーダルを Tadori 用に簡略化。Tadori はリスト作成必須では無いので、
// 「初期化済みかどうか」のチェックは省略 (起動時に ensureTadoriInboxList が自動で
// 作成する設計のため)。
//
// 提供するもの:
//   - 履歴 (recent) サイトを先頭に並べた一覧
//   - Search API で取れる全アクセス可能サイト (非同期で追加)
//   - 手入力フォールバック (Search API が引かないテナント向け)
//   - キャンセル時は null を返す (呼出側で起動を止める)

import { el } from '../lib/dom';
import { icons } from './icons';
import {
  listAccessibleSites,
  getSelectedSiteUrl,
  setSelectedSiteUrl,
  getRecentSites,
  detectCurrentSiteUrl,
  fetchSiteTitle,
  refreshRecentSiteTitle,
  tenantOrigin,
  type SpSite,
  type RecentSite,
} from '../sharepoint/spSites';

export interface SiteSelectionResult {
  siteUrl: string;
}

/** モーダルを開いて、ユーザーが選択した SP サイトの URL を Promise で返す。
 *  キャンセルなら null。 */
export function openSiteSelectionModal(): Promise<SiteSelectionResult | null> {
  return new Promise((resolve) => {
    const current = detectCurrentSiteUrl();
    const saved = getSelectedSiteUrl();
    const origin = tenantOrigin(current);
    const recents: RecentSite[] = getRecentSites();

    let selectedUrl = saved ?? current;
    let sites: SpSite[] = [];

    // ── モーダル要素 ──
    const backdrop = el('div', {
      style:
        'position:fixed;inset:0;background:rgba(0,0,0,0.5);' +
        'z-index:2147483700;display:flex;align-items:center;justify-content:center;' +
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif',
    });
    const modal = el('div', {
      style:
        'background:#fff;color:#1f1f1f;border-radius:8px;' +
        'box-shadow:0 12px 40px rgba(0,0,0,0.25);' +
        'min-width:520px;max-width:720px;max-height:80vh;' +
        'display:flex;flex-direction:column;overflow:hidden',
    });

    const head = el('div', {
      style: 'padding:16px 20px;border-bottom:1px solid #e5e5e5;' +
             'display:flex;align-items:center;gap:8px;font-weight:600;font-size:16px',
    }, [
      el('span', { html: icons.folder(18), style: 'display:inline-flex' }),
      'Tadori を起動する SP サイトを選択',
    ]);

    const note = el('div', {
      style: 'padding:12px 20px;background:#f5f5f3;color:#555;font-size:13px;line-height:1.6;border-bottom:1px solid #e5e5e5',
    }, [
      saved
        ? `前回は ${saved} を使用しました。続行する場合はそのまま「決定」を押してください。`
        : 'アクセス可能な SP サイトを選択してください。一覧に出ない場合は下の入力欄に URL を直接貼り付けても OK。',
    ]);

    const listHost = el('div', {
      style: 'flex:1;overflow-y:auto;padding:8px 0;min-height:200px',
    });

    /** 1 行 (radio + ラベル) を組み立て。 */
    const manualInput = el('input', {
      type: 'text', placeholder: 'https://contoso.sharepoint.com/sites/<site>',
      style:
        'width:100%;padding:8px 10px;font-size:13px;border:1px solid #ccc;' +
        'border-radius:4px;font-family:inherit;box-sizing:border-box',
    }) as HTMLInputElement;
    manualInput.addEventListener('input', () => {
      const v = manualInput.value.trim();
      if (v) {
        selectedUrl = v.replace(/\/+$/, '');
        // ラジオの選択を外す視覚効果
        modal.querySelectorAll<HTMLInputElement>('input[name="tdr-site"]').forEach(r => { r.checked = false; });
      }
    });

    const buildRow = (site: SpSite, marker?: string | null): HTMLElement => {
      const id = `tdr-site-${Math.random().toString(36).slice(2)}`;
      const radio = el('input', {
        type: 'radio', name: 'tdr-site', id, value: site.url,
        style: 'margin:0 10px 0 0;flex-shrink:0',
      }) as HTMLInputElement;
      if (site.url === selectedUrl) radio.checked = true;
      radio.addEventListener('change', () => {
        if (radio.checked) {
          selectedUrl = site.url;
          manualInput.value = '';
        }
      });
      const row = el('label', {
        for: id,
        style:
          'display:flex;align-items:center;gap:0;padding:8px 20px;' +
          'cursor:pointer;font-size:13px;border-bottom:1px solid transparent;',
      }, [
        radio,
        el('div', { style: 'flex:1;min-width:0' }, [
          el('div', {
            style:
              'font-weight:500;color:#1f1f1f;white-space:nowrap;' +
              'overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px',
          }, [
            el('span', {}, [site.title]),
            marker ? el('span', {
              style:
                'font-size:10px;padding:1px 6px;border-radius:99px;' +
                'background:#e8eef9;color:#3367d6',
            }, [marker]) : null,
          ].filter(Boolean) as HTMLElement[]),
          el('div', {
            style: 'color:#777;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,monospace',
          }, [site.url]),
        ]),
      ]);
      row.addEventListener('mouseenter', () => { row.style.background = '#f5f5f3'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      return row;
    };

    const renderList = (): void => {
      listHost.replaceChildren();
      // 1) recent (履歴) を先頭に
      if (recents.length > 0) {
        listHost.appendChild(el('div', {
          style: 'padding:6px 20px;font-size:11px;color:#777;font-weight:600;letter-spacing:0.04em',
        }, ['最近使ったサイト']));
        for (const r of recents) {
          listHost.appendChild(buildRow({ url: r.url, title: r.title }, '履歴'));
        }
      }
      // 2) Search API 結果 (recent と重複は除外)
      const recentSet = new Set(recents.map(r => r.url));
      const others = sites.filter(s => !recentSet.has(s.url));
      if (others.length > 0) {
        listHost.appendChild(el('div', {
          style: 'padding:6px 20px;font-size:11px;color:#777;font-weight:600;letter-spacing:0.04em;margin-top:8px',
        }, ['アクセス可能な全サイト']));
        for (const s of others) listHost.appendChild(buildRow(s));
      }
      // 3) 何も無いとき
      if (recents.length === 0 && sites.length === 0) {
        listHost.appendChild(el('div', {
          style: 'padding:24px 20px;font-size:13px;color:#777;text-align:center',
        }, ['サイト一覧を取得できませんでした。下の入力欄に URL を貼り付けてください。']));
      }
    };

    const manualBox = el('div', {
      style: 'padding:10px 20px;background:#fafaf8;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5',
    }, [
      el('div', {
        style: 'font-size:11px;color:#777;margin-bottom:6px;font-weight:600;letter-spacing:0.04em',
      }, ['URL を直接入力']),
      manualInput,
      el('div', {
        style: 'font-size:11px;color:#999;margin-top:4px',
      }, ['例: https://contoso.sharepoint.com/sites/team-tadori']),
    ]);

    const cancelBtn = el('button', {
      style:
        'padding:8px 18px;font-size:13px;background:#fff;color:#1f1f1f;' +
        'border:1px solid #ccc;border-radius:4px;cursor:pointer',
    }, ['キャンセル']);
    const okBtn = el('button', {
      style:
        'padding:8px 18px;font-size:13px;background:#3367d6;color:#fff;' +
        'border:1px solid #3367d6;border-radius:4px;cursor:pointer;font-weight:600',
    }, ['決定']);

    const close = (result: SiteSelectionResult | null): void => {
      backdrop.remove();
      resolve(result);
    };
    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => {
      const url = (manualInput.value.trim() || selectedUrl).replace(/\/+$/, '');
      if (!url) { manualInput.focus(); return; }
      // タイトル決定: 既知 (recent / sites) のもの、なければ URL を表示用に
      const known = [...recents, ...sites].find(s => s.url === url);
      const title = known?.title ?? url;
      setSelectedSiteUrl(url, title);
      // 起動後にサーバから本物のタイトルを引いて recent を上書きする (非同期)
      void fetchSiteTitle(url).then(t => { if (t) refreshRecentSiteTitle(url, t); });
      close({ siteUrl: url });
    });

    const foot = el('div', {
      style: 'padding:12px 20px;display:flex;justify-content:flex-end;gap:8px;background:#fafaf8',
    }, [cancelBtn, okBtn]);

    modal.append(head, note, listHost, manualBox, foot);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    // Esc キーで閉じる
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(null); }
    };
    document.addEventListener('keydown', onKey);

    renderList();

    // Search API を非同期に叩いて、結果が返り次第追加。失敗時は表示そのまま。
    void listAccessibleSites(origin).then((fetched) => {
      sites = fetched;
      renderList();
    });
  });
}
