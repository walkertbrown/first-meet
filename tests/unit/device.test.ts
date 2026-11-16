// Which phone (2.4, /ops "by device"): the browser and the model, never anything that names her.
import { describe, expect, it } from 'vitest';
import { browserNameOf, cleanDevice, deviceFromHeaders, deviceFromUA } from '@/lib/device';

const PIXEL = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

describe('device names', () => {
  it('the browser and its major version', () => {
    expect(browserNameOf(PIXEL)).toBe('Chrome 142');
    expect(browserNameOf(IPHONE)).toBe('Safari 18');
    expect(browserNameOf('curl/8')).toBe('Other browser');
  });

  it('from the user agent alone', () => {
    expect(deviceFromUA(IPHONE)).toBe('Safari 18 · iPhone; CPU iPhone OS 18_1 like Mac OS X');
    expect(deviceFromUA(PIXEL)).toBe('Chrome 142 · Linux; Android 10; K');
    expect(deviceFromUA(null)).toBe('unknown');
  });

  it('with the model from client hints when Chrome sends them', () => {
    const h = new Headers({ 'user-agent': PIXEL, 'sec-ch-ua-model': '"Pixel 8"', 'sec-ch-ua-platform': '"Android"', 'sec-ch-ua-platform-version': '"15.0.0"' });
    expect(deviceFromHeaders(h)).toBe('Chrome 142 · Android 15 Pixel 8');
    expect(deviceFromHeaders(new Headers({ 'user-agent': PIXEL, 'sec-ch-ua-model': '""' }))).toBe('Chrome 142 · Linux; Android 10; K');
  });

  it('kept to printable text and 80 characters', () => {
    expect(cleanDevice('Pixel\u0000 8\n')).toBe('Pixel 8');
    expect(cleanDevice('x'.repeat(200))).toHaveLength(80);
    expect(cleanDevice('')).toBeNull();
    expect(cleanDevice(5)).toBeNull();
  });
});
