import uiHtml from './generated/ui-embed';
import type { EditorPayload, ExportFormat, ImportPreviewEntry, ImportPreviewPayload, ImportResultEntry, PluginToUIMessage, SaveDocPayload, UIToPluginMessage } from './messages';
import { getComponentPropertyDefinitions, inspectSelectionNode } from './inspect';
import { scanComponents, getGroupLabelForNode } from './scan';
import type { ScanResult, ScanScope } from './scan';
import { resolveDocumentableNode, type DocumentableNode } from './store/resolveComponent';
import { getOrCreateDoc, getDocStatus, readComponentDoc, writeComponentDoc, buildDescriptionMarkdown } from './store/docStatus';
import { PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_DOC_KEY, REQUIRED_FIELDS, type ComponentDoc } from './store/types';
import { serializeCsv } from './export/csv';
import { serializeJson } from './export/json';
import { parseImportEnvelope, validateComponentDoc, type ImportComponentRecord } from './export/import';

const sendToUI = (message: PluginToUIMessage) => {
  figma.ui.postMessage(message);
};

figma.showUI(uiHtml, {
  width: 1200,
  height: 760,
  themeColors: true,
});

let uiReady = false;
let devTabActive = false;

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
  const progressStartedAt = Date.now();
  const results: Array<{ id: string; success: boolean; message?: string }> = [];

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    let name = id;
    try {
      const resolved = await resolveClearableNode(id);
      if ('error' in resolved) {
        results.push({ id, success: false, message: resolved.error });
      } else {
        name = resolved.node.name;
        clearDocForNode(resolved.node);
        results.push({ id, success: true });
      }
    } catch (error) {
      results.push({ id, success: false, message: error instanceof Error ? error.message : String(error) });
    }

    sendToUI({ type: 'CLEAR_DOCS_PROGRESS', payload: { done: index + 1, total: ids.length, name } });
    // Yield between components so a large selection doesn't freeze the UI.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await keepProgressVisible(progressStartedAt);
  sendToUI({ type: 'CLEAR_DOCS_RESULT', payload: { results } });
};

const keepProgressVisible = async (startedAt: number) => {
  const remaining = 400 - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

const makeExportFileName = (format: ExportFormat): string => {
  const fileName = figma.root.name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'figma-file';
  const date = new Date().toISOString().slice(0, 10);
  return `dds-compdoc-${fileName}-${date}.${format}`;
};

const handleExportRequest = async (format: ExportFormat, ids: string[], source: 'checked' | 'shown') => {
  try {
    const records = [];
    const showProgress = ids.length > 20;
    const progressStartedAt = Date.now();
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.removed || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')) {
        if (showProgress) sendToUI({ type: 'EXPORT_PROGRESS', payload: { done: index + 1, total: ids.length, name: id } });
        if (showProgress) await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }
      if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') {
        if (showProgress) sendToUI({ type: 'EXPORT_PROGRESS', payload: { done: index + 1, total: ids.length, name: node.name } });
        if (showProgress) await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }

      const definitions = getComponentPropertyDefinitions(node);
      const variantProperties = definitions.map((definition) => ({
        name: definition.propertyName.replace(/#.*$/, ''),
        rawName: definition.propertyName,
        type: definition.type ?? '',
        options: definition.variantOptions,
      }));
      const doc = readComponentDoc(node);
      const common = {
        name: node.name,
        group: getGroupLabelForNode(node),
        type: node.type === 'COMPONENT_SET' ? 'set' as const : 'component' as const,
        id: node.id,
        key: node.key,
        status: doc ? getDocStatus(node) : 'missing',
        doc,
      };

      records.push(format === 'csv' ? common : { ...common, variantProperties });
      if (showProgress) {
        sendToUI({ type: 'EXPORT_PROGRESS', payload: { done: index + 1, total: ids.length, name: node.name } });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    if (showProgress) await keepProgressVisible(progressStartedAt);

    const fileName = makeExportFileName(format);
    const content = format === 'csv'
      ? serializeCsv(records as Parameters<typeof serializeCsv>[0])
      : serializeJson({
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          fileName: figma.root.name,
          components: records as Parameters<typeof serializeJson>[0]['components'],
        });

    sendToUI({ type: 'EXPORT_DATA', payload: { format, fileName, content, count: records.length, source } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendToUI({ type: 'EXPORT_ERROR', payload: { message } });
  }
};

interface PlannedImport {
  outcome: ImportPreviewEntry['outcome'];
  name: string;
  nodeId?: string;
  doc?: ComponentDoc;
  existingDoc?: ComponentDoc | null;
  reason?: string;
}

const importPlans = new Map<string, PlannedImport[]>();

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

const docsAreIdentical = (left: ComponentDoc, right: ComponentDoc): boolean => {
  const comparable = (doc: ComponentDoc) => {
    const { updatedAt: _updatedAt, updatedBy: _updatedBy, ...content } = doc;
    return canonicalize(content);
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
};

const findImportTarget = (
  record: ImportComponentRecord,
  nodes: DocumentableNode[],
): DocumentableNode | null => {
  if (typeof record.key === 'string' && record.key) {
    const byKey = nodes.find((node) => node.key === record.key);
    if (byKey) return byKey;
  }
  if (typeof record.id === 'string' && record.id) {
    const byId = nodes.find((node) => node.id === record.id);
    if (byId) return byId;
  }
  if (typeof record.name === 'string' && typeof record.group === 'string') {
    return nodes.find((node) => node.name === record.name && getGroupLabelForNode(node) === record.group) ?? null;
  }
  return null;
};

const handleImportPreview = async (content: unknown) => {
  try {
    const records = parseImportEnvelope(content);
    await figma.loadAllPagesAsync();
    const nodes: DocumentableNode[] = [];
    for (const page of figma.root.children) {
      const found = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
      for (const node of found) {
        if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && node.parent?.type !== 'COMPONENT_SET')) {
          nodes.push(node);
        }
      }
    }

    const plans: PlannedImport[] = [];
    const plannedNodeIds = new Set<string>();

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] as ImportComponentRecord;
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        plans.push({ outcome: 'INVALID', name: `Entry ${index + 1}`, reason: 'Component entry must be an object.' });
        continue;
      }
      if (
        typeof record.name !== 'string' ||
        typeof record.group !== 'string' ||
        typeof record.id !== 'string' ||
        typeof record.key !== 'string' ||
        (record.type !== 'set' && record.type !== 'component')
      ) {
        plans.push({ outcome: 'INVALID', name: record.name || `Entry ${index + 1}`, reason: 'Component entry is missing valid name, group, type, id, or key fields.' });
        continue;
      }
      let doc: ComponentDoc;
      try {
        doc = validateComponentDoc(record?.doc);
      } catch (error) {
        plans.push({
          outcome: 'INVALID',
          name: typeof record?.name === 'string' && record.name ? record.name : `Entry ${index + 1}`,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const target = findImportTarget(record, nodes);
      if (!target) {
        plans.push({ outcome: 'UNMATCHED', name: record.name || `Entry ${index + 1}`, reason: 'No matching component.' });
        continue;
      }
      if (plannedNodeIds.has(target.id)) {
        plans.push({ outcome: 'INVALID', name: record.name || target.name, reason: 'Multiple import entries match the same component.' });
        continue;
      }
      plannedNodeIds.add(target.id);

      const rawExisting = target.getSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_DOC_KEY);
      const existing = readComponentDoc(target);
      const hasStoredDoc = rawExisting.length > 0;
      const outcome: PlannedImport['outcome'] = !hasStoredDoc
        ? 'NEW'
        : existing && docsAreIdentical(existing, doc)
          ? 'UNCHANGED'
          : 'DIFFERENT';
      plans.push({
        outcome,
        nodeId: target.id,
        doc,
        name: target.name,
        existingDoc: existing,
      });
    }

    const planId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    importPlans.set(planId, plans);
    const entries: ImportPreviewEntry[] = plans.map((plan) => {
      const existingDoc = plan.existingDoc;
      const fileDoc = plan.doc;
      const existingIsNewer = Boolean(
        existingDoc && fileDoc && Date.parse(existingDoc.updatedAt) > Date.parse(fileDoc.updatedAt),
      );
      return {
        id: plan.nodeId,
        name: plan.name,
        outcome: plan.outcome,
        reason: plan.reason,
        existingUpdatedAt: existingDoc?.updatedAt,
        existingUpdatedBy: existingDoc?.updatedBy,
        fileUpdatedAt: fileDoc?.updatedAt,
        fileUpdatedBy: fileDoc?.updatedBy,
        existingIsNewer,
      };
    });
    const preview: ImportPreviewPayload = {
      planId,
      fileCount: records.length,
      counts: {
        new: plans.filter((plan) => plan.outcome === 'NEW').length,
        unchanged: plans.filter((plan) => plan.outcome === 'UNCHANGED').length,
        different: plans.filter((plan) => plan.outcome === 'DIFFERENT').length,
        unmatched: plans.filter((plan) => plan.outcome === 'UNMATCHED').length,
        invalid: plans.filter((plan) => plan.outcome === 'INVALID').length,
      },
      entries,
    };
    sendToUI({ type: 'IMPORT_PREVIEW', payload: preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendToUI({ type: 'EXPORT_ERROR', payload: { message: `Import preview failed: ${message}` } });
  }
};

const handleImportConfirm = async (planId: string, choice: 'keep' | 'replace' | null) => {
  const plans = importPlans.get(planId);
  if (!plans) {
    sendToUI({ type: 'IMPORT_RESULT', payload: { added: [], replaced: [], keptExisting: [], unchanged: [], couldNotImport: [{ name: 'Import', reason: 'Preview expired. Select the file again.' }] } });
    return;
  }
  if (plans.some((plan) => plan.outcome === 'DIFFERENT') && choice === null) return;
  importPlans.delete(planId);

  const added: ImportResultEntry[] = [];
  const replaced: ImportResultEntry[] = [];
  const keptExisting: ImportResultEntry[] = [];
  const unchanged: ImportResultEntry[] = [];
  const couldNotImport: ImportResultEntry[] = [];
  const progressStartedAt = Date.now();
  let completed = 0;

  for (const plan of plans) {
    let resultEntry: ImportResultEntry = { id: plan.nodeId, name: plan.name };
    if (plan.outcome === 'UNCHANGED') {
      unchanged.push(resultEntry);
    } else if (plan.outcome === 'UNMATCHED' || plan.outcome === 'INVALID') {
      couldNotImport.push({ ...resultEntry, reason: plan.reason });
    } else if (plan.outcome === 'DIFFERENT' && choice === 'keep') {
      keptExisting.push(resultEntry);
    } else if ((plan.outcome === 'NEW' || plan.outcome === 'DIFFERENT') && plan.nodeId && plan.doc) {
      try {
        const node = await figma.getNodeByIdAsync(plan.nodeId);
        if (!node || node.removed || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') ||
          (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET')) {
          throw new Error('Target component no longer exists or is a variant.');
        }
        writeComponentDoc(node, plan.doc);
        if (plan.doc.syncToDescription) {
          node.description = buildDescriptionMarkdown(plan.doc.fields);
        }
        resultEntry = { ...resultEntry, status: getDocStatus(node) };
        if (plan.outcome === 'NEW') added.push(resultEntry);
        else replaced.push(resultEntry);
      } catch (error) {
        couldNotImport.push({ ...resultEntry, reason: error instanceof Error ? error.message : String(error) });
      }
    } else {
      couldNotImport.push({ ...resultEntry, reason: 'Import entry could not be applied.' });
    }
    completed += 1;
    sendToUI({ type: 'IMPORT_PROGRESS', payload: { done: completed, total: plans.length, name: plan.name } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await keepProgressVisible(progressStartedAt);
  sendToUI({ type: 'IMPORT_RESULT', payload: { added, replaced, keptExisting, unchanged, couldNotImport } });
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
      if (devTabActive) {
        void emitSelectionData().catch((error) => {
          console.error('[main] emitSelectionData rejected on UI_READY', error);
        });
      }
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
    case 'EXPORT_REQUEST': {
      void handleExportRequest(message.format, message.ids, message.source);
      break;
    }
    case 'IMPORT_PREVIEW_REQUEST': {
      void handleImportPreview(message.content);
      break;
    }
    case 'IMPORT_CONFIRM': {
      void handleImportConfirm(message.planId, message.choice);
      break;
    }
    case 'DEV_TAB_ACTIVE': {
      devTabActive = message.active;
      if (devTabActive) {
        void emitSelectionData().catch((error) => {
          console.error('[main] emitSelectionData rejected on DEV_TAB_ACTIVE', error);
        });
      }
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
      if (devTabActive) {
        void emitSelectionData().catch((error) => {
          console.error('[main] emitSelectionData rejected on selectionchange', error);
        });
      }
      void emitEditorForSelection();
      scheduleSelectionRescan();
    }
  } catch (error) {
    console.error('[main] selectionchange handler error', error);
  }
});
