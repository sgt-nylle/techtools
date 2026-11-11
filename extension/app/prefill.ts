/**
 * Fills the first text field of the currently mounted tool with `text` (used by the
 * "Inspect with TechTools" context-menu action). Works with React-controlled inputs by
 * using the native value setter + a bubbling `input` event, so no per-tool changes are needed.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function findField(root: ParentNode): HTMLInputElement | HTMLTextAreaElement | null {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input[type="text"], input:not([type]), input[type="search"]'
  );
}

export function prefillTool(root: HTMLElement, text: string, hint?: 'saml'): () => void {
  let cancelled = false;
  let tries = 0;

  const run = () => {
    if (cancelled) return;
    const field = findField(root);
    if (!field) {
      if (tries++ < 20) window.setTimeout(run, 50);
      return;
    }
    setNativeValue(field, text);
    field.focus();
  };

  if (hint === 'saml') {
    // The JWT / SAML tool switches tabs with [M]; wait one render, then fill.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    window.setTimeout(run, 80);
  } else {
    window.setTimeout(run, 30);
  }

  return () => {
    cancelled = true;
  };
}
