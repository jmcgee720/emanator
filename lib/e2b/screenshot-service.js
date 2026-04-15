/**
 * Screenshot Testing Service via E2B Sandbox
 * 
 * Runs Playwright inside an E2B sandbox to take screenshots of the
 * project's built output. Used by the AI to visually verify its changes.
 * 
 * For self-edit mode, uses local HTTP fetch to describe the page
 * since the app runs on localhost:3000.
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


/**
 * Describe page locally for self-edit mode.
 * Uses HTTP fetch + HTML parsing since the app runs on localhost:3000.
 * Falls back to spawn a Python Playwright subprocess for JS-rendered pages.
 */
export async function describeScreenshotLocal(url) {
  const targetUrl = url || 'http://localhost:3000'
  
  // First check health
  let healthStatus = 'unknown'
  try {
    const healthRes = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(5000) })
    if (healthRes.ok) {
      const healthData = await healthRes.json()
      healthStatus = healthData.status || 'ok'
    } else {
      healthStatus = `HTTP ${healthRes.status}`
    }
  } catch (healthErr) {
    healthStatus = `error: ${healthErr.message}`
  }

  // Try Python Playwright first (gives JS-rendered content)
  try {
    const { execSync } = await import('child_process')
    const pyScript = `
import json, sys, os
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium")
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        response = page.goto("${targetUrl}", wait_until="networkidle", timeout=15000)
        page.wait_for_timeout(2000)
        status = response.status if response else 0
        title = page.title()
        headings = page.eval_on_selector_all("h1,h2,h3", "els => els.map(h => h.textContent.trim()).filter(Boolean).slice(0, 10)")
        buttons = page.eval_on_selector_all("button,[role=button]", "els => els.map(b => b.textContent.trim()).filter(Boolean).slice(0, 15)")
        inputs = page.eval_on_selector_all("input,textarea,select", "els => els.map(i => i.placeholder || i.name || i.type).filter(Boolean).slice(0, 10)")
        images = page.eval_on_selector_all("img", "els => els.length")
        links = page.eval_on_selector_all("a", "els => els.length")
        body = page.evaluate("document.body?.innerText?.slice(0, 2000) || ''")
        browser.close()
        print(json.dumps({"status": status, "title": title, "headings": headings, "buttons": buttons, "inputs": inputs, "images": images, "links": links, "errors": errors[:5], "bodyPreview": body[:500], "hasContent": len(body) > 50}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`
    const result = execSync(`/opt/plugins-venv/bin/python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { 
      timeout: 30000,
      encoding: 'utf-8',
    })
    
    const data = JSON.parse(result.trim())
    if (data.error) throw new Error(data.error)

    let desc = `## Page Verification: ${targetUrl}\n`
    desc += `- **Build Status**: ${healthStatus}\n`
    desc += `- **HTTP Status**: ${data.status}\n`
    desc += `- **Title**: ${data.title || '(none)'}\n`
    desc += `- **Has Content**: ${data.hasContent ? 'Yes' : 'No — page may be blank'}\n`
    if (data.headings?.length) desc += `- **Headings**: ${data.headings.join(', ')}\n`
    if (data.buttons?.length) desc += `- **Buttons**: ${data.buttons.join(', ')}\n`
    if (data.inputs?.length) desc += `- **Inputs**: ${data.inputs.join(', ')}\n`
    desc += `- **Images**: ${data.images}, **Links**: ${data.links}\n`
    if (data.errors?.length) desc += `\n**Console Errors**:\n${data.errors.map(e => `- ${e}`).join('\n')}\n`
    if (data.bodyPreview) desc += `\n**Body Preview**:\n${data.bodyPreview.slice(0, 300)}\n`
    return desc
  } catch (pwErr) {
    console.warn('[Screenshot-Local] Playwright failed, falling back to HTTP fetch:', pwErr.message)
  }

  // Fallback: plain HTTP fetch + basic HTML parsing
  try {
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(10000) })
    const html = await res.text()
    
    // Basic HTML extraction
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : '(no title)'
    
    const headings = [...html.matchAll(/<h[1-3][^>]*>([^<]*)<\/h[1-3]>/gi)].map(m => m[1].trim()).filter(Boolean).slice(0, 10)
    const buttonTexts = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/gi)].map(m => m[1].trim()).filter(Boolean).slice(0, 15)
    const hasContent = html.length > 500

    let desc = `## Page Verification: ${targetUrl}\n`
    desc += `- **Build Status**: ${healthStatus}\n`
    desc += `- **HTTP Status**: ${res.status}\n`
    desc += `- **Title**: ${title}\n`
    desc += `- **Has Content**: ${hasContent ? 'Yes' : 'No — page may be blank or errored'}\n`
    if (headings.length) desc += `- **Headings**: ${headings.join(', ')}\n`
    if (buttonTexts.length) desc += `- **Buttons**: ${buttonTexts.join(', ')}\n`
    desc += `- **HTML Size**: ${html.length} chars\n`
    
    // Check for error indicators in HTML
    if (html.includes('ModuleBuildError') || html.includes('SyntaxError') || html.includes('Module not found')) {
      const errorMatch = html.match(/(ModuleBuildError|SyntaxError|Module not found)[^"<]*/)?.[0]
      desc += `\n**BUILD ERROR DETECTED**: ${errorMatch?.slice(0, 200)}\n`
    }

    return desc
  } catch (fetchErr) {
    return `## Page Verification: ${targetUrl}\n- **Build Status**: ${healthStatus}\n- **Error**: Could not fetch page — ${fetchErr.message}\n\nThe server may be restarting. Wait 5 seconds and try verify_build instead.`
  }
}
