'use strict';

// A5 renderer: template HTML → PNG with headless Chromium (Playwright). Chromium shapes Thai
// with HarfBuzz, so vowels and tone marks sit where the font puts them (no floating/overlap).
//
// Offline by design: the page is built from inline data only, the browser context is offline
// and every network request is aborted and counted (A5 acceptance "render without internet").
// One browser per render, one render at a time: the free host has 512 MB of memory.
const templates = require('./templates');
const { FONT_FACES } = require('./brand');

class RenderError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @param {{ executablePath?: string|null, logger?: object, timeoutMs?: number, chromium?: object }} [options]
 *   executablePath: Chromium to use (env CHROMIUM_PATH). Default: the one Playwright installed.
 */
function createRenderer({ executablePath = null, logger = null, timeoutMs = 30000, chromium = null } = {}) {
  let queue = Promise.resolve();
  let renders = 0;

  function browserType() {
    return chromium || require('playwright-core').chromium;
  }

  /** Run one job at a time. */
  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  /**
   * Render a complete HTML page to PNG.
   * @param {string} html
   * @param {{ width?: number, height?: number }} [size]
   * @returns {Promise<{ png: Buffer, blockedRequests: string[], fonts: { family: string, weight: string, status: string }[], ms: number }>}
   */
  function renderHtml(html, { width = templates.SIZE.width, height = templates.SIZE.height } = {}) {
    return serial(async () => {
      const started = Date.now();
      let browser;
      try {
        browser = await browserType().launch({
          headless: true,
          ...(executablePath ? { executablePath } : {}),
          chromiumSandbox: false,
          timeout: timeoutMs,
          args: ['--single-process', '--no-zygote', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'],
        });
      } catch (err) {
        throw new RenderError('renderer_unavailable', err.message.split('\n')[0]);
      }
      const blockedRequests = [];
      try {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, offline: true, javaScriptEnabled: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
        await context.route('**/*', (route) => {
          blockedRequests.push(route.request().url().slice(0, 200));
          return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        page.setDefaultTimeout(timeoutMs);
        await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
        const fonts = await page.evaluate(async () => {
          // Load every embedded face (data: URLs), wait, then fit long text with the real font.
          await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
          await document.fonts.ready;
          if (typeof window.__fit === 'function') window.__fit();
          await Promise.all([...document.images].map((img) => (img.decode ? img.decode().catch(() => null) : null)));
          return [...document.fonts].map((f) => ({ family: f.family.replace(/["']/g, ''), weight: String(f.weight), status: f.status }));
        });
        const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height }, animations: 'disabled' });
        renders += 1;
        return { png, blockedRequests, fonts, ms: Date.now() - started };
      } finally {
        await browser.close().catch(() => {});
      }
    });
  }

  /**
   * Validate data and render a template.
   * @param {string} templateId
   * @param {object} data
   * @param {{ background?: { mime: string, data: Buffer } }} [options] background must already
   *   have passed assets.loadForTemplate (consent check, S-4.5).
   */
  async function render(templateId, data, options = {}) {
    const clean = templates.validate(templateId, data);
    const html = templates.buildHtml(templateId, clean, options);
    const out = await renderHtml(html, templates.SIZE);
    const failed = out.fonts.filter((f) => f.status !== 'loaded');
    if (failed.length || out.fonts.length !== FONT_FACES.length) {
      // Never hand out an image drawn with a fallback font.
      throw new RenderError('fonts_not_loaded', failed);
    }
    if (logger) logger.info('content.rendered', { templateId, ms: out.ms, blocked: out.blockedRequests.length });
    return { ...out, templateId, data: clean };
  }

  return { render, renderHtml, stats: () => ({ renders }) };
}

module.exports = { createRenderer, RenderError };
