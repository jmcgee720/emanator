// ──────────────────────────────────────────────────────────────────────
// E2E TEST — convert a Mangia-Mama-shaped CRA fixture to Vite,
// run npm install, boot vite, fetch http://localhost:PORT, verify 200 OK.
//
// This is the test I should have run BEFORE claiming the CRA fix worked.
// If this test passes, the CRA→Vite import pipeline is genuinely working.
// ──────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import assert from 'node:assert/strict'

// Import our converter (the actual production code path).
const { convertCRAtoVite, isCRAProject } = await import('/app/lib/import/cra-to-vite.js')

const FIXTURE_DIR = '/tmp/cra2vite-e2e/frontend'
const PARENT_DIR = '/tmp/cra2vite-e2e'

// ── Fixture: a Mangia-Mama-shaped CRA project (CRA + craco + Phaser) ──
const fixtureFiles = [
  {
    path: 'frontend/package.json',
    content: JSON.stringify({
      name: 'mangia-mama',
      version: '0.1.0',
      private: true,
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        'react-scripts': '5.0.1',
        phaser: '^3.70.0',
      },
      devDependencies: {
        '@craco/craco': '^7.1.0',
      },
      scripts: {
        start: 'craco start',
        build: 'craco build',
        test: 'craco test',
        eject: 'react-scripts eject',
      },
      eslintConfig: { extends: ['react-app'] },
      browserslist: {
        production: ['>0.2%', 'not dead', 'not op_mini all'],
        development: ['last 1 chrome version'],
      },
    }, null, 2),
  },
  {
    path: 'frontend/craco.config.js',
    content: `const path = require('path');
module.exports = {
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
    },
  },
};
`,
  },
  {
    path: 'frontend/public/index.html',
    content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mangia Mama</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
  },
  {
    path: 'frontend/src/index.js',
    content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import reportWebVitals from './reportWebVitals';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

reportWebVitals();
`,
  },
  {
    path: 'frontend/src/App.jsx',
    content: `import React from 'react';

export default function App() {
  return (
    <div data-testid="app-root">
      <h1>Mangia Mama loaded successfully</h1>
      <p>VITE conversion worked!</p>
    </div>
  );
}
`,
  },
  {
    path: 'frontend/src/reportWebVitals.js',
    content: `const reportWebVitals = onPerfEntry => { /* ... */ };
export default reportWebVitals;
`,
  },
  {
    path: 'frontend/.env',
    content: `REACT_APP_API_URL=https://api.example.com
REACT_APP_DEBUG=false
`,
  },
]

function log(msg) { console.log(`[e2e] ${msg}`) }

function runCmd(cmd, args, cwd, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, CI: '1', ...opts.env }, stdio: opts.stdio || 'pipe' })
    let out = ''
    if (opts.stdio !== 'inherit') {
      p.stdout?.on('data', d => out += d.toString())
      p.stderr?.on('data', d => out += d.toString())
    }
    p.on('exit', code => code === 0 ? res(out) : rej(new Error(`${cmd} exited ${code}\n${out.slice(-2000)}`)))
    p.on('error', rej)
  })
}

async function writeFiles(files, parentDir) {
  for (const f of files) {
    const full = join(parentDir, f.path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, f.content, 'utf8')
  }
}

async function main() {
  // 1. Clean slate
  if (existsSync(PARENT_DIR)) await rm(PARENT_DIR, { recursive: true, force: true })
  await mkdir(PARENT_DIR, { recursive: true })

  // 2. Verify converter detects CRA correctly
  log('detecting CRA...')
  assert.equal(isCRAProject(fixtureFiles), true)
  log('✓ isCRAProject = true')

  // 3. Run the converter
  log('running convertCRAtoVite()...')
  const result = convertCRAtoVite(fixtureFiles)
  assert.equal(result.converted, true)
  assert.equal(result.root, 'frontend/')
  log(`✓ converted=true, root=${result.root}, entry=${result.entryFile}`)
  for (const line of result.summary) log(`  - ${line}`)

  // 4. Verify the transformed file set
  const out = result.files
  const findFile = (path) => out.find(f => f.path === path)
  assert.ok(findFile('frontend/vite.config.js'), 'vite.config.js must exist')
  assert.ok(findFile('frontend/index.html'), 'root index.html must exist')
  assert.ok(!findFile('frontend/craco.config.js'), 'craco.config.js must be removed')
  assert.ok(!findFile('frontend/public/index.html'), 'public/index.html must be removed')
  assert.ok(!findFile('frontend/src/reportWebVitals.js'), 'reportWebVitals must be removed')

  const newPkgFile = findFile('frontend/package.json')
  const newPkg = JSON.parse(newPkgFile.content)
  assert.ok(!newPkg.dependencies['react-scripts'], 'react-scripts must be removed')
  assert.ok(!newPkg.devDependencies['@craco/craco'], '@craco/craco must be removed')
  assert.ok(newPkg.devDependencies['vite'], 'vite must be added')
  assert.ok(newPkg.devDependencies['@vitejs/plugin-react'], '@vitejs/plugin-react must be added')
  assert.equal(newPkg.scripts.dev, 'vite')
  log('✓ package.json transformed correctly')

  const indexHtml = findFile('frontend/index.html').content
  assert.ok(indexHtml.includes('<script type="module"'), 'index.html must have module script tag')
  assert.ok(indexHtml.includes('/src/index.js') || indexHtml.includes('/src/index.jsx'), 'index.html must reference entry')
  assert.ok(!indexHtml.includes('%PUBLIC_URL%'), 'CRA template tags must be stripped')
  log('✓ index.html transformed correctly')

  const newIndex = findFile('frontend/src/index.js').content
  assert.ok(!newIndex.includes('reportWebVitals'), 'reportWebVitals import must be cleaned')
  log('✓ src/index.js cleaned')

  const newEnv = findFile('frontend/.env').content
  assert.ok(newEnv.includes('VITE_API_URL'), '.env REACT_APP_* renamed to VITE_*')
  assert.ok(!newEnv.includes('REACT_APP_'), 'REACT_APP_ removed from .env')
  log('✓ .env transformed')

  // 5. Write transformed files to disk
  log('writing transformed files to disk...')
  await writeFiles(out, PARENT_DIR)
  // Drop a .npmrc to skip peer-deps friction
  await writeFile(join(FIXTURE_DIR, '.npmrc'), 'legacy-peer-deps=true\nfund=false\naudit=false\n')

  // 6. Run npm install
  log('running npm install (~30-60s)...')
  await runCmd('npm', ['install', '--no-audit', '--no-fund'], FIXTURE_DIR)
  log('✓ npm install complete')

  // 7. Boot vite, wait for it to listen, fetch the URL, check for our marker text
  log('booting vite dev server on port 4567...')
  const vite = spawn('npx', ['--no-install', 'vite', '--port', '4567', '--host', '127.0.0.1'], {
    cwd: FIXTURE_DIR,
    env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' },
  })
  let viteOutput = ''
  vite.stdout.on('data', d => { const s = d.toString(); viteOutput += s; process.stdout.write('[vite] ' + s) })
  vite.stderr.on('data', d => { const s = d.toString(); viteOutput += s; process.stderr.write('[vite] ' + s) })

  // Wait up to 20s for "ready" / "Local:" line
  let ready = false
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    if (/Local:\s+http|ready in/.test(viteOutput)) { ready = true; break }
    if (vite.exitCode !== null) {
      throw new Error(`vite exited with code ${vite.exitCode} before ready\n${viteOutput.slice(-2000)}`)
    }
  }
  if (!ready) {
    try { vite.kill() } catch {}
    throw new Error(`vite did not become ready within 20s\n${viteOutput.slice(-2000)}`)
  }
  log('✓ vite is listening')

  // 8. Fetch the page
  try {
    log('fetching http://127.0.0.1:4567/ ...')
    const res = await fetch('http://127.0.0.1:4567/', {
      headers: { 'Accept': 'text/html' },
    })
    assert.equal(res.status, 200, `expected 200 OK, got ${res.status}`)
    const body = await res.text()
    assert.ok(body.includes('<div id="root">'), 'response HTML must contain <div id="root">')
    assert.ok(body.includes('type="module"'), 'response HTML must contain module script tag')
    log(`✓ http://127.0.0.1:4567/ → 200 OK, ${body.length} bytes, contains <div id="root">`)

    // Also fetch the entry JS to verify Vite serves it
    const entryRes = await fetch('http://127.0.0.1:4567/src/index.js')
    assert.equal(entryRes.status, 200, `entry JS must serve 200, got ${entryRes.status}`)
    const entryBody = await entryRes.text()
    assert.ok(entryBody.includes('import') || entryBody.includes('App'), 'entry JS body must look like JS')
    log(`✓ http://127.0.0.1:4567/src/index.js → 200 OK`)
  } finally {
    try { vite.kill('SIGTERM') } catch {}
    setTimeout(() => { try { vite.kill('SIGKILL') } catch {} }, 2000)
  }

  log('\n✓✓✓ ALL E2E CHECKS PASSED — converter produces a working Vite project that serves real HTML')
}

main().catch(err => {
  console.error('\n✗✗✗ E2E TEST FAILED:', err.message)
  process.exit(1)
})
