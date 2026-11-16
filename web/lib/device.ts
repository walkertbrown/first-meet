// Which phone: the browser and the model (plan 2.4, /ops "by device"). Nothing that names her.

/** The browser and its major version, from the user agent ("Chrome 142", "Safari 18"). */
export function browserNameOf(ua: string): string {
  for (const [re, name] of [[/Edg\/(\d+)/, 'Edge'], [/SamsungBrowser\/(\d+)/, 'Samsung Internet'], [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'], [/CriOS\/(\d+)/, 'Chrome'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+).*Safari/, 'Safari']] as const) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return 'Other browser';
}

/** A device name as the phone sent it, kept to printable text and 80 characters, or null. */
export function cleanDevice(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[^\x20-\x7E·]/g, '').trim().slice(0, 80);
  return s || null;
}

/** The device from a user agent alone (the server's fallback when the phone didn't say). */
export function deviceFromUA(ua: string | null | undefined): string {
  if (!ua) return 'unknown';
  const m = ua.match(/\(([^)]+)\)/)?.[1] ?? '';
  return cleanDevice(`${browserNameOf(ua)} · ${m}`) ?? 'unknown';
}

/**
 * The device a request came from: the user agent's browser, with the model from the client hints
 * Chrome sends once the site asks for them (Accept-CH, next.config.ts), else the user agent's own.
 */
export function deviceFromHeaders(h: Headers): string {
  const ua = h.get('user-agent');
  const hint = (k: string) => h.get(k)?.replace(/^"|"$/g, '') ?? '';
  const model = hint('sec-ch-ua-model');
  if (ua && model) {
    const s = [hint('sec-ch-ua-platform'), hint('sec-ch-ua-platform-version').split('.')[0], model].filter(Boolean).join(' ');
    return cleanDevice(`${browserNameOf(ua)} · ${s}`) ?? 'unknown';
  }
  return deviceFromUA(ua);
}

/** In the browser: the browser and the model, with the model from client hints where the browser gives them. */
export async function deviceOf(): Promise<string> {
  const ua = navigator.userAgent;
  const browser = browserNameOf(ua);
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(k: string[]): Promise<{ model?: string; platform?: string; platformVersion?: string }> } }).userAgentData;
  try {
    if (uad) {
      const h = await uad.getHighEntropyValues(['model', 'platform', 'platformVersion']);
      const s = [h.platform, h.platformVersion?.split('.')[0], h.model].filter(Boolean).join(' ');
      if (s) return `${browser} · ${s}`.slice(0, 80);
    }
  } catch { /* fall through */ }
  return deviceFromUA(ua);
}
