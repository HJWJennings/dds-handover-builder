import { PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_DOC_KEY, REQUIRED_FIELDS, type ComponentDoc } from './types';

export type DocStatus = 'documented' | 'draft' | 'missing';

/** Node types that can carry a ComponentDoc (COMPONENT_SET or standalone COMPONENT). */
export type DocumentableNode = ComponentSetNode | ComponentNode;

export const readComponentDoc = (node: DocumentableNode): ComponentDoc | null => {
  const raw = node.getSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_DOC_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ComponentDoc;
  } catch {
    // Corrupt/unreadable data is treated as "not documented" rather than throwing.
    return null;
  }
};

export const writeComponentDoc = (node: DocumentableNode, doc: ComponentDoc): void => {
  node.setSharedPluginData(PLUGIN_DATA_NAMESPACE, PLUGIN_DATA_DOC_KEY, JSON.stringify(doc));
};

export const createEmptyDoc = (): ComponentDoc => ({
  schemaVersion: 1,
  updatedAt: new Date(0).toISOString(),
  status: 'draft',
  fields: {
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
  },
  syncToDescription: false,
});

export const getOrCreateDoc = (node: DocumentableNode): ComponentDoc => readComponentDoc(node) ?? createEmptyDoc();

/** Condensed Purpose + When to use + AI guidance, truncated to ~1000 chars, for the node description. */
export const buildDescriptionMarkdown = (fields: ComponentDoc['fields']): string => {
  const combined = [fields.purpose, fields.whenToUse, fields.aiGuidance]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n\n');

  return combined.length > 1000 ? `${combined.slice(0, 997)}...` : combined;
};

export const getDocStatus = (node: DocumentableNode): DocStatus => {
  const doc = readComponentDoc(node);
  if (!doc) {
    return 'missing';
  }

  const requiredFilled = REQUIRED_FIELDS.every((key) => Boolean((doc.fields?.[key] as string | undefined)?.trim()));
  if (doc.status === 'ready' && requiredFilled) {
    return 'documented';
  }

  return 'draft';
};
