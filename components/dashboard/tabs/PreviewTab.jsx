'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { authFetch } from '@/lib/auth-fetch'
import {
  RefreshCw, AlertTriangle, MonitorSmartphone, Tablet, Monitor,
  Loader2, FileCode, AlertCircle, Terminal, Play, Square, RotateCcw
} from 'lucide-react'

// ─── Project classifier ────────────────────────────────────────────
function classifyProject(files) {
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

  // Check for package.json → Node project requiring execution
  const hasPackageJson = codeFiles.some(f => f.path === 'package.json' || f.path?.endsWith('/package.json'))
  if (hasPackageJson) {
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
function buildHtmlPreview({ htmlFiles, cssFiles, jsFiles, usesTailwind }) {
  let html = htmlFiles[0].content

  if (usesTailwind && !html.includes('tailwindcss')) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n<script src="https://cdn.tailwindcss.com"><\/script>`)
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
function buildReactPreview({ cssFiles, jsFiles, jsxFiles, tsFiles, usesTailwind, imageAssets }) {
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
    '<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>',
    '</head><body><div id="root"></div>',
    // Inject generated image asset mapping so placeholder URLs resolve to real data
    imageAssets && imageAssets.length > 0 ? [
      '<script>',
      'window.__GEN_IMAGE_MAP__ = ' + JSON.stringify(
        Object.fromEntries(imageAssets.map(a => [a.placeholder, a.dataUrl]))
      ).replace(/</g, '\\u003c') + ';',
      '/* After each render, replace placeholder image URLs with actual data */',
      'window.__fixImages = function() {',
      '  document.querySelectorAll("img").forEach(function(img) {',
      '    var src = img.getAttribute("src") || "";',
      '    Object.keys(window.__GEN_IMAGE_MAP__).forEach(function(key) {',
      '      if (src.indexOf(key) !== -1) img.src = window.__GEN_IMAGE_MAP__[key];',
      '    });',
      '  });',
      '  /* Also fix CSS background-image */',
      '  document.querySelectorAll("[style]").forEach(function(el) {',
      '    var s = el.getAttribute("style") || "";',
      '    Object.keys(window.__GEN_IMAGE_MAP__).forEach(function(key) {',
      '      if (s.indexOf(key) !== -1) el.setAttribute("style", s.split(key).join(window.__GEN_IMAGE_MAP__[key]));',
      '    });',
      '  });',
      '};',
      '/* Run image fixer after initial render and on every DOM mutation */',
      'new MutationObserver(function() { window.__fixImages(); }).observe(document.body, { childList: true, subtree: true });',
      '/* Safety: run image fixer after a short delay in case MutationObserver missed initial render */',
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
    '/* Mock Audio/Video to prevent media errors in sandbox */',
    'window.Audio = window.Audio || function(src) { this.src = src||""; this.play = function(){ return Promise.resolve(); }; this.pause = function(){}; this.load = function(){}; this.addEventListener = function(){}; this.removeEventListener = function(){}; this.volume = 1; this.currentTime = 0; this.duration = 0; };',
    '',
    'window.__COMPONENTS__ = {};',
    '',
    '/* Lazy component wrapper — resolves at render time, not at compile time */',
    '/* Fixes cross-file import order: if Home imports Header but Header compiles later, */',
    '/* the lazy wrapper defers the lookup until render when all components are available */',
    'function __lazy(modName) {',
    '  var w = React.forwardRef(function(props, ref) {',
    '    var C = window.__COMPONENTS__[modName] || window[modName];',
    '    if (!C || C === w) return null;',
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
    '            for (var ai = 0; ai < assetSpecs.length; ai++) {',
    '              var as = assetSpecs[ai];',
    '              if (as.type === "ImportDefaultSpecifier") {',
    '                /* Default import from asset = URL string or empty string */',
    '                assetDecls.push(t.variableDeclaration("var",[t.variableDeclarator(as.local, t.stringLiteral(""))]));',
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
    '              decls.push(t.variableDeclaration("var",[t.variableDeclarator(ls.local, t.callExpression(t.identifier("__lazy"),[t.stringLiteral(impN)]))]));',
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
    '      ExportNamedDeclaration: function(p) { p.node.declaration ? p.replaceWith(p.node.declaration) : p.remove(); },',
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
    'var __errs = [];',
    'for (var __i = 0; __i < __files.length; __i++) {',
    '  try {',
    '    exports = {}; module = { exports: exports };',
    '    var __r = Babel.transform(__files[__i].code, {',
    '      presets: ["env", "react", ["typescript", { isTSX: true, allExtensions: true }]],',
    '      plugins: [__mkPlugin(__files[__i].modName)],',
    '      filename: __files[__i].path',
    '    });',
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
    '    var __r2 = Babel.transform(__files[__j].code, {',
    '      presets: ["env", "react", ["typescript", { isTSX: true, allExtensions: true }]],',
    '      plugins: [__mkPlugin(__files[__j].modName)],',
    '      filename: __files[__j].path',
    '    });',
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
    '    var _r = Babel.transform(e.data.code, {',
    '      presets: ["env", "react", ["typescript", { isTSX: true, allExtensions: true }]],',
    '      plugins: [__mkPlugin(__modName)],',
    '      filename: __modName + ".jsx"',
    '    });',
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

// ─── Error handler injected into every preview ─────────────────────
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
export default function PreviewTab({ project, files, onLog, livePreviewData, isBuilding, onRefreshFiles, runtimeTestScript: externalRuntimeTestScript, generatedImageMap }) {
  const [viewportSize, setViewportSize] = useState('desktop')
  const [refreshKey, setRefreshKey] = useState(0)
  const [iframeErrors, setIframeErrors] = useState([])
  const [consoleLogs, setConsoleLogs] = useState([])
  const [showConsole, setShowConsole] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const iframeRef = useRef(null)
  const prevFilesRef = useRef(null)

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

  useEffect(() => {
    const prevHash = prevFilesRef.current
    const currentHash = files?.map(f => `${f.path}:${f.version || 0}:${f.updated_at || ''}:${typeof f.content === 'string' ? f.content.length : 0}`).join('|') || ''
    const hashChanged = prevHash !== null && prevHash !== currentHash
    const forceRefresh = forceRefreshRef.current || forceRecompileRef.current
    if (hashChanged || forceRefresh) {
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
    }
    prevFilesRef.current = currentHash
  }, [files])

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
    // Merge: SSE mapping (live build) takes priority, then persisted _assets/ files (reload)
    const mergedImageAssets = generatedImageMap.length > 0 ? generatedImageMap : assetImageMap

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
    setIframeErrors([])
    setConsoleLogs([])
    setIframeLoaded(false)
    // Clear snapshot to force a fresh recompile from source files
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
            Emanator cannot preview itself through the isolated Babel component pipeline.
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
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40">
        <div className="flex items-center gap-1">
          <Button size="sm" variant={viewportSize === 'mobile' ? 'secondary' : 'ghost'}
            className="h-7 w-7 p-0" onClick={() => setViewportSize('mobile')} data-testid="preview-viewport-mobile">
            <MonitorSmartphone className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant={viewportSize === 'tablet' ? 'secondary' : 'ghost'}
            className="h-7 w-7 p-0" onClick={() => setViewportSize('tablet')} data-testid="preview-viewport-tablet">
            <Tablet className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant={viewportSize === 'desktop' ? 'secondary' : 'ghost'}
            className="h-7 w-7 p-0" onClick={() => setViewportSize('desktop')} data-testid="preview-viewport-desktop">
            <Monitor className="w-3.5 h-3.5" />
          </Button>
          <span className="ml-2 text-[10px] font-mono text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded" data-testid="preview-mode-label">
            {modeLabel}{projectInfo.usesTailwind ? ' + Tailwind' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {runtimeResults && (
            <span className={`text-[10px] mr-1 px-1.5 py-0.5 rounded font-mono ${runtimeResults.allPassed ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' : 'bg-amber-950/60 text-amber-400 border border-amber-800/40'}`} data-testid="runtime-verification-badge">
              {runtimeResults.allPassed ? 'VERIFIED' : `${runtimeResults.passed}/${runtimeResults.total} passed`}
            </span>
          )}
          {iframeErrors.length > 0 && (
            <span className="text-[10px] text-red-400 mr-1" data-testid="preview-error-count">
              {iframeErrors.length} error{iframeErrors.length > 1 ? 's' : ''}
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={() => setShowConsole(v => !v)} data-testid="preview-toggle-console">
            <Terminal className={`w-3.5 h-3.5 ${consoleLogs.length > 0 ? 'text-blue-400' : ''}`} />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5"
            onClick={handleRefresh} data-testid="preview-refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
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
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          className="absolute inset-0 w-full h-full border-0"
          style={{ maxWidth: viewports[viewportSize].width === '100%' ? '100%' : viewports[viewportSize].width, margin: viewports[viewportSize].width === '100%' ? undefined : '0 auto' }}
          onLoad={() => { setIframeLoaded(true); handleLiveIframeLoad() }}
          data-testid="preview-iframe"
        />
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
    </div>
  )
}
