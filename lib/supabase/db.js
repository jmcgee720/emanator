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
}