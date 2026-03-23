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

export const db = {
  users: {
    async findByEmail(email) {
      const cleanEmail = email.trim()

      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .ilike('email', cleanEmail)
        .maybeSingle()

      if (error) return null
      return data
    },
  },
}