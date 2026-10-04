import type { EditorPayload, ExportFormat, HandoverGenerationResultPayload, HandoverPreviewEntry, ImportPreviewEntry, ImportPreviewPayload, ImportResultEntry, PluginToUIMessage, SaveResultPayload, UIToPluginMessage } from '../messages';
import type { ComponentGroup, ComponentListItem, ScanScope } from '../scan';
import type { ComponentDoc, ComponentDocLink } from '../store/types';
import { applyMarkdownAction, parseMarkdown, type BlockNode, type InlineNode, type MarkdownAction } from '../shared/markdown';

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
    post({ type: 'DEV_TAB_ACTIVE', active: target === 'dev' });
  });
});

// ---------------------------------------------------------------------------
// Dev tab (raw inspector) — unchanged behaviour, just scoped under the Dev tab.
// ---------------------------------------------------------------------------

const jsonOutput = document.getElementById('json-output') as HTMLPreElement | null;
const selectionSummary = document.getElementById('selection-summary') as HTMLDivElement | null;
const inspectButton = document.getElementById('inspect-selection') as HTMLButtonElement | null;
const styleProbeButton = document.getElementById('style-probe') as HTMLButtonElement | null;
const tokenCatalogueButton = document.getElementById('token-catalogue') as HTMLButtonElement | null;
const tokenCatalogueNote = document.getElementById('token-catalogue-note') as HTMLDivElement | null;
const generateTwiceButton = document.getElementById('generate-twice') as HTMLButtonElement | null;
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
  if (tokenCatalogueNote) tokenCatalogueNote.hidden = true;
  post({ type: 'INSPECT_SELECTION' });
});

styleProbeButton?.addEventListener('click', () => {
  if (tokenCatalogueNote) tokenCatalogueNote.hidden = true;
  updateSummary('Running Style probe…');
  post({ type: 'STYLE_PROBE_REQUEST' });
});

tokenCatalogueButton?.addEventListener('click', () => {
  if (tokenCatalogueNote) tokenCatalogueNote.hidden = false;
  updateSummary('Reading token catalogue…');
  post({ type: 'TOKEN_CATALOGUE_REQUEST' });
});

generateTwiceButton?.addEventListener('click', () => {
  const id = editorState.source?.id ?? state.selectedId;
  if (!id) {
    updateSummary('Select a component first.');
    return;
  }
  updateSummary('Generating twice…');
  post({ type: 'GENERATE_TWICE', id });
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
const needsDocFilterChip = document.getElementById('filter-needs-doc') as HTMLButtonElement | null;
const hidePrivateFilterChip = document.getElementById('filter-hide-private') as HTMLButtonElement | null;
const resultsCountEl = document.getElementById('results-count') as HTMLSpanElement | null;
const clearFiltersButton = document.getElementById('clear-filters') as HTMLButtonElement | null;
const expandAllButton = document.getElementById('expand-all') as HTMLButtonElement | null;
const collapseAllButton = document.getElementById('collapse-all') as HTMLButtonElement | null;
const selectAllShownButton = document.getElementById('select-all-shown') as HTMLButtonElement | null;
const clearSelectionButton = document.getElementById('clear-selection') as HTMLButtonElement | null;
const scanProgressLabel = document.getElementById('scan-progress') as HTMLSpanElement | null;
const scopeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.scope-button'));
const refreshButton = document.getElementById('refresh-list') as HTMLButtonElement | null;
const bulkBarEl = document.getElementById('bulk-bar') as HTMLDivElement | null;
const bulkCountEl = document.getElementById('bulk-count') as HTMLSpanElement | null;
const bulkClearButton = document.getElementById('bulk-clear') as HTMLButtonElement | null;
const bulkGenerateHandoverButton = document.getElementById('bulk-generate-handover') as HTMLButtonElement | null;
const exportMenuButton = document.getElementById('export-menu-button') as HTMLButtonElement | null;
const exportMenuEl = document.getElementById('export-menu') as HTMLDivElement | null;
const exportScopeLabel = document.getElementById('export-scope-label') as HTMLDivElement | null;
const exportSourceLabel = document.getElementById('export-source-label') as HTMLSpanElement | null;
const importJsonButton = document.getElementById('import-json-button') as HTMLButtonElement | null;
const importFileInput = document.getElementById('import-file') as HTMLInputElement | null;

interface BatchOutcome {
  label: string;
  count: number;
  danger?: boolean;
}

const renderBatchSummary = (target: HTMLElement | null, outcomes: BatchOutcome[]) => {
  if (!target) return;
  const visible = outcomes.filter((outcome) => outcome.count > 0);
  target.replaceChildren();
  target.classList.remove('outcome-failure');
  target.classList.toggle('has-failure', visible.some((outcome) => outcome.danger));
  if (visible.length === 0) {
    target.textContent = 'Nothing changed';
    return;
  }
  visible.forEach((outcome, index) => {
    if (index > 0) target.append(document.createTextNode(' · '));
    const part = document.createElement('span');
    part.textContent = `${outcome.label} ${outcome.count}`;
    if (outcome.danger) part.className = 'outcome-failure';
    target.appendChild(part);
  });
};

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

const itemPasses = (item: ComponentListItem): boolean => {
  if (state.hidePrivate && item.isPrivate) return false;
  if (state.needsDocOnly && item.status === 'documented') return false;
  if (!matchesSearch(item.name, item.fullName, state.search)) return false;
  return true;
};

/** Same order used for row rendering: group order, then item order within each group. */
const getFilteredFlatList = (): ComponentListItem[] => {
  const flat: ComponentListItem[] = [];
  for (const group of state.groups) {
    for (const item of group.items) {
      if (itemPasses(item)) flat.push(item);
    }
  }
  return flat;
};

const findItemById = (id: string): ComponentListItem | null => {
  for (const group of state.groups) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) return item;
  }
  return null;
};

const isAnyFilterActive = (): boolean => Boolean(state.search || state.needsDocOnly || state.hidePrivate);

const updateBulkBar = () => {
  const count = state.checked.size;
  if (bulkBarEl) bulkBarEl.hidden = count === 0;
  if (bulkCountEl) bulkCountEl.textContent = `${count} selected`;
};

const updateListMeta = () => {
  const totalCount = state.groups.reduce((sum, group) => sum + group.items.length, 0);
  const visibleCount = getFilteredFlatList().length;
  if (resultsCountEl) resultsCountEl.textContent = `Showing ${visibleCount} of ${totalCount}`;
  if (exportScopeLabel) exportScopeLabel.textContent = state.checked.size > 0 ? `${state.checked.size} checked` : `${visibleCount} shown`;
  if (clearFiltersButton) clearFiltersButton.hidden = !isAnyFilterActive();
  if (clearSelectionButton) clearSelectionButton.hidden = state.checked.size === 0;
  updateBulkBar();
};

const renderTree = () => {
  if (!treeContainer) return;

  updateListMeta();

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
    const visibleItems = group.items.filter(itemPasses);

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
        requestNavigateTo(item.id);
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

needsDocFilterChip?.addEventListener('click', () => {
  state.needsDocOnly = !state.needsDocOnly;
  needsDocFilterChip.classList.toggle('is-active', state.needsDocOnly);
  renderTree();
});

hidePrivateFilterChip?.addEventListener('click', () => {
  state.hidePrivate = !state.hidePrivate;
  hidePrivateFilterChip.classList.toggle('is-active', state.hidePrivate);
  renderTree();
});

clearFiltersButton?.addEventListener('click', () => {
  state.search = '';
  state.needsDocOnly = false;
  state.hidePrivate = false;
  if (searchInput) searchInput.value = '';
  needsDocFilterChip?.classList.remove('is-active');
  hidePrivateFilterChip?.classList.remove('is-active');
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

selectAllShownButton?.addEventListener('click', () => {
  getFilteredFlatList().forEach((item) => state.checked.add(item.id));
  renderTree();
});

clearSelectionButton?.addEventListener('click', () => {
  state.checked.clear();
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

// ---------------------------------------------------------------------------
// Confirm modal (Clear documentation, single + bulk)
// ---------------------------------------------------------------------------

interface ConfirmModalOptions {
  title: string;
  body: string;
  confirmLabel: string;
  listItems?: string[];
  confirmClass?: string;
  hideCancel?: boolean;
  onConfirm: () => void;
}

let activeModal: ConfirmModalOptions | null = null;

const modalOverlay = document.getElementById('confirm-modal') as HTMLDivElement | null;
const modalTitleEl = document.getElementById('modal-title') as HTMLHeadingElement | null;
const modalBodyEl = document.getElementById('modal-body') as HTMLParagraphElement | null;
const modalListEl = document.getElementById('modal-list') as HTMLDivElement | null;
const modalExtraEl = document.getElementById('modal-extra') as HTMLDivElement | null;
const modalProgressEl = document.getElementById('modal-progress') as HTMLDivElement | null;
const modalProgressBar = document.getElementById('modal-progress-bar') as HTMLProgressElement | null;
const modalProgressLabel = document.getElementById('modal-progress-label') as HTMLDivElement | null;
const modalProgressName = document.getElementById('modal-progress-name') as HTMLDivElement | null;
const modalExportContent = document.getElementById('modal-export-content') as HTMLTextAreaElement | null;
const modalCancelButton = document.getElementById('modal-cancel') as HTMLButtonElement | null;
const modalShowDocButton = document.getElementById('modal-show-doc') as HTMLButtonElement | null;
const modalConfirmButton = document.getElementById('modal-confirm') as HTMLButtonElement | null;
const modalCopyButton = document.getElementById('modal-copy') as HTMLButtonElement | null;
const modalActions = modalOverlay?.querySelector<HTMLDivElement>('.modal-actions') ?? null;
let progressModalLocked = false;
let progressModalStartedAt = 0;
let progressVerb = 'Processing';

const closeModal = () => {
  if (progressModalLocked) return;
  activeModal = null;
  if (modalOverlay) modalOverlay.hidden = true;
};

const openConfirmModal = (options: ConfirmModalOptions) => {
  progressModalLocked = false;
  activeModal = options;
  if (modalCancelButton) modalCancelButton.textContent = 'Cancel';
  if (modalCancelButton) modalCancelButton.hidden = Boolean(options.hideCancel);
  if (modalConfirmButton) {
    modalConfirmButton.hidden = false;
    modalConfirmButton.className = options.confirmClass ?? 'danger';
  }
  if (modalCopyButton) modalCopyButton.hidden = true;
  if (modalShowDocButton) modalShowDocButton.hidden = true;
  if (modalCancelButton) modalCancelButton.disabled = false;
  if (modalConfirmButton) modalConfirmButton.disabled = false;
  if (modalActions) modalActions.hidden = false;
  if (modalProgressEl) modalProgressEl.hidden = true;
  if (modalListEl) modalListEl.hidden = false;
  if (modalExtraEl) modalExtraEl.hidden = false;
  if (modalExportContent) modalExportContent.hidden = true;
  if (modalExtraEl) modalExtraEl.innerHTML = '';
  if (modalTitleEl) modalTitleEl.textContent = options.title;
  if (modalBodyEl) modalBodyEl.textContent = options.body;
  if (modalListEl) {
    modalListEl.innerHTML = '';
    if (options.listItems && options.listItems.length > 0) {
      const ul = document.createElement('ul');
      options.listItems.forEach((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      modalListEl.appendChild(ul);
    }
  }
  if (modalConfirmButton) modalConfirmButton.textContent = options.confirmLabel;
  if (modalOverlay) modalOverlay.hidden = false;
  modalCancelButton?.focus();
};

const startProgressModal = (title: string, total: number, verb: string) => {
  openConfirmModal({ title, body: '', confirmLabel: '', hideCancel: true, onConfirm: () => {} });
  progressModalLocked = true;
  progressModalStartedAt = Date.now();
  progressVerb = verb;
  if (modalCancelButton) modalCancelButton.disabled = true;
  if (modalConfirmButton) modalConfirmButton.disabled = true;
  if (modalCopyButton) modalCopyButton.disabled = true;
  if (modalActions) modalActions.hidden = true;
  if (modalListEl) modalListEl.hidden = true;
  if (modalExtraEl) modalExtraEl.hidden = true;
  if (modalExportContent) modalExportContent.hidden = true;
  if (modalProgressEl) modalProgressEl.hidden = false;
  if (modalProgressBar) {
    modalProgressBar.max = Math.max(total, 1);
    modalProgressBar.value = 0;
  }
  updateProgressModal(0, total, '');
};

const updateProgressModal = (done: number, total: number, name: string) => {
  if (!progressModalLocked) return;
  if (modalProgressBar) {
    modalProgressBar.max = Math.max(total, 1);
    modalProgressBar.value = Math.min(done, total);
  }
  if (modalProgressLabel) modalProgressLabel.textContent = `${progressVerb} ${done} of ${total}…`;
  if (modalProgressName) modalProgressName.textContent = name;
};

const completeProgressModal = (finish: () => void) => {
  if (!progressModalLocked) {
    finish();
    return;
  }
  const remaining = Math.max(0, 400 - (Date.now() - progressModalStartedAt));
  window.setTimeout(() => {
    progressModalLocked = false;
    finish();
  }, remaining);
};

modalCopyButton?.addEventListener('click', () => {
  if (!modalExportContent) return;
  modalExportContent.focus();
  modalExportContent.select();
  const copied = document.execCommand('copy');
  modalCopyButton.textContent = copied ? 'Copied' : 'Copy failed';
});

let pendingShowDocFrameId: string | null = null;

modalShowDocButton?.addEventListener('click', () => {
  if (!pendingShowDocFrameId) return;
  post({ type: 'SHOW_HANDOVER_DOC', frameId: pendingShowDocFrameId });
  closeModal();
});

modalCancelButton?.addEventListener('click', closeModal);

modalConfirmButton?.addEventListener('click', () => {
  const options = activeModal;
  closeModal();
  options?.onConfirm();
});

modalOverlay?.addEventListener('click', (event) => {
  if (!progressModalLocked && event.target === modalOverlay) closeModal();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalOverlay && !modalOverlay.hidden) {
    if (progressModalLocked) {
      event.preventDefault();
      return;
    }
    closeModal();
  }
});

const namesForIds = (ids: string[]): string[] => ids.map((id) => findItemById(id)?.fullName ?? id);

const confirmClearNames = (ids: string[]): string[] => {
  const names = namesForIds(ids);
  const shown = names.slice(0, 5);
  const remaining = names.length - shown.length;
  return remaining > 0 ? [...shown, `+ ${remaining} more`] : shown;
};

bulkClearButton?.addEventListener('click', () => {
  const ids = Array.from(state.checked);
  if (ids.length === 0) return;

  openConfirmModal({
    title: `Clear documentation for ${ids.length} components?`,
    body: "This removes all documentation fields, links and status from these components. It can't be undone from the plugin.",
    confirmLabel: `Clear ${ids.length}`,
    listItems: confirmClearNames(ids),
    onConfirm: () => {
      startProgressModal('Clearing documentation', ids.length, 'Clearing');
      post({ type: 'CLEAR_DOCS_BULK', ids });
    },
  });
});

const requestHandoverGeneration = (ids: string[]) => {
  post({ type: 'GENERATE_HANDOVER_PREVIEW_REQUEST', ids });
};

bulkGenerateHandoverButton?.addEventListener('click', () => {
  const ids = Array.from(state.checked);
  if (ids.length > 0) requestHandoverGeneration(ids);
});

const exportFormatButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-export-format]'));

exportMenuButton?.addEventListener('click', () => {
  if (exportMenuEl) exportMenuEl.hidden = !exportMenuEl.hidden;
});

document.addEventListener('click', (event) => {
  const target = event.target as Node | null;
  if (exportMenuEl && target && !exportMenuEl.contains(target) && !exportMenuButton?.contains(target)) {
    exportMenuEl.hidden = true;
  }
});

const requestExport = (format: ExportFormat) => {
  const checkedIds = Array.from(state.checked);
  const source = checkedIds.length > 0 ? 'checked' : 'shown';
  const ids = source === 'checked' ? checkedIds : getFilteredFlatList().map((item) => item.id);
  exportSourceLabel?.classList.remove('outcome-failure');
  if (exportMenuEl) exportMenuEl.hidden = true;
  if (ids.length > 20) startProgressModal('Exporting components', ids.length, 'Exporting');
  post({ type: 'EXPORT_REQUEST', format, ids, source });
};

exportFormatButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const format = button.dataset.exportFormat as ExportFormat;
    if (format === 'csv' || format === 'json') requestExport(format);
  });
});

importJsonButton?.addEventListener('click', () => {
  if (exportMenuEl) exportMenuEl.hidden = true;
  if (importFileInput) {
    importFileInput.value = '';
    importFileInput.click();
  }
});

importFileInput?.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  if (!file) return;
  try {
    const content = JSON.parse(await file.text()) as unknown;
    post({ type: 'IMPORT_PREVIEW_REQUEST', content });
    if (exportSourceLabel) exportSourceLabel.textContent = `Preparing import from ${file.name}…`;
  } catch (error) {
    if (exportSourceLabel) {
      exportSourceLabel.textContent = `Import error: ${error instanceof Error ? error.message : String(error)}`;
      exportSourceLabel.classList.add('outcome-failure');
    }
  }
});

interface ExportDataPayload {
  format: ExportFormat;
  fileName: string;
  content: string;
  count: number;
  source: 'checked' | 'shown';
}

const showExportContent = (payload: ExportDataPayload) => {
  const content = payload.format === 'csv' ? `\uFEFF${payload.content}` : payload.content;
  try {
    const blob = new Blob([content], { type: payload.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = payload.fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.warn('[ui] download was blocked; showing copy fallback', error);
  }

  const showDownloadFallback = () => {
    openConfirmModal({
      title: `${payload.format.toUpperCase()} export ready`,
      body: `Exporting ${payload.count} ${payload.source}. The download should start automatically; copy the content below if Figma blocks it.`,
      confirmLabel: 'Close',
      confirmClass: 'secondary',
      hideCancel: true,
      onConfirm: () => {},
    });
    if (modalExportContent) {
      modalExportContent.hidden = false;
      modalExportContent.value = content;
    }
    if (modalConfirmButton) modalConfirmButton.hidden = true;
    if (modalCopyButton) modalCopyButton.hidden = false;
    if (modalCancelButton) {
      modalCancelButton.hidden = false;
      modalCancelButton.textContent = 'Close';
      modalCancelButton.focus();
    }
  };
  if (payload.count > 20) {
    completeProgressModal(showDownloadFallback);
  } else {
    showDownloadFallback();
  }
  renderBatchSummary(exportSourceLabel, [{ label: 'Exported', count: payload.count }]);
};

const appendOutcomeSection = (
  container: HTMLElement,
  title: string,
  names: string[],
  appendDetail?: (list: HTMLElement, entry: ImportPreviewEntry) => void,
  detailEntries: ImportPreviewEntry[] = [],
) => {
  const section = document.createElement('section');
  section.className = 'outcome-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.appendChild(heading);
  if (names.length > 0) {
    const list = document.createElement('ul');
    names.slice(0, 5).forEach((name) => {
      const item = document.createElement('li');
      item.textContent = name;
      list.appendChild(item);
    });
    if (names.length > 5) {
      const more = document.createElement('li');
      more.textContent = `+ ${names.length - 5} more`;
      list.appendChild(more);
    }
    section.appendChild(list);
    if (appendDetail) {
      detailEntries.forEach((entry) => appendDetail(section, entry));
    }
  }
  container.appendChild(section);
};

const appendResultSection = (container: HTMLElement, title: string, entries: ImportResultEntry[]) => {
  if (entries.length === 0) return;
  const section = document.createElement('section');
  section.className = 'result-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.appendChild(heading);
  if (entries.length > 0) {
    const list = document.createElement('ul');
    entries.forEach((entry) => {
      const item = document.createElement('li');
      item.textContent = entry.reason ? `${entry.name}: ${entry.reason}` : entry.name;
      list.appendChild(item);
    });
    section.appendChild(list);
  }
  container.appendChild(section);
};

const showImportPreview = (preview: ImportPreviewPayload) => {
  let choice: 'keep' | 'replace' | null = null;
  const differs = preview.counts.different;
  const formatDate = (value?: string) => {
    if (!value) return 'unknown date';
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString() : value;
  };

  const updateImportChoice = () => {
    if (!modalConfirmButton) return;
    const replacing = choice === 'replace' ? differs : 0;
    const count = preview.counts.new + replacing;
    modalConfirmButton.disabled = (differs > 0 && choice === null) || count === 0;
    modalConfirmButton.textContent = count === 0
      ? 'Nothing to import'
      : replacing > 0
        ? `Import ${count} components`
        : `Add ${count} component${count === 1 ? '' : 's'}`;

    const keptAsIs = preview.counts.unchanged + (choice === 'keep' ? differs : 0);
    const summary = modalExtraEl?.querySelector<HTMLElement>('.import-live-summary');
    if (summary) {
      if (differs > 0 && choice === null) {
        summary.textContent = `Choose whether to keep or replace ${differs} different component${differs === 1 ? '' : 's'}.`;
      } else {
        const parts: string[] = [];
        if (preview.counts.new > 0) parts.push(`add ${preview.counts.new}`);
        if (replacing > 0) parts.push(`replace ${replacing}`);
        if (keptAsIs > 0) parts.push(`keep existing ${keptAsIs}`);
        summary.textContent = parts.length > 0 ? `This will ${parts.join(' · ')}.` : 'Nothing changed';
      }
    }
  };

  openConfirmModal({
    title: 'Import documentation',
    body: `File contains ${preview.fileCount} components.`,
    confirmLabel: 'Nothing to import',
    confirmClass: 'primary',
    hideCancel: false,
    onConfirm: () => {
      const selectedChoice = choice;
      if (differs > 0 && selectedChoice === null) return;
      const total = preview.counts.new + (selectedChoice === 'replace' ? differs : 0);
      startProgressModal('Importing documentation', preview.fileCount, 'Importing');
      post({ type: 'IMPORT_CONFIRM', planId: preview.planId, choice: selectedChoice });
      if (exportSourceLabel) exportSourceLabel.textContent = `Importing ${total} components…`;
    },
  });

  if (modalExtraEl) {
    appendOutcomeSection(modalExtraEl, `Will be added (${preview.counts.new})`, preview.entries.filter((entry) => entry.outcome === 'NEW').map((entry) => entry.name));
    appendOutcomeSection(modalExtraEl, `Already documented, identical (${preview.counts.unchanged})`, preview.entries.filter((entry) => entry.outcome === 'UNCHANGED').map((entry) => entry.name));
    appendOutcomeSection(modalExtraEl, `Already documented, different (${differs})`, preview.entries.filter((entry) => entry.outcome === 'DIFFERENT').map((entry) => entry.name), (list, entry) => {
      const detail = document.createElement('div');
      detail.className = 'outcome-detail';
      detail.textContent = `Existing: updated ${formatDate(entry.existingUpdatedAt)}${entry.existingUpdatedBy ? ` by ${entry.existingUpdatedBy}` : ''} / File: updated ${formatDate(entry.fileUpdatedAt)}${entry.fileUpdatedBy ? ` by ${entry.fileUpdatedBy}` : ''}`;
      list.appendChild(detail);
      if (entry.existingIsNewer) {
        const warning = document.createElement('div');
        warning.className = 'outcome-detail outcome-warning';
        warning.textContent = 'Existing version is newer';
        list.appendChild(warning);
      }
    }, preview.entries.filter((entry) => entry.outcome === 'DIFFERENT'));

    const cannotImport = preview.entries.filter((entry) => entry.outcome === 'UNMATCHED' || entry.outcome === 'INVALID');
    appendOutcomeSection(modalExtraEl, `Can't import: ${cannotImport.length}`, cannotImport.map((entry) => `${entry.name}: ${entry.reason ?? 'Unknown reason'}`));

    if (differs > 0) {
      const choices = document.createElement('fieldset');
      choices.className = 'import-choice';
      const legend = document.createElement('legend');
      legend.textContent = 'Choose what to do with different documentation';
      choices.appendChild(legend);
      const choiceOptions: Array<{ value: 'keep' | 'replace'; label: string }> = [
        { value: 'keep', label: `Keep existing documentation (skip these ${differs})` },
        { value: 'replace', label: `Replace existing documentation with the file's version (${differs})` },
      ];
      for (const option of choiceOptions) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'import-conflict-choice';
        input.value = option.value;
        input.required = true;
        input.addEventListener('change', () => {
          choice = option.value;
          updateImportChoice();
        });
        const text = document.createElement('span');
        text.textContent = option.label;
        label.append(input, text);
        choices.appendChild(label);
      }
      modalExtraEl.appendChild(choices);
    }

    const summary = document.createElement('div');
    summary.className = 'import-live-summary';
    summary.id = 'modal-import-summary';
    modalExtraEl.appendChild(summary);
  }
  updateImportChoice();
};

const showImportResult = (result: Extract<PluginToUIMessage, { type: 'IMPORT_RESULT' }>['payload']) => {
  const added = result.added;
  const replaced = result.replaced;
  const kept = result.keptExisting;
  const unchanged = result.unchanged;
  const couldNotImport = result.couldNotImport;
  for (const entry of [...added, ...replaced]) {
    if (entry.id) updateItemStatus(entry.id, entry.status ?? 'missing');
  }
  renderTree();
  const outcomes: BatchOutcome[] = [
    { label: 'Added', count: added.length },
    { label: 'Replaced', count: replaced.length },
    { label: 'Kept existing', count: kept.length },
    { label: 'Unchanged', count: unchanged.length },
    { label: "Couldn't import", count: couldNotImport.length, danger: true },
  ];
  openConfirmModal({
    title: 'Import result',
    body: '',
    confirmLabel: 'Close',
    confirmClass: 'secondary',
    hideCancel: true,
    onConfirm: () => {},
  });
  renderBatchSummary(modalBodyEl, outcomes);
  if (modalExtraEl) {
    appendResultSection(modalExtraEl, `Added (${added.length})`, added);
    appendResultSection(modalExtraEl, `Replaced (${replaced.length})`, replaced);
    appendResultSection(modalExtraEl, `Kept existing (${kept.length})`, kept);
    appendResultSection(modalExtraEl, `Unchanged (${unchanged.length})`, unchanged);
    appendResultSection(modalExtraEl, `Couldn't import: ${couldNotImport.length}`, couldNotImport);
  }
  if (modalConfirmButton) {
    modalConfirmButton.hidden = false;
    modalConfirmButton.textContent = 'Close';
    modalConfirmButton.focus();
  }
  renderBatchSummary(exportSourceLabel, outcomes);
};

const showHandoverPreview = (preview: { planId: string; entries: HandoverPreviewEntry[] }) => {
  const validEntries = preview.entries.filter((entry) => !entry.error);
  const replacementCount = validEntries.filter((entry) => entry.replacesExisting).length;
  const names = preview.entries.slice(0, 5).map((entry) => {
    if (entry.error) return `${entry.name}: ${entry.error}`;
    return `${entry.name}${entry.replacesExisting ? ' · replaces existing doc' : ''}`;
  });
  if (preview.entries.length > 5) names.push(`+ ${preview.entries.length - 5} more`);

  openConfirmModal({
    title: 'Generate handover docs',
    body: replacementCount > 0
      ? `This will generate ${validEntries.length} document${validEntries.length === 1 ? '' : 's'}. Manual edits to ${replacementCount} existing generated document${replacementCount === 1 ? '' : 's'} will be lost.`
      : `This will generate ${validEntries.length} document${validEntries.length === 1 ? '' : 's'} as native Figma frames.`,
    confirmLabel: `Generate ${validEntries.length} doc${validEntries.length === 1 ? '' : 's'}`,
    confirmClass: 'primary',
    listItems: names,
    onConfirm: () => {
      startProgressModal('Generating handover docs', preview.entries.length, 'Generating');
      post({ type: 'GENERATE_HANDOVER_CONFIRM', planId: preview.planId });
    },
  });
  if (modalConfirmButton) modalConfirmButton.disabled = validEntries.length === 0;
};

const showHandoverResult = (result: HandoverGenerationResultPayload) => {
  const runLabel = result.runIndex !== undefined ? ` (run ${result.runIndex + 1} of 2)` : '';
  const generated = result.generated.map((entry) => ({ id: entry.id, name: entry.name }));
  const replaced = result.replaced.map((entry) => ({ id: entry.id, name: entry.name }));
  const failed = result.failed.map((entry) => ({ id: entry.id, name: entry.name, reason: entry.reason }));
  const outcomes: BatchOutcome[] = [
    { label: 'Generated', count: generated.length },
    { label: 'Replaced', count: replaced.length },
    { label: 'Failed', count: failed.length, danger: true },
  ];
  openConfirmModal({
    title: `Handover doc result${runLabel}`,
    body: '',
    confirmLabel: 'Close',
    confirmClass: 'secondary',
    hideCancel: true,
    onConfirm: () => {},
  });
  pendingShowDocFrameId = result.showDocFrameId ?? null;
  if (modalShowDocButton) modalShowDocButton.hidden = !pendingShowDocFrameId;
  renderBatchSummary(modalBodyEl, outcomes);
  if (result.emptySectionCount > 0 && modalBodyEl) {
    modalBodyEl.append(document.createTextNode(` · ${result.emptySectionCount} sections had no content`));
  }
  if (modalBodyEl) {
    modalBodyEl.append(document.createTextNode(` · ${result.instanceCount} instances · Grids: ${result.gridCount}`));
    modalBodyEl.append(document.createTextNode(` · Variants: placed ${result.variantsPlaced} of ${result.variantsTotal}`));
    if (result.variantsOther > 0) modalBodyEl.append(document.createTextNode(` · Other variants: ${result.variantsOther}`));
    modalBodyEl.append(document.createTextNode(` · On dark: ${result.onDarkStatuses.join(', ') || 'not available'}`));
    modalBodyEl.append(document.createTextNode(` · Healed ${result.healedFrames} frames · Collapsed: ${result.collapsedCount} · Empty: ${result.emptyFrameCount}`));
    if (result.narrowTextCount > 0) modalBodyEl.append(document.createTextNode(` · Narrow text: ${result.narrowTextCount}`));
    if (result.outOfBoundsCount > 0) modalBodyEl.append(document.createTextNode(` · Out of bounds: ${result.outOfBoundsCount}`));
    if (result.sectionErrors.length > 0) {
      modalBodyEl.append(document.createTextNode(` · Generated with ${result.sectionErrors.length} section errors`));
    }
  }
  if (modalExtraEl && result.sectionErrors.length > 0) {
    const section = document.createElement('section');
    section.className = 'result-section';
    const heading = document.createElement('h4');
    heading.textContent = 'Section errors';
    section.appendChild(heading);
    const list = document.createElement('ul');
    result.sectionErrors.forEach((entry) => {
      const item = document.createElement('li');
      item.textContent = `Section failed: ${entry}`;
      item.className = 'outcome-failure';
      list.appendChild(item);
    });
    section.appendChild(list);
    modalExtraEl.appendChild(section);
  }
  if (modalExtraEl && result.sections.length > 0) {
    const section = document.createElement('section');
    section.className = 'result-section';
    const heading = document.createElement('h4');
    heading.textContent = 'Sections';
    section.appendChild(heading);
    const list = document.createElement('ul');
    result.sections.forEach((entry) => {
      const item = document.createElement('li');
      const stackLine = entry.stack?.split('\n').find((line) => line.trim().startsWith('at '));
      item.textContent = `${entry.name}: ${entry.status}${entry.reason ? `: ${entry.reason}` : ''}${entry.status === 'failed' && stackLine ? ` — ${stackLine.trim()}` : ''} (${entry.durationMs}ms)`;
      if (entry.status === 'failed') item.className = 'outcome-failure';
      list.appendChild(item);
    });
    section.appendChild(list);
    modalExtraEl.appendChild(section);
  }
  if (modalExtraEl && result.genLog.length > 0) {
    const details = document.createElement('details');
    details.className = 'result-log';
    const summary = document.createElement('summary');
    summary.textContent = `Log (${result.genLog.length} lines)`;
    details.appendChild(summary);
    const pre = document.createElement('pre');
    pre.className = 'result-log-block';
    pre.textContent = result.genLog.join('\n');
    details.appendChild(pre);
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'secondary';
    copyButton.textContent = 'Copy log';
    copyButton.addEventListener('click', () => {
      const textarea = document.createElement('textarea');
      textarea.value = result.genLog.join('\n');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy log'; }, 1500);
    });
    details.appendChild(copyButton);
    modalExtraEl.appendChild(details);
  }
  if (modalExtraEl) {
    appendResultSection(modalExtraEl, `Generated (${generated.length})`, generated);
    appendResultSection(modalExtraEl, `Replaced (${replaced.length})`, replaced);
    appendResultSection(modalExtraEl, `Failed (${failed.length})`, failed);

    const fontSection = document.createElement('section');
    fontSection.className = 'result-section';
    const fontHeading = document.createElement('h4');
    fontHeading.textContent = 'Fonts';
    fontSection.appendChild(fontHeading);
    const fontList = document.createElement('ul');
    [
      `Body: ${result.fontReport.bodyFamily || 'unavailable'} ${result.fontReport.regularStyle || ''}`.trim(),
      `Bold: ${result.fontReport.boldStyle || 'unavailable'}`,
      `Mono: ${result.fontReport.monoFamily || 'unavailable'} ${result.fontReport.monoStyle || ''}`.trim(),
      `Italic: ${result.fontReport.italicStyle ?? 'not available; skipped'}`,
      ...result.fontReport.fallbacks.map((fallback) => `Fallback: ${fallback}`),
      ...result.fontReport.errors.map((error) => `Error: ${error}`),
    ].forEach((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      fontList.appendChild(item);
    });
    fontSection.appendChild(fontList);
    modalExtraEl.appendChild(fontSection);

    const tokenSection = document.createElement('section');
    tokenSection.className = 'result-section';
    const tokenHeading = document.createElement('h4');
    tokenHeading.textContent = 'Token report';
    tokenSection.appendChild(tokenHeading);
    const tokenList = document.createElement('ul');
    result.tokenBindingReadback.forEach((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      if (line.includes('NOT FOUND in Web')) item.className = 'outcome-failure';
      tokenList.appendChild(item);
    });
    const mismatchCount = result.tokenReport.filter((entry) => entry.reason.startsWith('value differs from expected:')).length;
    const boundCount = result.tokenReport.filter((entry) => Boolean(entry.variableUsed) && !entry.reason.startsWith('value differs from expected:')).length;
    const fallbackCount = result.tokenReport.length - boundCount - mismatchCount;
    const tokenSummary = document.createElement('li');
    tokenSummary.textContent = `${boundCount} roles bound to variables, ${fallbackCount} using fallback, ${mismatchCount} mismatches`;
    tokenSummary.style.fontWeight = '600';
    tokenList.appendChild(tokenSummary);
    result.tokenReport.forEach((entry) => {
      const item = document.createElement('li');
      const resolution = entry.variableUsed ? `Variable: ${entry.variableUsed}` : `Fallback: ${String(entry.fallback ?? 'none')}`;
      const valueReport = entry.resolvedValue ? ` · resolved ${entry.resolvedValue}` : '';
      item.textContent = `${entry.role}: ${resolution}${valueReport} · ${entry.reason}`;
      if (entry.reason.startsWith('NOT FOUND in Web') || entry.reason.startsWith('value differs from expected:')) item.className = 'outcome-failure';
      tokenList.appendChild(item);
    });
    result.errors.forEach((error) => {
      const item = document.createElement('li');
      item.textContent = `Error: ${error}`;
      item.className = 'outcome-failure';
      tokenList.appendChild(item);
    });
    if (result.collapsedTextPaths.length > 0) {
      const layoutHeading = document.createElement('h4');
      layoutHeading.textContent = 'Layout check: collapsed text layers';
      tokenSection.appendChild(layoutHeading);
      const layoutList = document.createElement('ul');
      result.collapsedTextPaths.forEach((path) => {
        const item = document.createElement('li');
        item.textContent = path;
        item.className = 'outcome-failure';
        layoutList.appendChild(item);
      });
      tokenSection.appendChild(layoutList);
    }
    tokenSection.appendChild(tokenList);
    modalExtraEl.appendChild(tokenSection);
  }
  renderBatchSummary(exportSourceLabel, outcomes);
};

// ---------------------------------------------------------------------------
// Editor (right pane, Components tab)
// ---------------------------------------------------------------------------

type RichFieldKey =
  | 'purpose'
  | 'whenToUse'
  | 'whenNotToUse'
  | 'responsive'
  | 'accessibility'
  | 'contentGuidance'
  | 'behaviourNotes'
  | 'aiGuidance'
  | 'storybookControls';

interface FieldConfig {
  key: RichFieldKey | 'storybookPath';
  label: string;
  required: boolean;
  richText: boolean;
  placeholder: string;
}

const FIELD_CONFIGS: FieldConfig[] = [
  { key: 'purpose', label: 'Purpose', required: true, richText: true, placeholder: 'What this component is for, in one or two sentences.' },
  { key: 'whenToUse', label: 'When to use', required: true, richText: true, placeholder: "Scenarios where this is the right choice." },
  { key: 'whenNotToUse', label: 'When NOT to use', required: true, richText: true, placeholder: 'Situations where you should reach for something else.' },
  { key: 'responsive', label: 'Responsive', required: false, richText: true, placeholder: 'How this adapts across breakpoints, if at all.' },
  { key: 'accessibility', label: 'Accessibility', required: true, richText: true, placeholder: 'Keyboard, screen reader and contrast notes.' },
  { key: 'contentGuidance', label: 'Content guidance', required: false, richText: true, placeholder: 'Voice, tone, character limits, truncation rules.' },
  { key: 'behaviourNotes', label: 'Behaviour notes', required: false, richText: true, placeholder: 'Wrap, truncation, max length, keyboard, tab order.' },
  { key: 'aiGuidance', label: 'AI guidance', required: false, richText: true, placeholder: "Instructions for AI tools, e.g. \"Use for the primary action on a screen. Don't build a custom button when this fits.\"" },
  { key: 'storybookPath', label: 'Storybook path', required: false, richText: false, placeholder: 'e.g. AI chat > Chat bubbles > User' },
  { key: 'storybookControls', label: 'Storybook controls', required: false, richText: true, placeholder: 'Notes on the relevant controls/args in Storybook.' },
];

const TOOLBAR_ACTIONS: Array<{ action: MarkdownAction; label: string; title: string }> = [
  { action: 'bold', label: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', title: 'Italic' },
  { action: 'strikethrough', label: 'S', title: 'Strikethrough' },
  { action: 'h1', label: 'H1', title: 'Heading' },
  { action: 'bulletList', label: '•', title: 'Bullet list' },
  { action: 'numberedList', label: '1.', title: 'Numbered list' },
  { action: 'link', label: '🔗', title: 'Link' },
  { action: 'code', label: '`', title: 'Inline code' },
  { action: 'codeBlock', label: '{ }', title: 'Code block' },
];

interface EditorState {
  source: EditorPayload | null;
  fields: ComponentDoc['fields'];
  docStatus: 'draft' | 'ready';
  syncToDescription: boolean;
  handoverConfig: NonNullable<ComponentDoc['handoverConfig']>;
  dirty: boolean;
  missingFields: Set<string>;
  previewFields: Set<string>;
}

const emptyFields = (): ComponentDoc['fields'] => ({
  purpose: '',
  whenToUse: '',
  whenNotToUse: '',
  responsive: '',
  accessibility: '',
  contentGuidance: '',
  aiGuidance: '',
  behaviourNotes: '',
  storybookPath: '',
  storybookControls: '',
  links: [],
});

const editorState: EditorState = {
  source: null,
  fields: emptyFields(),
  docStatus: 'draft',
  syncToDescription: false,
  handoverConfig: { onDark: 'auto', themes: 'auto' },
  dirty: false,
  missingFields: new Set(),
  previewFields: new Set(),
};

let pendingNavigation: { targetId: string | null; fromCanvas: boolean; payload: EditorPayload | null } | null = null;
let pendingSaveResolve: ((success: boolean) => void) | null = null;

const editorEmptyEl = document.getElementById('editor-empty') as HTMLDivElement | null;
const editorRootEl = document.getElementById('editor-root') as HTMLDivElement | null;
const editorNameEl = document.getElementById('editor-name') as HTMLHeadingElement | null;
const editorMetaEl = document.getElementById('editor-meta') as HTMLDivElement | null;
const statusPillEl = document.getElementById('editor-status-pill') as HTMLSpanElement | null;
const clearDocButton = document.getElementById('clear-doc-button') as HTMLButtonElement | null;
const guardEl = document.getElementById('editor-guard') as HTMLDivElement | null;
const guardSaveButton = document.getElementById('guard-save') as HTMLButtonElement | null;
const guardDiscardButton = document.getElementById('guard-discard') as HTMLButtonElement | null;
const guardCancelButton = document.getElementById('guard-cancel') as HTMLButtonElement | null;
const fieldsContainer = document.getElementById('editor-fields') as HTMLDivElement | null;
const linksListEl = document.getElementById('links-list') as HTMLDivElement | null;
const addLinkButton = document.getElementById('add-link') as HTMLButtonElement | null;
const syncCheckbox = document.getElementById('sync-to-description') as HTMLInputElement | null;
const handoverAxesEl = document.getElementById('handover-axes') as HTMLDivElement | null;
const handoverOnDarkSelect = document.getElementById('handover-on-dark') as HTMLSelectElement | null;
const handoverThemesSelect = document.getElementById('handover-themes') as HTMLSelectElement | null;
const prevButton = document.getElementById('editor-prev') as HTMLButtonElement | null;
const skipButton = document.getElementById('editor-skip') as HTMLButtonElement | null;
const nextButton = document.getElementById('editor-next') as HTMLButtonElement | null;
const requiredProgressEl = document.getElementById('required-progress') as HTMLSpanElement | null;
const unsavedLabelEl = document.getElementById('unsaved-label') as HTMLSpanElement | null;
const moveToDraftButton = document.getElementById('move-to-draft') as HTMLButtonElement | null;
const saveDraftButton = document.getElementById('save-draft') as HTMLButtonElement | null;
const savePrimaryButton = document.getElementById('save-primary') as HTMLButtonElement | null;
const generateHandoverButton = document.getElementById('generate-handover') as HTMLButtonElement | null;

const STATUS_PILL_LABEL: Record<string, string> = {
  documented: 'Documented',
  draft: 'Draft',
  missing: 'Not documented',
};

const markDirty = () => {
  editorState.dirty = true;
};

const renderInline = (nodes: InlineNode[]): (Node | string)[] =>
  nodes.flatMap<Node | string>((node) => {
    switch (node.type) {
      case 'text':
        return [node.value];
      case 'bold': {
        const el = document.createElement('strong');
        el.append(...renderInline(node.children));
        return [el];
      }
      case 'italic': {
        const el = document.createElement('em');
        el.append(...renderInline(node.children));
        return [el];
      }
      case 'strikethrough': {
        const el = document.createElement('s');
        el.append(...renderInline(node.children));
        return [el];
      }
      case 'code': {
        const el = document.createElement('code');
        el.textContent = node.value;
        return [el];
      }
      case 'link': {
        const el = document.createElement('a');
        el.href = node.href;
        el.target = '_blank';
        el.rel = 'noreferrer';
        el.append(...renderInline(node.children));
        return [el];
      }
      default:
        return [];
    }
  });

const renderPreview = (container: HTMLElement, source: string) => {
  container.innerHTML = '';
  const blocks: BlockNode[] = parseMarkdown(source);

  if (blocks.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Nothing to preview yet.';
    container.appendChild(empty);
    return;
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      const el = document.createElement('h1');
      el.append(...renderInline(block.children));
      container.appendChild(el);
    } else if (block.type === 'paragraph') {
      const el = document.createElement('p');
      el.append(...renderInline(block.children));
      container.appendChild(el);
    } else if (block.type === 'bulletList') {
      const el = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        li.append(...renderInline(item));
        el.appendChild(li);
      }
      container.appendChild(el);
    } else if (block.type === 'numberedList') {
      const el = document.createElement('ol');
      for (const item of block.items) {
        const li = document.createElement('li');
        li.append(...renderInline(item));
        el.appendChild(li);
      }
      container.appendChild(el);
    } else if (block.type === 'codeBlock') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.value;
      pre.appendChild(code);
      container.appendChild(pre);
    }
  }
};

const buildField = (config: FieldConfig): HTMLElement => {
  const fieldEl = document.createElement('div');
  fieldEl.className = 'field';
  fieldEl.dataset.field = config.key;
  if (editorState.missingFields.has(config.key)) {
    fieldEl.classList.add('is-invalid');
  }

  const labelRow = document.createElement('div');
  labelRow.className = 'field-label-row';

  const label = document.createElement('label');
  label.textContent = config.required ? `${config.label} *` : config.label;
  label.htmlFor = `field-${config.key}`;
  labelRow.appendChild(label);

  if (config.richText) {
    const previewToggle = document.createElement('button');
    previewToggle.type = 'button';
    previewToggle.className = 'link-button';
    const inPreview = editorState.previewFields.has(config.key);
    previewToggle.textContent = inPreview ? 'Edit' : 'Preview';
    previewToggle.addEventListener('click', () => {
      if (editorState.previewFields.has(config.key)) {
        editorState.previewFields.delete(config.key);
      } else {
        editorState.previewFields.add(config.key);
      }
      renderEditor();
    });
    labelRow.appendChild(previewToggle);
  }

  fieldEl.appendChild(labelRow);

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = config.placeholder;
  fieldEl.appendChild(hint);

  const value = (editorState.fields[config.key as keyof ComponentDoc['fields']] as string) ?? '';

  if (config.richText && editorState.previewFields.has(config.key)) {
    const preview = document.createElement('div');
    preview.className = 'preview';
    renderPreview(preview, value);
    fieldEl.appendChild(preview);
  } else {
    if (config.richText) {
      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      for (const item of TOOLBAR_ACTIONS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = item.title;
        button.textContent = item.label;
        button.addEventListener('click', () => {
          const textarea = fieldEl.querySelector('textarea') as HTMLTextAreaElement | null;
          if (!textarea) return;
          const result = applyMarkdownAction(item.action, {
            value: textarea.value,
            start: textarea.selectionStart ?? 0,
            end: textarea.selectionEnd ?? 0,
          });
          (editorState.fields as Record<string, unknown>)[config.key] = result.value;
          if (editorState.missingFields.delete(config.key)) {
            fieldEl.classList.remove('is-invalid');
            fieldEl.querySelector('.field-error')?.remove();
          }
          markDirty();
          textarea.value = result.value;
          textarea.focus();
          textarea.setSelectionRange(result.start, result.end);
          updateFooterStatus();
        });
        toolbar.appendChild(button);
      }
      fieldEl.appendChild(toolbar);
    }

    if (config.richText) {
      const textarea = document.createElement('textarea');
      textarea.id = `field-${config.key}`;
      textarea.value = value;
      textarea.rows = 3;
      textarea.addEventListener('input', () => {
        (editorState.fields as Record<string, unknown>)[config.key] = textarea.value;
        if (editorState.missingFields.delete(config.key)) {
          fieldEl.classList.remove('is-invalid');
          fieldEl.querySelector('.field-error')?.remove();
        }
        markDirty();
        updateFooterStatus();
      });
      fieldEl.appendChild(textarea);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = `field-${config.key}`;
      input.value = value;
      input.addEventListener('input', () => {
        (editorState.fields as Record<string, unknown>)[config.key] = input.value;
        if (editorState.missingFields.delete(config.key)) {
          fieldEl.classList.remove('is-invalid');
          fieldEl.querySelector('.field-error')?.remove();
        }
        markDirty();
        updateFooterStatus();
      });
      fieldEl.appendChild(input);
    }
  }

  if (editorState.missingFields.has(config.key)) {
    const error = document.createElement('p');
    error.className = 'field-error';
    error.textContent = 'This field is required to mark the component as Ready.';
    fieldEl.appendChild(error);
  }

  return fieldEl;
};

const isHttpsUrl = (url: string) => /^https:\/\/.+/i.test(url.trim());

const buildLinkRow = (link: ComponentDocLink, index: number): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'link-row';
  if (link.url && !isHttpsUrl(link.url)) {
    row.classList.add('is-invalid');
  }

  const labelInput = document.createElement('input');
  labelInput.className = 'link-label';
  labelInput.type = 'text';
  labelInput.placeholder = 'Label (e.g. Storybook)';
  labelInput.value = link.label;
  labelInput.addEventListener('input', () => {
    editorState.fields.links[index] = { ...editorState.fields.links[index], label: labelInput.value };
    markDirty();
    updateFooterStatus();
  });

  const urlInput = document.createElement('input');
  urlInput.className = 'link-url';
  urlInput.type = 'text';
  urlInput.placeholder = 'https://…';
  urlInput.value = link.url;
  urlInput.addEventListener('input', () => {
    editorState.fields.links[index] = { ...editorState.fields.links[index], url: urlInput.value };
    markDirty();
    updateFooterStatus();
    row.classList.toggle('is-invalid', urlInput.value.length > 0 && !isHttpsUrl(urlInput.value));
  });

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'link-row-remove';
  removeButton.textContent = '✕';
  removeButton.title = 'Remove link';
  removeButton.addEventListener('click', () => {
    editorState.fields.links.splice(index, 1);
    markDirty();
    renderEditor();
  });

  row.append(labelInput, urlInput, removeButton);
  return row;
};

const REQUIRED_FIELD_CONFIGS = FIELD_CONFIGS.filter((config) => config.required);

const requiredMissingKeys = (): string[] =>
  REQUIRED_FIELD_CONFIGS.filter((config) => !(editorState.fields[config.key as keyof ComponentDoc['fields']] as string)?.trim()).map(
    (config) => config.key,
  );

const scrollToField = (key: string) => {
  const fieldEl = fieldsContainer?.querySelector<HTMLElement>(`[data-field="${key}"]`);
  if (!fieldEl) return;
  fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  fieldEl.querySelector<HTMLElement>('textarea, input')?.focus();
};

/** Updates the footer status row (progress/unsaved label/move-to-draft/primary label) without rebuilding the fields. */
const updateFooterStatus = () => {
  const missing = requiredMissingKeys().length;
  const done = REQUIRED_FIELD_CONFIGS.length - missing;
  if (requiredProgressEl) {
    requiredProgressEl.textContent = `${done} of ${REQUIRED_FIELD_CONFIGS.length} required fields complete`;
  }
  if (unsavedLabelEl) unsavedLabelEl.hidden = !editorState.dirty;
  if (moveToDraftButton) moveToDraftButton.hidden = editorState.docStatus !== 'ready';
  if (savePrimaryButton) savePrimaryButton.textContent = editorState.docStatus === 'ready' ? 'Save' : 'Mark as ready';
};

const renderHandoverAxes = (variantProperties: Array<{ name: string; options: string[] }>) => {
  if (!handoverAxesEl) return;
  handoverAxesEl.innerHTML = '';
  const axes = editorState.handoverConfig.axes ?? {};
  const labels = editorState.handoverConfig.labels ?? {};
  for (const property of variantProperties) {
    const displayName = property.name.replace(/#.*$/, '');
    const row = document.createElement('div');
    row.className = 'handover-axis-row';

    const axisRow = document.createElement('div');
    axisRow.className = 'handover-axis-title';
    const axisLabel = document.createElement('label');
    axisLabel.textContent = displayName;
    const select = document.createElement('select');
    select.append(new Option('Auto', 'auto'), new Option('Columns', 'columns'), new Option('Rows', 'rows'));
    select.value = axes[property.name] ?? 'auto';
    select.addEventListener('change', () => {
      editorState.handoverConfig.axes = { ...(editorState.handoverConfig.axes ?? {}), [property.name]: select.value as 'auto' | 'columns' | 'rows' };
      markDirty();
      updateFooterStatus();
    });
    axisLabel.appendChild(select);
    axisRow.appendChild(axisLabel);

    const reverseLabel = document.createElement('label');
    reverseLabel.className = 'checkbox-label';
    const reverseCheckbox = document.createElement('input');
    reverseCheckbox.type = 'checkbox';
    reverseCheckbox.checked = Boolean(editorState.handoverConfig.reverse?.[property.name]);
    reverseCheckbox.addEventListener('change', () => {
      editorState.handoverConfig.reverse = { ...(editorState.handoverConfig.reverse ?? {}), [property.name]: reverseCheckbox.checked };
      markDirty();
      updateFooterStatus();
    });
    reverseLabel.append(reverseCheckbox, document.createTextNode('Reverse order'));
    axisRow.appendChild(reverseLabel);
    row.appendChild(axisRow);

    const labelsGrid = document.createElement('div');
    labelsGrid.className = 'handover-axis-labels';
    for (const option of property.options) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `${displayName} (${option})`;
      input.value = labels[`${property.name}=${option}`] ?? '';
      input.addEventListener('input', () => {
        const key = `${property.name}=${option}`;
        const next = { ...(editorState.handoverConfig.labels ?? {}) };
        if (input.value.trim()) next[key] = input.value;
        else delete next[key];
        editorState.handoverConfig.labels = next;
        markDirty();
        updateFooterStatus();
      });
      labelsGrid.appendChild(input);
    }
    row.appendChild(labelsGrid);
    handoverAxesEl.appendChild(row);
  }
};

const renderEditor = () => {
  if (!editorRootEl || !editorEmptyEl) return;

  if (!editorState.source) {
    editorRootEl.hidden = true;
    editorEmptyEl.hidden = false;
    return;
  }

  editorEmptyEl.hidden = true;
  editorRootEl.hidden = false;

  const { source } = editorState;

  if (editorNameEl) editorNameEl.textContent = source.name;
  if (editorMetaEl) {
    const typeLabel = source.type === 'COMPONENT_SET' ? 'Component set' : 'Component';
    editorMetaEl.textContent = `${typeLabel} · ${source.variantCount} variant${source.variantCount === 1 ? '' : 's'} · ${source.group}`;
  }
  if (statusPillEl) {
    statusPillEl.className = `status-pill status-${source.status}`;
    statusPillEl.textContent = STATUS_PILL_LABEL[source.status] ?? source.status;
  }
  if (clearDocButton) clearDocButton.hidden = source.status === 'missing';

  if (fieldsContainer) {
    fieldsContainer.innerHTML = '';
    for (const config of FIELD_CONFIGS) {
      fieldsContainer.appendChild(buildField(config));
    }
  }

  if (linksListEl) {
    linksListEl.innerHTML = '';
    editorState.fields.links.forEach((link, index) => {
      linksListEl.appendChild(buildLinkRow(link, index));
    });
  }

  if (syncCheckbox) syncCheckbox.checked = editorState.syncToDescription;
  renderHandoverAxes(source.variantProperties ?? []);
  if (handoverOnDarkSelect) handoverOnDarkSelect.value = editorState.handoverConfig.onDark ?? 'auto';
  if (handoverThemesSelect) handoverThemesSelect.value = editorState.handoverConfig.themes ?? 'auto';

  updateFooterStatus();

  const flatList = getFilteredFlatList();
  const currentIndex = flatList.findIndex((item) => item.id === source.id);
  if (prevButton) prevButton.disabled = currentIndex <= 0;
  if (nextButton) nextButton.disabled = currentIndex === -1 || currentIndex >= flatList.length - 1;
};

const applyEditorPayload = (payload: EditorPayload | null) => {
  editorState.source = payload;
  editorState.fields = payload ? JSON.parse(JSON.stringify(payload.doc.fields)) : emptyFields();
  editorState.docStatus = payload?.doc.status ?? 'draft';
  editorState.syncToDescription = Boolean(payload?.doc.syncToDescription);
  editorState.handoverConfig = {
    axes: { ...(payload?.doc.handoverConfig?.axes ?? {}) },
    labels: { ...(payload?.doc.handoverConfig?.labels ?? {}) },
    reverse: { ...(payload?.doc.handoverConfig?.reverse ?? {}) },
    onDark: payload?.doc.handoverConfig?.onDark ?? 'auto',
    themes: payload?.doc.handoverConfig?.themes ?? 'auto',
  };
  editorState.dirty = false;
  editorState.missingFields.clear();
  editorState.previewFields.clear();
  state.selectedId = payload?.id ?? null;
  renderEditor();
  renderTree();
};

const showGuard = (reason: string) => {
  if (!guardEl) return;
  guardEl.hidden = false;
  console.log('[ui] guard banner', true, reason);
};

const hideGuard = (reason: string) => {
  if (!guardEl) return;
  guardEl.hidden = true;
  console.log('[ui] guard banner', false, reason);
};

/** Routes UI-initiated navigation (row click / prev / next) through the unsaved-changes guard. */
const requestNavigateTo = (id: string) => {
  if (editorState.dirty) {
    pendingNavigation = { targetId: id, fromCanvas: false, payload: null };
    showGuard('navigate-away-dirty');
    renderEditor();
    return;
  }
  post({ type: 'SELECT_NODE', id });
};

const handleEditorOpen = (payload: EditorPayload | null) => {
  if (!payload) {
    if (!editorState.dirty) applyEditorPayload(null);
    return;
  }

  if (editorState.dirty && editorState.source && editorState.source.id !== payload.id) {
    pendingNavigation = { targetId: null, fromCanvas: true, payload };
    showGuard('canvas-selection-dirty');
    renderEditor();
    return;
  }

  applyEditorPayload(payload);
};

const performSave = (status: 'draft' | 'ready'): Promise<boolean> => {
  if (!editorState.source) return Promise.resolve(false);

  if (status === 'ready') {
    const missing = requiredMissingKeys();
    if (missing.length > 0) {
      editorState.missingFields = new Set(missing);
      renderEditor();
      scrollToField(missing[0]);
      return Promise.resolve(false);
    }
  }

  const invalidLink = editorState.fields.links.find((link) => link.url && !isHttpsUrl(link.url));
  if (invalidLink) {
    renderEditor();
    return Promise.resolve(false);
  }

  editorState.docStatus = status;
  const id = editorState.source.id;
  return new Promise((resolve) => {
    pendingSaveResolve = resolve;
    post({
      type: 'SAVE_DOC',
      payload: {
        id,
        fields: editorState.fields,
        status,
        syncToDescription: editorState.syncToDescription,
        handoverConfig: editorState.handoverConfig,
      },
    });
  });
};

const updateItemStatus = (id: string, status: ComponentListItem['status']) => {
  for (const group of state.groups) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) {
      item.status = status;
      break;
    }
  }
};

const handleSaveResult = (payload: SaveResultPayload) => {
  if (pendingSaveResolve) {
    const resolve = pendingSaveResolve;
    pendingSaveResolve = null;
    resolve(payload.success);
  }

  if (!payload.success) {
    if (payload.missingFields) {
      editorState.missingFields = new Set(payload.missingFields);
    }
    renderEditor();
    return;
  }

  editorState.dirty = false;
  editorState.missingFields.clear();
  if (editorState.source && editorState.source.id === payload.id && payload.status) {
    editorState.source = { ...editorState.source, status: payload.status };
  }
  if (payload.status) {
    updateItemStatus(payload.id, payload.status);
  }
  renderEditor();
  renderTree();
};

/** Resets in-memory editor/list state after a component's doc has been cleared. */
const resetClearedState = (id: string) => {
  updateItemStatus(id, 'missing');
  state.checked.delete(id);
  if (editorState.source && editorState.source.id === id) {
    editorState.source = { ...editorState.source, status: 'missing' };
    editorState.fields = emptyFields();
    editorState.docStatus = 'draft';
    editorState.syncToDescription = false;
    editorState.dirty = false;
    editorState.missingFields.clear();
  }
};

const handleClearDocResult = (payload: { id: string; success: boolean; message?: string }) => {
  if (!payload.success) {
    console.error('[ui] clear doc failed', payload.message);
    if (exportSourceLabel) {
      exportSourceLabel.textContent = payload.message ?? 'Couldn’t clear documentation';
      exportSourceLabel.classList.add('outcome-failure');
    }
    return;
  }
  resetClearedState(payload.id);
  renderBatchSummary(exportSourceLabel, [{ label: 'Cleared', count: 1 }]);
  renderEditor();
  renderTree();
};

const handleClearDocsResult = (results: Array<{ id: string; success: boolean; message?: string }>) => {
  let successCount = 0;
  for (const result of results) {
    if (result.success) {
      successCount += 1;
      resetClearedState(result.id);
    } else {
      console.error('[ui] bulk clear failed', result.id, result.message);
    }
  }

  const failedCount = results.length - successCount;
  renderBatchSummary(exportSourceLabel, [
    { label: 'Cleared', count: successCount },
    { label: "Couldn't clear", count: failedCount, danger: true },
  ]);

  renderEditor();
  renderTree();
};

clearDocButton?.addEventListener('click', () => {
  if (!editorState.source) return;
  const { id, name } = editorState.source;

  openConfirmModal({
    title: `Clear documentation for ${name}?`,
    body: "This removes all documentation fields, links and status from this component. It can't be undone from the plugin.",
    confirmLabel: 'Clear documentation',
    onConfirm: () => {
      post({ type: 'CLEAR_DOC', id });
    },
  });
});

const continuePendingNavigation = () => {
  const pending = pendingNavigation;
  pendingNavigation = null;
  hideGuard('navigation-resolved');
  if (!pending) return;

  if (pending.fromCanvas) {
    applyEditorPayload(pending.payload);
  } else if (pending.targetId) {
    post({ type: 'SELECT_NODE', id: pending.targetId });
  }
};

guardSaveButton?.addEventListener('click', () => {
  void performSave(editorState.docStatus).then((success) => {
    if (success) continuePendingNavigation();
  });
});

guardDiscardButton?.addEventListener('click', () => {
  editorState.dirty = false;
  continuePendingNavigation();
});

guardCancelButton?.addEventListener('click', () => {
  const pending = pendingNavigation;
  pendingNavigation = null;
  hideGuard('cancelled');
  // Canvas selection already moved; re-select the node still being edited to revert it.
  if (pending?.fromCanvas && editorState.source) {
    post({ type: 'SELECT_NODE', id: editorState.source.id });
  }
  renderEditor();
});

addLinkButton?.addEventListener('click', () => {
  editorState.fields.links.push({ label: '', url: '' });
  markDirty();
  renderEditor();
});

moveToDraftButton?.addEventListener('click', () => {
  editorState.docStatus = 'draft';
  markDirty();
  updateFooterStatus();
});

syncCheckbox?.addEventListener('change', () => {
  editorState.syncToDescription = syncCheckbox.checked;
  markDirty();
  updateFooterStatus();
});

handoverOnDarkSelect?.addEventListener('change', () => {
  editorState.handoverConfig.onDark = handoverOnDarkSelect.value as 'auto' | 'off';
  markDirty();
  updateFooterStatus();
});

handoverThemesSelect?.addEventListener('change', () => {
  editorState.handoverConfig.themes = handoverThemesSelect.value as 'auto' | 'off';
  markDirty();
  updateFooterStatus();
});

saveDraftButton?.addEventListener('click', () => {
  void performSave('draft');
});

generateHandoverButton?.addEventListener('click', () => {
  if (editorState.source) requestHandoverGeneration([editorState.source.id]);
});

savePrimaryButton?.addEventListener('click', () => {
  void performSave('ready');
});

prevButton?.addEventListener('click', () => {
  const flatList = getFilteredFlatList();
  const index = editorState.source ? flatList.findIndex((item) => item.id === editorState.source!.id) : -1;
  if (index > 0) requestNavigateTo(flatList[index - 1].id);
});

nextButton?.addEventListener('click', () => {
  const flatList = getFilteredFlatList();
  const index = editorState.source ? flatList.findIndex((item) => item.id === editorState.source!.id) : -1;
  if (index >= 0 && index < flatList.length - 1) requestNavigateTo(flatList[index + 1].id);
});

skipButton?.addEventListener('click', () => {
  // Skip deliberately bypasses the unsaved-changes guard: move on without documenting this one.
  editorState.dirty = false;
  const flatList = getFilteredFlatList();
  const index = editorState.source ? flatList.findIndex((item) => item.id === editorState.source!.id) : -1;
  if (index >= 0 && index < flatList.length - 1) {
    post({ type: 'SELECT_NODE', id: flatList[index + 1].id });
  }
});

window.addEventListener('keydown', (event) => {
  const isCmd = event.metaKey || event.ctrlKey;
  if (!isCmd || event.key !== 'Enter') return;
  event.preventDefault();

  if (event.shiftKey) {
    void performSave('ready').then((success) => {
      if (!success) return;
      const flatList = getFilteredFlatList();
      const index = editorState.source ? flatList.findIndex((item) => item.id === editorState.source!.id) : -1;
      if (index >= 0 && index < flatList.length - 1) {
        post({ type: 'SELECT_NODE', id: flatList[index + 1].id });
      }
    });
  } else {
    void performSave('ready');
  }
});

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
    case 'TOKEN_CATALOGUE_RESULT': {
      renderOutput(message.payload);
      if (tokenCatalogueNote) tokenCatalogueNote.hidden = false;
      updateSummary('Token catalogue ready');
      break;
    }
    case 'GENERATE_HANDOVER_PREVIEW': {
      showHandoverPreview(message.payload);
      break;
    }
    case 'GENERATE_HANDOVER_PROGRESS': {
      updateProgressModal(message.payload.done, message.payload.total, message.payload.name);
      break;
    }
    case 'GENERATE_HANDOVER_RESULT': {
      completeProgressModal(() => showHandoverResult(message.payload));
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
    case 'EDITOR_OPEN': {
      handleEditorOpen(message.payload);
      break;
    }
    case 'SAVE_RESULT': {
      handleSaveResult(message.payload);
      break;
    }
    case 'CLEAR_DOC_RESULT': {
      handleClearDocResult(message.payload);
      break;
    }
    case 'CLEAR_DOCS_PROGRESS': {
      updateProgressModal(message.payload.done, message.payload.total, message.payload.name);
      break;
    }
    case 'CLEAR_DOCS_RESULT': {
      completeProgressModal(() => {
        handleClearDocsResult(message.payload.results);
        closeModal();
      });
      break;
    }
    case 'EXPORT_DATA': {
      showExportContent(message.payload);
      break;
    }
    case 'EXPORT_ERROR': {
      if (progressModalLocked) completeProgressModal(() => closeModal());
      if (exportSourceLabel) {
        exportSourceLabel.textContent = message.payload.message;
        exportSourceLabel.classList.add('outcome-failure');
      }
      break;
    }
    case 'IMPORT_PREVIEW': {
      showImportPreview(message.payload);
      break;
    }
    case 'IMPORT_PROGRESS': {
      updateProgressModal(message.payload.done, message.payload.total, message.payload.name);
      if (exportSourceLabel) {
        exportSourceLabel.classList.remove('outcome-failure');
        exportSourceLabel.textContent = `Importing ${message.payload.done} of ${message.payload.total}…`;
      }
      break;
    }
    case 'IMPORT_RESULT': {
      completeProgressModal(() => showImportResult(message.payload));
      break;
    }
    case 'EXPORT_PROGRESS': {
      updateProgressModal(message.payload.done, message.payload.total, message.payload.name);
      break;
    }
  }
});

console.log('[ui] sent UI_READY');
post({ type: 'UI_READY' });
