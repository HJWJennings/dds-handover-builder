import type { PluginToUIMessage, UIToPluginMessage } from '../messages';
import type { ComponentGroup, ScanScope } from '../scan';

const post = (message: UIToPluginMessage) => {
  window.parent.postMessage({ pluginMessage: message }, '*');
};

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>('.tab-panel'));

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle('is-active', b === button));
    tabPanels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.tabPanel === target));
  });
});

// ---------------------------------------------------------------------------
// Dev tab (raw inspector) — unchanged behaviour, just scoped under the Dev tab.
// ---------------------------------------------------------------------------

const jsonOutput = document.getElementById('json-output') as HTMLPreElement | null;
const selectionSummary = document.getElementById('selection-summary') as HTMLDivElement | null;
const inspectButton = document.getElementById('inspect-selection') as HTMLButtonElement | null;
const copyButton = document.getElementById('copy-json') as HTMLButtonElement | null;

const renderOutput = (value: unknown) => {
  if (!jsonOutput) return;
  jsonOutput.textContent = JSON.stringify(value, null, 2);
};

const updateSummary = (summary: string) => {
  if (!selectionSummary) return;
  selectionSummary.textContent = summary;
};

inspectButton?.addEventListener('click', () => {
  post({ type: 'INSPECT_SELECTION' });
});

copyButton?.addEventListener('click', async () => {
  const text = jsonOutput?.textContent ?? '{}';

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!copied) {
      throw new Error('execCommand copy returned false');
    }

    const originalText = copyButton.textContent ?? 'Copy JSON';
    copyButton.textContent = 'Copied';
    window.setTimeout(() => {
      copyButton.textContent = originalText;
    }, 1200);
  } catch (error) {
    copyButton.textContent = 'Copy failed';
  }
});

renderOutput({ message: 'Ready. Select a component or component set to inspect.' });
updateSummary('No component selected.');

// ---------------------------------------------------------------------------
// Component list (Components tab)
// ---------------------------------------------------------------------------

const treeContainer = document.getElementById('component-tree') as HTMLDivElement | null;
const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
const needsDocFilter = document.getElementById('filter-needs-doc') as HTMLInputElement | null;
const hidePrivateFilter = document.getElementById('filter-hide-private') as HTMLInputElement | null;
const expandAllButton = document.getElementById('expand-all') as HTMLButtonElement | null;
const collapseAllButton = document.getElementById('collapse-all') as HTMLButtonElement | null;
const scanProgressLabel = document.getElementById('scan-progress') as HTMLSpanElement | null;
const scopeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.scope-button'));
const selectedInfoEl = document.getElementById('selected-info') as HTMLDivElement | null;
const refreshButton = document.getElementById('refresh-list') as HTMLButtonElement | null;

const STATUS_ICON: Record<string, string> = {
  documented: '✓',
  draft: '◐',
  missing: '✗',
};

interface ListState {
  scope: ScanScope;
  groups: ComponentGroup[];
  search: string;
  needsDocOnly: boolean;
  hidePrivate: boolean;
  collapsed: Set<string>;
  checked: Set<string>;
  selectedId: string | null;
}

const state: ListState = {
  scope: 'page',
  groups: [],
  search: '',
  needsDocOnly: false,
  hidePrivate: false,
  collapsed: new Set(),
  checked: new Set(),
  selectedId: null,
};

const matchesSearch = (name: string, fullName: string, query: string) => {
  if (!query) return true;
  const q = query.toLowerCase();
  return name.toLowerCase().includes(q) || fullName.toLowerCase().includes(q);
};

const renderTree = () => {
  if (!treeContainer) return;

  const scrollTop = treeContainer.scrollTop;

  if (state.groups.length === 0) {
    treeContainer.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No components found.';
    treeContainer.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  let visibleGroupCount = 0;

  for (const group of state.groups) {
    const visibleItems = group.items.filter((item) => {
      if (state.hidePrivate && item.isPrivate) return false;
      if (state.needsDocOnly && item.status === 'documented') return false;
      if (!matchesSearch(item.name, item.fullName, state.search)) return false;
      return true;
    });

    if (visibleItems.length === 0) continue;
    visibleGroupCount += 1;

    const groupEl = document.createElement('div');
    const isCollapsed = state.collapsed.has(group.key);
    groupEl.className = `group${isCollapsed ? ' is-collapsed' : ''}`;

    const header = document.createElement('div');
    header.className = `group-header${isCollapsed ? ' is-collapsed' : ''}`;

    const disclosure = document.createElement('span');
    disclosure.className = 'disclosure';
    disclosure.textContent = '▾';
    header.appendChild(disclosure);

    const groupCheckbox = document.createElement('input');
    groupCheckbox.type = 'checkbox';
    groupCheckbox.className = 'group-checkbox';
    const checkedCount = visibleItems.filter((item) => state.checked.has(item.id)).length;
    groupCheckbox.checked = checkedCount === visibleItems.length;
    groupCheckbox.indeterminate = checkedCount > 0 && checkedCount < visibleItems.length;
    groupCheckbox.addEventListener('click', (event) => {
      event.stopPropagation();
      // The browser already toggles `checked` before this handler runs, so it reflects the new state.
      const shouldCheck = groupCheckbox.checked;
      visibleItems.forEach((item) => {
        if (shouldCheck) state.checked.add(item.id);
        else state.checked.delete(item.id);
      });
      renderTree();
    });
    header.appendChild(groupCheckbox);

    const label = document.createElement('span');
    label.textContent = group.label;
    header.appendChild(label);

    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = String(visibleItems.length);
    header.appendChild(count);

    header.addEventListener('click', () => {
      if (state.collapsed.has(group.key)) {
        state.collapsed.delete(group.key);
      } else {
        state.collapsed.add(group.key);
      }
      renderTree();
    });

    groupEl.appendChild(header);

    const itemsEl = document.createElement('div');
    itemsEl.className = 'group-items';

    for (const item of visibleItems) {
      const row = document.createElement('div');
      row.className = `component-row${item.isPrivate ? ' is-private' : ''}${item.id === state.selectedId ? ' is-selected' : ''}`;

      const rowCheckbox = document.createElement('input');
      rowCheckbox.type = 'checkbox';
      rowCheckbox.checked = state.checked.has(item.id);
      rowCheckbox.addEventListener('click', (event) => {
        event.stopPropagation();
        if (rowCheckbox.checked) state.checked.add(item.id);
        else state.checked.delete(item.id);
        renderTree();
      });
      row.appendChild(rowCheckbox);

      const statusIcon = document.createElement('span');
      statusIcon.className = `status-icon status-${item.status}`;
      statusIcon.textContent = STATUS_ICON[item.status] ?? '?';
      statusIcon.title = item.status;
      row.appendChild(statusIcon);

      const name = document.createElement('span');
      name.className = 'row-name';
      name.textContent = item.name;
      name.title = item.fullName;
      row.appendChild(name);

      const type = document.createElement('span');
      type.className = 'row-type';
      type.textContent = item.type === 'COMPONENT_SET' ? 'set' : 'component';
      row.appendChild(type);

      row.addEventListener('click', () => {
        state.selectedId = item.id;
        post({ type: 'SELECT_NODE', id: item.id });
        renderTree();
      });

      itemsEl.appendChild(row);
    }

    groupEl.appendChild(itemsEl);
    fragment.appendChild(groupEl);
  }

  treeContainer.innerHTML = '';
  if (visibleGroupCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No components match the current filters.';
    treeContainer.appendChild(empty);
    return;
  }

  treeContainer.appendChild(fragment);
  treeContainer.scrollTop = scrollTop;
};

searchInput?.addEventListener('input', () => {
  state.search = searchInput.value;
  renderTree();
});

needsDocFilter?.addEventListener('change', () => {
  state.needsDocOnly = needsDocFilter.checked;
  renderTree();
});

hidePrivateFilter?.addEventListener('change', () => {
  state.hidePrivate = hidePrivateFilter.checked;
  renderTree();
});

expandAllButton?.addEventListener('click', () => {
  state.collapsed.clear();
  renderTree();
});

collapseAllButton?.addEventListener('click', () => {
  state.groups.forEach((group) => state.collapsed.add(group.key));
  renderTree();
});

scopeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const scope = button.dataset.scope as ScanScope;
    if (scope === state.scope) return;
    scopeButtons.forEach((b) => b.classList.toggle('is-active', b === button));
    state.scope = scope;
    if (treeContainer) {
      treeContainer.innerHTML = '<div class="empty-state">Scanning…</div>';
    }
    post({ type: 'SCAN_REQUEST', scope });
  });
});

refreshButton?.addEventListener('click', () => {
  post({ type: 'REFRESH_LIST' });
});

// Rescan when the plugin window regains focus (e.g. switching back from Figma canvas).
window.addEventListener('focus', () => {
  post({ type: 'REFRESH_LIST' });
});

const updateSelectedInfo = (payload: { id: string; name: string; type: string } | null) => {
  if (!selectedInfoEl) return;
  if (!payload) {
    selectedInfoEl.textContent = 'No component selected.';
    return;
  }
  selectedInfoEl.textContent = `${payload.name} (${payload.type})`;
  state.selectedId = payload.id;
};

window.addEventListener('message', (event) => {
  const message = event.data?.pluginMessage as PluginToUIMessage | undefined;
  if (!message) {
    return;
  }

  switch (message.type) {
    case 'INSPECT_RESULT': {
      console.log('[ui] selection msg', message.payload ?? null);
      renderOutput(message.payload ?? {});
      const payload = message.payload as { name?: string; nodeType?: string; error?: string } | null;
      if (payload?.error) {
        updateSummary(payload.error);
        break;
      }
      updateSummary(payload?.name ? `${payload.name} (${payload.nodeType ?? 'node'})` : 'Selection ready');
      break;
    }
    case 'INSPECT_ERROR': {
      renderOutput({ error: message.payload?.message ?? 'Unknown error' });
      updateSummary(message.payload?.message ?? 'Inspector error');
      break;
    }
    case 'SCAN_RESULT': {
      state.scope = message.payload.scope;
      state.groups = message.payload.groups;
      if (scanProgressLabel) scanProgressLabel.textContent = '';
      renderTree();
      break;
    }
    case 'SCAN_PROGRESS': {
      if (!scanProgressLabel) break;
      const { scannedPages, totalPages } = message.payload;
      scanProgressLabel.textContent = totalPages > 1 ? `Scanning page ${scannedPages}/${totalPages}…` : '';
      break;
    }
    case 'SCAN_ERROR': {
      if (treeContainer) {
        treeContainer.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = message.payload.message;
        treeContainer.appendChild(empty);
      }
      break;
    }
    case 'SELECTED_INFO': {
      updateSelectedInfo(message.payload);
      renderTree();
      break;
    }
  }
});

console.log('[ui] sent UI_READY');
post({ type: 'UI_READY' });
