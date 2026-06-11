// MyMergent Constants

export const APP_NAME = 'MyMergent'

// ─── Role System ─────────────────────────────────────────────────────────────
export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  CHILD_MONITORED: 'child_monitored'
}

export const VALID_ROLES = new Set([ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER, ROLES.CHILD_MONITORED])

export function getUserRole(user) {
  const role = user?.role
  return VALID_ROLES.has(role) ? role : ROLES.MEMBER
}

/**
 * Permission checks — middleware-style hook for role-based access control.
 * Actions: 'self_edit', 'manage_users', 'manage_content', 'execute_plan', 'view_admin', 'view_monitored'
 */
export function hasPermission(role, action) {
  const normalized = VALID_ROLES.has(role) ? role : ROLES.MEMBER
  switch (action) {
    case 'self_edit':       return normalized === ROLES.OWNER
    case 'manage_users':    return normalized === ROLES.OWNER
    case 'manage_content':  return normalized === ROLES.OWNER || normalized === ROLES.ADMIN
    case 'execute_plan':    return normalized !== ROLES.CHILD_MONITORED || true // all roles can build
    case 'view_admin':      return normalized === ROLES.OWNER || normalized === ROLES.ADMIN
    case 'view_monitored':  return normalized === ROLES.OWNER
    default:                return false
  }
}

export function isMonitored(role) {
  return role === ROLES.CHILD_MONITORED
}

export const BUILDER_MODES = [
  { id: 'app', name: 'App Builder', icon: 'Layers' },
  { id: 'website', name: 'Website Builder', icon: 'Globe' },
  { id: 'image', name: 'Image Builder', icon: 'Image' },
  { id: 'document', name: 'Document Builder', icon: 'FileText' }
]

export const WORKSPACE_TABS = [
  { id: 'preview', name: 'Preview', icon: 'Eye' },
  { id: 'code', name: 'Code', icon: 'Code' },
  { id: 'assets', name: 'Assets', icon: 'FolderOpen' },
  { id: 'logs', name: 'Logs', icon: 'Terminal' },
  { id: 'export', name: 'Export', icon: 'Download' },
  { id: 'deploy', name: 'Deploy', icon: 'Rocket' }
]

export const EXPORT_TARGETS = [
  { id: 'web', name: 'Web', description: 'Deploy to web hosting', icon: 'Globe' },
  { id: 'pwa', name: 'PWA', description: 'Progressive Web App', icon: 'Smartphone' },
  { id: 'ios', name: 'iOS Wrapper', description: 'iOS app via Capacitor', icon: 'Apple' },
  { id: 'android', name: 'Android Wrapper', description: 'Android app via Capacitor', icon: 'Smartphone' },
  { id: 'zip', name: 'Vercel-ready ZIP', description: 'Vite + React + Tailwind — deploy anywhere', icon: 'Archive' },
  { id: 'manifest', name: 'Project Manifest', description: 'Export project metadata', icon: 'FileJson' }
]

export const CANVAS_SECTIONS = [
  'Project Overview',
  'Project Goals',
  'Key Decisions',
  'Architecture Notes',
  'Master Prompts',
  'Working Prompts',
  'Failed Prompts',
  'Successful Prompt Patterns',
  'Feature Requirements',
  'Technical Specifications',
  'Important Constraints',
  'Open Tasks',
  'Completed Tasks'
]

export const ITEM_STATUS = {
  ACTIVE: 'active',
  CONFIRMED: 'confirmed',
  DISCARDED: 'discarded',
  FINALIZED: 'finalized'
}

// ─── Core System Boundary ────────────────────────────────────────────────────
export const CHAT_TYPES = {
  BUILDER: 'builder',
  SELF_EDIT: 'self_edit'
}

export const SELF_EDIT_PREFIX = '\u2699 Self-Edit: '

export const SELF_EDIT_TARGETS = [
  { id: 'prompt_builder', label: 'Prompt Builder', path: 'lib/ai/prompt-builder.js', description: 'Design recipes, code patterns, and mandatory page structure rules that control ALL generated websites' },
  { id: 'design_system', label: 'Design System', path: 'lib/ai/design-system.js', description: 'Design presets, color tokens, layout patterns, component rules, and Tailwind enforcement that define the visual quality floor' },
  { id: 'image_generator', label: 'Image Generator', path: 'lib/ai/image-prefetch.js', description: 'Art direction prompts, subject detection, vibe lexicon, and image placement logic for AI-generated custom visuals' },
  { id: 'message_stream', label: 'Message Stream', path: 'lib/ai/message-stream.js', description: 'Core streaming engine — handles AI responses, tool calls, self-edit pipeline, patch processing, and all SSE events' },
  { id: 'ai_service', label: 'AI Service', path: 'lib/ai/service.js', description: 'AI provider layer — model selection, fallback logic, streaming infrastructure' },
  { id: 'stream_client', label: 'Stream Client', path: 'lib/stream-client.js', description: 'Frontend SSE client — parses server-sent events, handles tokens, files, canvas updates' },
  { id: 'plan_validator', label: 'Plan Validator', path: 'lib/ai/plan-validator.js' },
  { id: 'safe_apply', label: 'Safe Apply', path: 'lib/self_builder/safe_apply.js' },
  { id: 'feature_planner', label: 'Feature Planner', path: 'lib/self_builder/feature_planner.js' },
  { id: 'request_router', label: 'Request Router', path: 'lib/self_builder/request_router.js' },
  { id: 'change_log', label: 'Change Log', path: 'lib/self_builder/change_log.js' },
  { id: 'prompt_library', label: 'Prompt Library', path: 'lib/self_builder/prompt_library.js' },
  { id: 'adaptive_learning', label: 'Adaptive Learning', path: 'lib/ai/adaptive-learning.js' },
  { id: 'dashboard', label: 'Dashboard', path: 'components/dashboard/Dashboard.jsx', description: 'Main dashboard orchestrator — 3300+ lines, prefer editing sub-components instead' },
  { id: 'project_grid', label: 'Project Grid', path: 'components/dashboard/ProjectGrid.jsx', description: 'Project listing page — hero, project cards, bulk select/delete, Core System button, credits modal (351 lines)' },
  { id: 'chat_composer', label: 'Chat Composer', path: 'components/dashboard/ChatComposer.jsx', description: 'Chat input area — message text area, send button, attachments, voice dictation (385 lines)' },
  { id: 'left_panel', label: 'Left Panel', path: 'components/dashboard/LeftPanel.jsx', description: 'Chat sidebar — chat list, new chat, scope selector, build log (801 lines)' },
  { id: 'top_bar', label: 'Top Bar', path: 'components/dashboard/TopBar.jsx', description: 'Navigation header — logo, credits, import, growth, settings (208 lines)' },
  { id: 'message_renderer', label: 'Message Renderer', path: 'components/dashboard/MessageRenderer.jsx', description: 'Chat message display — text rendering, inline Apply to Live buttons (183 lines)' },
  { id: 'diff_review', label: 'Diff Review', path: 'components/dashboard/DiffReviewPanel.jsx', description: 'Diff review UI — approve/reject file changes (326 lines)' },
  { id: 'project_hub', label: 'Project Hub', path: 'components/dashboard/ProjectHub.jsx', description: 'Project workspace — file tree, media bin, chat selection (562 lines)' },
  { id: 'new_project_modal', label: 'New Project Modal', path: 'components/dashboard/NewProjectModal.jsx', description: 'Create project dialog — templates, project type selection (410 lines)' },
  { id: 'right_panel', label: 'Right Panel', path: 'components/dashboard/RightPanel.jsx', description: 'Preview/Code/Canvas panel — tabs, file viewer, canvas display' },
  { id: 'code_tab', label: 'Code Tab', path: 'components/dashboard/tabs/CodeTab.jsx', description: 'Code viewer — diff view, Apply to Live, Rollback, patch history' },
  { id: 'core_canvas', label: 'Core Canvas', path: 'components/dashboard/tabs/CoreCanvas.jsx', description: 'Project Canvas — markdown editor, checklist, auto-save' },
  { id: 'live_promote', label: 'Live Promote', path: 'lib/api/routes/live-promote.js', description: 'Apply to Live API — file writing, syntax validation, rollback, patch history' },
  { id: 'tools', label: 'AI Tools', path: 'lib/ai/tools.js', description: 'Tool definitions — patch_files, update_canvas, create_files, etc.' },
  { id: 'constants', label: 'Constants', path: 'lib/constants.js', description: 'Self-edit targets, chat types, prefixes' },
  { id: 'ui_components', label: 'UI Components', path: 'components/' },
  { id: 'api_routes', label: 'API Routes', path: 'app/api/' },
]


export function getChatType(chat, project = null) {
  // Check title prefix first (most reliable)
  if (chat?.title?.startsWith(SELF_EDIT_PREFIX)) {
    return CHAT_TYPES.SELF_EDIT
  }
  // Fallback: if chat belongs to a Core System project, treat it as self-edit
  // (handles legacy chats that lost the prefix or were created before auto-conversion)
  if (project?.settings?.is_core === true) {
    return CHAT_TYPES.SELF_EDIT
  }
  return CHAT_TYPES.BUILDER
}

export function selfEditTitle(description) {
  return `${SELF_EDIT_PREFIX}${description}`
}
