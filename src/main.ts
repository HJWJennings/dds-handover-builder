import uiHtml from './generated/ui-embed';
import type { PluginToUIMessage, UIToPluginMessage } from './messages';
import { inspectSelectionNode } from './inspect';

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

figma.ui.onmessage = (message: UIToPluginMessage) => {
  console.log('[main] message received', message?.type);
  switch (message.type) {
    case 'UI_READY': {
      uiReady = true;
      void emitSelectionData().catch((error) => {
        console.error('[main] emitSelectionData rejected on UI_READY', error);
      });
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
  }
};

figma.on('selectionchange', () => {
  try {
    console.log('[main] selectionchange', figma.currentPage.name, figma.currentPage.selection.length, figma.currentPage.selection.map((n) => `${n.type}:${n.name}`));
    if (uiReady) {
      void emitSelectionData().catch((error) => {
        console.error('[main] emitSelectionData rejected on selectionchange', error);
      });
    }
  } catch (error) {
    console.error('[main] selectionchange handler error', error);
  }
});
