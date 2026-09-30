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
      };
    }
  | {
      type: 'CLEAR_DOCS_RESULT';
      payload: ClearDocsResultPayload;
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
    };

