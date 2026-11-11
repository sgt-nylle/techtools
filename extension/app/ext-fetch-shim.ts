/**
 * The web app's tools call same-origin endpoints (`/api/dns`, `/api/probe`, ...).
 * Inside the extension those would resolve to chrome-extension://<id>/api/..., so we
 * transparently route them to the production API. `host_permissions` in manifest.json
 * lets extension pages make these cross-origin requests.
 *
 * Client-side-only tools (Subnet, JWT/SAML, Mail Headers, Password Generator) never hit the
 * network and work fully offline.
 */
export const API_BASE = 'https://techtools.subwrite.se';

const nativeFetch = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (typeof input === 'string' && input.startsWith('/api/')) {
    return nativeFetch(API_BASE + input, init);
  }
  if (input instanceof URL && input.origin === location.origin && input.pathname.startsWith('/api/')) {
    return nativeFetch(API_BASE + input.pathname + input.search, init);
  }
  return nativeFetch(input, init);
};

/** Tools that need the TechTools API (everything else is 100% local). */
export const ONLINE_TOOL_IDS = new Set([
  'dns-inspector',
  'whats-my-ip',
  'cert-analyzer',
  'url-tester',
  'security-headers',
]);
