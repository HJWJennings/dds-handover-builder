import type { ScanResult, ScanScope } from './scan';

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
      type: 'SELECTED_INFO';
      payload: {
        id: string;
        name: string;
        type: string;
      } | null;
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
    };
