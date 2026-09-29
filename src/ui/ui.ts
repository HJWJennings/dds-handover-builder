const jsonOutput = document.getElementById('json-output') as HTMLPreElement | null;
const selectionSummary = document.getElementById('selection-summary') as HTMLDivElement | null;
const inspectButton = document.getElementById('inspect-selection') as HTMLButtonElement | null;
const copyButton = document.getElementById('copy-json') as HTMLButtonElement | null;

const renderOutput = (value: unknown) => {
  if (!jsonOutput) return;
  jsonOutput.textContent = JSON.stringify(value, null, 2);
};

const updateSummary = (summary: string) => {
  if (!selectionSummary) return;
  selectionSummary.textContent = summary;
};

if (inspectButton) {
  inspectButton.disabled = false;
}

inspectButton?.addEventListener('click', () => {
  console.log('[ui] Inspect selection click');
  window.parent.postMessage({ pluginMessage: { type: 'INSPECT_SELECTION' } }, '*');
});

copyButton?.addEventListener('click', async () => {
  const text = jsonOutput?.textContent ?? '{}';

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!copied) {
      throw new Error('execCommand copy returned false');
    }

    const originalText = copyButton.textContent ?? 'Copy JSON';
    copyButton.textContent = 'Copied';
    window.setTimeout(() => {
      copyButton.textContent = originalText;
    }, 1200);
  } catch (error) {
    copyButton.textContent = 'Copy failed';
  }
});

window.addEventListener('message', (event) => {
  const message = event.data?.pluginMessage;
  if (!message) {
    return;
  }

  if (message.type === 'INSPECT_RESULT') {
    console.log('[ui] selection msg', message.payload ?? null);
    renderOutput(message.payload ?? {});
    const payload = message.payload as { name?: string; nodeType?: string; error?: string } | null;
    if (payload?.error) {
      updateSummary(payload.error);
      return;
    }

    updateSummary(payload?.name ? `${payload.name} (${payload.nodeType ?? 'node'})` : 'Selection ready');
  }

  if (message.type === 'INSPECT_ERROR') {
    renderOutput({ error: message.payload?.message ?? 'Unknown error' });
    updateSummary(message.payload?.message ?? 'Inspector error');
  }
});

renderOutput({ message: 'Ready. Select a component or component set to inspect.' });
updateSummary('No component selected.');

console.log('[ui] sent UI_READY');
window.parent.postMessage({ pluginMessage: { type: 'UI_READY' } }, '*');
