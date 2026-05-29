import { describe, it, expect } from 'vitest';
import { extractVisibleText, fetchUrlContent } from './fetch-url';

describe('extractVisibleText', () => {
  it('strips scripts and styles', () => {
    const html =
      '<html><head><style>.x{color:red}</style></head><body><script>alert(1)</script><p>Menu</p></body></html>';
    expect(extractVisibleText(html)).toBe('Menu');
  });

  it('drops nav, header, footer noise', () => {
    const html = '<nav>Home About</nav><main>Pizza margherita 8€</main><footer>©2026</footer>';
    expect(extractVisibleText(html)).toBe('Pizza margherita 8€');
  });

  it('keeps text from real menu structure', () => {
    const html = `
      <h2>Antipasti</h2>
      <ul><li>Bruschetta &euro;6</li><li>Caprese &euro;9</li></ul>
      <h2>Primi</h2>
      <ul><li>Carbonara &euro;12</li></ul>
    `;
    const out = extractVisibleText(html);
    expect(out).toContain('Antipasti');
    expect(out).toContain('Carbonara');
    expect(out).toContain('€');
  });

  it('decodes common entities', () => {
    expect(extractVisibleText('<p>Caffè &amp; cornetto &quot;classico&quot;</p>')).toContain('& cornetto');
    expect(extractVisibleText('<p>Caffè &amp; cornetto &quot;classico&quot;</p>')).toContain('"classico"');
  });

  it('handles HTML comments', () => {
    expect(extractVisibleText('<!-- skip me --><p>visible</p>')).toBe('visible');
  });
});

describe('fetchUrlContent', () => {
  it('rejects invalid URLs', async () => {
    const out = await fetchUrlContent('not a url');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_url');
  });

  it('rejects non-http(s) schemes', async () => {
    const out = await fetchUrlContent('file:///etc/passwd');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_url');
  });

  it('rejects localhost (SSRF guard)', async () => {
    const out = await fetchUrlContent('http://localhost/menu');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_url');
  });

  it('rejects RFC1918 private networks', async () => {
    const out = await fetchUrlContent('http://192.168.1.1/menu');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_url');
  });

  it('rejects the cloud metadata IP (169.254.169.254)', async () => {
    const out = await fetchUrlContent('http://169.254.169.254/latest/meta-data/');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_url');
  });

  it('rejects CGNAT space (100.64.0.0/10)', async () => {
    const out = await fetchUrlContent('http://100.64.0.1/menu');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_url');
  });

  it('rejects IPv6 loopback', async () => {
    const out = await fetchUrlContent('http://[::1]/menu');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_url');
  });
});
