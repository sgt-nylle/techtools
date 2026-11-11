/* TechTools extension — background service worker (MV3).
 * Responsibilities: context-menu "Inspect with TechTools", keyboard command for the side
 * panel, and the hand-off of selected text to the UI via chrome.storage.local.
 * Plain JS on purpose (no build step); `chrome` is aliased for Firefox (`browser`).
 */
const api = typeof browser !== 'undefined' ? browser : chrome;

const PENDING_KEY = 'tt_ext_pending';
const MENU_ROOT = 'tt-root';
const MENU_AUTO = 'tt-auto';
const MENU_PANEL = 'tt-panel';

/** Explicit tool targets offered under the submenu: menuId -> tool id (matches registry ids). */
const TOOL_MENUS = {
  'tt-tool-subnet-calculator': { toolId: 'subnet-calculator', label: 'Subnet / CIDR calculator' },
  'tt-tool-auth-inspector': { toolId: 'auth-inspector', label: 'JWT / SAML inspector' },
  'tt-tool-dns-inspector': { toolId: 'dns-inspector', label: 'DNS & WHOIS lookup' },
  'tt-tool-whats-my-ip': { toolId: 'whats-my-ip', label: 'IP / range owner' },
  'tt-tool-cert-analyzer': { toolId: 'cert-analyzer', label: 'Certificate / CSR analyzer' },
  'tt-tool-mail-header-analyzer': { toolId: 'mail-header-analyzer', label: 'Mail header analyzer' },
  'tt-tool-url-tester': { toolId: 'url-tester', label: 'URL & TLS probe' },
};

/** Guess the best tool for a text selection. Returns { toolId, hint? } (toolId null = just search). */
function detect(raw) {
  const text = raw.trim();
  if (/^(Bearer\s+)?eyJ[\w-]+\.[\w-]+(\.[\w-]*)?$/i.test(text)) return { toolId: 'auth-inspector' };
  if (
    /^<.*(saml|Assertion|Response|EntityDescriptor)/is.test(text) ||
    /SAMLResponse=/i.test(text) ||
    /^(PHNhbWw|PD94bWw|PHNhbWxw)/.test(text)
  ) {
    return { toolId: 'auth-inspector', hint: 'saml' };
  }
  if (/-----BEGIN [A-Z ]+-----/.test(text)) return { toolId: 'cert-analyzer' };
  if (/^(Received|Return-Path|Authentication-Results|DKIM-Signature|ARC-Seal):/im.test(text)) {
    return { toolId: 'mail-header-analyzer' };
  }
  if (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(text) || /^[0-9a-f:]+:[0-9a-f:]*\/\d{1,3}$/i.test(text)) {
    return { toolId: 'subnet-calculator' };
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(text) || /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i.test(text)) {
    return { toolId: 'whats-my-ip' };
  }
  if (/^https?:\/\/\S+$/i.test(text)) return { toolId: 'url-tester' };
  if (/^([a-z0-9-]+\.)+[a-z]{2,}\.?$/i.test(text)) return { toolId: 'dns-inspector' };
  return { toolId: null };
}

function registerMenus() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: MENU_ROOT, title: 'Inspect with TechTools', contexts: ['selection'] });
    api.contextMenus.create({
      id: MENU_AUTO,
      parentId: MENU_ROOT,
      title: 'Auto-detect "%s"',
      contexts: ['selection'],
    });
    api.contextMenus.create({ id: 'tt-sep', parentId: MENU_ROOT, type: 'separator', contexts: ['selection'] });
    for (const [id, def] of Object.entries(TOOL_MENUS)) {
      api.contextMenus.create({ id, parentId: MENU_ROOT, title: def.label, contexts: ['selection'] });
    }
    api.contextMenus.create({
      id: MENU_PANEL,
      title: 'Open TechTools side panel',
      contexts: ['page', 'selection', 'action'],
    });
  });
}

api.runtime.onInstalled.addListener(registerMenus);
// MV3 service workers restart often; menus persist, but re-register on browser start to be safe.
api.runtime.onStartup?.addListener(registerMenus);

/** Show the UI: popup if the browser allows it, else side panel, else a small popup window. */
async function showUi(tab) {
  try {
    await api.action.openPopup();
    return;
  } catch {
    /* openPopup needs a recent user gesture / Chrome 127+ — fall through */
  }
  try {
    if (api.sidePanel && tab && tab.windowId !== undefined) {
      await api.sidePanel.open({ windowId: tab.windowId });
      return;
    }
  } catch {
    /* ignore */
  }
  api.windows.create({ url: api.runtime.getURL('popup.html'), type: 'popup', width: 740, height: 640 });
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_PANEL) {
    try {
      if (api.sidePanel && tab) await api.sidePanel.open({ windowId: tab.windowId });
    } catch {
      /* ignore */
    }
    return;
  }

  const text = (info.selectionText || '').trim();
  if (!text) return;

  let pending;
  if (info.menuItemId === MENU_AUTO) {
    pending = { ...detect(text), text };
  } else if (TOOL_MENUS[info.menuItemId]) {
    const { toolId } = TOOL_MENUS[info.menuItemId];
    pending = { toolId, text, hint: toolId === 'auth-inspector' ? detect(text).hint : undefined };
  } else {
    return;
  }

  // Storage write first (the UI reads + clears this on open), then open the UI.
  await api.storage.local.set({ [PENDING_KEY]: { ...pending, ts: Date.now() } });
  await showUi(tab);
});

api.commands.onCommand.addListener(async (command, tab) => {
  // `_execute_action` (Alt+Shift+T) is handled natively by the browser (opens the popup).
  if (command === 'open-side-panel' && api.sidePanel) {
    const win = tab ? { id: tab.windowId } : await api.windows.getCurrent();
    try {
      await api.sidePanel.open({ windowId: win.id });
    } catch {
      /* ignore */
    }
  }
});
