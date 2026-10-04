import type { ScanResult, ScanScope } from './scan';
import type { ComponentDoc } from './store/types';
import type { DocStatus } from './store/docStatus';

export interface EditorVariantProperty {
  name: string;
  options: string[];
}

export interface EditorPayload {
  id: string;
  name: string;
  fullName: string;
  type: 'COMPONENT_SET' | 'COMPONENT';
  variantCount: number;
  variantPropertyNames: string[];
  variantProperties: EditorVariantProperty[];
  group: string;
  status: DocStatus;
  doc: ComponentDoc;
}

export interface SaveDocPayload {
  id: string;
  fields: ComponentDoc['fields'];
  status: 'draft' | 'ready';
  syncToDescription: boolean;
  handoverConfig: NonNullable<ComponentDoc['handoverConfig']>;
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

export interface HandoverPreviewEntry {
  id: string;
  name: string;
  replacesExisting: boolean;
  error?: string;
}

export interface HandoverFontReport {
  bodyFamily: string;
  bodyFallback: string | null;
  regularStyle: string;
  boldStyle: string;
  italicStyle: string | null;
  monoFamily: string;
  monoStyle: string;
  monoFallback: string | null;
  fallbacks: string[];
  errors: string[];
}

export interface HandoverTokenReportEntry {
  role: string;
  variableUsed: string | null;
  fallback: string | number | null;
  resolvedValue?: string;
  reason: string;
  verify?: boolean;
}

export interface HandoverGenerationResultPayload {
  generated: Array<{ id: string; name: string; frameId: string }>;
  replaced: Array<{ id: string; name: string; frameId: string }>;
  failed: Array<{ id: string; name: string; reason: string }>;
  emptySectionCount: number;
  instanceCount: number;
  gridCount: number;
  variantsPlaced: number;
  variantsTotal: number;
  variantsOther: number;
  onDarkStatuses: string[];
  collapsedCount: number;
  emptyFrameCount: number;
  narrowTextCount: number;
  outOfBoundsCount: number;
  healedFrames: number;
  sectionErrors: string[];
  sections: Array<{ name: string; status: string; reason?: string; stack?: string; durationMs: number }>;
  genLog: string[];
  collapsedTextLayers: number;
  collapsedTextPaths: string[];
  fontReport: HandoverFontReport;
  tokenBindingReadback: string[];
  tokenReport: HandoverTokenReportEntry[];
  errors: string[];
  showDocFrameId?: string;
  /** Set when this payload is one run of the "Generate twice" self-test. */
  runIndex?: number;
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
    }
  | {
      type: 'TOKEN_CATALOGUE_RESULT';
      payload: unknown;
    }
  | {
      type: 'GENERATE_HANDOVER_PREVIEW';
      payload: { planId: string; entries: HandoverPreviewEntry[] };
    }
  | {
      type: 'GENERATE_HANDOVER_PROGRESS';
      payload: { done: number; total: number; name: string };
    }
  | {
      type: 'GENERATE_HANDOVER_RESULT';
      payload: HandoverGenerationResultPayload;
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
    }
  | {
      type: 'STYLE_PROBE_REQUEST';
    }
  | {
      type: 'TOKEN_CATALOGUE_REQUEST';
    }
  | {
      type: 'GENERATE_HANDOVER_PREVIEW_REQUEST';
      ids: string[];
    }
  | {
      type: 'GENERATE_HANDOVER_CONFIRM';
      planId: string;
    }
  | {
      type: 'GENERATE_TWICE';
      id: string;
    }
  | {
      type: 'SHOW_HANDOVER_DOC';
      frameId: string;
    };

