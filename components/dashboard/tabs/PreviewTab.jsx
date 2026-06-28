'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { authFetch } from '@/lib/auth-fetch'
import {
  RefreshCw, AlertTriangle, MonitorSmartphone, Tablet, Monitor,
  Loader2, FileCode, AlertCircle, Terminal, Play, Square, RotateCcw,
  Accessibility, CheckCircle2, XCircle, ChevronDown, ChevronUp, ExternalLink, Zap
} from 'lucide-react'
import ServerPreview from './ServerPreview'
import { ImageryDeferredBanner, ImageryGeneratedPill } from '../ImageryDeferredBanner.jsx'

// ─── Parse VFS entries out of a components/assets.js module ────────
// Used on project reload (no live SSE map available) so path-form
// `<img src="/logo.png">` continues to resolve against the persisted
// brand-asset module. We don't evaluate JS — we regex-grab
// `'\/path': EXPORT_NAME` pairs from the VIRTUAL_FS block and match
// each to its `export const EXPORT_NAME = \`data:...\`` literal.
function parseBrandVfsFromAssetsModule(source) {
  if (typeof source !== 'string' || !source) return []
  const exportRe = /export\s+const\s+([A-Z0-9_]+)\s*=\s*`(data:[^`]+)`/g
  const byName = {}
  let m
  while ((m = exportRe.exec(source)) !== null) byName[m[1]] = m[2]

  const vfsBlock = source.match(/VIRTUAL_FS\s*=\s*\{([\s\S]*?)\}/)
  if (!vfsBlock) return []
  const pairRe = /['"]([^'"]+)['"]\s*:\s*([A-Z0-9_]+)/g
  const out = []
  while ((m = pairRe.exec(vfsBlock[1])) !== null) {
    const path = m[1]
    const name = m[2]
    if (byName[name]) out.push({ placeholder: path, dataUrl: byName[name] })
  }
  return out
}

// ─── Project classifier ────────────────────────────────────────────
// EXPORTED so other components (ProjectThumbnail) can build the same
// preview HTML for purposes like Project Bin thumbnails without
// duplicating the 540-line build pipeline.
export function classifyProject(files, options = {}) {
  if (!files?.length) return { type: 'empty', files: [] }

  const codeFiles = files.filter(f => {
    if (!f.path) return false
    if (f.path.startsWith('_generated/')) return false
    if (f.path.startsWith('_uploads/')) return false
    if (f.path.startsWith('_assets/')) return false
    if (f.file_type === 'image') return false
    return true
  })

  if (codeFiles.length === 0) {
    const assetCount = files.filter(f => f.path?.startsWith('_generated/') || f.path?.startsWith('_uploads/')).length
    if (assetCount > 0) {
      return { type: 'assets-only', assetCount, files }
    }
    return { type: 'empty', files: [] }
  }

  // Check for package.json → Node project requiring execution.
  // Callers that need a static in-browser preview (dashboard thumbnails) pass
  // { skipNodeDetection: true } so the classifier falls through to react/html
  // detection and the iframe can render an approximation of the project.
  const hasPackageJson = codeFiles.some(f => f.path === 'package.json' || f.path?.endsWith('/package.json'))
  if (hasPackageJson && !options.skipNodeDetection) {
    return { type: 'node', files: codeFiles }
  }

  const htmlFiles = codeFiles.filter(f => f.path?.match(/\.html?$/i) && f.content)
  const cssFiles = codeFiles.filter(f => f.path?.match(/\.(css|scss)$/i) && f.content)
  const jsFiles = codeFiles.filter(f => f.path?.match(/\.js$/i) && f.content && !f.path.includes('node_modules'))
  const jsxFiles = codeFiles.filter(f => f.path?.match(/\.(jsx|tsx)$/i) && f.content)
  const tsFiles = codeFiles.filter(f => f.path?.match(/\.ts$/i) && f.content && !f.path.match(/\.d\.ts$/i))

  const allCode = codeFiles.map(f => f.content || '').join('\n')
  const usesTailwind = allCode.includes('tailwind') ||
    /class(?:Name)?=["'][^"']*(?:flex|grid|text-|bg-|p-|m-|rounded|shadow|border|w-|h-|gap-)/.test(allCode)
  const usesReact = allCode.includes('import React') || allCode.includes('from "react"') ||
    allCode.includes("from 'react'") || allCode.includes('useState') ||
    allCode.includes('jsx') || jsxFiles.length > 0

  if (htmlFiles.length > 0) {
    const indexHtml = htmlFiles.find(f => f.path.match(/(^|\/)index\.html?$/i))
    if (indexHtml) {
      const c = indexHtml.content
      const isFullDoc = c.includes('<!DOCTYPE') || c.includes('<html')
      const hasInlineStyles = /<style[\s>]/.test(c) && c.length > 500
      if (isFullDoc && hasInlineStyles) {
        return { type: 'html', htmlFiles: [indexHtml], cssFiles, jsFiles, usesTailwind }
      }
    }
    if (!usesReact) {
      return { type: 'html', htmlFiles, cssFiles, jsFiles, usesTailwind }
    }
  }

  if (usesReact || jsxFiles.length > 0) {
    return { type: 'react', htmlFiles, cssFiles, jsFiles, jsxFiles, tsFiles, usesTailwind }
  }
  if (jsFiles.length > 0) {
    return { type: 'js', htmlFiles, cssFiles, jsFiles, usesTailwind }
  }
  if (cssFiles.length > 0) {
    return { type: 'css-only', cssFiles, usesTailwind }
  }
  return { type: 'unsupported', files }
}

// ─── Regex helper ──────────────────────────────────────────────────
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Build: React/JSX preview uses AST-based transforms (see buildReactPreview) ──

// ─── Build: HTML/CSS/JS ────────────────────────────────────────────
// Exported alongside buildReactPreview for ProjectThumbnail use.
export function buildHtmlPreview({ htmlFiles, cssFiles, jsFiles, usesTailwind }) {
  let html = htmlFiles[0].content

  if (usesTailwind && !html.includes('tailwindcss')) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n<script src="https://cdn.tailwindcss.com/3.4.17"><\/script>`)
  }

  for (const cssFile of cssFiles) {
    const fileName = cssFile.path.split('/').pop()
    const linkPattern = new RegExp('<link[^>]*href=["\'](?:\\.\\/)?' + escapeRegex(fileName) + '["\'][^>]*\\/?>', 'gi')
    if (linkPattern.test(html)) {
      html = html.replace(linkPattern, '<style>\n' + cssFile.content + '\n</style>')
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', '<style>\n' + cssFile.content + '\n</style>\n</head>')
    }
  }

  for (const jsFile of jsFiles) {
    const fileName = jsFile.path.split('/').pop()
    const scriptPattern = new RegExp('<script[^>]*src=["\'](?:\\.\\/)?' + escapeRegex(fileName) + '["\'][^>]*>\\s*<\\/script>', 'gi')
    if (scriptPattern.test(html)) {
      html = html.replace(scriptPattern, '<script>\n' + jsFile.content + '\n<\/script>')
    }
  }

  return wrapWithErrorHandler(html)
}

// ─── Build: React/JSX (AST-based module transform — no regex hacks) ──
// EXPORTED so ProjectThumbnail can build a real preview iframe srcDoc
// for projects that don't yet have a saved snapshot. Pure function
// (no React state, no side effects) — safe to call from any component.
export function buildReactPreview({ cssFiles, jsFiles, jsxFiles, tsFiles, usesTailwind, imageAssets }) {
  // Strip @tailwind directives from CSS — the CDN handles these automatically
  const allCss = (cssFiles?.map(f => f.content).join('\n') || '')
    .replace(/@tailwind\s+(base|components|utilities)\s*;?\s*/g, '')
    .trim()
  const normalizePreviewPath = (p = '') => String(p).replace(/^\.\//, '')

  const componentFiles = [...(jsxFiles || []), ...(tsFiles || [])].filter(f => {
    const p = normalizePreviewPath(f.path)
    return !/\.d\.ts$/.test(p)
  })

  const reactJsFiles = (jsFiles || []).filter(f => {
    const c = f.content || ''
    return (
      c.includes('React') ||
      c.includes('useState') ||
      c.includes('export default') ||
      /<\/?[A-Z]/.test(c)
    )
  })

  const allComponents = [...componentFiles, ...reactJsFiles]

  // Filter out CRA-style entry files that just call ReactDOM.render/createRoot
  // These create competing React roots and serve no purpose in the preview
  const filteredComponents = allComponents.filter(f => {
    const c = f.content || ''
    const p = normalizePreviewPath(f.path)
    // Exclude files like src/index.js that are just bootstrap files
    if (/(?:^|\/)index\.(js|ts)$/i.test(p) && c.includes('createRoot') && !/<\/?[A-Z]/.test(c.replace(/ReactDOM|React\.StrictMode/g, ''))) {
      return false
    }
    return true
  })

  const entryFile =
    filteredComponents.find(f => /App\.(jsx|tsx|js)$/i.test(normalizePreviewPath(f.path))) ||
    filteredComponents.find(f => /index\.(jsx|tsx|js)$/i.test(normalizePreviewPath(f.path))) ||
    filteredComponents.find(f => /page\.(jsx|tsx|js)$/i.test(normalizePreviewPath(f.path))) ||
    filteredComponents[0] ||
    null

  // For streaming shells: return a valid empty shell even without files
  const isEmptyShell = !entryFile

  const entryName = isEmptyShell ? 'App' : normalizePreviewPath(entryFile.path)
    .replace(/\.(jsx|tsx|js|ts)$/, '')
    .split('/')
    .pop()

  // Collect raw file data — Babel AST plugin handles all module transforms
  const fileEntries = isEmptyShell ? [] : filteredComponents.map(f => ({
    path: f.path,
    modName: f.path.replace(/^\.\//, '').replace(/\.(jsx|tsx|js|ts)$/, '').split('/').pop(),
    code: f.content || ''
  }))

  // Sort: entry file goes last so all dependencies compile first
  if (!isEmptyShell) {
    fileEntries.sort((a, b) => (a.modName === entryName ? 1 : 0) - (b.modName === entryName ? 1 : 0))
  }

  // JSON-safe embedding: escape < to prevent </script> breakout in srcDoc
  const filesJson = JSON.stringify(fileEntries).replace(/</g, '\\u003c')
  const entryJson = JSON.stringify(entryName).replace(/</g, '\\u003c')

  const html = [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Preview</title>',
    usesTailwind ? '<script src="https://cdn.tailwindcss.com/3.4.17"><\/script>' : '',
    usesTailwind ? `<script>
      if (window.tailwind) {
        tailwind.config = {
          theme: {
            extend: {
              colors: {
                accent: { DEFAULT: '#6366f1', dark: '#4f46e5', light: '#818cf8' },
                'dark-premium': '#0f0f0f',
                'dark-card': '#1a1a1a',
                'dark-border': '#2a2a2a',
                primary: { DEFAULT: '#6366f1', dark: '#4f46e5', light: '#818cf8' },
                secondary: { DEFAULT: '#ec4899', dark: '#db2777', light: '#f472b6' },
              }
            }
          }
        }
      }
    <\/script>` : '',
    '<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #fff; }',
    allCss,
    '</style>',
    '<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin><\/script>',
    '<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin><\/script>',
    '<script src="https://unpkg.com/react-router-dom@6.13.0/umd/react-router-dom.production.min.js" crossorigin><\/script>',
    // Pin Babel to v7. Babel 8 (auto-served from unpinned URL) removed the
    // `isTSX` / `allExtensions` options from @babel/preset-typescript, which
    // makes every .tsx file in every project fail to compile and surfaces a
    // "Preview Compile Error" red screen in both the live preview and the
    // dashboard thumbnail iframes.
    '<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"><\/script>',
    '</head><body><div id="root"></div>',
    // Inject generated image asset mapping so placeholder URLs resolve to real data
    imageAssets && imageAssets.length > 0 ? [
      '<script>',
      'window.__GEN_IMAGE_MAP__ = ' + JSON.stringify(
        Object.fromEntries(imageAssets.map(a => [a.placeholder, a.dataUrl]))
      ).replace(/</g, '\\u003c') + ';',
      '/* Virtual filesystem — merges pre-injected brand-asset paths with anything',
      '   a later-loading components/assets.js module registers at runtime. */',
      'window.__EMANATOR_VFS__ = Object.assign({}, window.__EMANATOR_VFS__ || {}, window.__GEN_IMAGE_MAP__);',
      '/* Strip leading ./ and optional public/ so "./logo.png" and "public/logo.png"',
      '   both resolve to the same VFS key "/logo.png". */',
      'window.__normalizeVfsKey = function(s) {',
      '  var v = String(s || "");',
      '  v = v.replace(/^\\.\\//, "/");',
      '  if (v.charAt(0) !== "/") v = "/" + v;',
      '  v = v.replace(/^\\/public\\//, "/");',
      '  return v;',
      '};',
      '/* Some imported apps reference assets with a project-name prefix like',
      '   /assets/mangia-mama/ui/logo.png. The actual file lives at',
      '   /ui/logo.png in the VFS. This helper tries the original key first,',
      '   then strips a /assets/{anything}/ prefix as a second pass. */',
      'window.__resolveVfsKey = function(key, map) {',
      '  if (map[key]) return map[key];',
      '  var stripped = key.replace(/^\\/assets\\/[^/]+\\//, "/");',
      '  if (stripped !== key && map[stripped]) return map[stripped];',
      '  /* Last-resort: match by file basename — works for unique filenames. */',
      '  var basename = key.split("/").pop();',
      '  if (basename) {',
      '    var keys = Object.keys(map);',
      '    for (var i = 0; i < keys.length; i++) {',
      '      if (keys[i].endsWith("/" + basename)) return map[keys[i]];',
      '    }',
      '  }',
      '  return null;',
      '};',
      '/* After each render, replace placeholder/path image URLs with actual data. */',
      'window.__fixImages = function() {',
      '  var map = Object.assign({}, window.__GEN_IMAGE_MAP__ || {}, window.__EMANATOR_VFS__ || {});',
      '  var keys = Object.keys(map);',
      '  if (keys.length === 0) return;',
      '  document.querySelectorAll("img").forEach(function(img) {',
      '    var src = img.getAttribute("src") || "";',
      '    if (src.indexOf("data:") === 0) return;',
      '    /* 1. substring match on full placeholder URLs (stock/generated images) */',
      '    for (var i = 0; i < keys.length; i++) {',
      '      var k = keys[i];',
      '      if (k.charAt(0) !== "/" && src.indexOf(k) !== -1) { img.src = map[k]; return; }',
      '    }',
      '    /* 2. path-form VFS resolve (leading slash + ./ + public/) — now',
      '       falls through to project-prefix stripping + basename matching */',
      '    var norm = window.__normalizeVfsKey(src);',
      '    var resolved = window.__resolveVfsKey(norm, map);',
      '    if (resolved) { img.src = resolved; return; }',
      '  });',
      '  /* Also fix CSS background-image url(...) references */',
      '  document.querySelectorAll("[style]").forEach(function(el) {',
      '    var s = el.getAttribute("style") || "";',
      '    if (!/url\\(/.test(s)) return;',
      '    var changed = false;',
      '    keys.forEach(function(k) {',
      '      if (s.indexOf(k) !== -1) { s = s.split(k).join(map[k]); changed = true; }',
      '    });',
      '    if (changed) el.setAttribute("style", s);',
      '  });',
      '};',
      '/* Run image fixer after initial render and on every DOM mutation */',
      'new MutationObserver(function() { window.__fixImages(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src","style"] });',
      '/* Safety: run image fixer after short delays in case MutationObserver missed initial render */',
      'setTimeout(function() { window.__fixImages(); }, 500);',
      'setTimeout(function() { window.__fixImages(); }, 2000);',
      '<\/script>',
    ].join('\n') : '',
    '<script>',
    'var { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, useLayoutEffect, useDeferredValue, useTransition, useId, useSyncExternalStore, createContext, createElement, Fragment, memo, forwardRef, lazy, Suspense } = React;',
    'var createRoot = ReactDOM.createRoot;',
    'var exports = {}; var module = { exports: exports };',
    '',
    '/* React Router DOM globals */',
    'var _RR = typeof ReactRouterDOM !== "undefined" ? ReactRouterDOM : {};',
    '',
    '/* Use MemoryRouter for iframe srcdoc (no real URLs to route against) */',
    'var MemoryRouter = _RR.MemoryRouter || function(p){return createElement("div",null,p.children);};',
    'var BrowserRouter = MemoryRouter;',
    'var HashRouter = MemoryRouter;',
    'var Router = MemoryRouter;',
    '',
    '/* Custom v5-compatible Route: handles component, render, element, and children props */',
    'var Route = function(props) {',
    '  if (props.element) return props.element;',
    '  var C = props.component;',
    '  if (C) return createElement(C, props);',
    '  if (props.render) return props.render(props);',
    '  if (props.children) return typeof props.children === "function" ? props.children(props) : props.children;',
    '  return null;',
    '};',
    '',
    '/* Custom v5-compatible Switch: renders first matching Route child */',
    'var Switch = function(props) {',
    '  var children = React.Children.toArray(props.children);',
    '  var loc;',
    '  try { loc = _RR.useLocation ? _RR.useLocation() : {pathname:"/"}; } catch(e) { loc = {pathname:"/"}; }',
    '  for (var i = 0; i < children.length; i++) {',
    '    var child = children[i];',
    '    if (!child || !child.props) continue;',
    '    var rPath = child.props.path;',
    '    if (!rPath) return child;',
    '    var isExact = child.props.exact;',
    '    if (isExact ? loc.pathname === rPath : loc.pathname.indexOf(rPath) === 0) return child;',
    '  }',
    '  return null;',
    '};',
    '',
    '/* v6 Routes — wrap with v6 API or fall back to Switch */',
    'var Routes = _RR.Routes || Switch;',
    '',
    '/* Navigation */',
    'var Link = _RR.Link || function(p){return createElement("a",{href:p.to||"#",onClick:function(e){e.preventDefault();}},p.children);};',
    'var NavLink = _RR.NavLink || Link;',
    'var Navigate = _RR.Navigate || function(){return null;};',
    'var Outlet = _RR.Outlet || function(){return null;};',
    'var useNavigate = _RR.useNavigate || function(){return function(){};};',
    'var useParams = _RR.useParams || function(){return {};};',
    'var useLocation = _RR.useLocation || function(){return {pathname:"/",search:"",hash:""};};',
    'var useSearchParams = _RR.useSearchParams || function(){return [new URLSearchParams(),function(){}];};',
    '',
    '/* React Router v5 compat */',
    'var Redirect = Navigate;',
    'var withRouter = function(C){return C;};',
    'var useHistory = function(){var nav = useNavigate(); return {push:nav,replace:nav,goBack:function(){},listen:function(){return function(){};},location:useLocation()};};',
    'var useRouteMatch = _RR.useRouteMatch || function(){return {path:"/",url:"/",params:{}};};',
    '',
    '/* Stub factory for missing third-party libs */',
    'function __stubIcon(name){return function(p){return createElement("span",{className:(p&&p.className)||"","data-icon":name,"aria-hidden":"true"},name?name[0]:"");};};',
    'function __stubComponent(name){return function(p){return createElement("div",{"data-stub":name},p&&p.children);};};',
    '',
    '/* Module stubs — imports from unknown packages resolve here instead of crashing */',
    'window.__MODULE_STUBS__ = {',
    '  "react": React,',
    '  "react-dom": ReactDOM,',
    '  "react-dom/client": { createRoot: ReactDOM.createRoot },',
    '  "react-router-dom": _RR,',
    '};',
    '',
    '/* Icon library stub — returns a simple SVG placeholder for any icon name */',
    'var __iconProxy = typeof Proxy !== "undefined" ? new Proxy({}, {',
    '  get: function(_, name) {',
    '    if (typeof name !== "string") return undefined;',
    '    return function(p) { return createElement("svg", { width: p&&p.size||p&&p.width||20, height: p&&p.size||p&&p.height||20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className: (p&&p.className)||"", style: p&&p.style }, createElement("circle",{cx:"12",cy:"12",r:"10"})); };',
    '  }',
    '}) : {};',
    'window.__MODULE_STUBS__["lucide-react"] = __iconProxy;',
    'window.__MODULE_STUBS__["@heroicons/react/24/solid"] = __iconProxy;',
    'window.__MODULE_STUBS__["@heroicons/react/24/outline"] = __iconProxy;',
    'window.__MODULE_STUBS__["@heroicons/react/20/solid"] = __iconProxy;',
    'window.__MODULE_STUBS__["react-icons/fi"] = __iconProxy;',
    'window.__MODULE_STUBS__["react-icons/hi"] = __iconProxy;',
    'window.__MODULE_STUBS__["react-icons/fa"] = __iconProxy;',
    '',
    '/* framer-motion stub */',
    'var __motionProxy = typeof Proxy !== "undefined" ? new Proxy({}, {',
    '  get: function(_, tag) { if (typeof tag !== "string") return undefined; return function(p){return createElement(tag,Object.assign({},p,{initial:undefined,animate:undefined,exit:undefined,whileHover:undefined,whileTap:undefined,transition:undefined,variants:undefined}),p&&p.children);}; }',
    '}) : {};',
    'var motion = __motionProxy;',
    'var AnimatePresence = function(p){return createElement(Fragment,null,p&&p.children);};',
    'window.__MODULE_STUBS__["framer-motion"] = { motion: __motionProxy, AnimatePresence: AnimatePresence, useAnimation: function(){return {};}, useInView: function(){return false;}, useScroll: function(){return {scrollY:0,scrollYProgress:0};} };',
    '',
    '/* next/image stub — convert <Image src="..." /> to a normal <img> tag.',
    '   Imported Next.js apps frequently use this; without the stub, every',
    '   <Image> call would crash because next/image relies on a Next.js',
    '   server pipeline that obviously doesn\'t exist in our preview iframe. */',
    'function __NextImage(p) {',
    '  var props = p || {};',
    '  var src = typeof props.src === "string" ? props.src : (props.src && props.src.src) || "";',
    '  var resolved = src;',
    '  /* Try the VFS for relative paths */',
    '  if (typeof src === "string" && src.charAt(0) !== "h" /* not http(s)/data */) {',
    '    var key = src.charAt(0) === "/" ? src : "/" + src;',
    '    key = key.replace(/^\\/public\\//, "/");',
    '    var hit = window.__EMANATOR_VFS__ && window.__EMANATOR_VFS__[key];',
    '    if (hit) resolved = hit;',
    '  }',
    '  /* Strip Next-specific props that <img> doesn\'t understand */',
    '  var imgProps = { src: resolved };',
    '  if (props.alt !== undefined) imgProps.alt = props.alt;',
    '  if (props.width !== undefined) imgProps.width = props.width;',
    '  if (props.height !== undefined) imgProps.height = props.height;',
    '  if (props.className !== undefined) imgProps.className = props.className;',
    '  if (props.style !== undefined) imgProps.style = props.style;',
    '  if (props.onClick !== undefined) imgProps.onClick = props.onClick;',
    '  if (props.loading !== undefined) imgProps.loading = props.loading;',
    '  return createElement("img", imgProps);',
    '}',
    'window.__MODULE_STUBS__["next/image"] = { default: __NextImage };',
    'window.__MODULE_STUBS__["next/legacy/image"] = { default: __NextImage };',
    '',
    '/* next/link stub — collapse to <a> tag */',
    'function __NextLink(p) {',
    '  var props = p || {};',
    '  var href = typeof props.href === "string" ? props.href : (props.href && props.href.pathname) || "#";',
    '  return createElement("a", { href: href, className: props.className, style: props.style, onClick: function(e){ if (props.onClick) props.onClick(e); else e.preventDefault(); } }, props.children);',
    '}',
    'window.__MODULE_STUBS__["next/link"] = { default: __NextLink };',
    '',
    '/* next/navigation stubs — most-used hooks */',
    'window.__MODULE_STUBS__["next/navigation"] = {',
    '  useRouter: function(){ return { push: function(){}, replace: function(){}, back: function(){}, refresh: function(){}, prefetch: function(){} }; },',
    '  usePathname: function(){ return typeof location !== "undefined" ? location.pathname : "/"; },',
    '  useSearchParams: function(){ return new URLSearchParams(); },',
    '  redirect: function(){},',
    '  notFound: function(){},',
    '};',
    'window.__MODULE_STUBS__["next/router"] = {',
    '  useRouter: function(){ return { push: function(){}, replace: function(){}, back: function(){}, pathname: "/", query: {}, asPath: "/", events: { on: function(){}, off: function(){} } }; },',
    '};',
    '',
    '/* Radix UI stub — imported apps use ~10 different @radix-ui/* primitive',
    '   packages (Dialog, Tabs, Switch, Tooltip, etc.). Each exports Root,',
    '   Trigger, Content, Portal, Overlay, etc. as React.forwardRef components.',
    '   Source files that wrap them with shadcn-style Tailwind do',
    '   `Trigger.displayName = "AccordionPrimitive.Trigger"` which crashes',
    '   when the namespace is undefined. The Proxy below returns a stub',
    '   component for ANY property access so all 100+ Radix subcomponents',
    '   resolve to harmless <div>s that render their children.            */',
    'function __radixProxy(packageName) {',
    '  if (typeof Proxy === "undefined") return {};',
    '  return new Proxy(function(){}, {',
    '    get: function(_, name) {',
    '      if (typeof name !== "string") return undefined;',
    '      if (name === "default") return __radixProxy(packageName);',
    '      var stub = function(p) { return createElement("div", { "data-radix": packageName + "." + name, className: (p&&p.className)||"" }, p && p.children); };',
    '      stub.displayName = packageName + "." + name;',
    '      return stub;',
    '    },',
    '    apply: function() { return null; }',
    '  });',
    '}',
    '/* Pre-register the most common Radix primitives so source files that',
    '   reference them as `AccordionPrimitive.Root` (without an import for',
    '   `AccordionPrimitive` itself) also resolve. */',
    '["Accordion","AlertDialog","Avatar","Checkbox","Collapsible","ContextMenu","Dialog","DropdownMenu","HoverCard","Label","Menubar","NavigationMenu","Popover","Progress","RadioGroup","ScrollArea","Select","Separator","Slider","Switch","Tabs","Toast","Toggle","ToggleGroup","Tooltip","Slot"].forEach(function(name) {',
    '  var pkg = "@radix-ui/react-" + name.replace(/([a-z])([A-Z])/g,"$1-$2").toLowerCase();',
    '  var p = __radixProxy(name + "Primitive");',
    '  window.__MODULE_STUBS__[pkg] = p;',
    '  /* Also expose as a global alias so files that don\'t import the namespace still resolve */',
    '  if (typeof window[name + "Primitive"] === "undefined") window[name + "Primitive"] = p;',
    '});',
    '',
    '/* Phaser game engine stub — imported games can\'t actually run in the',
    '   preview (needs WebGL + asset loading + game loop) but at least the',
    '   import + class instantiation should not crash the whole page so the',
    '   menu / UI parts of the game render. */',
    'window.__MODULE_STUBS__["phaser"] = (function() {',
    '  function NoOp() {}',
    '  NoOp.prototype = { add: function(){return this;}, on: function(){return this;}, off: function(){return this;} };',
    '  var P = {',
    '    Game: NoOp, Scene: NoOp, AUTO: 0, WEBGL: 1, CANVAS: 2,',
    '    Scale: { FIT: "fit", CENTER_BOTH: "center", RESIZE: "resize", NONE: "none" },',
    '    Math: { Between: function(a,b){return Math.floor(a+Math.random()*(b-a));}, Clamp: function(v,lo,hi){return Math.max(lo,Math.min(hi,v));} },',
    '    Input: { Keyboard: { KeyCodes: {} } },',
    '    Display: { Color: { GetColor: function(){return 0xffffff;} } },',
    '  };',
    '  return Object.assign({ default: P }, P);',
    '})();',
    '',
    '/* Generic UNKNOWN-package fallback — for any other imported package',
    '   we don\'t explicitly know about (zustand, swr, dayjs, etc), the',
    '   Proxy stubs out function imports as no-ops returning null/{} so',
    '   nothing crashes at import-evaluation time. Concrete imports ',
    '   (lucide-react, framer-motion, etc.) above take precedence. */',
    'window.__UNKNOWN_PKG_STUB__ = typeof Proxy !== "undefined" ? new Proxy(function(){return {};}, {',
    '  get: function(_, name) {',
    '    if (typeof name !== "string") return undefined;',
    '    if (name === "default") return window.__UNKNOWN_PKG_STUB__;',
    '    /* PascalCase → component, lowerCamel → no-op function returning {} */',
    '    if (/^[A-Z]/.test(name)) return __stubComponent(name);',
    '    return function() { return {}; };',
    '  },',
    '  apply: function() { return {}; }',
    '}) : {};',
    '',
    '/* Mock Audio/Video to prevent media errors in sandbox */',
    'window.Audio = window.Audio || function(src) { this.src = src||""; this.play = function(){ return Promise.resolve(); }; this.pause = function(){}; this.load = function(){}; this.addEventListener = function(){}; this.removeEventListener = function(){}; this.volume = 1; this.currentTime = 0; this.duration = 0; };',
    '',
    'window.__COMPONENTS__ = {};',
    'window.__NAMED__ = {};',
    '',
    '/* Named import resolver — for `import { useAuth } from "./X"` where useAuth is a function/hook, */',
    '/* NOT a component. Returns a wrapper that looks up the real function at call time so eval order doesn\'t matter. */',
    'function __namedImport(mn, name) {',
    '  return function() {',
    '    var ns = window.__NAMED__[mn];',
    '    var fn = ns && ns[name];',
    '    if (typeof fn === "function") return fn.apply(this, arguments);',
    '    /* Fallback: maybe it was actually meant as a component */',
    '    var C = window.__COMPONENTS__[name];',
    '    if (C) return React.createElement.apply(React, [C].concat(Array.prototype.slice.call(arguments)));',
    '    return null;',
    '  };',
    '}',
    '',
    '/* Global safety net — some LLM-generated files reference hooks WITHOUT importing them. */',
    '/* Pre-declare common hook names on window so bare references fall back to __NAMED__ registry. */',
    '/* These are shadowed by local `var useAuth = __namedImport(...)` in files that properly import. */',
    '["useAuth", "useMockAPI"].forEach(function(hookName) {',
    '  if (typeof window[hookName] === "undefined") {',
    '    window[hookName] = function() {',
    '      for (var m in window.__NAMED__) {',
    '        var ns = window.__NAMED__[m];',
    '        if (ns && typeof ns[hookName] === "function") return ns[hookName].apply(this, arguments);',
    '      }',
    '      return {};',
    '    };',
    '  }',
    '});',
    '',
    '/* Lazy component wrapper — resolves at render time, not at compile time */',
    '/* Fixes cross-file import order: if Home imports Header but Header compiles later, */',
    '/* the lazy wrapper defers the lookup until render when all components are available */',
    'function __lazy(modName) {',
    '  var w = React.forwardRef(function(props, ref) {',
    '    var C = window.__COMPONENTS__[modName] || window[modName];',
    '    if (!C || C === w) {',
    '      /* Component not found — render children if provided, otherwise null */',
    '      if (props && props.children) return typeof props.children === "function" ? null : React.createElement(Fragment, null, props.children);',
    '      return null;',
    '    }',
    '    var p = Object.assign({}, props);',
    '    if (ref) p.ref = ref;',
    '    return React.createElement(C, p);',
    '  });',
    '  w.displayName = "Lazy(" + modName + ")";',
    '  w.__isLazy = true;',
    '  w.__modName = modName;',
    '  return w;',
    '}',
    '',
    '/* AST-based module transform plugin — replaces all regex rewriting */',
    'function __mkPlugin(mn) {',
    '  return function(b) {',
    '    var t = b.types;',
    '    function tgt() { return t.memberExpression(t.memberExpression(t.identifier("window"), t.identifier("__COMPONENTS__")), t.stringLiteral(mn), true); }',
    '    return { visitor: {',
    '      ImportDeclaration: function(p) {',
    '        /* Resolve named imports from known modules to globals */',
    '        var src = p.node.source.value;',
    '        var stubs = window.__MODULE_STUBS__[src];',
    '        if (stubs) {',
    '          var specs = p.node.specifiers || [];',
    '          for (var si = 0; si < specs.length; si++) {',
    '            var s = specs[si];',
    '            if (s.type === "ImportDefaultSpecifier" && stubs.default) {',
    '              try { window[s.local.name] = stubs.default; } catch(e){}',
    '            } else if (s.type === "ImportSpecifier") {',
    '              var imp = s.imported ? s.imported.name : s.local.name;',
    '              if (stubs[imp] && !window[s.local.name]) { try { window[s.local.name] = stubs[imp]; } catch(e){} }',
    '            }',
    '          }',
    '          p.remove();',
    '          return;',
    '        }',
    '        /* Local imports: resolve from __COMPONENTS__ registry via lazy wrappers */',
    '        if (src.charAt(0) === "." || src.charAt(0) === "/") {',
    '          /* Skip asset imports (.svg, .css, .png, .jpg, .gif, .webp, .ico, .module.css) */',
    '          if (/\\.(svg|css|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp[34]|module\\.css)$/i.test(src)) {',
    '            var assetSpecs = p.node.specifiers || [];',
    '            var assetDecls = [];',
    '            /* Resolve image/font imports against the VFS so',
    '               `import logo from "./logo.png"` becomes a real',
    '               data URL at runtime. We compute the canonical VFS',
    '               key from the import path (./, ../, leading slash),',
    '               and emit:  var logo = (window.__EMANATOR_VFS__ &&',
    '                          window.__EMANATOR_VFS__[KEY]) || ""    */',
    '            var vfsLookup = function(impPath) {',
    '              var k = String(impPath || "");',
    '              k = k.replace(/^\\.\\//, "/");',
    '              k = k.replace(/^\\.\\.\\//, "/");',
    '              if (k.charAt(0) !== "/") k = "/" + k;',
    '              k = k.replace(/^\\/public\\//, "/");',
    '              return k;',
    '            };',
    '            var vfsKey = vfsLookup(src);',
    '            /* Build expression: (window.__EMANATOR_VFS__ && window.__EMANATOR_VFS__[VFS_KEY]) || "" */',
    '            var vfsExpr = t.logicalExpression("||",',
    '              t.logicalExpression("&&",',
    '                t.memberExpression(t.identifier("window"), t.identifier("__EMANATOR_VFS__")),',
    '                t.memberExpression(t.memberExpression(t.identifier("window"), t.identifier("__EMANATOR_VFS__")), t.stringLiteral(vfsKey), true)',
    '              ),',
    '              t.stringLiteral("")',
    '            );',
    '            for (var ai = 0; ai < assetSpecs.length; ai++) {',
    '              var as = assetSpecs[ai];',
    '              if (as.type === "ImportDefaultSpecifier") {',
    '                /* Default import from image/font: VFS-resolved data URL or empty string */',
    '                assetDecls.push(t.variableDeclaration("var",[t.variableDeclarator(as.local, vfsExpr)]));',
    '              } else if (as.type === "ImportSpecifier" && as.imported && as.imported.name === "ReactComponent") {',
    '                /* SVG as React component: import { ReactComponent as X } from "./file.svg" */',
    '                assetDecls.push(t.variableDeclaration("var",[t.variableDeclarator(as.local, t.callExpression(t.identifier("__stubIcon"),[t.stringLiteral(as.local.name)]))]));',
    '              } else {',
    '                assetDecls.push(t.variableDeclaration("var",[t.variableDeclarator(as.local, t.callExpression(t.identifier("__stubComponent"),[t.stringLiteral(as.local.name)]))]));',
    '              }',
    '            }',
    '            if (assetDecls.length > 0) { p.replaceWithMultiple(assetDecls); } else { p.remove(); }',
    '            return;',
    '          }',
    '          var localMod = src.replace(/^\\.\\//,"").replace(/\\.\\.\\//g,"").replace(/\\.(jsx|tsx|js|ts)$/,"").split("/").pop();',
    '          var decls = [];',
    '          var localSpecs = p.node.specifiers || [];',
    '          for (var li = 0; li < localSpecs.length; li++) {',
    '            var ls = localSpecs[li];',
    '            if (ls.type === "ImportDefaultSpecifier") {',
    '              decls.push(t.variableDeclaration("var",[t.variableDeclarator(ls.local, t.callExpression(t.identifier("__lazy"),[t.stringLiteral(localMod)]))]));',
    '            } else if (ls.type === "ImportSpecifier") {',
    '              var impN = ls.imported ? ls.imported.name : ls.local.name;',
    '              /* Named imports from local files = functions/hooks/values (NOT components). */',
    '              /* `useAuth` is a hook, not a React component — use __namedImport to resolve at call time. */',
    '              /* PascalCase-named imports fall back to __lazy for the rare case of named component exports. */',
    '              var isPascal = /^[A-Z]/.test(impN);',
    '              var resolver = isPascal ? "__lazy" : "__namedImport";',
    '              var args = isPascal ? [t.stringLiteral(impN)] : [t.stringLiteral(localMod), t.stringLiteral(impN)];',
    '              decls.push(t.variableDeclaration("var",[t.variableDeclarator(ls.local, t.callExpression(t.identifier(resolver), args))]));',
    '            } else if (ls.type === "ImportNamespaceSpecifier") {',
    '              decls.push(t.variableDeclaration("var",[t.variableDeclarator(ls.local, t.objectExpression([]))]));',
    '            }',
    '          }',
    '          if (decls.length > 0) { p.replaceWithMultiple(decls); } else { p.remove(); }',
    '          return;',
    '        }',
    '        /* Unknown package import — generate stubs for imported names */',
    '        var unknownSpecs = p.node.specifiers || [];',
    '        var unknownDecls = [];',
    '        for (var ui = 0; ui < unknownSpecs.length; ui++) {',
    '          var us = unknownSpecs[ui];',
    '          unknownDecls.push(t.variableDeclaration("var",[t.variableDeclarator(us.local, t.callExpression(t.identifier("__stubComponent"),[t.stringLiteral(us.local.name)]))]));',
    '        }',
    '        if (unknownDecls.length > 0) { p.replaceWithMultiple(unknownDecls); } else { p.remove(); }',
    '      },',
    '      ExportDefaultDeclaration: function(p) {',
    '        var d = p.node.declaration;',
    '        if (t.isFunctionDeclaration(d) || t.isClassDeclaration(d)) {',
    '          if (!d.id) d.id = t.identifier("_Default");',
    '          p.replaceWithMultiple([d, t.expressionStatement(t.assignmentExpression("=", tgt(), d.id))]);',
    '        } else { p.replaceWith(t.expressionStatement(t.assignmentExpression("=", tgt(), d))); }',
    '      },',
    '      ExportNamedDeclaration: function(p) {',
    '        var d = p.node.declaration;',
    '        if (!d) { p.remove(); return; }',
    '        /* Register each named export on window.__NAMED__[modName][exportName] so other files can import it. */',
    '        var regs = [];',
    '        var ensureNamed = t.expressionStatement(t.assignmentExpression("=",',
    '          t.memberExpression(t.memberExpression(t.identifier("window"), t.identifier("__NAMED__")), t.stringLiteral(mn), true),',
    '          t.logicalExpression("||",',
    '            t.memberExpression(t.memberExpression(t.identifier("window"), t.identifier("__NAMED__")), t.stringLiteral(mn), true),',
    '            t.objectExpression([]))));',
    '        regs.push(ensureNamed);',
    '        var addReg = function(idName) {',
    '          regs.push(t.expressionStatement(t.assignmentExpression("=",',
    '            t.memberExpression(t.memberExpression(t.memberExpression(t.identifier("window"), t.identifier("__NAMED__")), t.stringLiteral(mn), true), t.identifier(idName)),',
    '            t.identifier(idName))));',
    '        };',
    '        if (t.isFunctionDeclaration(d) || t.isClassDeclaration(d)) {',
    '          if (d.id) addReg(d.id.name);',
    '          p.replaceWithMultiple([d].concat(regs));',
    '        } else if (t.isVariableDeclaration(d)) {',
    '          for (var vi = 0; vi < d.declarations.length; vi++) {',
    '            var vd = d.declarations[vi];',
    '            if (vd.id && vd.id.name) addReg(vd.id.name);',
    '          }',
    '          p.replaceWithMultiple([d].concat(regs));',
    '        } else {',
    '          p.replaceWith(d);',
    '        }',
    '      },',
    '      ExportAllDeclaration: function(p) { p.remove(); }',
    '    }};',
    '  };',
    '}',
    '',
    '/* Pre-register ALL known component names as lazy wrappers on window */',
    '/* This prevents ReferenceErrors when code uses bare identifiers without imports */',
    '/* (e.g., const routes = [{component: SocialMedia}] without an import statement) */',
    'var __files = ' + filesJson + ';',
    'for (var __p = 0; __p < __files.length; __p++) {',
    '  if (__files[__p].modName && !window[__files[__p].modName]) {',
    '    window[__files[__p].modName] = __lazy(__files[__p].modName);',
    '  }',
    '}',
    '',
    '/* Process each file through Babel with AST module transform */',
    '/* Per-file resilience: only use the typescript preset for .ts/.tsx files',
    '   (running it on plain .js/.jsx is wasted work and amplifies preset bugs),',
    '   and if compile fails retry without the typescript preset as a safety',
    '   net so a single bad file (or future preset breaking change) cannot',
    '   blank the whole preview. */',
    'function __presetsFor(filePath) {',
    '  var isTs = /\\.(tsx|ts)$/i.test(filePath || "");',
    '  if (isTs) return ["env", "react", ["typescript", { isTSX: true, allExtensions: true }]];',
    '  return ["env", "react"];',
    '}',
    'function __safeTransform(code, modName, filePath) {',
    '  try {',
    '    return Babel.transform(code, { presets: __presetsFor(filePath), plugins: [__mkPlugin(modName)], filename: filePath });',
    '  } catch (e) {',
    '    /* Fallback: drop typescript preset entirely. Real .tsx type annotations',
    '       may slip through but a partial render is far better than a red wall. */',
    '    if (/typescript|isTSX|allExtensions/i.test(String(e.message || ""))) {',
    '      try { return Babel.transform(code, { presets: ["env", "react"], plugins: [__mkPlugin(modName)], filename: filePath }); }',
    '      catch (e2) { throw e2; }',
    '    }',
    '    throw e;',
    '  }',
    '}',
    'var __errs = [];',
    'for (var __i = 0; __i < __files.length; __i++) {',
    '  try {',
    '    exports = {}; module = { exports: exports };',
    '    var __r = __safeTransform(__files[__i].code, __files[__i].modName, __files[__i].path);',
    '    (0, eval)(__r.code);',
    '    /* Pick up CJS exports if plugin missed them */',
    '    if (!window.__COMPONENTS__[__files[__i].modName]) {',
    '      var _cjs = module.exports.default || module.exports;',
    '      if (typeof _cjs === "function") window.__COMPONENTS__[__files[__i].modName] = _cjs;',
    '    }',
    '    /* Expose compiled component as global for cross-file references */',
    '    if (window.__COMPONENTS__[__files[__i].modName]) { window[__files[__i].modName] = window.__COMPONENTS__[__files[__i].modName]; }',
    '  } catch(__e) {',
    '    __errs.push(__files[__i].path + ": " + __e.message);',
    '    console.error("[preview] Compile error in " + __files[__i].path + ":", __e);',
    '  }',
    '}',
    '',
    '/* Second pass: re-compile all files now that all components are registered */',
    '/* This fixes cross-file imports where File A imports File B but B compiled after A */',
    'for (var __j = 0; __j < __files.length; __j++) {',
    '  try {',
    '    exports = {}; module = { exports: exports };',
    '    var __r2 = __safeTransform(__files[__j].code, __files[__j].modName, __files[__j].path);',
    '    (0, eval)(__r2.code);',
    '    if (!window.__COMPONENTS__[__files[__j].modName]) {',
    '      var _cjs2 = module.exports.default || module.exports;',
    '      if (typeof _cjs2 === "function") window.__COMPONENTS__[__files[__j].modName] = _cjs2;',
    '    }',
    '    if (window.__COMPONENTS__[__files[__j].modName]) { window[__files[__j].modName] = window.__COMPONENTS__[__files[__j].modName]; }',
    '  } catch(__e2) { /* Errors already reported in first pass */ }',
    '}',
    '',
    '/* Mount entry component */',
    'try {',
    '  var _Entry = window.__COMPONENTS__[' + entryJson + '] || window.__COMPONENTS__["App"] || Object.values(window.__COMPONENTS__)[0];',
    '  if (_Entry) {',
    '    /* Wrap in error boundary to catch component-level render errors */',
    '    var _EB = function(props) { return props.children; };',
    '    try {',
    '      var _EBClass = (function(S) {',
    '        function EB(p) { S.call(this, p); this.state = { error: null }; }',
    '        EB.prototype = Object.create(S.prototype);',
    '        EB.prototype.constructor = EB;',
    '        EB.getDerivedStateFromError = function(e) { return { error: e }; };',
    '        EB.prototype.render = function() {',
    '          if (this.state.error) return React.createElement("div", { style: { padding: "2rem", fontFamily: "monospace", fontSize: "13px" } },',
    '            React.createElement("div", { style: { color: "#ef4444", fontWeight: "bold", marginBottom: "0.5rem" } }, "Render Error"),',
    '            React.createElement("div", { style: { color: "#f97316", whiteSpace: "pre-wrap" } }, String(this.state.error.message || this.state.error))',
    '          );',
    '          return this.props.children;',
    '        };',
    '        return EB;',
    '      })(React.Component);',
    '      _EB = _EBClass;',
    '    } catch(e) {}',
    '    window.__root__ = createRoot(document.getElementById("root"));',
    '    window.__root__.render(createElement(_EB, null, createElement(_Entry)));',
    '    /* Force Tailwind CDN to rescan DOM after React mount */',
    '    if (window.tailwind) { setTimeout(function() { document.body.classList.add("__tw"); document.body.classList.remove("__tw"); }, 50); }',
    '  }',
    '  else if (__errs.length) {',
    '    var _d = document.createElement("div"); _d.style.cssText = "padding:2rem;font-family:monospace;font-size:13px;white-space:pre-wrap;";',
    '    var _h = document.createElement("div"); _h.style.cssText = "color:#ff6b6b;font-weight:bold;margin-bottom:1rem;"; _h.textContent = "Preview Compile Error";',
    '    var _b = document.createElement("div"); _b.style.color = "#ef4444"; _b.textContent = __errs.join("\\n");',
    '    _d.appendChild(_h); _d.appendChild(_b); document.getElementById("root").appendChild(_d);',
    '    window.parent.postMessage({ type: "__PREVIEW_ERROR__", error: __errs.join("; ") }, "*");',
    '  }',
    '  else { document.getElementById("root").innerHTML = \'<div style="padding:3rem;text-align:center;color:#888;font-family:system-ui;background:#0a0a0a;min-height:100vh;display:flex;align-items:center;justify-content:center;"><div><div style="font-size:1.5rem;margin-bottom:0.5rem;color:#ccc;">Building preview...</div><div style="font-size:0.9rem;opacity:0.6;">Components will appear as they stream in</div></div></div>\'; }',
    '} catch (_e) {',
    '  document.getElementById("root").innerHTML = \'<div style="padding:2rem;color:#ef4444;font-family:monospace;white-space:pre-wrap;">Render Error: \' + String(_e.message).replace(/</g,"&lt;") + \'</div>\';',
    '  window.parent.postMessage({ type: "__PREVIEW_ERROR__", error: _e.message, stack: _e.stack }, "*");',
    '}',
    '',
    '/* Live update listener — streaming preview uses same AST transform */',
    'window.addEventListener("message", function(e) {',
    '  if (!e.data || e.data.type !== "live_update") return;',
    '  try {',
    '    /* Compute correct modName from file path (not entryName) */',
    '    var __modName = e.data.filePath ? e.data.filePath.replace(/^\\.\\//,"").replace(/\\.(jsx|tsx|js|ts)$/,"").split("/").pop() : e.data.entryName;',
    '    exports = {}; module = { exports: exports };',
    '    var _r = __safeTransform(e.data.code, __modName, e.data.filePath || (__modName + ".jsx"));',
    '    (0, eval)(_r.code);',
    '    if (!window.__COMPONENTS__[__modName]) { var _cjs2 = module.exports.default || module.exports; if (typeof _cjs2 === "function") window.__COMPONENTS__[__modName] = _cjs2; }',
    '    if (window.__COMPONENTS__[__modName]) { window[__modName] = window.__COMPONENTS__[__modName]; }',
    '    /* Render entry: prefer App, then entryName, then first available component */',
    '    var _entry = window.__COMPONENTS__["App"] || window.__COMPONENTS__[e.data.entryName] || Object.values(window.__COMPONENTS__)[0];',
    '    if (_entry && window.__root__) { window.__root__.render(createElement(_entry)); }',
    '    /* Force Tailwind rescan after live update */',
    '    if (window.tailwind) { setTimeout(function() { document.body.classList.add("__tw"); document.body.classList.remove("__tw"); }, 50); }',
    '  } catch(_err) { /* ignore errors during streaming — code may be partial */ }',
    '});',
    '<\/script></body></html>'
  ].join('\n')

  return wrapWithErrorHandler(html)
}

// ─── Build: CSS-only ───────────────────────────────────────────────
function buildCssPreview({ cssFiles, usesTailwind }) {
  const allCss = cssFiles.map(f => `/* ${f.path} */\n${f.content}`).join('\n\n')
  return wrapWithErrorHandler(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CSS Preview</title>
${usesTailwind ? '<script src="https://cdn.tailwindcss.com/3.4.17"><\/script>' : ''}
<style>${allCss}</style></head>
<body><div id="root" style="padding:2rem;font-family:system-ui;color:#666;">
<p>CSS loaded. Add an <code>index.html</code> file for full preview.</p>
</div></body></html>`)
}

// ─── Build: vanilla JS ─────────────────────────────────────────────
function buildJsPreview({ jsFiles, cssFiles, usesTailwind }) {
  const allCss = cssFiles?.map(f => f.content).join('\n') || ''
  const allJs = jsFiles.map(f => `// --- ${f.path} ---\n${f.content}`).join('\n;\n')
  return wrapWithErrorHandler(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JS Preview</title>
${usesTailwind ? '<script src="https://cdn.tailwindcss.com/3.4.17"><\/script>' : ''}
<style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family:system-ui; } ${allCss}</style></head>
<body><div id="root"></div>
<script>\n${allJs}\n<\/script>
</body></html>`)
}

// ─── Error handler + a11y auditor injected into every preview ─────────────────────
function wrapWithErrorHandler(html) {
  const errorScript = `<script>
window.onerror = function(msg, src, line, col, err) {
  window.parent.postMessage({ type: '__PREVIEW_ERROR__', error: msg, line: line, col: col, stack: err && err.stack || '' }, '*');
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  window.parent.postMessage({ type: '__PREVIEW_ERROR__', error: 'Unhandled Promise: ' + (e.reason && e.reason.message || e.reason) }, '*');
});
['log','warn','error','info'].forEach(function(level) {
  var orig = console[level];
  console[level] = function() {
    var args = Array.from(arguments).map(function(a) { try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(e) { return String(a); } });
    window.parent.postMessage({ type: '__PREVIEW_CONSOLE__', level: level, message: args.join(' ') }, '*');
    orig.apply(console, arguments);
  };
});
// Accessibility auditor — loads axe-core on demand and runs against the preview DOM.
// Parent frame sends { type: '__RUN_A11Y_AUDIT__' } and we respond with
// { type: '__PREVIEW_A11Y_RESULT__', violations, passes, incomplete, auditedAt }.
window.__emanatorRunAxe = function() {
  function run() {
    try {
      if (!window.axe) {
        window.parent.postMessage({ type: '__PREVIEW_A11Y_RESULT__', error: 'axe-core not loaded yet' }, '*');
        return;
      }
      window.axe.run(document, { resultTypes: ['violations', 'incomplete'] }).then(function(results) {
        var serialize = function(list) {
          return (list || []).slice(0, 50).map(function(r) {
            return {
              id: r.id,
              impact: r.impact,
              help: r.help,
              helpUrl: r.helpUrl,
              nodes: (r.nodes || []).slice(0, 5).map(function(n) { return { target: n.target, html: (n.html || '').slice(0, 180) } })
            };
          });
        };
        window.parent.postMessage({
          type: '__PREVIEW_A11Y_RESULT__',
          violations: serialize(results.violations),
          incomplete: serialize(results.incomplete),
          passes: (results.passes || []).length,
          auditedAt: new Date().toISOString()
        }, '*');
      }).catch(function(err) {
        window.parent.postMessage({ type: '__PREVIEW_A11Y_RESULT__', error: err.message || 'axe.run failed' }, '*');
      });
    } catch (err) {
      window.parent.postMessage({ type: '__PREVIEW_A11Y_RESULT__', error: err.message }, '*');
    }
  }
  if (window.axe) { run(); return; }
  // Lazy-load axe-core from unpkg the first time it's needed so we don't
  // bloat every preview load. ~400 KB gzipped.
  var s = document.createElement('script');
  s.src = 'https://unpkg.com/axe-core@4.10.0/axe.min.js';
  s.onload = run;
  s.onerror = function() {
    window.parent.postMessage({ type: '__PREVIEW_A11Y_RESULT__', error: 'Failed to load axe-core CDN' }, '*');
  };
  document.head.appendChild(s);
};
window.addEventListener('message', function(ev) {
  if (ev.data && ev.data.type === '__RUN_A11Y_AUDIT__') {
    window.__emanatorRunAxe();
  }
});
<\/script>`

  if (html.includes('<head')) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${errorScript}`)
  }
  return `<!DOCTYPE html><html><head>${errorScript}</head><body>${html}</body></html>`
}


// ═══════════════════════════════════════════════════════════════════
// Node Preview Runner UI
// ═══════════════════════════════════════════════════════════════════
function NodePreviewRunner({ project, files, onLog }) {
  const [status, setStatus] = useState('idle') // idle | starting | installing | running | failed | stopped
  const [logs, setLogs] = useState([])
  const [port, setPort] = useState(null)
  const [basePath, setBasePath] = useState('/')
  const pollingRef = useRef(null)
  const logsEndRef = useRef(null)

  const backendUrl = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_APP_URL || process.env.REACT_APP_BACKEND_URL || '')
    : ''

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Clean up on unmount or project change
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [project?.id])

  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`/api/preview/status/${project.id}`)
        if (!res.ok) return
        const data = await res.json()
        setStatus(data.status)
        setLogs(data.logs || [])
        if (data.status === 'running') {
          setPort(data.port)
          if (data.base_path) setBasePath(data.base_path)
          onLog?.('success', 'Preview server is running')
        }
        if (data.status === 'failed' || data.status === 'stopped' || data.status === 'none') {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      } catch { /* ignore */ }
    }, 2000)
  }, [project?.id, onLog])

  const handleStart = async () => {
    // Stop any existing preview first (full cleanup)
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    try { await authFetch(`/api/preview/stop/${project.id}`, { method: 'POST' }) } catch { /* ignore */ }

    // Reset all frontend state
    setStatus('starting')
    setLogs(['[emanator] Restart requested — creating fresh preview session...'])
    setPort(null)
    setBasePath('/')
    onLog?.('info', 'Starting preview...')

    try {
      const res = await authFetch('/api/preview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          files: files.filter(f => f.content != null).map(f => ({ path: f.path, content: f.content })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('failed')
        setLogs(['[emanator] Restart requested — creating fresh preview session...', `[error] ${data.error}`])
        onLog?.('error', `Preview start failed: ${data.error}`)
        return
      }
      setStatus(data.status)
      setPort(data.port)
      // Always poll — base_path is only available from the status endpoint
      startPolling()
    } catch (err) {
      setStatus('failed')
      setLogs(['[emanator] Restart requested — creating fresh preview session...', `[error] ${err.message}`])
      onLog?.('error', `Preview error: ${err.message}`)
    }
  }

  const handleStop = async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    try {
      await authFetch(`/api/preview/stop/${project.id}`, { method: 'POST' })
    } catch { /* ignore */ }
    setStatus('stopped')
    setPort(null)
    onLog?.('info', 'Preview stopped')
  }

  const previewUrl = port ? `${backendUrl}/api/preview/serve/${project.id}${basePath}` : null
  const isLoading = status === 'starting' || status === 'installing'
  const isRunning = status === 'running'
  const isFailed = status === 'failed'
  const isStopped = status === 'stopped'

  // Detect framework from package.json
  const pkgFile = files?.find(f => f.path === 'package.json' || f.path?.endsWith('/package.json'))
  let frameworkLabel = 'Node.js'
  if (pkgFile?.content) {
    try {
      const pkg = JSON.parse(pkgFile.content)
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      if (deps.next) frameworkLabel = 'Next.js'
      else if (deps['react-scripts']) frameworkLabel = 'Create React App'
      else if (deps.vite) frameworkLabel = 'Vite'
      else if (deps.express) frameworkLabel = 'Express'
      else if (deps.react) frameworkLabel = 'React'
    } catch { /* ignore */ }
  }

  // Idle state — show start button
  if (!isLoading && !isRunning && !isFailed && !isStopped) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-4" data-testid="preview-node-idle">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <Play className="w-7 h-7 text-emerald-400" />
        </div>
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-foreground" data-testid="preview-framework-label">{frameworkLabel} Project</p>
          <p className="text-xs mt-1.5 opacity-70 leading-relaxed">
            This project requires <code className="text-[10px] bg-muted/60 px-1 py-0.5 rounded">npm install</code> and a dev server to preview.
            Click below to start.
          </p>
        </div>
        <Button
          onClick={handleStart}
          className="gap-2"
          data-testid="preview-start-btn"
        >
          <Play className="w-4 h-4" /> Start Preview
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background" data-testid="preview-node-runner">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded ${
            isRunning ? 'bg-emerald-500/15 text-emerald-400' :
            isLoading ? 'bg-amber-500/15 text-amber-400' :
            isFailed ? 'bg-red-500/15 text-red-400' :
            'bg-muted/40 text-muted-foreground'
          }`} data-testid="preview-runner-status">
            {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            {isFailed && <AlertCircle className="w-3 h-3" />}
            {status === 'installing' ? 'Installing...' :
             status === 'starting' ? 'Starting...' :
             status === 'running' ? `Running (${frameworkLabel})` :
             status === 'failed' ? 'Failed' : 'Stopped'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isRunning && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5"
              onClick={() => {
                const iframe = document.querySelector('[data-testid="preview-node-iframe"]')
                if (iframe) iframe.src = iframe.src
              }}
              data-testid="preview-node-refresh">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          )}
          {(isRunning || isLoading) && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-red-400 hover:text-red-300"
              onClick={handleStop} data-testid="preview-stop-btn">
              <Square className="w-3.5 h-3.5" /> Stop
            </Button>
          )}
          {(isFailed || isStopped) && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5"
              onClick={handleStart} data-testid="preview-restart-btn">
              <RotateCcw className="w-3.5 h-3.5" /> Restart
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {isRunning && previewUrl ? (
        <div className="flex-1 overflow-hidden bg-white flex flex-col">
          <iframe
            key={previewUrl}
            src={previewUrl}
            title="Node Preview"
            className="flex-1 w-full border-0"
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
            data-testid="preview-node-iframe"
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Build Logs */}
      <div className="border-t border-border/40 bg-muted/20 max-h-52 min-h-[80px] overflow-auto" data-testid="preview-build-logs">
        <div className="flex items-center justify-between px-3 py-1 border-b border-border/30">
          <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Terminal className="w-3 h-3" /> Build Output
            {logs.length > 0 && <span className="opacity-50">({logs.length} lines)</span>}
          </span>
        </div>
        <div className="px-3 py-1 font-mono text-[10px] space-y-0 leading-relaxed">
          {logs.length === 0 ? (
            <div className="py-2 text-muted-foreground/50">No output yet</div>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={
                line.includes('[error]') || line.includes('ERR!') || line.includes('Error:') ? 'text-red-400' :
                line.includes('[warn') || line.includes('WARN') ? 'text-yellow-400' :
                line.startsWith('[emanator]') ? 'text-blue-400' :
                'text-muted-foreground'
              }>{line}</div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════
// Main PreviewTab Component
// ═══════════════════════════════════════════════════════════════════
export default function PreviewTab({ project, files, onLog, livePreviewData, isBuilding, onRefreshFiles, runtimeTestScript: externalRuntimeTestScript, generatedImageMap, serverPreviewRefreshRef: externalServerPreviewRefreshRef }) {
  const [viewportSize, setViewportSize] = useState('desktop')
  const [refreshKey, setRefreshKey] = useState(0)
  // Server is the only supported preview engine (Feb 2026 standardization).
  // The previous multi-engine state machine (Babel srcDoc / WebContainer /
  // server) has been removed — server-only via Fly Machines, see
  // docs/PREVIEW_ENGINE_STANDARDIZATION.md.
  // The Babel srcDoc fallback below is retained ONLY for live-streaming
  // build previews (before files are persisted), not as a switchable
  // engine.
  const [iframeErrors, setIframeErrors] = useState([])
  const [consoleLogs, setConsoleLogs] = useState([])
  const [showConsole, setShowConsole] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [a11y, setA11y] = useState(null) // { status: 'idle'|'running'|'done'|'error', violations, incomplete, passes, error }
  const [showA11y, setShowA11y] = useState(false)
  const iframeRef = useRef(null)
  const prevFilesRef = useRef(null)
  // Use the parent-provided ref if available (so useDashboardStream's
  // auto-refresh-after-AI-edit can call refresh directly), else fall back
  // to a local ref for older mounts/tests.
  const localServerPreviewRefreshRef = useRef(null)
  const serverPreviewRefreshRef = externalServerPreviewRefreshRef || localServerPreviewRefreshRef

  // ── Preview Snapshot: persist compiled HTML so re-entry shows exact same preview ──
  const [snapshotHtml, setSnapshotHtml] = useState(null)
  const [snapshotLoaded, setSnapshotLoaded] = useState(false)
  const snapshotSavedHashRef = useRef(null)
  const forceRecompileRef = useRef(false)

  // Compute a stable content hash from files
  const filesContentHash = useMemo(() => {
    if (!files?.length) return ''
    return files
      .filter(f => f.path && f.content != null)
      .map(f => `${f.path}:${typeof f.content === 'string' ? f.content.length : 0}:${f.updated_at || ''}`)
      .sort()
      .join('|')
  }, [files])

  // Load snapshot on project entry
  useEffect(() => {
    if (!project?.id) { setSnapshotLoaded(true); return }
    setSnapshotLoaded(false)
    authFetch(`/api/projects/${project.id}/preview-snapshot`)
      .then(r => r.ok ? r.json() : { snapshot: null })
      .then(data => {
        if (data.snapshot?.html && data.snapshot.files_hash === filesContentHash) {
          setSnapshotHtml(data.snapshot.html)
          snapshotSavedHashRef.current = data.snapshot.files_hash
        } else {
          setSnapshotHtml(null)
        }
      })
      .catch(() => setSnapshotHtml(null))
      .finally(() => setSnapshotLoaded(true))
  }, [project?.id, filesContentHash])

  const viewports = {
    mobile: { width: '375px', label: 'Mobile' },
    tablet: { width: '768px', label: 'Tablet' },
    desktop: { width: '100%', label: 'Desktop' }
  }

  // Framework detection + auto-engine selection removed (Feb 2026
  // standardization on Fly server preview). When there was a choice
  // between Babel / WebContainer / server, this code routed framework
  // projects (CRA/Next/Vite) to the server engine. Now everything that
  // has a project ID goes through ServerPreview unconditionally.

  useEffect(() => {
    const prevHash = prevFilesRef.current
    // ONLY trigger refresh when files are actually WRITTEN (updated_at changes)
    // This prevents preview thrashing when AI responds with text but doesn't change files
    const currentHash = files?.map(f => `${f.path}:${f.updated_at || ''}`).join('|') || ''
    const hashChanged = prevHash !== null && prevHash !== currentHash
    const forceRefresh = forceRefreshRef.current || forceRecompileRef.current
    
    // Log for debugging
    if (hashChanged) {
      console.log('[PreviewTab] Files changed — auto-refreshing preview', { 
        fileCount: files?.length, 
        prevHash: prevHash?.slice(0, 100), 
        currentHash: currentHash?.slice(0, 100) 
      })
    }
    
    if (hashChanged || forceRefresh) {
      // Debounce: wait 500ms before recompiling so rapid file changes don't thrash the preview
      // Auto-refresh happens after agent file changes are complete
      const timer = setTimeout(() => {
        // Invalidate snapshot when files change (new build) or user forces refresh
        // Files changed = snapshot is stale by definition — always clear it
        setSnapshotHtml(null)
        snapshotSavedHashRef.current = null
        setRefreshKey(k => k + 1)
        if (!forceRefresh) {
          setIframeErrors([])
          setConsoleLogs([])
          setIframeLoaded(false)
        }
        forceRefreshRef.current = false
        forceRecompileRef.current = false
        // Log auto-refresh for user visibility
        if (hashChanged && onLog) {
          onLog('info', 'Preview auto-refreshed after file changes')
        }
      }, forceRefresh ? 0 : 500)
      prevFilesRef.current = currentHash
      return () => clearTimeout(timer)
    }
    prevFilesRef.current = currentHash
  }, [files, onLog])

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__PREVIEW_ERROR__') {
        // Suppress errors during streaming — code is naturally incomplete
        if (isBuilding) return
        const errMsg = `${e.data.error}${e.data.line ? ` (line ${e.data.line})` : ''}`
        setIframeErrors(prev => {
          if (prev.includes(errMsg)) return prev
          return [...prev.slice(-9), errMsg]
        })
        onLog?.('error', `Preview: ${errMsg}`)
      }
      if (e.data?.type === '__PREVIEW_CONSOLE__') {
        setConsoleLogs(prev => [...prev.slice(-49), { level: e.data.level, message: e.data.message }])
      }
      if (e.data?.type === '__PREVIEW_A11Y_RESULT__') {
        if (e.data.error) {
          setA11y({ status: 'error', error: e.data.error })
        } else {
          const result = {
            status: 'done',
            violations: e.data.violations || [],
            incomplete: e.data.incomplete || [],
            passes: e.data.passes || 0,
            auditedAt: e.data.auditedAt,
          }
          setA11y(result)
          setShowA11y(true)
          // Expose the latest audit so QuickActionChips can offer a "Fix all
          // violations" chip that pre-fills the chat with the concrete issues.
          if (typeof window !== 'undefined') {
            window.__EMANATOR_LATEST_A11Y__ = result
            window.dispatchEvent(new CustomEvent('emanator:a11y-result', { detail: result }))
          }
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onLog])

  // Node project detection — scan FULL file list, not filtered clientFiles
  // Only classify as node if it DOESN'T have any React component files
  const isNodeProject = useMemo(() => {
    const hasPackageJson = (files || []).some(f =>
      f.path === 'package.json' || f.path?.endsWith('/package.json')
    )
    if (!hasPackageJson) return false
    // If the project also has React files, it's a React project with package.json — NOT a pure node project
    const hasReactFiles = (files || []).some(f => {
      const p = f.path || ''
      const c = f.content || ''
      return (p.endsWith('.jsx') || p.endsWith('.tsx')) ||
        ((p.endsWith('.js') || p.endsWith('.ts')) && (c.includes('React') || c.includes('useState') || c.includes('export default')))
    })
    return !hasReactFiles
  }, [files])

  const { previewHtml, projectInfo, buildLog } = useMemo(() => {
    // Skip snapshot cache — always recompile from current files
    // (Snapshot cache caused stale preview bugs when runtime code changed)

    // If node project, skip the srcdoc pipeline entirely
    if (isNodeProject) {
      return { previewHtml: null, projectInfo: { type: 'node', files: files || [] }, buildLog: ['Type: node'] }
    }

    const clientFiles = (files || []).filter(f => {
      const p = f.path || ''
      return (
        p.startsWith('components/') ||
        p.startsWith('app/') ||
        p.endsWith('.jsx') ||
        p.endsWith('.tsx') ||
        p.endsWith('.js') ||
        p.endsWith('.css') ||
        p.endsWith('.html')
      ) &&
      !p.includes('lib/self_builder') &&
      !p.includes('supabase') &&
      !p.includes('api/')
    })

    const info = classifyProject(clientFiles)
    const log = []

    log.push(`Type: ${info.type}`)
    if (info.type === 'react') {
      const components = [...(info.jsxFiles || []), ...(info.tsFiles || [])]
      const reactJs = (info.jsFiles || []).filter(f => {
        const c = f.content || ''
        return c.includes('React') || c.includes('useState') || c.includes('export default') || /<\w+[\s/>]/.test(c)
      })
      const all = [...components, ...reactJs]
      const entry = all.find(f => f.path.match(/App\.(jsx|tsx|js)$/i)) ||
                    all.find(f => f.path.match(/index\.(jsx|tsx|js)$/i)) ||
                    all.find(f => f.path.match(/page\.(jsx|tsx|js)$/i)) ||
                    all[0]
      log.push(`Entry: ${entry?.path || 'none'}`)
      log.push(`Files: ${all.map(f => f.path).join(', ')}`)
      log.push(`Tailwind: ${info.usesTailwind}`)
    }

    let html = null
    // Build image assets mapping from _assets/ files AND SSE-provided generatedImageMap
    const assetImageMap = (files || [])
      .filter(f => f.path?.startsWith('_assets/__gen_img') && f.content?.startsWith('data:'))
      .map(f => {
        const filename = f.path.split('/').pop()
        return { placeholder: `https://emanator-generated.img/${filename}`, dataUrl: f.content }
      })
    // Parse brand VFS entries from components/assets.js on reload — so
    // path-form `<img src="/logo.png">` continues to resolve even after
    // the SSE stream is gone. We extract each `export const NAME = \`data:...\``
    // pair and re-map it to its canonical VFS path.
    const assetsModule = (files || []).find(f => f.path === 'components/assets.js')
    const brandVfsFromModule = assetsModule?.content ? parseBrandVfsFromAssetsModule(assetsModule.content) : []

    // Imported projects (Mangia Mama, Spyrals, etc.) carry their static
    // images as files with file_type === 'image' and data: URL content.
    // Map each one to the VFS shape buildReactPreview expects so
    // <img src="/icons/foo.png"> in the imported JSX resolves to the
    // actual binary at preview time.
    const importedImageAssets = (files || [])
      .filter(f => (f.file_type === 'image' || f.file_type === 'font') && typeof f.content === 'string' && f.content.startsWith('data:'))
      .flatMap(f => {
        const dataUrl = f.content
        const path = f.path
        // Map the canonical /path/to/image.png plus the most common
        // "public/" stripped variant — the VFS normalizer handles the
        // ./ and public/ cases at runtime, so we just need the leading-
        // slash form here. We register both with and without the public/
        // prefix so {{IMAGE_X}}-style placeholders also resolve.
        const stripped = path.replace(/^public\//, '').replace(/^\.\//, '')
        const placeholders = Array.from(new Set([
          '/' + stripped,
          '/' + path,
          stripped,
          path,
        ]))
        return placeholders.map(p => ({ placeholder: p, dataUrl }))
      })

    // Merge: SSE mapping (live build) takes priority, then persisted _assets/ files (reload)
    // Brand VFS is ADDITIVE — it never conflicts with stock/generated image URLs
    const liveOrReload = generatedImageMap.length > 0 ? generatedImageMap : assetImageMap
    const mergedImageAssets = [...liveOrReload, ...brandVfsFromModule, ...importedImageAssets]

    switch (info.type) {
      case 'html': html = buildHtmlPreview(info); break
      case 'react': html = buildReactPreview({ ...info, imageAssets: mergedImageAssets }); break
      case 'js': html = buildJsPreview(info); break
      case 'css-only': html = buildCssPreview(info); break
    }

    if (html) log.push(`Output: ${html.length} chars`)

    return { previewHtml: html, projectInfo: info, buildLog: log }
  }, [files, refreshKey, isNodeProject, snapshotHtml, generatedImageMap])

  // ── Save preview snapshot after successful compilation ──
  useEffect(() => {
    if (!project?.id || !previewHtml || !filesContentHash) return
    // Don't re-save if we're just rendering the cached snapshot
    if (snapshotSavedHashRef.current === filesContentHash) return
    // Only save non-snapshot compilations (real builds)
    if (projectInfo?.type === 'snapshot') return

    const timer = setTimeout(() => {
      authFetch(`/api/projects/${project.id}/preview-snapshot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: previewHtml, files_hash: filesContentHash })
      }).then(() => {
        snapshotSavedHashRef.current = filesContentHash
      }).catch(() => {})
    }, 1500) // Debounce to avoid saving during rapid file changes
    return () => clearTimeout(timer)
  }, [previewHtml, filesContentHash, project?.id, projectInfo?.type])

  // ── Live streaming preview ──
  // Create the shell HTML only ONCE when streaming starts.
  // Use postMessage for subsequent updates to avoid iframe reload flicker.
  const [streamShellHtml, setStreamShellHtml] = useState(null)
  const iframeReadyForLiveRef = useRef(false)
  const pendingLiveRef = useRef(null)

  // Create shell when streaming starts (only once per streaming session)
  useEffect(() => {
    if (livePreviewData?.content && !previewHtml && !streamShellHtml) {
      // Clear snapshot when a new live build starts — we'll snapshot the result after
      setSnapshotHtml(null)
      snapshotSavedHashRef.current = null
      // Clear stale errors from previous builds
      setIframeErrors([])
      // Build an EMPTY shell — no files. All content will arrive via postMessage live_update.
      // This avoids Babel compile errors from incomplete streaming code on initial render.
      const shellInfo = {
        type: 'react',
        jsxFiles: [],
        cssFiles: [], jsFiles: [], tsFiles: [], htmlFiles: [],
        usesTailwind: livePreviewData.content.includes('className'),
        usesShadcn: false,
        imageAssets: generatedImageMap,
      }
      setStreamShellHtml(buildReactPreview(shellInfo))
      iframeReadyForLiveRef.current = false
      pendingLiveRef.current = livePreviewData
    }
    // Only clear stream shell when real previewHtml is available (not when livePreviewData clears)
    if (previewHtml && streamShellHtml) {
      setStreamShellHtml(null)
      iframeReadyForLiveRef.current = false
      pendingLiveRef.current = null
    }
  }, [livePreviewData, previewHtml, streamShellHtml])

  // Send live updates via postMessage (after shell iframe has loaded)
  useEffect(() => {
    if (!livePreviewData?.content || !streamShellHtml) return
    if (!iframeReadyForLiveRef.current) {
      // iframe not ready yet — store as pending
      pendingLiveRef.current = livePreviewData
      return
    }
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    const filePath = livePreviewData.path || ''
    // entryName is the preferred entry component — use "App" if available, else this file
    const fileModName = filePath.replace(/^\.\//, '').replace(/\.(jsx|tsx|js|ts)$/, '').split('/').pop() || 'page'
    const entryName = 'App' // Always try to mount App as entry for multi-file projects
    iframe.contentWindow.postMessage({ type: 'live_update', code: livePreviewData.content, entryName, filePath }, '*')
  }, [livePreviewData, streamShellHtml])

  // Handle iframe load — send any pending live data
  const handleLiveIframeLoad = useCallback(() => {
    iframeReadyForLiveRef.current = true
    if (pendingLiveRef.current?.content) {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      const entryName = 'App'
      iframe.contentWindow.postMessage({ type: 'live_update', code: pendingLiveRef.current.content, entryName, filePath: pendingLiveRef.current.path }, '*')
      pendingLiveRef.current = null
    }
  }, [])

  const effectivePreviewHtml = previewHtml || streamShellHtml || null

  // ── Guardrail 5: Preview blank health check ──
  const [previewBlank, setPreviewBlank] = useState(false)
  useEffect(() => {
    if (!iframeLoaded || !effectivePreviewHtml) { setPreviewBlank(false); return }
    const timer = setTimeout(() => {
      try {
        const doc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document
        const root = doc?.getElementById('root')
        if (root && root.innerHTML.trim().length === 0 && iframeErrors.length === 0) {
          setPreviewBlank(true)
          console.warn('[Guardrail] Preview rendered blank — #root is empty after load')
        } else {
          setPreviewBlank(false)
        }
      } catch { setPreviewBlank(false) }
    }, 3000)
    return () => clearTimeout(timer)
  }, [iframeLoaded, effectivePreviewHtml, refreshKey, iframeErrors.length])


  const forceRefreshRef = useRef(false)

  // ── Runtime Verification: inject test scripts and listen for results ──
  const [runtimeTestScript, setRuntimeTestScript] = useState(null)
  const [runtimeResults, setRuntimeResults] = useState(null)

  // Sync with external runtime test script from streaming
  useEffect(() => {
    if (externalRuntimeTestScript) {
      setRuntimeTestScript(externalRuntimeTestScript)
      setRuntimeResults(null)
    }
  }, [externalRuntimeTestScript])

  // Listen for runtime_verification results from the iframe
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'runtime_verification') {
        setRuntimeResults(event.data)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Inject the runtime test script into the iframe after it loads
  useEffect(() => {
    if (!runtimeTestScript || !iframeLoaded || !iframeRef.current) return
    try {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document
      if (doc) {
        const script = doc.createElement('script')
        script.textContent = runtimeTestScript
        doc.body.appendChild(script)
      }
    } catch (e) {
      console.warn('[RuntimeVerification] Failed to inject test script:', e)
    }
  }, [runtimeTestScript, iframeLoaded, refreshKey])

  const handleRefresh = useCallback(() => {
    // Server preview is the only engine — delegate to its refresh handler.
    if (serverPreviewRefreshRef.current) {
      serverPreviewRefreshRef.current()
      return
    }
    // Fallback: live-streaming Babel srcDoc preview path (no project ID
    // yet, files arriving over SSE). Recompile from source.
    setIframeErrors([])
    setConsoleLogs([])
    setIframeLoaded(false)
    setSnapshotHtml(null)
    snapshotSavedHashRef.current = null
    forceRecompileRef.current = true
    if (onRefreshFiles) {
      forceRefreshRef.current = true
      onRefreshFiles()
    } else {
      setRefreshKey(k => k + 1)
    }
  }, [onRefreshFiles])

  const isCoreSystemProject =
    project?.name === 'Auroraly Backend' ||
    project?.name === 'Auroraly' ||
    project?.name === 'Emanator Backend' ||
    project?.name === 'Emanator' ||
    project?.type === 'core'

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted-foreground" data-testid="preview-empty">
        <p className="text-sm">Select a project to preview</p>
      </div>
    )
  }

  if (isCoreSystemProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-core-disabled">
        <AlertTriangle className="w-10 h-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">Core System Preview Disabled</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            Auroraly cannot preview itself through the isolated Babel component pipeline.
          </p>
        </div>
      </div>
    )
  }

  // Node project → delegate to runner
  if (projectInfo.type === 'node') {
    return <NodePreviewRunner project={project} files={files} onLog={onLog} />
  }

  if (projectInfo.type === 'empty' && !livePreviewData && !streamShellHtml) {
    // Building state → premium skeleton (only while no live data has arrived)
    if (isBuilding) {
      return (
        <div className="h-full flex flex-col bg-[#0C1018] overflow-hidden" data-testid="preview-building-skeleton">
          <style>{`
            @keyframes em-shimmer {
              0% { background-position: -400px 0; }
              100% { background-position: 400px 0; }
            }
            .em-skel {
              background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(0,229,255,0.06) 50%, rgba(255,255,255,0.03) 75%);
              background-size: 800px 100%;
              animation: em-shimmer 2s ease-in-out infinite;
              border-radius: 6px;
            }
          `}</style>
          {/* Navbar skeleton */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
            <div className="em-skel w-7 h-7 rounded-md" />
            <div className="em-skel h-3 w-24" />
            <div className="flex-1" />
            <div className="em-skel h-3 w-14" />
            <div className="em-skel h-3 w-14" />
            <div className="em-skel h-3 w-14" />
            <div className="em-skel h-8 w-20 rounded-full" />
          </div>
          {/* Hero skeleton */}
          <div className="flex flex-col items-center gap-4 pt-16 pb-10 px-8">
            <div className="em-skel h-3 w-28 rounded-full" />
            <div className="em-skel h-7 w-80 mt-2" />
            <div className="em-skel h-4 w-64 mt-1" />
            <div className="em-skel h-3 w-48 mt-1" />
            <div className="flex gap-3 mt-5">
              <div className="em-skel h-9 w-28 rounded-full" />
              <div className="em-skel h-9 w-28 rounded-full" style={{ opacity: 0.5 }} />
            </div>
          </div>
          {/* Content blocks skeleton */}
          <div className="grid grid-cols-3 gap-4 px-8 mt-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-lg border border-white/5 bg-white/[0.015] p-5 flex flex-col gap-3" style={{ animationDelay: `${i * 150}ms` }}>
                <div className="em-skel w-9 h-9 rounded-lg" style={{ animationDelay: `${i * 150}ms` }} />
                <div className="em-skel h-4 w-3/4" style={{ animationDelay: `${i * 150}ms` }} />
                <div className="em-skel h-3 w-full" style={{ animationDelay: `${i * 150}ms` }} />
                <div className="em-skel h-3 w-5/6" style={{ animationDelay: `${i * 150}ms` }} />
              </div>
            ))}
          </div>
          {/* Generating label */}
          <div className="flex items-center justify-center gap-2 mt-auto pb-6 text-xs text-cyan-400/60">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Building preview...
          </div>
        </div>
      )
    }
    // True empty state — no build in progress
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-no-files">
        <FileCode className="w-10 h-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">No preview available yet</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            Ask the AI to generate a web page, landing site, or React app — it will appear here automatically.
          </p>
        </div>
      </div>
    )
  }

  if (projectInfo.type === 'assets-only') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-assets-only">
        <FileCode className="w-10 h-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">No previewable code files</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            This project contains {projectInfo.assetCount} generated asset{projectInfo.assetCount !== 1 ? 's' : ''} but no HTML, CSS, or JavaScript files.
            Check the <strong>Assets</strong> tab to view generated images.
          </p>
        </div>
      </div>
    )
  }

  if (projectInfo.type === 'unsupported') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-unsupported">
        <AlertTriangle className="w-10 h-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">Unsupported project structure</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            Preview supports HTML, CSS, JavaScript, and React/JSX projects.
          </p>
        </div>
      </div>
    )
  }

  if (!effectivePreviewHtml) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-render-error">
        <AlertCircle className="w-10 h-10 text-red-400 opacity-60" />
        <div className="text-center">
          <p className="text-sm font-medium">Preview render failed</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            Could not assemble a preview from {files?.length} file(s).
          </p>
          {buildLog.length > 0 && (
            <pre className="mt-3 text-[10px] text-left bg-muted/40 rounded p-2 max-w-md overflow-auto">
              {buildLog.join('\n')}
            </pre>
          )}
        </div>
      </div>
    )
  }

  const modeLabel = livePreviewData ? 'Live Preview' :
    projectInfo.type === 'react' ? 'React (Babel)' :
    projectInfo.type === 'html' ? 'HTML' :
    projectInfo.type === 'js' ? 'JavaScript' :
    projectInfo.type === 'css-only' ? 'CSS Only' : 'Preview'

  return (
    <div className="h-full flex flex-col bg-background min-h-0" data-testid="preview-tab">
      {/* Minimal control bar — just refresh button */}
      <div className="flex items-center justify-end px-3 py-1 border-b border-border/40">
        <Button size="sm" variant="ghost" className="h-6 gap-1.5 text-xs"
          onClick={handleRefresh} data-testid="preview-refresh">
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {iframeErrors.length > 0 && (
        <div className="px-3 py-1.5 bg-red-950/40 border-b border-red-900/40 text-red-300 text-[11px] font-mono max-h-24 overflow-auto" data-testid="preview-error-banner">
          {iframeErrors.map((err, i) => (
            <div key={i} className="flex gap-1.5 items-start py-0.5">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      {runtimeResults && !runtimeResults.allPassed && (
        <div className="px-3 py-1.5 bg-amber-950/30 border-b border-amber-800/30 text-[11px] font-mono max-h-32 overflow-auto" data-testid="runtime-verification-results">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="text-amber-300 font-semibold">Runtime Verification: {runtimeResults.passed}/{runtimeResults.total} passed</span>
          </div>
          {runtimeResults.results?.map((r, i) => (
            <div key={i} className={`flex gap-1.5 items-start py-0.5 ${r.pass ? 'text-emerald-400/70' : 'text-red-400'}`}>
              <span className="shrink-0">{r.pass ? '\u2713' : '\u2717'}</span>
              <span>{r.name}: {r.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden bg-white flex justify-center relative">
        {/* Server preview (Fly Machines) is the standardized engine for all
            projects with persisted files. The Babel srcDoc fallback below
            handles the live-streaming preview during a fresh build BEFORE
            the project has a saved ID — once persistence kicks in, control
            transfers to ServerPreview. See docs/PREVIEW_ENGINE_STANDARDIZATION.md */}
        {project?.id ? (
          <div className="absolute inset-0">
            <ServerPreview 
              projectId={project?.id} 
              projectName={project?.name}
              onRefreshReady={(refreshFn) => { serverPreviewRefreshRef.current = refreshFn }}
            />
          </div>
        ) : (
          <>
            {!iframeLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-background z-10" data-testid="preview-loading">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading preview...</span>
                </div>
              </div>
            )}
            {previewBlank && iframeLoaded && (
              <div className="absolute bottom-3 left-3 right-3 z-20 bg-amber-950/80 border border-amber-800/50 rounded-lg px-3 py-2 text-amber-200 text-[11px] backdrop-blur-sm" data-testid="preview-blank-warning">
                Preview rendered blank. The component may have a runtime error or missing dependencies. Check the console below.
              </div>
            )}
            <iframe
              ref={iframeRef}
              key={refreshKey}
              srcDoc={effectivePreviewHtml}
              title="Preview"
              // allow-same-origin is required so previews can use
              // localStorage / sessionStorage / cookies — many imported
              // projects (auth flows, carts, user prefs) crash without
              // it: "SecurityError: localStorage Forbidden in a
              // sandboxed document without allow-same-origin flag."
              // Auroraly-built sites typically don't touch storage so
              // we never hit this — but Mangia Mama and similar
              // imported apps do.
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              className="absolute inset-0 w-full h-full border-0"
              style={{ maxWidth: viewports[viewportSize].width === '100%' ? '100%' : viewports[viewportSize].width, margin: viewports[viewportSize].width === '100%' ? undefined : '0 auto' }}
              onLoad={() => { setIframeLoaded(true); handleLiveIframeLoad() }}
              data-testid="preview-iframe"
            />
          </>
        )}
      </div>

      {showConsole && (
        <div className="border-t border-border/40 bg-muted/20 max-h-40 overflow-auto" data-testid="preview-console">
          <div className="flex items-center justify-between px-3 py-1 border-b border-border/30">
            <span className="text-[10px] font-medium text-muted-foreground">
              Console {buildLog.length > 0 && <span className="opacity-50 ml-1">| {buildLog[0]}</span>}
            </span>
            <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => setConsoleLogs([])}>
              <span className="text-[9px]">Clear</span>
            </Button>
          </div>
          {consoleLogs.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/50">
              <p>No console output</p>
              {buildLog.length > 1 && (
                <pre className="mt-1 opacity-40">{buildLog.slice(1).join('\n')}</pre>
              )}
            </div>
          ) : (
            <div className="px-3 py-1 font-mono text-[10px] space-y-0.5">
              {consoleLogs.map((log, i) => (
                <div key={i} className={
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-yellow-400' : 'text-muted-foreground'
                }>
                  <span className="opacity-50">[{log.level}]</span> {log.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showA11y && a11y && a11y.status !== 'idle' && (
        <div className="border-t border-border/40 bg-muted/20 max-h-64 overflow-auto" data-testid="preview-a11y-panel">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              <Accessibility className="w-3.5 h-3.5" />
              Accessibility audit
              {a11y.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {a11y.status === 'done' && a11y.violations?.length === 0 ? (
                <span className="flex items-center gap-1 text-emerald-400 text-[10px]" data-testid="a11y-clean">
                  <CheckCircle2 className="w-3 h-3" /> No violations ({a11y.passes} checks passed)
                </span>
              ) : null}
              {a11y.status === 'done' && a11y.violations?.length > 0 ? (
                <span className="text-red-400 text-[10px]">{a11y.violations.length} violation{a11y.violations.length > 1 ? 's' : ''}{a11y.incomplete?.length ? ` · ${a11y.incomplete.length} to review` : ''}</span>
              ) : null}
              {a11y.status === 'error' ? (
                <span className="text-amber-400 text-[10px]">{a11y.error}</span>
              ) : null}
            </span>
            <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => setShowA11y(false)}>
              <span className="text-[9px]">Close</span>
            </Button>
          </div>
          {a11y.status === 'done' && a11y.violations?.length > 0 ? (
            <div className="px-3 py-2 space-y-1.5 text-[11px]" data-testid="a11y-violations">
              {a11y.violations.map((v, i) => (
                <div key={v.id + i} className="rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5" data-testid={`a11y-violation-${v.id}`}>
                  <div className="flex items-center gap-1.5">
                    <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                    <span className={`text-[9px] font-semibold uppercase px-1 rounded ${
                      v.impact === 'critical' ? 'bg-red-500/20 text-red-300' :
                      v.impact === 'serious' ? 'bg-orange-500/20 text-orange-300' :
                      v.impact === 'moderate' ? 'bg-yellow-500/20 text-yellow-300' :
                      'bg-muted-foreground/20 text-muted-foreground'
                    }`}>{v.impact || 'minor'}</span>
                    <span className="font-medium">{v.help}</span>
                    {v.helpUrl ? (
                      <a href={v.helpUrl} target="_blank" rel="noopener noreferrer" className="ml-auto opacity-60 hover:opacity-100">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : null}
                  </div>
                  {v.nodes?.[0]?.html ? (
                    <pre className="mt-1 text-[10px] text-muted-foreground/80 overflow-x-auto">{v.nodes[0].html}</pre>
                  ) : null}
                  {v.nodes?.length > 1 ? (
                    <span className="text-[9px] opacity-50">+{v.nodes.length - 1} more element{v.nodes.length - 1 === 1 ? '' : 's'}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
