import uiHtml from './generated/ui-embed';
import type { PluginToUIMessage, UIToPluginMessage } from './messages';
import { inspectSelectionNode } from './inspect';
import { scanComponents } from './scan';
import type { ScanResult, ScanScope } from './scan';

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

const emitSelectedInfo = () => {
  const node = figma.currentPage.selection[0] ?? null;
  sendToUI({
    type: 'SELECTED_INFO',
    payload: node ? { id: node.id, name: node.name, type: node.type } : null,
  });
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
          emitSelectedInfo();
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
      emitSelectedInfo();
      scheduleSelectionRescan();
    }
  } catch (error) {
    console.error('[main] selectionchange handler error', error);
  }
});
