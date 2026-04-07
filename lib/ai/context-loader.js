/**
 * Context loading — load scoped, platform, workspace, and project context.
 * Extracted from service.js to reduce file size.
 */

import { assembleContext, classifyScope } from './context.js'
import { compressContext } from './stream-helpers.js'
import { db } from '@/lib/supabase/db'

const MAX_RECENT_MESSAGES = 20

/**
 * Route to the correct context loader based on scope
 */
export async function loadScopedContext(projectId, chatId, userId, scope) {
  if (scope === 'platform') {
    return loadPlatformContext(chatId)
  }
  if (scope === 'workspace') {
    return loadWorkspaceContext(projectId, chatId, userId)
  }
  return loadContext(projectId, chatId)
}

/**
 * Platform scope: only chat history + platform knowledge (injected via system message)
 */
export async function loadPlatformContext(chatId) {
  const [chat, messages] = await Promise.all([
    db.chats.findById(chatId),
    db.messages.findByChatId(chatId),
  ])
  const compressedMessages = compressContext(messages)
  return {
    project: null,
    chat: chat ? { id: chat.id, title: chat.title, messages: compressedMessages.slice(-MAX_RECENT_MESSAGES).map(m => ({ role: m.role, content: m.content, created_at: m.created_at })) } : null,
    files: [],
    canvas: null,
  }
}

/**
 * Workspace scope: cross-project data for the user
 */
export async function loadWorkspaceContext(projectId, chatId, userId) {
  const [chat, messages, userProjects] = await Promise.all([
    db.chats.findById(chatId),
    db.messages.findByChatId(chatId),
    db.projects.findByUserId(userId),
  ])
  const compressedMessages = compressContext(messages)

  const projectSummaries = []
  const allFiles = []
  const allCanvas = []

  for (const proj of (userProjects || []).slice(0, 20)) {
    const [files, canvasDoc] = await Promise.all([
      db.projectFiles.findByProjectId(proj.id),
      db.projectCanvas.findByProjectId(proj.id),
    ])
    projectSummaries.push({ ...proj, file_count: files?.length || 0 })
    if (files?.length) {
      for (const f of files.slice(0, 5)) {
        allFiles.push({ ...f, project_name: proj.name })
      }
    }
    if (canvasDoc?.canvas_content) {
      allCanvas.push({
        project_name: proj.name,
        overview: canvasDoc.canvas_content.project_overview || null,
      })
    }
  }

  return {
    project: null,
    chat: chat ? { id: chat.id, title: chat.title, messages: compressedMessages.slice(-MAX_RECENT_MESSAGES).map(m => ({ role: m.role, content: m.content, created_at: m.created_at })) } : null,
    files: [],
    canvas: null,
    workspaceProjects: projectSummaries,
    workspaceFiles: allFiles,
    workspaceCanvas: allCanvas,
  }
}

/**
 * Project scope: full project context with files, canvas, memory
 */
export async function loadContext(projectId, chatId) {
  const [project, chat, messages, files, canvasDoc, memory] = await Promise.all([
    db.projects.findById(projectId),
    db.chats.findById(chatId),
    db.messages.findByChatId(chatId),
    db.projectFiles.findByProjectId(projectId),
    db.projectCanvas.findByProjectId(projectId),
    db.projectMemory.findByProjectId(projectId)
  ])

  const compressedMessages = compressContext(messages)

  return assembleContext({
    project,
    chat,
    messages: compressedMessages,
    files,
    canvas: canvasDoc?.canvas_content,
    memory
  })
}
