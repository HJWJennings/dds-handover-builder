import type { ScanResult, ScanScope } from './scan';
import type { ComponentDoc } from './store/types';
import type { DocStatus } from './store/docStatus';

export interface EditorPayload {
  id: string;
  name: string;
  fullName: string;
  type: 'COMPONENT_SET' | 'COMPONENT';
  variantCount: number;
  group: string;
  status: DocStatus;
  doc: ComponentDoc;
}

export interface SaveDocPayload {
  id: string;
  fields: ComponentDoc['fields'];
  status: 'draft' | 'ready';
  syncToDescription: boolean;
}

export interface SaveResultPayload {
  id: string;
  success: boolean;
  status?: DocStatus;
  message?: string;
  missingFields?: string[];
}

export interface ClearDocResultPayload {
  id: string;
  success: boolean;
  message?: string;
}

export interface ClearDocsResultPayload {
  results: ClearDocResultPayload[];
}

export type ExportFormat = 'csv' | 'json';

export interface ImportPreviewEntry {
  id?: string;
  name: string;
  outcome: 'NEW' | 'UNCHANGED' | 'DIFFERENT' | 'UNMATCHED' | 'INVALID';
  reason?: string;
  existingUpdatedAt?: string;
  existingUpdatedBy?: string;
  fileUpdatedAt?: string;
  fileUpdatedBy?: string;
  existingIsNewer?: boolean;
}

export interface ImportPreviewPayload {
  planId: string;
  fileCount: number;
  counts: {
    new: number;
    unchanged: number;
    different: number;
    unmatched: number;
    invalid: number;
  };
  entries: ImportPreviewEntry[];
}

export interface ImportResultEntry {
  id?: string;
  name: string;
  reason?: string;
  status?: DocStatus;
}

export type PluginToUIMessage =
  | {
      type: 'INSPECT_RESULT';
      payload: unknown;
    }
  | {
      type: 'SELECTION_STATUS';
      payload: {
        title: string;
        detail: string;
      };
    }
  | {
      type: 'INSPECT_ERROR';
      payload: {
        message: string;
      };
    }
  | {
      type: 'SCAN_RESULT';
      payload: ScanResult;
    }
  | {
      type: 'SCAN_PROGRESS';
      payload: {
        scannedPages: number;
        totalPages: number;
      };
    }
  | {
      type: 'SCAN_ERROR';
      payload: {
        message: string;
      };
    }
  | {
      type: 'EDITOR_OPEN';
      payload: EditorPayload | null;
    }
  | {
      type: 'SAVE_RESULT';
      payload: SaveResultPayload;
    }
  | {
      type: 'CLEAR_DOC_RESULT';
      payload: ClearDocResultPayload;
    }
  | {
      type: 'CLEAR_DOCS_PROGRESS';
      payload: {
        done: number;
        total: number;
        name: string;
      };
    }
  | {
      type: 'CLEAR_DOCS_RESULT';
      payload: ClearDocsResultPayload;
    }
  | {
      type: 'EXPORT_DATA';
      payload: {
        format: ExportFormat;
        fileName: string;
        content: string;
        count: number;
        source: 'checked' | 'shown';
      };
    }
  | {
      type: 'EXPORT_ERROR';
      payload: { message: string };
    }
  | {
      type: 'EXPORT_PROGRESS';
      payload: { done: number; total: number; name: string };
    }
  | {
      type: 'IMPORT_PREVIEW';
      payload: ImportPreviewPayload;
    }
  | {
      type: 'IMPORT_PROGRESS';
      payload: { done: number; total: number; name: string };
    }
  | {
      type: 'IMPORT_RESULT';
      payload: {
        added: ImportResultEntry[];
        replaced: ImportResultEntry[];
        keptExisting: ImportResultEntry[];
        unchanged: ImportResultEntry[];
        couldNotImport: ImportResultEntry[];
      };
    };

export type UIToPluginMessage =
  | {
      type: 'UI_READY';
    }
  | {
      type: 'INSPECT_SELECTION';
    }
  | {
      type: 'CLEAR_RESULT';
    }
  | {
      type: 'SCAN_REQUEST';
      scope: ScanScope;
    }
  | {
      type: 'REFRESH_LIST';
    }
  | {
      type: 'SELECT_NODE';
      id: string;
    }
  | {
      type: 'DEV_TAB_ACTIVE';
      active: boolean;
    }
  | {
      type: 'SAVE_DOC';
      payload: SaveDocPayload;
    }
  | {
      type: 'CLEAR_DOC';
      id: string;
    }
  | {
      type: 'CLEAR_DOCS_BULK';
      ids: string[];
    }
  | {
      type: 'EXPORT_REQUEST';
      format: ExportFormat;
      ids: string[];
      source: 'checked' | 'shown';
    }
  | {
      type: 'IMPORT_PREVIEW_REQUEST';
      content: unknown;
    }
  | {
      type: 'IMPORT_CONFIRM';
      planId: string;
      choice: 'keep' | 'replace' | null;
    };

