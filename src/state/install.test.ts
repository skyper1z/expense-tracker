import { describe, expect, it } from 'vitest';
import { detectBrowser } from './install';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.25.84',
  iphoneWhatsApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.20.79',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  // iOS 26 keeps reporting "OS 18_6" but Safari's own version is 26.
  iphone17Safari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

describe('browser detection for the install screen', () => {
  it.each([
    ['iphoneSafari', 0, 'ios', 'safari'],
    ['iphoneChrome', 5, 'ios', 'chromium'],
    ['iphoneInstagram', 5, 'ios', 'in-app'],
    ['iphoneWhatsApp', 5, 'ios', 'in-app'],
    ['ipadDesktopMode', 5, 'ios', 'safari'],
    ['androidChrome', 5, 'android', 'chromium'],
    ['androidWebView', 5, 'android', 'in-app'],
    ['androidFirefox', 5, 'android', 'firefox'],
    ['androidSamsung', 5, 'android', 'samsung'],
    ['macChrome', 0, 'desktop', 'chromium'],
    ['macSafari', 0, 'desktop', 'safari'],
    ['winEdge', 0, 'desktop', 'chromium'],
    ['winFirefox', 0, 'desktop', 'firefox'],
  ] as const)('%s → %s / %s', (key, touch, platform, browser) => {
    const r = detectBrowser(UA[key], touch);
    expect(r.platform).toBe(platform);
    expect(r.browser).toBe(browser);
    expect(r.isIOS).toBe(platform === 'ios');
  });

  it('knows iPhone from iPad and reads Safari’s version', () => {
    expect(detectBrowser(UA.iphone17Safari26, 5)).toMatchObject({ device: 'iphone', browser: 'safari', safariMajor: 26 });
    expect(detectBrowser(UA.iphoneSafari, 5)).toMatchObject({ device: 'iphone', safariMajor: 18 });
    expect(detectBrowser(UA.ipadSafari, 5)).toMatchObject({ device: 'ipad', browser: 'safari' });
    expect(detectBrowser(UA.ipadDesktopMode, 5)).toMatchObject({ device: 'ipad' });
    expect(detectBrowser(UA.iphoneChrome, 5)).toMatchObject({ device: 'iphone', browser: 'chromium', safariMajor: null });
    expect(detectBrowser(UA.macSafari, 0)).toMatchObject({ device: 'desktop', browser: 'safari', safariMajor: 18 });
    expect(detectBrowser(UA.androidChrome, 5)).toMatchObject({ device: 'android' });
  });
});
