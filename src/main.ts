import uiHtml from './generated/ui-embed';
import type { EditorPayload, PluginToUIMessage, SaveDocPayload, UIToPluginMessage } from './messages';
import { inspectSelectionNode } from './inspect';
import { scanComponents, getGroupLabelForNode } from './scan';
import type { ScanResult, ScanScope } from './scan';
import { resolveDocumentableNode, type DocumentableNode } from './store/resolveComponent';
import { getOrCreateDoc, getDocStatus, readComponentDoc, writeComponentDoc, buildDescriptionMarkdown } from './store/docStatus';
import { PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_DOC_KEY, REQUIRED_FIELDS, type ComponentDoc } from './store/types';

const sendToUI = (message: PluginToUIMessage) => {
  figma.ui.postMessage(message);
};

figma.showUI(uiHtml, {
  width: 1200,
  height: 760,
  themeColors: true,
});

let uiReady = false;

const emitSelectionData = async () => {
  try {
    console.log('[main] inspect start');
    const selectedNode = figma.currentPage.selection[0] ?? null;
    const payload = await inspectSelectionNode(selectedNode);

    sendToUI({
      type: 'INSPECT_RESULT',
      payload,
    });
    console.log('[main] inspect end');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? error.stack : null;

    console.error('[main] inspect flow error', error);
    sendToUI({
      type: 'INSPECT_RESULT',
      payload: {
        error: message,
        meta: {
          errors: stack ? [message, stack] : [message],
        },
      },
    });
  }
};

const buildEditorPayload = (node: DocumentableNode): EditorPayload => ({
  id: node.id,
  name: node.name,
  fullName: node.name,
  type: node.type,
  variantCount: node.type === 'COMPONENT_SET' ? node.children.length : 1,
  group: getGroupLabelForNode(node),
  status: getDocStatus(node),
  doc: getOrCreateDoc(node),
});

const emitEditorForSelection = async () => {
  try {
    const selected = figma.currentPage.selection[0] ?? null;
    const resolved = await resolveDocumentableNode(selected);
    sendToUI({ type: 'EDITOR_OPEN', payload: resolved ? buildEditorPayload(resolved) : null });
  } catch (error) {
    console.error('[main] emitEditorForSelection failed', error);
  }
};

/** True when every field is blank and there are no links — used to treat an empty Save draft as a clear. */
const isDocEmpty = (fields: ComponentDoc['fields']): boolean =>
  fields.links.length === 0 &&
  Object.entries(fields).every(([key, value]) => key === 'links' || !(value as string)?.trim());

/** Clears sharedPluginData, and the description too if it still matches what Sync-to-description last wrote. */
const clearDocForNode = (node: DocumentableNode) => {
  const existing = readComponentDoc(node);
  if (existing?.syncToDescription) {
    const expected = buildDescriptionMarkdown(existing.fields);
    if (node.description === expected) {
      node.description = '';
    }
  }
  // An empty string removes the sharedPluginData key entirely.
  node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_DOC_KEY, '');
};

const resolveClearableNode = async (
  id: string,
): Promise<{ node: DocumentableNode } | { error: string }> => {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.removed || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')) {
    return { error: 'Component no longer exists.' };
  }
  if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') {
    return { error: 'Cannot clear documentation on a variant; select its component set.' };
  }
  return { node };
};

const handleClearDoc = async (id: string) => {
  try {
    const resolved = await resolveClearableNode(id);
    if ('error' in resolved) {
      sendToUI({ type: 'CLEAR_DOC_RESULT', payload: { id, success: false, message: resolved.error } });
      return;
    }
    clearDocForNode(resolved.node);
    sendToUI({ type: 'CLEAR_DOC_RESULT', payload: { id, success: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[main] clear doc failed', error);
    sendToUI({ type: 'CLEAR_DOC_RESULT', payload: { id, success: false, message } });
  }
};

const handleClearDocsBulk = async (ids: string[]) => {
  const results: Array<{ id: string; success: boolean; message?: string }> = [];

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    try {
      const resolved = await resolveClearableNode(id);
      if ('error' in resolved) {
        results.push({ id, success: false, message: resolved.error });
      } else {
        clearDocForNode(resolved.node);
        results.push({ id, success: true });
      }
    } catch (error) {
      results.push({ id, success: false, message: error instanceof Error ? error.message : String(error) });
    }

    sendToUI({ type: 'CLEAR_DOCS_PROGRESS', payload: { done: index + 1, total: ids.length } });
    // Yield between components so a large selection doesn't freeze the UI.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  sendToUI({ type: 'CLEAR_DOCS_RESULT', payload: { results } });
};

const handleSaveDoc = async (payload: SaveDocPayload) => {
  try {
    const node = await figma.getNodeByIdAsync(payload.id);
    if (!node || node.removed || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')) {
      sendToUI({ type: 'SAVE_RESULT', payload: { id: payload.id, success: false, message: 'Component no longer exists.' } });
      return;
    }

    // Never write on a variant; documentation lives on the COMPONENT_SET (or a standalone COMPONENT).
    if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') {
      sendToUI({
        type: 'SAVE_RESULT',
        payload: { id: payload.id, success: false, message: 'Cannot save documentation on a variant; select its component set.' },
      });
      return;
    }

    if (payload.status === 'ready') {
      const missing = REQUIRED_FIELDS.filter((key) => !(payload.fields[key] as string | undefined)?.trim());
      if (missing.length > 0) {
        sendToUI({
          type: 'SAVE_RESULT',
          payload: {
            id: payload.id,
            success: false,
            missingFields: missing,
            message: 'Fill in the required fields before marking as Ready.',
          },
        });
        return;
      }
    }

    // An empty draft (no fields, no links) is the same as "never documented"; don't persist it.
    if (payload.status === 'draft' && isDocEmpty(payload.fields)) {
      clearDocForNode(node);
      sendToUI({ type: 'SAVE_RESULT', payload: { id: payload.id, success: true, status: getDocStatus(node) } });
      return;
    }

    const existing = readComponentDoc(node);
    const doc: ComponentDoc = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: figma.currentUser?.name ?? undefined,
      status: payload.status,
      fields: payload.fields,
      handover: existing?.handover,
      syncToDescription: payload.syncToDescription,
    };

    writeComponentDoc(node, doc);

    if (payload.syncToDescription) {
      node.description = buildDescriptionMarkdown(doc.fields);
    }

    sendToUI({ type: 'SAVE_RESULT', payload: { id: payload.id, success: true, status: getDocStatus(node) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[main] save doc failed', error);
    sendToUI({ type: 'SAVE_RESULT', payload: { id: payload.id, success: false, message } });
  }
};

let lastScope: ScanScope = 'page';
let scanInFlight = false;
let scanQueued = false;

/** Signature of ids/names/count used to skip re-sending the list when nothing relevant changed. */
let lastSnapshot: string | null = null;

const computeSnapshot = (result: ScanResult): string => {
  const parts: string[] = [];
  for (const group of result.groups) {
    for (const item of group.items) {
      parts.push(`${item.id}:${item.fullName}`);
    }
  }
  parts.sort();
  return `${result.scope}|${result.totalCount}|${parts.join(',')}`;
};

const runScan = async (scope: ScanScope) => {
  if (scanInFlight) {
    scanQueued = true;
    return;
  }

  scanInFlight = true;
  lastScope = scope;

  try {
    const result = await scanComponents(scope, (scannedPages, totalPages) => {
      sendToUI({ type: 'SCAN_PROGRESS', payload: { scannedPages, totalPages } });
    });
    lastSnapshot = computeSnapshot(result);
    sendToUI({ type: 'SCAN_RESULT', payload: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[main] scan error', error);
    sendToUI({ type: 'SCAN_ERROR', payload: { message } });
  } finally {
    scanInFlight = false;
    if (scanQueued) {
      scanQueued = false;
      void runScan(lastScope);
    }
  }
};

// Cheap rescan triggered by selectionchange: only scans the current page, and only
// re-sends the list to the UI when ids/names/counts actually differ from the last snapshot.
let selectionRescanTimer: ReturnType<typeof setTimeout> | null = null;

const runCheapRescan = async () => {
  if (lastScope !== 'page' || scanInFlight) return;

  try {
    const result = await scanComponents('page');
    const snapshot = computeSnapshot(result);
    if (snapshot === lastSnapshot) {
      return;
    }
    lastSnapshot = snapshot;
    console.log('[main] rescan selectionchange');
    sendToUI({ type: 'SCAN_RESULT', payload: result });
  } catch (error) {
    console.error('[main] cheap rescan failed', error);
  }
};

const scheduleSelectionRescan = () => {
  if (!uiReady) return;
  if (selectionRescanTimer) {
    clearTimeout(selectionRescanTimer);
  }
  selectionRescanTimer = setTimeout(() => {
    selectionRescanTimer = null;
    void runCheapRescan();
  }, 300);
};

let rescanTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRescanReason: string | null = null;

const scheduleRescan = (reason: string) => {
  if (!uiReady) return;
  pendingRescanReason = reason;
  if (rescanTimer) {
    clearTimeout(rescanTimer);
  }
  rescanTimer = setTimeout(() => {
    rescanTimer = null;
    console.log('[main] rescan', pendingRescanReason);
    void runScan(lastScope);
  }, 500);
};

/** True if `node` is a COMPONENT/COMPONENT_SET itself, or a descendant of one (e.g. a renamed inner layer). */
const isRelevantChange = (node: SceneNode | RemovedNode): boolean => {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    return true;
  }

  // RemovedNode has no parent chain left to walk; only its own type (checked above) is relevant.
  if (!('parent' in node)) {
    return false;
  }

  let current: BaseNode | null = node.parent;
  while (current && current.type !== 'PAGE') {
    if (current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') {
      return true;
    }
    current = current.parent;
  }

  return false;
};

const handleDocumentChangeEvent = (event: DocumentChangeEvent) => {
  const relevant = event.documentChanges.some((change) => {
    if (change.type !== 'CREATE' && change.type !== 'DELETE' && change.type !== 'PROPERTY_CHANGE') {
      return false;
    }
    return isRelevantChange(change.node);
  });

  if (relevant) {
    scheduleRescan('documentchange');
  }
};

// "All pages" scope only: figma.on("documentchange") requires loadAllPagesAsync() first, so we
// only register it once that has actually happened, and remove it again when the user switches
// back to "This page" (selectionchange + the refresh button cover that scope instead).
let documentChangeRegistered = false;

const ensureDocumentChangeListener = async () => {
  if (documentChangeRegistered) return;
  await figma.loadAllPagesAsync();
  documentChangeRegistered = true;
  figma.on('documentchange', handleDocumentChangeEvent);
};

const removeDocumentChangeListener = () => {
  if (!documentChangeRegistered) return;
  documentChangeRegistered = false;
  figma.off('documentchange', handleDocumentChangeEvent);
};

/** Walks up a node's ancestors to find the PageNode it belongs to. */
function findPageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'PAGE') {
      return current;
    }
    current = current.parent;
  }
  return null;
}

figma.ui.onmessage = (message: UIToPluginMessage) => {
  console.log('[main] message received', message?.type);
  switch (message.type) {
    case 'UI_READY': {
      uiReady = true;
      void emitSelectionData().catch((error) => {
        console.error('[main] emitSelectionData rejected on UI_READY', error);
      });
      void emitEditorForSelection();
      void runScan(lastScope);
      break;
    }
    case 'INSPECT_SELECTION': {
      void emitSelectionData().catch((error) => {
        console.error('[main] emitSelectionData rejected on INSPECT_SELECTION', error);
      });
      break;
    }
    case 'CLEAR_RESULT': {
      sendToUI({
        type: 'INSPECT_RESULT',
        payload: { message: 'Inspector cleared.' },
      });
      break;
    }
    case 'SCAN_REQUEST': {
      if (message.scope === 'all') {
        void ensureDocumentChangeListener();
      } else {
        removeDocumentChangeListener();
      }
      void runScan(message.scope);
      break;
    }
    case 'REFRESH_LIST': {
      void runScan(lastScope);
      break;
    }
    case 'SAVE_DOC': {
      void handleSaveDoc(message.payload);
      break;
    }
    case 'CLEAR_DOC': {
      void handleClearDoc(message.id);
      break;
    }
    case 'CLEAR_DOCS_BULK': {
      void handleClearDocsBulk(message.ids);
      break;
    }
    case 'SELECT_NODE': {
      void (async () => {
        try {
          const node = await figma.getNodeByIdAsync(message.id);
          if (!node || node.removed || !('type' in node) || node.type === 'PAGE' || node.type === 'DOCUMENT') {
            return;
          }

          const sceneNode = node as SceneNode;
          const page = findPageOf(sceneNode);
          if (page && page.id !== figma.currentPage.id) {
            await figma.setCurrentPageAsync(page);
          }

          figma.currentPage.selection = [sceneNode];
          figma.viewport.scrollAndZoomIntoView([sceneNode]);
          void emitEditorForSelection();
        } catch (error) {
          console.error('[main] SELECT_NODE failed', error);
        }
      })();
      break;
    }
  }
};

figma.on('selectionchange', () => {
  try {
    console.log('[main] selectionchange', figma.currentPage.name, figma.currentPage.selection.length, figma.currentPage.selection.map((n) => `${n.type}:${n.name}`));
    if (uiReady) {
      void emitSelectionData().catch((error) => {
        console.error('[main] emitSelectionData rejected on selectionchange', error);
      });
      void emitEditorForSelection();
      scheduleSelectionRescan();
    }
  } catch (error) {
    console.error('[main] selectionchange handler error', error);
  }
});
