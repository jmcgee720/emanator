import { createClient } from '@supabase/supabase-js'

/**
 * Supabase Database Client
 * Server-side only - uses service role key for full access
 */

let supabaseAdmin = null

export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
  }
  return supabaseAdmin
}

/**
 * Database helper functions
 */
export const db = {
  // ============ USERS ============
  users: {
    async findByEmail(email) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async findById(id) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async findAll() {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async create(user) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('users')
        .insert(user)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async update(id, updates) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async delete(id) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', id)
      if (error) throw error
      return true
    },

    async upsertOwner(email) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('users')
        .upsert(
          { email, role: 'owner', is_allowlisted: true },
          { onConflict: 'email' }
        )
        .select()
        .single()
      if (error) throw error
      return data
    }
  },

  // ============ PROJECTS ============
  projects: {
    async findByUserId(userId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async findById(id) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async create(project) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('projects')
        .insert(project)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async update(id, updates) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async delete(id) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id)
      if (error) throw error
      return true
    }
  },

  // ============ CHATS ============
  chats: {
    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async findById(id) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('id', id)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async create(chat) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chats')
        .insert(chat)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async update(id, updates) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chats')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async delete(id) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('chats')
        .delete()
        .eq('id', id)
      if (error) throw error
      return true
    }
  },

  // ============ MESSAGES ============
  messages: {
    async findByChatId(chatId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },

    async create(message) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('messages')
        .insert(message)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async deleteByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('project_id', projectId)
      if (error) throw error
      return true
    },

    async deleteByChatId(chatId) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('chat_id', chatId)
      if (error) throw error
      return true
    },

    async findById(messageId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('id', messageId)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async update(messageId, updates) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('messages')
        .update(updates)
        .eq('id', messageId)
        .select()
        .single()
      if (error) throw error
      return data
    }
  },

  // ============ PROJECT FILES ============
  projectFiles: {
    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_files')
        .select('*')
        .eq('project_id', projectId)
        .order('path', { ascending: true })
      if (error) throw error
      return data || []
    },

    async findByPath(projectId, path) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_files')
        .select('*')
        .eq('project_id', projectId)
        .eq('path', path)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async create(file) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_files')
        .insert(file)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async update(id, updates) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_files')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async upsert(projectId, path, content, fileType = 'text') {
      const supabase = getSupabaseAdmin()
      
      // Check if file exists
      const existing = await this.findByPath(projectId, path)
      
      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from('project_files')
          .update({
            content,
            version: existing.version + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select()
          .single()
        if (error) throw error
        return { ...data, action: 'updated' }
      } else {
        // Create new
        const { data, error } = await supabase
          .from('project_files')
          .insert({
            project_id: projectId,
            path,
            content,
            file_type: fileType,
            version: 1
          })
          .select()
          .single()
        if (error) throw error
        return { ...data, action: 'created' }
      }
    },

    async delete(id) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('project_files')
        .delete()
        .eq('id', id)
      if (error) throw error
      return true
    },

    async deleteByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('project_files')
        .delete()
        .eq('project_id', projectId)
      if (error) throw error
      return true
    },

    async bulkInsert(files) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_files')
        .insert(files)
        .select()
      if (error) throw error
      return data
    }
  },

  // ============ PROJECT CANVAS ============
  projectCanvas: {
    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_canvas')
        .select('*')
        .eq('project_id', projectId)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async create(canvas) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_canvas')
        .insert(canvas)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async update(projectId, canvasContent) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_canvas')
        .update({
          canvas_content: canvasContent,
          last_updated: new Date().toISOString()
        })
        .eq('project_id', projectId)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async deleteByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('project_canvas')
        .delete()
        .eq('project_id', projectId)
      if (error) throw error
      return true
    }
  },

  // ============ CANVAS EVENTS ============
  canvasEvents: {
    async create(event) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('canvas_events')
        .insert(event)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('canvas_events')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    }
  },

  // ============ SNAPSHOTS ============
  snapshots: {
    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('snapshots')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async findById(id) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('snapshots')
        .select('*')
        .eq('id', id)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async create(snapshot) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('snapshots')
        .insert(snapshot)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async deleteByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('snapshots')
        .delete()
        .eq('project_id', projectId)
      if (error) throw error
      return true
    }
  },

  // ============ EXPORTS ============
  exports: {
    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('exports')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async create(exportRecord) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('exports')
        .insert(exportRecord)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async deleteByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('exports')
        .delete()
        .eq('project_id', projectId)
      if (error) throw error
      return true
    }
  },

  // ============ DEPLOYMENTS ============
  deployments: {
    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('deployments')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async create(deployment) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('deployments')
        .insert(deployment)
        .select()
        .single()
      if (error) throw error
      return data
    }
  },

  // ============ SEARCH INDEX ============
  searchIndex: {
    async create(entry) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('search_index')
        .insert(entry)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async bulkInsert(entries) {
      if (!entries || entries.length === 0) return []
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('search_index')
        .insert(entries)
        .select()
      if (error) throw error
      return data
    },

    async search(query, projectIds, contentTypes = null) {
      const supabase = getSupabaseAdmin()
      let queryBuilder = supabase
        .from('search_index')
        .select('*')
        .in('project_id', projectIds)
        .textSearch('content_text', query)
        .limit(50)
      
      if (contentTypes && contentTypes.length > 0) {
        queryBuilder = queryBuilder.in('content_type', contentTypes)
      }
      
      const { data, error } = await queryBuilder
      if (error) throw error
      return data || []
    }
  },

  // ============ GENERATION RUNS ============
  generationRuns: {
    async findByProjectId(projectId, limit = 50) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('generation_runs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },

    async create(run) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('generation_runs')
        .insert(run)
        .select()
        .single()
      if (error) throw error
      return data
    }
  },

  // ============ FILE CHANGE EVENTS ============
  fileChangeEvents: {
    async findByProjectId(projectId, limit = 100) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('file_change_events')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },

    async create(event) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('file_change_events')
        .insert(event)
        .select()
        .single()
      if (error) throw error
      return data
    }
  },

  // ============ CHAT ATTACHMENTS ============
  chatAttachments: {
    async findByChatId(chatId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chat_attachments')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },

    async findByMessageId(messageId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chat_attachments')
        .select('*')
        .eq('message_id', messageId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },

    async findById(id) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chat_attachments')
        .select('*')
        .eq('id', id)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },

    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chat_attachments')
        .select('id, filename, mime_type, size, file_category, chat_id, message_id, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async create(attachment) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chat_attachments')
        .insert(attachment)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async updateMessageId(id, messageId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('chat_attachments')
        .update({ message_id: messageId })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async delete(id) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('chat_attachments')
        .delete()
        .eq('id', id)
      if (error) throw error
      return true
    }
  },

  // ============ CHANGELOG ============
  changelog: {
    async create(entry) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('changelog')
        .insert({
          project_id: entry.project_id,
          chat_id: entry.chat_id,
          user_id: entry.user_id,
          user_task: entry.user_task,
          task_mode: entry.task_mode || 'plan',
          context_paths: entry.context_paths || [],
          validator_result: entry.validator_result || null,
          plan_hash: entry.plan_hash || null,
          rejection_reasons: entry.rejection_reasons || [],
          plan_summary: entry.plan_summary || null,
          file_actions: entry.file_actions || null,
          constraints_checked: entry.constraints_checked || null,
          created_at: new Date().toISOString(),
        })
        .select()
        .single()
      // Soft fail — changelog is non-critical
      if (error) {
        console.warn('[DB] changelog insert failed (table may not exist):', error.message)
        return null
      }
      return data
    },

    async findLastRejectedForTask(projectId, userTask) {
      const supabase = getSupabaseAdmin()
      const { data } = await supabase
        .from('changelog')
        .select('plan_hash')
        .eq('project_id', projectId)
        .eq('user_task', (userTask || '').slice(0, 1000))
        .neq('rejection_reasons', '[]')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data
    },

    async findByProject(projectId, limit = 20) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('changelog')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) return []
      return data || []
    }
  },

  projectMemory: {
    async findByProjectId(projectId) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_memory')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) {
        console.log('[projectMemory.findByProjectId] Error:', error.message)
        return []
      }
      return data || []
    },

    async create(entry) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_memory')
        .insert(entry)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async deleteById(id) {
      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('project_memory')
        .delete()
        .eq('id', id)
      if (error) throw error
    },

    async updateById(id, fields) {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('project_memory')
        .update(fields)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
  }
}
