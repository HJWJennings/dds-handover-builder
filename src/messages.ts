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
    };
