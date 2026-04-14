/**
 * Screenshot Testing Service via E2B Sandbox
 * 
 * Runs Playwright inside an E2B sandbox to take screenshots of the
 * project's built output. Used by the AI to visually verify its changes.
 */

import { getOrCreateSandbox, execInSandbox, writeSandboxFile } from './sandbox-service.js'

/**
 * Install Playwright in the sandbox (one-time per sandbox session).
 */
async function ensurePlaywrightInstalled(sandbox) {
  // Check if already installed
  const check = await execInSandbox(sandbox, 'which playwright 2>/dev/null || echo "NOT_FOUND"', { timeoutMs: 5000 })
  if (!check.stdout.includes('NOT_FOUND')) return true

  console.log('[Screenshot] Installing Playwright in sandbox...')
  const install = await execInSandbox(sandbox, 'npm install -g playwright && playwright install chromium --with-deps 2>&1', { timeoutMs: 120000 })
  if (!install.success) {
    console.error('[Screenshot] Playwright install failed:', install.stderr?.slice(-200))
    return false
  }
  console.log('[Screenshot] Playwright installed')
  return true
}

/**
 * Take a screenshot of a URL using Playwright in the E2B sandbox.
 * Returns base64-encoded image data.
 */
export async function takeScreenshot(projectId, url, opts = {}) {
  const sandbox = await getOrCreateSandbox(projectId)
  
  // Ensure Playwright is installed
  const installed = await ensurePlaywrightInstalled(sandbox)
  if (!installed) {
    return { success: false, error: 'Failed to install Playwright in sandbox' }
  }

  const width = opts.width || 1280
  const height = opts.height || 800
  const fullPage = opts.fullPage || false
  const waitMs = opts.waitMs || 3000

  // Write a screenshot script
  const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: ${width}, height: ${height} } });
  try {
    await page.goto('${url}', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(${waitMs});
    const buffer = await page.screenshot({ fullPage: ${fullPage}, type: 'png' });
    const base64 = buffer.toString('base64');
    console.log('SCREENSHOT_START');
    console.log(base64);
    console.log('SCREENSHOT_END');
  } catch (err) {
    console.error('SCREENSHOT_ERROR:', err.message);
  } finally {
    await browser.close();
  }
})();
`

  await writeSandboxFile(sandbox, '_screenshot.cjs', script)
  const result = await execInSandbox(sandbox, 'node /home/user/project/_screenshot.cjs 2>&1', { timeoutMs: 60000 })

  // Extract base64 from output
  const output = result.stdout || ''
  const startIdx = output.indexOf('SCREENSHOT_START')
  const endIdx = output.indexOf('SCREENSHOT_END')

  if (startIdx !== -1 && endIdx !== -1) {
    const base64 = output.slice(startIdx + 'SCREENSHOT_START'.length, endIdx).trim()
    return { success: true, base64, width, height }
  }

  // Check for error
  const errorMatch = output.match(/SCREENSHOT_ERROR:\s*(.+)/)
  return {
    success: false,
    error: errorMatch ? errorMatch[1] : 'Screenshot capture failed — no output',
    output: output.slice(-500),
  }
}

/**
 * Take a screenshot and return a text description for the AI.
 * Since we can't embed images in tool responses easily,
 * we describe what the screenshot shows based on page content.
 */
export async function describeScreenshot(projectId, url, opts = {}) {
  const sandbox = await getOrCreateSandbox(projectId)
  
  const installed = await ensurePlaywrightInstalled(sandbox)
  if (!installed) {
    return 'Could not install Playwright for screenshot verification.'
  }

  const width = opts.width || 1280
  const height = opts.height || 800

  // Script that captures page content + structure instead of pixels
  const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: ${width}, height: ${height} } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  
  try {
    const response = await page.goto('${url}', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    const status = response?.status() || 'unknown';
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '');
    const headings = await page.evaluate(() => 
      Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.textContent?.trim()).filter(Boolean).slice(0, 10)
    );
    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button,[role=button]')).map(b => b.textContent?.trim()).filter(Boolean).slice(0, 15)
    );
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,textarea,select')).map(i => i.placeholder || i.name || i.type).filter(Boolean).slice(0, 10)
    );
    const images = await page.evaluate(() => document.querySelectorAll('img').length);
    const links = await page.evaluate(() => document.querySelectorAll('a').length);
    
    console.log(JSON.stringify({
      status, title, headings, buttons, inputs, images, links,
      errors: errors.slice(0, 5),
      bodyPreview: bodyText.slice(0, 500),
      hasContent: bodyText.length > 50,
    }));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
  } finally {
    await browser.close();
  }
})();
`

  await writeSandboxFile(sandbox, '_describe.cjs', script)
  const result = await execInSandbox(sandbox, 'node /home/user/project/_describe.cjs 2>&1', { timeoutMs: 60000 })

  try {
    const data = JSON.parse(result.stdout?.trim() || '{}')
    if (data.error) return `PAGE ERROR: ${data.error}`

    let desc = `## Page Verification: ${url}\n`
    desc += `- **Status**: HTTP ${data.status}\n`
    desc += `- **Title**: ${data.title || '(none)'}\n`
    desc += `- **Has Content**: ${data.hasContent ? 'Yes' : 'No — page may be blank'}\n`
    if (data.headings?.length) desc += `- **Headings**: ${data.headings.join(', ')}\n`
    if (data.buttons?.length) desc += `- **Buttons**: ${data.buttons.join(', ')}\n`
    if (data.inputs?.length) desc += `- **Inputs**: ${data.inputs.join(', ')}\n`
    desc += `- **Images**: ${data.images}, **Links**: ${data.links}\n`
    if (data.errors?.length) desc += `\n**Console Errors**:\n${data.errors.map(e => `- ${e}`).join('\n')}\n`
    if (data.bodyPreview) desc += `\n**Body Preview**:\n${data.bodyPreview.slice(0, 300)}\n`

    return desc
  } catch {
    return `Screenshot verification completed but output parsing failed. Raw output: ${result.stdout?.slice(-300)}`
  }
}
