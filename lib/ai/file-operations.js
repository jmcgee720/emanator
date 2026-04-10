/**
 * File operations — save files with validation/repair, delete files, placeholder image replacement.
 * Extracted from service.js to reduce file size.
 */

import { validateCodeCompleteness } from './code-validator.js'
import { validateFileOperations, invalidateCache } from './filesystem.js'
import { detectFileType } from './tool-executor.js'
import { db } from '@/lib/supabase/db'

/**
 * Save files to the project — includes code completeness validation,
 * placeholder image replacement, and DB verification.
 *
 * @param {string} projectId
 * @param {Array} files - Array of { path, content, file_type, description, changes }
 * @param {boolean} isUpdate
 * @param {object} provider - AI provider instance for auto-repair
 * @param {Array} prefetchedImages - Prefetched stock images for placeholder replacement
 * @returns {Array} saved files
 */
export async function saveFiles(projectId, files, isUpdate, provider, prefetchedImages = []) {
  console.log(`[saveFiles] Called with ${files.length} file(s), isUpdate=${isUpdate}, paths:`, files.map(f => f.path))
  const savedFiles = []

  // ── Code Completeness Validation — auto-repair truncated files ──
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file.content || file.content.trim().length < 10) {
      console.warn(`[CodeValidator] Skipping empty/tiny file: ${file.path}`)
      files.splice(i, 1)
      i--
      continue
    }
    const result = validateCodeCompleteness(file.content, file.path)
    if (!result.valid && result.repairPrompt) {
      console.warn(`[CodeValidator] Incomplete file detected: ${file.path} — ${result.reason}. Attempting auto-repair...`)
      // If file is severely truncated (< 200 chars, just imports), skip it — not enough context to repair
      if (file.content.trim().length < 200 && !file.content.includes('export')) {
        console.warn(`[CodeValidator] File too short to repair (${file.content.trim().length} chars), skipping: ${file.path}`)
        files.splice(i, 1)
        i--
        continue
      }
      try {
        const repairMessages = [
          { role: 'system', content: 'You are a code completion assistant. Output ONLY the complete file content. No markdown fences, no explanation.' },
          { role: 'user', content: result.repairPrompt },
        ]
        const repairResponse = await provider.chat(repairMessages, { temperature: 0.2, max_tokens: 16000 })
        const repairedContent = repairResponse?.content?.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
        if (repairedContent && repairedContent.length > file.content.length * 0.8) {
          const recheck = validateCodeCompleteness(repairedContent, file.path)
          if (recheck.valid) {
            console.log(`[CodeValidator] Auto-repair succeeded for ${file.path}`)
            files[i] = { ...file, content: repairedContent }
          } else {
            console.warn(`[CodeValidator] Auto-repair still incomplete for ${file.path}: ${recheck.reason}. Saving original.`)
          }
        }
      } catch (repairErr) {
        console.error(`[CodeValidator] Auto-repair failed for ${file.path}:`, repairErr.message)
      }
    }
  }

  // ── Placeholder Image Replacement — swap generic placeholder URLs with stock photos ──
  // NOTE: Generated image placeholders (emanator-generated.img) stay as-is in source files.
  // They show as broken images in preview, but the layout/styling renders correctly.
  if (prefetchedImages.length > 0) {
    const placeholderPattern = /(?:https?:\/\/(?:via\.placeholder\.com|placehold\.co|placeholder\.com|dummyimage\.com)[^\s"'`>)]*|(?:https?:\/\/[^\s"'`>)]*placeholder[^\s"'`>]*))/gi

    let imgIndex = 0
    for (let i = 0; i < files.length; i++) {
      const ext = files[i].path?.split('.').pop()?.toLowerCase() || ''
      if (!['jsx', 'tsx', 'js', 'ts', 'html', 'htm', 'css'].includes(ext)) continue
      const original = files[i].content
      if (!original) continue

      const replaced = original.replace(placeholderPattern, () => {
        const img = prefetchedImages[imgIndex % prefetchedImages.length]
        imgIndex++
        return img.url?.startsWith('data:') ? (img._placeholderUrl || img.url) : img.url
      })

      if (replaced !== original) {
        console.log(`[ImagePostProcessor] Replaced ${imgIndex} stock placeholder(s) in ${files[i].path}`)
        files[i] = { ...files[i], content: replaced }
      }
    }
  }

  // Validate operations before applying
  try {
    const operations = files.map(f => ({
      action: isUpdate ? 'update' : 'create',
      path: f.path,
    }))
    const validation = await validateFileOperations(projectId, operations)
    if (validation.warnings.length > 0) {
      console.warn('[AIService] File operation warnings:', validation.warnings)
    }
  } catch (valErr) {
    console.error('[AIService] Validation error:', valErr.message)
  }

  for (const file of files) {
    try {
      const existing = await db.projectFiles.findByPath(projectId, file.path)

      if (existing) {
        const updated = await db.projectFiles.update(existing.id, {
          content: file.content,
          version: existing.version + 1,
          change_source: 'ai_generation'
        })

        await db.fileChangeEvents.create({
          project_id: projectId,
          file_id: existing.id,
          file_path: file.path,
          action: 'update',
          changes: file.changes || file.description
        })

        savedFiles.push({ ...updated, action: 'updated', description: file.description || file.changes })
      } else {
        const newFile = await db.projectFiles.create({
          project_id: projectId,
          path: file.path,
          content: file.content,
          file_type: file.file_type || detectFileType(file.path),
          version: 1,
          change_source: 'ai_generation'
        })

        await db.fileChangeEvents.create({
          project_id: projectId,
          file_id: newFile.id,
          file_path: file.path,
          action: 'create',
          changes: file.description
        })

        savedFiles.push({ ...newFile, action: 'created', description: file.description })
      }
    } catch (fileErr) {
      console.error(`[AIService] Failed to save file ${file.path}:`, fileErr.message)
    }
  }

  if (savedFiles.length > 0) {
    await db.projects.update(projectId, { updated_at: new Date().toISOString() })
    invalidateCache(projectId)
  }

  // VERIFICATION: confirm files exist in DB
  for (const file of savedFiles) {
    const check = await db.projectFiles.findByPath(projectId, file.path)
    if (!check) {
      console.error(`[AIService] VERIFICATION FAILED: File ${file.path} not found after save`)
    }
  }

  return savedFiles
}

/**
 * Delete files from the project (for refactoring)
 */
export async function deleteFiles(projectId, files) {
  const deleted = []
  for (const file of files) {
    try {
      const existing = await db.projectFiles.findByPath(projectId, file.path)
      if (existing) {
        await db.fileChangeEvents.create({
          project_id: projectId,
          file_id: existing.id,
          file_path: file.path,
          action: 'delete',
          changes: file.reason || 'Deleted by AI refactor'
        })
        await db.projectFiles.delete(existing.id)
        deleted.push({ path: file.path, reason: file.reason })
      }
    } catch (err) {
      console.error(`[AIService] Failed to delete file ${file.path}:`, err.message)
    }
  }
  if (deleted.length > 0) {
    invalidateCache(projectId)
  }
  return deleted
}
