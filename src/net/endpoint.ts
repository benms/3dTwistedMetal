interface EndpointEnv {
  VITE_SERVER_URL?: string;
  DEV: boolean;
}
interface PageLocation {
  protocol: string;
  host: string;
}

/**
 * The game server's WebSocket URL. `VITE_SERVER_URL` may be given as ws(s):// or http(s)://,
 * with or without the `/ws` path. In development an unset value uses the Vite proxy on the
 * page's own origin; in a production build it disables online play.
 */
export function serverUrl(
  env: EndpointEnv = import.meta.env,
  location: PageLocation = window.location,
): string | null {
  const configured = env.VITE_SERVER_URL?.trim();
  if (!configured) {
    if (!env.DEV) return null;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return null;
  }
  const schemes: Record<string, string> = {
    'http:': 'ws:',
    'https:': 'wss:',
    'ws:': 'ws:',
    'wss:': 'wss:',
  };
  const scheme = schemes[url.protocol];
  if (!scheme) return null;
  const path = url.pathname.replace(/\/+$/, '') || '/ws';
  return `${scheme}//${url.host}${path}${url.search}`;
}

/** The plain-HTTP health URL on the same host, used to wake a sleeping server early. */
export function healthUrl(socketUrl: string): string {
  const url = new URL(socketUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/healthz';
  url.search = '';
  return url.toString();
}
