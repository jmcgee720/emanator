import { createClient } from '@supabase/supabase-js'

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

      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .ilike('email', email.trim())
        .maybeSingle()

      if (error) return null
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
        .order('created_at', { ascending: true })

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
      return data || []
    },

    async findIndexByProjectId(projectId) {
      if (!projectId) return []

      const { data, error } = await supabaseAdmin
        .from('project_files')
        .select('path, content, file_type, updated_at, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data || []).map(f => ({
        path: f.path,
        size: typeof f.content === 'string' ? f.content.length : 0,
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
      const { data, error } = await supabaseAdmin
        .from('project_files')
        .insert(payload)
        .select()
        .single()

      if (error) throw error
      return data
    },

    async update(id, updates) {
      const { data, error } = await supabaseAdmin
        .from('project_files')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
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

      if (existing) {
        const nextVersion = Number(existing.version || 1) + 1
        const { data, error } = await supabaseAdmin
          .from('project_files')
          .update({
            content,
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
          content,
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

      const { data, error } = await supabaseAdmin
        .from('project_files')
        .insert(rows)
        .select()

      if (error) throw error
      return data || []
    },

    async delete(id) {
      const { error } = await supabaseAdmin
        .from('project_files')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    },

    async deleteByProjectId(projectId) {
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
    async findByChatId(chatId) {
      if (!chatId) return []

      const { data, error } = await supabaseAdmin
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })

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
}