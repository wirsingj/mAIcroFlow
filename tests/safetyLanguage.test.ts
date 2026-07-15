import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const productDocs = ['README.md', 'SAFETY.md', 'ARCHITECTURE.md', 'ROADMAP.md'];
const productCopyAndCode = ['README.md', 'SAFETY.md', 'ARCHITECTURE.md', 'ROADMAP.md', 'src/renderer/App.tsx'];

describe('safety positioning', () => {
  it('states the mission and durable technical boundary', () => {
    const readme = read('README.md');
    const safety = read('SAFETY.md');

    expect(readme).toContain('local-first, user-directed macro/RPA tool');
    expect(readme).toContain('observes only what the user could already see');
    expect(safety).toContain('visible pixels in, explicit user-configured actions out');
    expect(safety).toContain('TOS And Permitted Use Posture');
  });

  it('documents allowed and disallowed use examples', () => {
    const safety = read('SAFETY.md');

    expect(safety).toContain('## Allowed Examples');
    expect(safety).toContain('Extracting values from a visible screenshot');
    expect(safety).toContain('## Disallowed Examples');
    expect(safety).toContain('Reading process memory');
    expect(safety).toContain('Inspecting network packets');
  });

  it('keeps screenshot retention docs aligned with disposable run captures', () => {
    const docs = productDocs.map(read).join('\n');

    expect(docs).toContain('v0 does not retain run screenshots by default');
    expect(docs).not.toContain('real workflow run captures a fresh screenshot into `data/captures/`');
  });

  it('does not use risky positive marketing phrases', () => {
    const haystack = productDocs.map(read).join('\n').toLowerCase();
    const blockedPhrases = [
      'undetectable',
      'anti-ban',
      'works anywhere',
      'bypass detection',
      'bypass protections with',
      'stealth automation system'
    ];

    for (const phrase of blockedPhrases) {
      expect(haystack).not.toContain(phrase);
    }
  });

  it('keeps risky code/product names out of positive product copy', () => {
    const haystack = productCopyAndCode.map(read).join('\n');

    expect(haystack).not.toMatch(/\bBot\b/);
    expect(haystack).not.toMatch(/\binjector\b/i);
    expect(haystack).not.toMatch(/\banti-ban\b/i);
  });
});

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
