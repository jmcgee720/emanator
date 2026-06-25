import { createClient } from '@supabase/supabase-js'
import {
  persistContent,
  resolveContent,
  resolveAllContent,
  deleteStorageObject,
} from './file-storage.js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

export function getSupabaseAdmin() {
  return supabaseAdmin
}

export const db = {
  users: {
    async findByEmail(email) {
      if (!email) return null

      const cleanEmail = email.trim()
      console.log('[db.users.findByEmail] Looking for:', cleanEmail)

      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .ilike('email', cleanEmail)
        .maybeSingle()

      console.log('[db.users.findByEmail] Result:', { found: !!data, error: error?.message || null })
      if (error) {
        console.error('[db.users.findByEmail] Error:', error)
        return null
      }
      return data
    },

    async findById(id) {
      if (!id) return null

      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return null
      return data
    },

    async findAll() {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },

    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('users')
        .insert(payload)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async update(id, updates) {
      const { data, error } = await supabaseAdmin
        .from('users')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async delete(id) {
      const { error } = await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    },

    async updateRole(id, role) {
      const { data, error } = await supabaseAdmin
        .from('users')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async upsertOwner(email) {
      const existing = await this.findByEmail(email)
      if (existing) return existing

      return this.create({
        email,
        role: 'owner',
        is_allowlisted: true,
      })
    },
  },

  projects: {
    async findByUserId(userId) {
      if (!userId) return []

      const { data, error } = await supabaseAdmin
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },

    async findById(id) {
      if (!id) return null

      const { data, error } = await supabaseAdmin
        .from('projects')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return null
      return data
    },

    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .insert(payload)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async update(id, updates) {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async delete(id) {
      const { error } = await supabaseAdmin
        .from('projects')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    },

    async findPublic({ limit = 24, offset = 0 } = {}) {
      // Projects explicitly marked public via settings.is_public === true.
      // Uses ->> JSON operator for efficient filtering on the JSONB column.
      const { data, error } = await supabaseAdmin
        .from('projects')
        .select('id, name, description, type, settings, user_id, created_at, updated_at')
        .filter('settings->>is_public', 'eq', 'true')
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) throw error
      return data || []
    },
  },

  projectCanvas: {
    async findByProjectId(projectId) {
      if (!projectId) return null

      const { data, error } = await supabaseAdmin
        .from('project_canvas')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle()

      if (error) return null
      return data
    },

    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('project_canvas')
        .insert(payload)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async update(projectId, canvas_content) {
      const { data, error } = await supabaseAdmin
        .from('project_canvas')
        .update({ canvas_content })
        .eq('project_id', projectId)
        .select()
        .single()

      if (error) throw error
      return data
    },
  },

  chats: {
    async findByProjectId(projectId) {
      if (!projectId) return []

      const { data, error } = await supabaseAdmin
        .from('chats')
        .select('*')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data || []
    },

    async findCoreSystemChats() {
      // Core System chats have project_id = null and title starts with SELF_EDIT_PREFIX
      const { data, error } = await supabaseAdmin
        .from('chats')
        .select('*')
        .is('project_id', null)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data || []
    },

    async findById(id) {
      if (!id) return null

      const { data, error } = await supabaseAdmin
        .from('chats')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return null
      return data
    },

    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('chats')
        .insert(payload)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async update(id, updates) {
      const { data, error } = await supabaseAdmin
        .from('chats')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async delete(id) {
      const { error } = await supabaseAdmin
        .from('chats')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    },
  },

    projectFiles: {
    async findByProjectId(projectId) {
      if (!projectId) return []

      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (error) throw error
      // Hybrid storage: rows with storage_path live in Supabase Storage.
      // Resolve content transparently so callers see a uniform shape.
      await resolveAllContent(data || [])
      return data || []
    },

    async findIndexByProjectId(projectId) {
      if (!projectId) return []

      // Index queries don't need content — just metadata. Avoid
      // touching the heavy `content` column AND skip Storage downloads.
      // This is the call used by chat-context loaders, which is the
      // hottest query in the app.
      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('path, file_type, updated_at, created_at, storage_path, content_size:content')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data || []).map(f => ({
        path: f.path,
        // For inline rows, content is the raw string → length is bytes.
        // For storage_path rows, we don't know the size without an extra
        // call; report 0 (callers use it for sorting/UX, not auth).
        size: typeof f.content_size === 'string' ? f.content_size.length : 0,
        file_type: f.file_type,
        lastModified: f.updated_at || f.created_at,
      }))
    },

    async findById(id) {
      if (!id) return null

      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return null
      if (data && data.storage_path && !data.content) {
        data.content = await resolveContent(data)
      }
      return data
    },

    async findByPath(projectId, filePath) {
      if (!projectId || !filePath) return null

      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('*')
        .eq('project_id', projectId)
        .eq('path', filePath)
        .maybeSingle()

      if (error) return null
      if (data && data.storage_path && !data.content) {
        data.content = await resolveContent(data)
      }
      return data
    },

    async findByPathAcrossProjects(userId, filePath) {
      if (!userId || !filePath) return []

      const projects = await db.projects.findByUserId(userId)
      if (!projects.length) return []
      const projectIds = projects.map(p => p.id)
      const projectMap = new Map(projects.map(p => [p.id, p.name]))

      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('project_id, path')
        .eq('path', filePath)
        .in('project_id', projectIds)

      if (error || !data?.length) return []
      return data.map(f => ({
        project_id: f.project_id,
        project_name: projectMap.get(f.project_id) || 'Unknown',
        path: f.path,
      }))
    },

    async create(payload) {
      // If caller passed inline content, route it through hybrid storage.
      let row = { ...payload }
      if (row.project_id && row.path && typeof row.content === 'string') {
        const persisted = await persistContent(row.project_id, row.path, row.content)
        row.content = persisted.content
        row.storage_path = persisted.storage_path
      }
      const { data, error } = await supabaseAdmin
        .from('project_files')
        .insert(row)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async update(id, updates) {
      const next = { ...updates, updated_at: new Date().toISOString() }
      // If caller is updating content, redirect through hybrid storage.
      // We need project_id + path to write to Storage — fetch them if
      // not provided (rare, but the editor flow provides only `id`).
      if (typeof next.content === 'string') {
        let projectId = next.project_id
        let filePath = next.path
        if (!projectId || !filePath) {
          const { data: cur } = await supabaseAdmin
            .from('project_files')
            .select('project_id, path, storage_path')
            .eq('id', id)
            .maybeSingle()
          projectId = projectId || cur?.project_id
          filePath = filePath || cur?.path
          // Clean up old Storage object if its size class is changing.
          if (cur?.storage_path) await deleteStorageObject(cur.storage_path)
        }
        if (projectId && filePath) {
          const persisted = await persistContent(projectId, filePath, next.content)
          next.content = persisted.content
          next.storage_path = persisted.storage_path
        }
      }
      const { data, error } = await supabaseAdmin
        .from('project_files')
        .update(next)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async upsert(projectId, filePath, content, file_type = 'text') {
      const { data: existing, error: findError } = await supabaseAdmin
        .from('project_files')
        .select('*')
        .eq('project_id', projectId)
        .eq('path', filePath)
        .maybeSingle()

      if (findError) throw findError

      // Route content through hybrid storage. If the previous row had a
      // Storage object and the new content is now inline-sized, we need
      // to clean up the orphaned object so we don't pay for stale bytes.
      const persisted = await persistContent(projectId, filePath, content)
      if (existing?.storage_path && persisted.storage_path !== existing.storage_path) {
        await deleteStorageObject(existing.storage_path)
      }

      if (existing) {
        const nextVersion = Number(existing.version || 1) + 1
        const { data, error } = await supabaseAdmin
          .from('project_files')
          .update({
            content: persisted.content,
            storage_path: persisted.storage_path,
            file_type,
            version: nextVersion,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select()
          .single()

        if (error) throw error
        return { action: 'updated', file: data }
      }

      const { data, error } = await supabaseAdmin
        .from('project_files')
        .insert({
          project_id: projectId,
          path: filePath,
          content: persisted.content,
          storage_path: persisted.storage_path,
          file_type,
          version: 1,
        })
        .select()
        .single()

      if (error) throw error
      return { action: 'created', file: data }
    },

    async bulkInsert(rows) {
      if (!Array.isArray(rows) || rows.length === 0) return []

      // Persist any oversized rows to Storage in parallel before insert.
      // Per-row tolerance: if persistContent throws (e.g. FILE_TOO_LARGE),
      // we drop that row and keep the rest of the batch. Better to save
      // 60/61 files than to lose all 61 because one runaway generation
      // tripped the size cap.
      const settled = await Promise.allSettled(rows.map(async (r) => {
        if (!r.project_id || !r.path || typeof r.content !== 'string') return r
        const persisted = await persistContent(r.project_id, r.path, r.content)
        return {
          ...r,
          content: persisted.content,
          storage_path: persisted.storage_path,
        }
      }))
      const prepared = []
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i]
        if (s.status === 'fulfilled') {
          prepared.push(s.value)
        } else {
          console.error(
            `[bulkInsert] dropping row "${rows[i].path}" — ${s.reason?.message || s.reason}`,
          )
        }
      }
      if (prepared.length === 0) return []

      const { data, error } = await supabaseAdmin
        .from('project_files')
        .insert(prepared)
        .select()

      if (error) throw error
      return data || []
    },

    async delete(id) {
      // Clean up Storage object too (best-effort — not worth blocking on).
      const { data: cur } = await supabaseAdmin
        .from('project_files')
        .select('storage_path')
        .eq('id', id)
        .maybeSingle()
      if (cur?.storage_path) deleteStorageObject(cur.storage_path).catch(() => {})

      const { error } = await supabaseAdmin
        .from('project_files')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    },

    /**
     * Delete a project file by its path. Used by the v2 agent's
     * `delete_file` tool when the LLM wants to physically remove a
     * file from the project (e.g. an unwanted `middleware.js` that
     * Next.js Edge Runtime can't compile in the sandbox). Returns
     * `{ deleted: true }` on success, `{ deleted: false, reason: 'not-found' }`
     * if the file didn't exist. Never throws on a missing file —
     * deleting something that's already gone is idempotent success
     * from the caller's perspective.
     */
    async deleteByPath(projectId, filePath) {
      if (!projectId) throw new Error('projectId required')
      if (!filePath) throw new Error('filePath required')

      const { data: row, error: findError } = await supabaseAdmin
        .from('project_files')
        .select('id, storage_path')
        .eq('project_id', projectId)
        .eq('path', filePath)
        .maybeSingle()

      if (findError) throw findError
      if (!row) return { deleted: false, reason: 'not-found' }

      if (row.storage_path) {
        await deleteStorageObject(row.storage_path).catch(() => {})
      }

      const { error: delError } = await supabaseAdmin
        .from('project_files')
        .delete()
        .eq('id', row.id)

      if (delError) throw delError
      return { deleted: true, path: filePath }
    },

    async deleteByProjectId(projectId) {
      // Clean up all Storage objects for this project — fire-and-forget.
      ;(async () => {
        const { data: rows } = await supabaseAdmin
          .from('project_files')
          .select('storage_path')
          .eq('project_id', projectId)
        for (const r of (rows || [])) {
          if (r.storage_path) await deleteStorageObject(r.storage_path).catch(() => {})
        }
      })().catch(() => {})

      const { error } = await supabaseAdmin
        .from('project_files')
        .delete()
        .eq('project_id', projectId)

      if (error) throw error
      return { success: true }
    },
  },

  fileChangeEvents: {
    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('file_change_events')
        .insert(payload)
        .select()
        .single()

      if (error) throw error
      return data
    },
  },

  messages: {
    async findByChatId(chatId, limit = null) {
      if (!chatId) return []

      let query = supabaseAdmin
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })

      // Apply limit if specified (for context loading)
      if (limit && limit > 0) {
        // Get total count first to calculate offset for "last N"
        const { count } = await supabaseAdmin
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('chat_id', chatId)
        
        if (count && count > limit) {
          // Skip older messages, only get the most recent N
          query = query.range(count - limit, count - 1)
        }
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },

    async findById(id) {
      if (!id) return null

      const { data, error } = await supabaseAdmin
        .from('messages')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return null
      return data
    },

    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('messages')
        .insert(payload)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async update(id, updates) {
      const { data, error } = await supabaseAdmin
        .from('messages')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async delete(id) {
      const { error } = await supabaseAdmin
        .from('messages')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    },
  },

  // ============ CHANGELOG ============
  // Audit trail for grounded planning events
  changelog: {
    async create(entry) {
      const { data, error } = await supabaseAdmin
        .from('changelog')
        .insert({
          project_id: entry.project_id,
          chat_id: entry.chat_id || null,
          user_id: entry.user_id || null,
          user_task: entry.user_task || '',
          task_mode: entry.task_mode || 'plan',
          context_paths: entry.context_paths || [],
          validator_result: entry.validator_result || null,
          plan_hash: entry.plan_hash || null,
          rejection_reasons: entry.rejection_reasons || [],
          plan_summary: entry.plan_summary || null,
          file_actions: entry.file_actions || null,
          constraints_checked: entry.constraints_checked || null,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },

    async findByProject(projectId, limit = 10) {
      if (!projectId) return []

      const { data, error } = await supabaseAdmin
        .from('changelog')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data || []
    },

    async findLastRejectedForTask(projectId, userTask) {
      if (!projectId || !userTask) return null

      // Find the most recent changelog entry for this project
      // that has rejection_reasons and matches (or contains) the user task
      const { data, error } = await supabaseAdmin
        .from('changelog')
        .select('*')
        .eq('project_id', projectId)
        .not('rejection_reasons', 'eq', '[]')
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) return null
      if (!data || data.length === 0) return null

      // Find entry where user_task overlaps with the given task
      const taskLower = userTask.toLowerCase().slice(0, 100)
      const match = data.find(entry => {
        const entryTask = (entry.user_task || '').toLowerCase()
        return entryTask.includes(taskLower) || taskLower.includes(entryTask.slice(0, 100))
      })

      return match || null
    },
  },

  // ============ PROJECT MEMORY ============
  // Key-value memory entries per project for builder context
  projectMemory: {
    async findByProjectId(projectId) {
      if (!projectId) return []

      const { data, error } = await supabaseAdmin
        .from('project_memory')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data || []
    },

    async create(entry) {
      const { data, error } = await supabaseAdmin
        .from('project_memory')
        .insert({
          project_id: entry.project_id,
          key: entry.key,
          value: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
        })
        .select()
        .single()

      if (error) throw error
      return data
    },

    async updateById(id, updates) {
      if (!id) return null

      const updatePayload = {
        updated_at: new Date().toISOString(),
      }
      if (updates.key !== undefined) updatePayload.key = updates.key
      if (updates.value !== undefined) {
        updatePayload.value = typeof updates.value === 'string' ? updates.value : JSON.stringify(updates.value)
      }

      const { data, error } = await supabaseAdmin
        .from('project_memory')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async deleteById(id) {
      if (!id) return { success: false }

      const { error } = await supabaseAdmin
        .from('project_memory')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    },
  },

  // ============ GENERATION RUNS ============
  // Tracks AI generation runs for analytics and debugging
  generationRuns: {
    async create(entry) {
      const { data, error } = await supabaseAdmin
        .from('generation_runs')
        .insert({
          id: entry.id,
          project_id: entry.project_id,
          chat_id: entry.chat_id || null,
          user_id: entry.user_id || null,
          tool_mode: entry.tool_mode || 'unknown',
          files_generated: entry.files_generated || 0,
          duration: entry.duration || null,
          success: entry.success !== false,
          error: entry.error || null,
          provider: entry.provider || 'openai',
          model: entry.model || null,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },

    async findByProjectId(projectId, limit = 50) {
      if (!projectId) return []

      const { data, error } = await supabaseAdmin
        .from('generation_runs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data || []
    },

    /**
     * Aggregate all generation runs for a user over a rolling window.
     * Returns the raw run rows — the API route rolls them up into trend
     * metrics (counts per provider, avg duration, success rate, etc.).
     */
    async findByUserSince(userId, sinceIso, limit = 500) {
      if (!userId || !sinceIso) return []
      const { data, error } = await supabaseAdmin
        .from('generation_runs')
        .select('id, project_id, tool_mode, files_generated, duration, success, provider, model, created_at')
        .eq('user_id', userId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },
  },

  // ============ CREDITS ============
  credits: {
    async getBalance(userId) {
      if (!userId) return null

      const { data, error } = await supabaseAdmin
        .from('credits_balance')
        .select('balance, updated_at')
        .eq('user_id', userId)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async initBalance(userId, startingBalance = 50.0) {
      const { data, error } = await supabaseAdmin
        .from('credits_balance')
        .upsert({
          user_id: userId,
          balance: startingBalance,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        .select()
        .single()

      if (error) throw error
      return data
    },

    async addCredits(userId, amount) {
      // Get current balance first
      let current = await this.getBalance(userId)
      if (!current) {
        current = await this.initBalance(userId, 0)
      }

      const newBalance = parseFloat(current.balance) + parseFloat(amount)

      const { data, error } = await supabaseAdmin
        .from('credits_balance')
        .update({
          balance: newBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async deductCredits(userId, amount, actionType) {
      let current = await this.getBalance(userId)
      if (!current) {
        current = await this.initBalance(userId)
      }

      const currentBalance = parseFloat(current.balance)
      const cost = parseFloat(amount)

      if (currentBalance < cost) {
        return { error: 'Insufficient credits', balance: currentBalance, required: cost }
      }

      const newBalance = currentBalance - cost

      const { data, error } = await supabaseAdmin
        .from('credits_balance')
        .update({
          balance: newBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select()
        .single()

      if (error) throw error

      // Log usage
      await supabaseAdmin
        .from('credits_usage')
        .insert({
          user_id: userId,
          action_type: actionType,
          cost: cost,
        })

      return data
    },

    async getUsageHistory(userId, limit = 50) {
      const { data, error } = await supabaseAdmin
        .from('credits_usage')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data || []
    },
  },

  snapshots: {
    async create(doc) {
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .insert({
          project_id: doc.project_id,
          name: doc.name,
          files_snapshot: doc.files_snapshot,
          canvas_snapshot: doc.canvas_snapshot || null,
          metadata: doc.metadata || null,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },

    async findById(id) {
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) return null
      return data
    },

    async findByProjectId(projectId) {
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) return []
      return data || []
    },

    async delete(id) {
      const { error } = await supabaseAdmin
        .from('snapshots')
        .delete()
        .eq('id', id)
      if (error) throw error
      return { success: true }
    },
  },


  sharedPreviews: {
    async create(doc) {
      const snapshotDoc = {
        project_id: doc.project_id,
        name: `__share__${doc.share_token}`,
        files_snapshot: doc.files_snapshot,
        canvas_snapshot: null,
        metadata: {
          share_token: doc.share_token,
          user_id: doc.user_id,
          title: doc.title,
          views: 0,
          expires_at: doc.expires_at || null,
        },
      }
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .insert(snapshotDoc)
        .select()
        .single()
      if (error) throw error
      return { ...data, share_token: doc.share_token, title: doc.title, views: 0, expires_at: doc.expires_at || null }
    },

    async findByToken(token) {
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .select('*')
        .eq('name', `__share__${token}`)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        id: data.id,
        project_id: data.project_id,
        share_token: data.metadata?.share_token || token,
        title: data.metadata?.title || 'Shared Preview',
        files_snapshot: data.files_snapshot || [],
        views: data.metadata?.views || 0,
        user_id: data.metadata?.user_id,
        expires_at: data.metadata?.expires_at || null,
        created_at: data.created_at,
      }
    },

    async findByProjectId(projectId) {
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .select('id, name, metadata, created_at')
        .eq('project_id', projectId)
        .like('name', '__share__%')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map(d => ({
        id: d.id,
        share_token: d.metadata?.share_token || d.name.replace('__share__', ''),
        title: d.metadata?.title || 'Shared Preview',
        views: d.metadata?.views || 0,
        expires_at: d.metadata?.expires_at || null,
        created_at: d.created_at,
      }))
    },

    async incrementViews(token) {
      const existing = await this.findByToken(token)
      if (!existing) return
      const newViews = (existing.views || 0) + 1
      await supabaseAdmin
        .from('snapshots')
        .update({ metadata: { ...existing, views: newViews, share_token: token, title: existing.title, user_id: existing.user_id } })
        .eq('name', `__share__${token}`)
    },

    async delete(id, projectId) {
      const { error } = await supabaseAdmin
        .from('snapshots')
        .delete()
        .eq('id', id)
        .eq('project_id', projectId)
        .like('name', '__share__%')
      if (error) throw error
      return true
    },
  },

  marketplaceTemplates: {
    async findAll() {
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .select('*')
        .like('name', '__marketplace__%')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map(d => ({
        id: d.id,
        project_id: d.project_id,
        name: d.metadata?.name || 'Untitled',
        description: d.metadata?.description || '',
        category: d.metadata?.category || 'General',
        author_email: d.metadata?.author_email || '',
        file_count: d.metadata?.file_count || 0,
        clones: d.metadata?.clones || 0,
        avg_rating: d.metadata?.avg_rating || 0,
        review_count: d.metadata?.review_count || 0,
        files_snapshot: d.files_snapshot || [],
        created_at: d.created_at,
      }))
    },

    async findById(id) {
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .select('*')
        .eq('id', id)
        .like('name', '__marketplace__%')
        .maybeSingle()
      if (error) return null
      if (!data) return null
      return {
        id: data.id,
        project_id: data.project_id,
        name: data.metadata?.name || 'Untitled',
        description: data.metadata?.description || '',
        category: data.metadata?.category || 'General',
        author_email: data.metadata?.author_email || '',
        file_count: data.metadata?.file_count || 0,
        clones: data.metadata?.clones || 0,
        files_snapshot: data.files_snapshot || [],
        created_at: data.created_at,
      }
    },

    async create(doc) {
      const snapshotDoc = {
        project_id: doc.project_id,
        name: `__marketplace__${doc.name.replace(/\s+/g, '_').toLowerCase()}__${Date.now()}`,
        files_snapshot: doc.files_snapshot,
        canvas_snapshot: null,
        metadata: {
          name: doc.name,
          description: doc.description,
          category: doc.category,
          user_id: doc.user_id,
          author_email: doc.author_email,
          file_count: doc.file_count,
          clones: 0,
        },
      }
      const { data, error } = await supabaseAdmin
        .from('snapshots')
        .insert(snapshotDoc)
        .select()
        .single()
      if (error) throw error
      return {
        id: data.id,
        project_id: data.project_id,
        name: doc.name,
        description: doc.description,
        category: doc.category,
        author_email: doc.author_email,
        file_count: doc.file_count,
        clones: 0,
        created_at: data.created_at,
      }
    },

    async incrementClones(id) {
      const { data } = await supabaseAdmin
        .from('snapshots')
        .select('metadata')
        .eq('id', id)
        .maybeSingle()
      if (!data) return
      const meta = data.metadata || {}
      meta.clones = (meta.clones || 0) + 1
      await supabaseAdmin
        .from('snapshots')
        .update({ metadata: meta })
        .eq('id', id)
    },

    async delete(id, userId) {
      const { data } = await supabaseAdmin
        .from('snapshots')
        .select('metadata')
        .eq('id', id)
        .like('name', '__marketplace__%')
        .maybeSingle()
      if (!data) return false
      if (data.metadata?.user_id !== userId) return false
      const { error } = await supabaseAdmin
        .from('snapshots')
        .delete()
        .eq('id', id)
      if (error) throw error
      return true
    },

    async addReview(templateId, review) {
      const { data } = await supabaseAdmin
        .from('snapshots')
        .select('metadata')
        .eq('id', templateId)
        .like('name', '__marketplace__%')
        .maybeSingle()
      if (!data) throw new Error('Template not found')
      const meta = data.metadata || {}
      const reviews = meta.reviews || []
      // Check if user already reviewed
      const existingIdx = reviews.findIndex(r => r.user_id === review.user_id)
      const newReview = { ...review, created_at: new Date().toISOString() }
      if (existingIdx >= 0) {
        reviews[existingIdx] = newReview
      } else {
        reviews.push(newReview)
      }
      // Compute average rating
      const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : 0
      meta.reviews = reviews
      meta.avg_rating = parseFloat(avgRating)
      meta.review_count = reviews.length
      await supabaseAdmin
        .from('snapshots')
        .update({ metadata: meta })
        .eq('id', templateId)
      return newReview
    },

    async getReviews(templateId) {
      const { data } = await supabaseAdmin
        .from('snapshots')
        .select('metadata')
        .eq('id', templateId)
        .like('name', '__marketplace__%')
        .maybeSingle()
      if (!data) return []
      return (data.metadata?.reviews || []).map(r => ({
        author_email: r.author_email,
        rating: r.rating,
        comment: r.comment,
        created_at: r.created_at,
      }))
    },
  },

  deployments: {
    async create(doc) {
      const { data, error } = await supabaseAdmin
        .from('deployments')
        .insert(doc)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async findByProjectId(projectId) {
      const { data, error } = await supabaseAdmin
        .from('deployments')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data || []
    },

    async findById(id) {
      const { data, error } = await supabaseAdmin
        .from('deployments')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) return null
      return data
    },

    async updateStatus(id, status, url) {
      const updates = { status }
      if (url) updates.url = url
      const { data, error } = await supabaseAdmin
        .from('deployments')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
  },

  exports: {
    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('exports')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async findByProjectId(projectId) {
      const { data, error } = await supabaseAdmin
        .from('exports')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  },

  /**
   * Project collaborators — basic multi-user team collaboration.
   * Each row: { project_id, user_id, role: 'viewer' | 'editor', invited_by, invited_at }
   *
   * The table schema is created lazily on first write so the module
   * degrades gracefully in environments where the migration hasn't
   * been applied yet.
   */
  projectCollaborators: {
    async list(projectId) {
      if (!projectId) return []
      const { data, error } = await supabaseAdmin
        .from('project_collaborators')
        .select('project_id, user_id, role, invited_by, invited_at, users!project_collaborators_user_id_fkey(email, name, avatar_url)')
        .eq('project_id', projectId)
        .order('invited_at', { ascending: true })
      if (error) {
        if (/does not exist/i.test(error.message || '')) return []
        throw error
      }
      return data || []
    },

    async invite({ projectId, email, role = 'viewer', invitedBy }) {
      const cleanEmail = String(email || '').trim().toLowerCase()
      if (!cleanEmail || !projectId) throw new Error('projectId and email are required')
      if (!['viewer', 'editor'].includes(role)) throw new Error('role must be viewer or editor')

      const { data: user, error: userErr } = await supabaseAdmin
        .from('users')
        .select('id, email, name')
        .eq('email', cleanEmail)
        .maybeSingle()
      if (userErr) throw userErr
      if (!user) throw new Error('No user found with that email. Ask them to sign up first.')

      const { data, error } = await supabaseAdmin
        .from('project_collaborators')
        .upsert(
          { project_id: projectId, user_id: user.id, role, invited_by: invitedBy, invited_at: new Date().toISOString() },
          { onConflict: 'project_id,user_id' },
        )
        .select()
        .single()
      if (error) throw error
      return { ...data, email: user.email, name: user.name }
    },

    async remove({ projectId, userId }) {
      if (!projectId || !userId) throw new Error('projectId and userId are required')
      const { error } = await supabaseAdmin
        .from('project_collaborators')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', userId)
      if (error) throw error
      return { removed: true }
    },

    /**
     * Returns the role the given user has on the project, or null if
     * they're not a collaborator. Used by auth gates on mutating routes.
     */
    async roleFor({ projectId, userId }) {
      if (!projectId || !userId) return null
      const { data, error } = await supabaseAdmin
        .from('project_collaborators')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) {
        if (/does not exist/i.test(error.message || '')) return null
        return null
      }
      return data?.role || null
    },
  },

  // ============ PROMO CODES ============
  promoCodes: {
    async findAll() {
      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async findByCode(code) {
      if (!code) return null
      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .select('*')
        .eq('code', code.toUpperCase())
        .maybeSingle()
      if (error) return null
      return data
    },

    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .insert({
          code: payload.code.toUpperCase(),
          plan: payload.plan,
          max_uses: payload.max_uses || 1,
          created_by: payload.created_by,
          expires_at: payload.expires_at || null,
          description: payload.description || null,
          is_active: true,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },

    async deactivate(id) {
      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async incrementUses(id) {
      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .select('uses_count')
        .eq('id', id)
        .single()
      if (error) throw error
      
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('promo_codes')
        .update({ uses_count: data.uses_count + 1 })
        .eq('id', id)
        .select()
        .single()
      if (updateError) throw updateError
      return updated
    },
  },

  promoRedemptions: {
    async findByUserId(userId) {
      if (!userId) return []
      const { data, error } = await supabaseAdmin
        .from('user_promo_redemptions')
        .select('*, promo_codes(*)')
        .eq('user_id', userId)
        .order('redeemed_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async hasUserRedeemed(userId, promoCodeId) {
      if (!userId || !promoCodeId) return false
      const { data, error } = await supabaseAdmin
        .from('user_promo_redemptions')
        .select('id')
        .eq('user_id', userId)
        .eq('promo_code_id', promoCodeId)
        .maybeSingle()
      if (error) return false
      return !!data
    },

    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('user_promo_redemptions')
        .insert({
          user_id: payload.user_id,
          promo_code_id: payload.promo_code_id,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
  },

  // ============ AGENT COLLABORATIONS ============
  // Inter-agent collaboration sessions (Project Agent ↔ Core System)
  agentCollaborations: {
    async create(payload) {
      const { data, error } = await supabaseAdmin
        .from('agent_collaborations')
        .insert({
          project_chat_id: payload.project_chat_id,
          core_chat_id: payload.core_chat_id,
          user_id: payload.user_id,
          status: 'active',
          initial_context: payload.initial_context || null,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },

    async findById(id) {
      if (!id) return null
      const { data, error } = await supabaseAdmin
        .from('agent_collaborations')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) return null
      return data
    },

    async findActiveByProjectChat(projectChatId) {
      if (!projectChatId) return null
      const { data, error } = await supabaseAdmin
        .from('agent_collaborations')
        .select('*')
        .eq('project_chat_id', projectChatId)
        .eq('status', 'active')
        .maybeSingle()
      if (error) return null
      return data
    },

    async findActiveByCoreChat(coreChatId) {
      if (!coreChatId) return null
      const { data, error } = await supabaseAdmin
        .from('agent_collaborations')
        .select('*')
        .eq('core_chat_id', coreChatId)
        .eq('status', 'active')
        .maybeSingle()
      if (error) return null
      return data
    },

    async updateStatus(id, status, summary = null) {
      const updates = { status }
      if (status === 'paused') updates.paused_at = new Date().toISOString()
      if (status === 'resolved') {
        updates.resolved_at = new Date().toISOString()
        if (summary) updates.resolution_summary = summary
      }
      if (status === 'cancelled') updates.cancelled_at = new Date().toISOString()
      
      const { data, error } = await supabaseAdmin
        .from('agent_collaborations')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async incrementMessageCount(id) {
      const { data, error } = await supabaseAdmin
        .from('agent_collaborations')
        .select('message_count')
        .eq('id', id)
        .single()
      if (error) throw error
      
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('agent_collaborations')
        .update({ message_count: data.message_count + 1 })
        .eq('id', id)
        .select()
        .single()
      if (updateError) throw updateError
      return updated
    },

    async addCreditsUsed(id, amount) {
      const { data, error } = await supabaseAdmin
        .from('agent_collaborations')
        .select('credits_used')
        .eq('id', id)
        .single()
      if (error) throw error
      
      const newTotal = parseFloat(data.credits_used) + parseFloat(amount)
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('agent_collaborations')
        .update({ credits_used: newTotal })
        .eq('id', id)
        .select()
        .single()
      if (updateError) throw updateError
      return updated
    },

    async findByUserId(userId, limit = 20) {
      if (!userId) return []
      const { data, error } = await supabaseAdmin
        .from('agent_collaborations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },
  },
}