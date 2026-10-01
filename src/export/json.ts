import type { ComponentDoc } from '../store/types';

export interface JsonComponentRecord {
  name: string;
  group: string;
  type: 'set' | 'component';
  id: string;
  key: string;
  status: string;
  variantProperties: Array<{
    name: string;
    rawName: string;
    type: string;
    options: unknown[];
  }>;
  doc: ComponentDoc | null;
}

export interface JsonExportEnvelope {
  schemaVersion: 1;
  exportedAt: string;
  fileName: string;
  components: JsonComponentRecord[];
}

export const serializeJson = (exportData: JsonExportEnvelope): string => JSON.stringify(exportData, null, 2);
