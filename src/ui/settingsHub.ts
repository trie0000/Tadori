// 設定ハブ — Spira と同じ左ナビ + 右ペイン構成。
// AI 接続設定は spira:ai:corp:* キーで Spira と共有。

import { el } from '../lib/dom';
import { icons } from './icons';
import { openModal } from './modal';
import { toast } from './toast';
import { loadSettings, saveSettings, parseAddressList, type RuntimeSettings } from '../api/aiSettings';
import { embedQuery } from '../embeddings/client';

type SectionId = 'ai' | 'ingest' | 'display' | 'diag' | 'about';

export function openSettingsHub(root: HTMLElement): void {
  const draft: RuntimeSettings = { ...loadSettings() };

  const nav  = el('div', { class: 'tdr-hub-nav' });
  const pane = el('div', { class: 'tdr-hub-pane' });

  const navItems: { id: SectionId; label: string; icon: string }[] = [
    { id: 'ai',      label: 'AI 接続',  icon: icons.settings() },
    { id: 'ingest',  label: '取り込み', icon: icons.activity() },
    { id: 'display', label: '表示',     icon: icons.moon()     },
    { id: 'diag',    label: '診断',     icon: icons.search()   },
    { id: 'about',   label: 'About',    icon: icons.chevron()  },
  ];

  const navBtns = new Map<SectionId, HTMLElement>();
  for (const item of navItems) {
    const btn = el('div', { class: 'tdr-hub-navitem' }, [
      el('span', { html: item.icon }),
      el('span', {}, [item.label]),
    ]);
    btn.addEventListener('click', () => activate(item.id));
    navBtns.set(item.id, btn);
    nav.appendChild(btn);
  }

  function activate(id: SectionId): void {
    for (const [sid, btn] of navBtns) btn.classList.toggle('is-active', sid === id);
    pane.textContent = '';
    switch (id) {
      case 'ai':      buildAiPane(pane, draft); break;
      case 'ingest':  buildIngestPane(pane, draft); break;
      case 'display': buildDisplayPane(pane, root); break;
      case 'diag':    buildDiagPane(pane, draft, root); break;
      case 'about':   buildAboutPane(pane); break;
    }
  }

  const saveBtn = el('button', { class: 'tdr-btn tdr-btn--primary' }, ['保存']);
  saveBtn.addEventListener('click', () => {
    saveSettings(draft);
    toast(root, '設定を保存しました', 'info');
  });

  openModal({
    root,
    title: '設定',
    body:   el('div', { class: 'tdr-hub' }, [nav, pane]),
    footer: el('div', { class: 'tdr-modal-footer' }, [saveBtn]),
  });

  activate('ai');
}

// ─── 共通ヘルパ ───────────────────────────────────────────────────────────────

function mkInput(value: string, onchange: (v: string) => void): HTMLInputElement {
  const inp = el('input', { class: 'tdr-input', type: 'text', value });
  inp.addEventListener('change', () => onchange(inp.value));
  return inp;
}

function mkRow(label: string, ctrl: HTMLElement, hint?: string): HTMLElement[] {
  const nodes: HTMLElement[] = [el('label', {}, [label]), ctrl];
  if (hint) nodes.push(el('p', { class: 'tdr-hint' }, [hint]));
  return nodes;
}

// ─── AI 接続 ──────────────────────────────────────────────────────────────────

function buildAiPane(pane: HTMLElement, draft: RuntimeSettings): void {
  pane.appendChild(el('p', { class: 'tdr-pane-title' }, ['AI 接続']));

  const grid = el('div', { class: 'tdr-fieldgrid' });
  grid.appendChild(el('p', { class: 'tdr-shared-note' }, [
    '★ Spira と共有される設定です。どちらで変更しても両方のツールに反映されます。',
  ]));

  const relayInp = mkInput(draft.relayBaseUrl,          v => { draft.relayBaseUrl = v; });
  const keyInp   = mkInput(draft.apiKey,                v => { draft.apiKey = v; });
  keyInp.type = 'password';
  const chatInp  = mkInput(draft.chatDeployment,        v => { draft.chatDeployment = v; });
  const embInp   = mkInput(draft.embeddingDeployment,   v => { draft.embeddingDeployment = v; });
  const verInp   = mkInput(draft.apiVersion,            v => { draft.apiVersion = v; });
  const dimInp   = mkInput(String(draft.dimensions),    v => { draft.dimensions = Number(v) || 256; });

  grid.append(
    ...mkRow('中継サーバ URL', relayInp, '例: http://localhost:18080'),
    ...mkRow('API キー', keyInp,         'サブスクリプションキー (省略可)'),
    ...mkRow('チャットモデル', chatInp,  'RAG 回答用デプロイ名 (例: gpt-4o-mini)'),
    ...mkRow('埋め込みモデル', embInp,   '検索用デプロイ名 (例: text-embedding-3-small)'),
    ...mkRow('API バージョン', verInp,   '例: 2024-02-01'),
    ...mkRow('次元数', dimInp,           'Matryoshka 短縮次元数 (ADR-004 で 256)'),
  );
  pane.appendChild(grid);
}

// ─── 取り込み ─────────────────────────────────────────────────────────────────

function buildIngestPane(pane: HTMLElement, draft: RuntimeSettings): void {
  pane.appendChild(el('p', { class: 'tdr-pane-title' }, ['取り込み']));

  const grid = el('div', { class: 'tdr-fieldgrid' });

  const listInp  = mkInput(draft.listTitle, v => { draft.listTitle = v; });
  const intInp   = mkInput(String(draft.ingestIntervalSec), v => { draft.ingestIntervalSec = Number(v) || 30; });

  const addrArea = el('textarea', { class: 'tdr-input', rows: '4' });
  addrArea.value = draft.mlAddresses.join('\n');
  addrArea.addEventListener('change', () => { draft.mlAddresses = parseAddressList(addrArea.value); });

  grid.append(
    ...mkRow('List 表示名', listInp, '例: 受信メールリスト'),
    el('label', { class: 'top' }, ['ML アドレス']),
    addrArea,
    el('p', { class: 'tdr-hint' }, ['取り込み対象アドレス。1 行に 1 件。']),
    ...mkRow('取り込み間隔 (秒)', intInp, 'デフォルト 30 秒'),
  );
  pane.appendChild(grid);
}

// ─── 表示 ─────────────────────────────────────────────────────────────────────

function buildDisplayPane(pane: HTMLElement, root: HTMLElement): void {
  pane.appendChild(el('p', { class: 'tdr-pane-title' }, ['表示']));

  const toggleBtn = el('button', { class: 'tdr-btn' }, [
    el('span', { html: icons.moon() }),
    el('span', {}, [root.dataset.theme === 'dark' ? 'ダークモード: ON' : 'ダークモード: OFF']),
  ]);

  toggleBtn.addEventListener('click', () => {
    const isDark = root.dataset.theme === 'dark';
    root.dataset.theme = isDark ? '' : 'dark';
    localStorage.setItem('tadori:theme', isDark ? '' : 'dark');
    const lbl = toggleBtn.querySelector('span:last-child');
    if (lbl) lbl.textContent = isDark ? 'ダークモード: OFF' : 'ダークモード: ON';
  });

  pane.appendChild(el('div', { style: 'margin-top:var(--s-3)' }, [toggleBtn]));
}

// ─── 診断 ─────────────────────────────────────────────────────────────────────

function buildDiagPane(pane: HTMLElement, draft: RuntimeSettings, root: HTMLElement): void {
  pane.appendChild(el('p', { class: 'tdr-pane-title' }, ['診断']));

  function mkDiagRow(label: string): { row: HTMLElement; set: (ok: boolean, text: string) => void } {
    const stat = el('span', { class: 'stat' }, ['—']);
    const row  = el('div', { class: 'tdr-diag' }, [el('span', {}, [label]), stat]);
    return {
      row,
      set(ok: boolean, text: string): void {
        stat.textContent = text;
        stat.className   = `stat ${ok ? 'ok' : 'ng'}`;
      },
    };
  }

  const relay = mkDiagRow('中継サーバ接続');
  const embed = mkDiagRow('埋め込み API');

  const runBtn = el('button', { class: 'tdr-btn tdr-btn--primary', style: 'margin-top:var(--s-6)' }, ['テスト実行']);

  runBtn.addEventListener('click', () => {
    runBtn.disabled = true;
    relay.set(false, '確認中…');
    embed.set(false, '確認中…');

    void (async () => {
      // 中継サーバ ping
      const ac    = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      try {
        const res = await fetch(`${draft.relayBaseUrl}/`, { method: 'GET', credentials: 'omit', signal: ac.signal });
        clearTimeout(timer);
        relay.set(true, `HTTP ${res.status}`);
      } catch (e) {
        clearTimeout(timer);
        relay.set(false, e instanceof Error ? e.message.slice(0, 60) : 'failed');
      }

      // 埋め込みテスト
      try {
        const vec = await embedQuery('テスト', draft, { apiKey: draft.apiKey });
        embed.set(true, `OK — dim: ${vec.length}`);
      } catch (e) {
        embed.set(false, e instanceof Error ? e.message.slice(0, 60) : 'failed');
        toast(root, `埋め込みテスト失敗: ${e instanceof Error ? e.message : ''}`, 'error');
      }

      runBtn.disabled = false;
    })();
  });

  pane.append(relay.row, embed.row, runBtn);
}

// ─── About ────────────────────────────────────────────────────────────────────

function buildAboutPane(pane: HTMLElement): void {
  pane.appendChild(el('p', { class: 'tdr-pane-title' }, ['About']));

  const grid = el('div', { class: 'tdr-fieldgrid' });
  grid.append(
    el('label', {}, ['バージョン']),
    el('span', { style: 'font-family:var(--font-mono);font-size:var(--fs-sm)' }, [__TADORI_VERSION__]),
    el('label', {}, ['ビルド']),
    el('span', { style: 'font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--ink-3)' }, [__TADORI_BUILD_ID__]),
  );
  pane.appendChild(grid);
}
