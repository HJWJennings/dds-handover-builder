import type { ComponentDoc } from '../store/types';

export interface ImportComponentRecord {
  name: string;
  group: string;
  type: 'set' | 'component';
  id: string;
  key: string;
  doc: unknown;
}

export const parseImportEnvelope = (value: unknown): ImportComponentRecord[] => {
  if (!value || typeof value !== 'object') throw new Error('Expected a JSON object.');
  const envelope = value as { schemaVersion?: unknown; components?: unknown };
  if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.components)) {
    throw new Error('Expected an export object with schemaVersion 1 and a components array.');
  }
  return envelope.components as ImportComponentRecord[];
};

export const validateComponentDoc = (value: unknown): ComponentDoc => {
  if (!value || typeof value !== 'object') throw new Error('doc must be an object.');
  const doc = value as Record<string, unknown>;
  if (doc.schemaVersion !== 1) throw new Error('schemaVersion must be 1.');
  if (typeof doc.updatedAt !== 'string' || !doc.updatedAt) throw new Error('updatedAt must be a non-empty string.');
  if (!Number.isFinite(Date.parse(doc.updatedAt))) throw new Error('updatedAt must be a valid date string.');
  if (doc.updatedBy !== undefined && typeof doc.updatedBy !== 'string') throw new Error('updatedBy must be a string.');
  if (doc.status !== 'draft' && doc.status !== 'ready') throw new Error('status must be "draft" or "ready".');
  if (!doc.fields || typeof doc.fields !== 'object') throw new Error('fields must be an object.');

  const fields = doc.fields as Record<string, unknown>;
  const stringKeys = [
    'purpose', 'whenToUse', 'whenNotToUse', 'responsive', 'accessibility',
    'contentGuidance', 'aiGuidance', 'behaviourNotes', 'storybookPath', 'storybookControls',
  ];
  for (const key of stringKeys) {
    if (typeof fields[key] !== 'string') throw new Error(`fields.${key} must be a string.`);
  }
  if (doc.status === 'ready') {
    for (const key of ['purpose', 'whenToUse', 'whenNotToUse', 'accessibility']) {
      if (!(fields[key] as string).trim()) throw new Error(`Ready docs require fields.${key}.`);
    }
  }
  if (!Array.isArray(fields.links)) throw new Error('fields.links must be an array.');
  const links = fields.links.map((link, index) => {
    if (!link || typeof link !== 'object') throw new Error(`fields.links[${index}] must be an object.`);
    const item = link as Record<string, unknown>;
    if (typeof item.label !== 'string' || typeof item.url !== 'string') {
      throw new Error(`fields.links[${index}] must have string label and url values.`);
    }
    if (item.url && !/^https:\/\/.+/i.test(item.url.trim())) {
      throw new Error(`fields.links[${index}].url must use https.`);
    }
    return { label: item.label, url: item.url };
  });

  if (doc.syncToDescription !== undefined && typeof doc.syncToDescription !== 'boolean') {
    throw new Error('syncToDescription must be a boolean.');
  }
  if (doc.handover !== undefined) {
    if (!doc.handover || typeof doc.handover !== 'object') throw new Error('handover must be an object.');
    const handover = doc.handover as Record<string, unknown>;
    if (typeof handover.frameId !== 'string' || typeof handover.generatedAt !== 'string') {
      throw new Error('handover must contain string frameId and generatedAt values.');
    }
  }

  return {
    schemaVersion: 1,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy as string | undefined,
    status: doc.status,
    fields: {
      purpose: fields.purpose as string,
      whenToUse: fields.whenToUse as string,
      whenNotToUse: fields.whenNotToUse as string,
      responsive: fields.responsive as string,
      accessibility: fields.accessibility as string,
      contentGuidance: fields.contentGuidance as string,
      aiGuidance: fields.aiGuidance as string,
      behaviourNotes: fields.behaviourNotes as string,
      storybookPath: fields.storybookPath as string,
      storybookControls: fields.storybookControls as string,
      links,
    },
    handover: doc.handover as ComponentDoc['handover'],
    syncToDescription: doc.syncToDescription as boolean | undefined,
  };
};
