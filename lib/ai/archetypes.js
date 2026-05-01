// ══════════════════════════════════════════════════════════════════════
// ── EMANATOR ARCHETYPES ──
// Deterministic catalog of app archetypes. Every archetype declares the
// routes and user flows that MUST exist in the generated app, regardless
// of whether the user's brief named them. This is how Auroraly infers
// Sign Up without being told.
//
// Adding a new archetype: drop a new entry into ARCHETYPES. That's it.
// Keep triggers tight. Keep requiredRoutes honest — only list routes
// that MUST be there for the app to feel complete.
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ArchetypeFlow
 * @property {string} id
 * @property {string} desc - Human-readable flow description, used in plan prompts
 */

/**
 * @typedef {Object} Archetype
 * @property {string} id
 * @property {string} label
 * @property {RegExp} triggers - Fast regex-first match on brief text
 * @property {string[]} requiredRoutes - Route ids that MUST appear in the plan
 * @property {ArchetypeFlow[]} requiredFlows - Flows that MUST be wired end-to-end
 * @property {string[]} dataShapes - Domain entities the MockAPI should seed
 * @property {string} [notes] - Extra guidance injected into the planner prompt
 */

/** @type {Record<string, Archetype>} */
export const ARCHETYPES = {
  saas_tool: {
    id: 'saas_tool',
    label: 'SaaS tool / B2B software',
    triggers: /\b(saas|platform|workspace|team|organization|workflow|automation|productivity tool|admin dashboard|analytics platform|b2b)\b/i,
    requiredRoutes: ['landing', 'features', 'pricing', 'login', 'signup', 'forgot_password', 'dashboard', 'settings', 'onboarding'],
    requiredFlows: [
      { id: 'signup_to_dashboard', desc: 'Landing CTA → signup form → onboarding → dashboard' },
      { id: 'login_to_dashboard', desc: 'Navbar login → login form → dashboard' },
      { id: 'logout', desc: 'Dashboard logout → auth cleared → landing' },
      { id: 'pricing_cta', desc: 'Pricing tier CTA → signup prefilled with tier' },
    ],
    dataShapes: ['User', 'Workspace', 'Item'],
  },

  ai_app: {
    id: 'ai_app',
    label: 'AI app / copilot / chat-based tool',
    triggers: /\b(ai-powered|ai tool|copilot|chatbot|gpt|llm|prompt|generate text|ai assistant|writing assistant|ai chat)\b/i,
    requiredRoutes: ['landing', 'features', 'pricing', 'login', 'signup', 'dashboard', 'chat', 'settings', 'api_keys'],
    requiredFlows: [
      { id: 'signup_to_chat', desc: 'Landing → signup → api-key setup (optional, skippable) → chat' },
      { id: 'chat_session', desc: 'User types prompt → streaming mock response → message persists in history' },
      { id: 'history_nav', desc: 'Sidebar shows past conversations, click loads into main pane' },
    ],
    dataShapes: ['User', 'Conversation', 'Message'],
  },

  marketplace: {
    id: 'marketplace',
    label: 'Marketplace / two-sided platform',
    triggers: /\b(marketplace|buyer|seller|listing|vendor|browse sellers|two-sided|freelancer platform)\b/i,
    requiredRoutes: ['landing', 'browse', 'item_detail', 'login', 'signup', 'dashboard', 'my_listings', 'create_listing', 'checkout'],
    requiredFlows: [
      { id: 'browse_to_buy', desc: 'Landing → browse → item detail → checkout → confirmation' },
      { id: 'become_seller', desc: 'Signup → dashboard → create listing → listing appears in browse' },
    ],
    dataShapes: ['User', 'Listing', 'Order'],
  },

  social_app: {
    id: 'social_app',
    label: 'Social app / feed-based community',
    triggers: /\b(social network|social app|feed|posts|followers|timeline|share with friends|community feed)\b/i,
    requiredRoutes: ['landing', 'login', 'signup', 'feed', 'profile', 'post_detail', 'notifications', 'settings'],
    requiredFlows: [
      { id: 'signup_to_feed', desc: 'Signup → pick-a-username → feed with seeded posts' },
      { id: 'create_post', desc: 'Feed → new post composer → submit → appears at top of feed' },
      { id: 'like_and_follow', desc: 'Like button toggles state; follow button updates profile' },
    ],
    dataShapes: ['User', 'Post', 'Comment', 'Follow'],
  },

  content_site: {
    id: 'content_site',
    label: 'Content site / blog / newsletter',
    triggers: /\b(blog|newsletter|magazine|articles|publication|editorial|content site)\b/i,
    requiredRoutes: ['landing', 'articles', 'article_detail', 'about', 'subscribe', 'search'],
    requiredFlows: [
      { id: 'browse_to_read', desc: 'Landing → article list → article detail with reading experience' },
      { id: 'subscribe', desc: 'Subscribe CTA → email form → success toast → stored in mock list' },
    ],
    dataShapes: ['Article', 'Author', 'Subscriber'],
  },

  portfolio: {
    id: 'portfolio',
    label: 'Portfolio / personal site',
    triggers: /\b(portfolio|personal site|resume site|my work|showcase projects|about me)\b/i,
    requiredRoutes: ['landing', 'projects', 'project_detail', 'about', 'contact'],
    requiredFlows: [
      { id: 'view_project', desc: 'Landing → projects grid → project detail with gallery' },
      { id: 'contact', desc: 'Contact form → submit → thank-you state' },
    ],
    dataShapes: ['Project', 'Experience'],
  },

  ecommerce: {
    id: 'ecommerce',
    label: 'E-commerce / online store',
    triggers: /\b(e-?commerce|online store|shop|store for|sell products|product catalog|shopping cart)\b/i,
    requiredRoutes: ['landing', 'shop', 'product_detail', 'cart', 'checkout', 'login', 'signup', 'orders'],
    requiredFlows: [
      { id: 'browse_to_buy', desc: 'Landing → shop → product detail → add to cart → checkout → order confirmation' },
      { id: 'guest_checkout', desc: 'Checkout works without login; offers account creation at end' },
    ],
    dataShapes: ['Product', 'Cart', 'Order', 'User'],
  },

  dashboard_internal: {
    id: 'dashboard_internal',
    label: 'Internal dashboard / admin panel',
    triggers: /\b(admin panel|internal tool|analytics dashboard|reporting dashboard|ops tool|monitoring)\b/i,
    requiredRoutes: ['login', 'dashboard', 'data_table', 'detail', 'settings'],
    requiredFlows: [
      { id: 'login_to_dashboard', desc: 'Login → dashboard with KPI cards and data table' },
      { id: 'drill_down', desc: 'Row click → detail view → back to table preserves filters' },
    ],
    dataShapes: ['User', 'Record'],
  },

  chat_app: {
    id: 'chat_app',
    label: 'Chat app / messaging',
    triggers: /\b(chat app|messaging app|messenger|direct messages|instant message|team chat)\b/i,
    requiredRoutes: ['landing', 'login', 'signup', 'conversations', 'conversation_detail', 'profile'],
    requiredFlows: [
      { id: 'signup_to_chat', desc: 'Signup → pick username → conversations list seeded with demo chats' },
      { id: 'send_message', desc: 'Type message → send → appears in thread → persists on refresh' },
    ],
    dataShapes: ['User', 'Conversation', 'Message'],
  },

  utility_tool: {
    id: 'utility_tool',
    label: 'Utility tool / single-purpose app',
    triggers: /\b(converter|calculator|generator|formatter|validator|single-purpose tool|utility tool)\b/i,
    requiredRoutes: ['home', 'about'],
    requiredFlows: [
      { id: 'input_to_output', desc: 'User enters input → clicks action → sees output with copy button' },
    ],
    dataShapes: ['HistoryItem'],
  },

  crm: {
    id: 'crm',
    label: 'CRM / relationship-centric tool',
    triggers: /\b(crm|customer relationship|sales pipeline|deal tracker|contact management|lead management)\b/i,
    requiredRoutes: ['login', 'signup', 'dashboard', 'contacts', 'contact_detail', 'pipeline', 'activities', 'settings'],
    requiredFlows: [
      { id: 'signup_to_contacts', desc: 'Signup → onboarding → contacts list with seeded demo leads' },
      { id: 'move_deal', desc: 'Drag-and-drop deal across pipeline stages (or stage-change dropdown)' },
      { id: 'log_activity', desc: 'Contact detail → log call/email/note → appears in timeline' },
    ],
    dataShapes: ['User', 'Contact', 'Deal', 'Activity'],
  },

  lms: {
    id: 'lms',
    label: 'LMS / course platform',
    triggers: /\b(lms|learning management|course platform|online course|elearning|teach online)\b/i,
    requiredRoutes: ['landing', 'courses', 'course_detail', 'lesson', 'login', 'signup', 'dashboard', 'progress'],
    requiredFlows: [
      { id: 'signup_to_course', desc: 'Signup → browse courses → enroll → lesson viewer' },
      { id: 'lesson_progress', desc: 'Complete lesson → progress bar updates → next lesson unlocks' },
    ],
    dataShapes: ['User', 'Course', 'Lesson', 'Enrollment'],
  },

  booking: {
    id: 'booking',
    label: 'Booking / scheduling app',
    triggers: /\b(booking|schedule|appointment|reservation|calendly|coach booking|barber booking)\b/i,
    requiredRoutes: ['landing', 'services', 'book', 'login', 'signup', 'dashboard', 'my_bookings'],
    requiredFlows: [
      { id: 'guest_book', desc: 'Landing → pick service → pick time slot → enter details → confirmation' },
      { id: 'my_bookings', desc: 'Signup → dashboard → see upcoming + past bookings' },
    ],
    dataShapes: ['Service', 'Slot', 'Booking'],
  },

  community: {
    id: 'community',
    label: 'Community / forum',
    triggers: /\b(community|forum|discussion board|threads|subreddit|message board)\b/i,
    requiredRoutes: ['landing', 'feed', 'thread_detail', 'new_thread', 'login', 'signup', 'profile'],
    requiredFlows: [
      { id: 'signup_to_post', desc: 'Signup → feed → new thread → thread appears at top' },
      { id: 'reply_and_vote', desc: 'Thread detail → reply → appears; upvote toggles state' },
    ],
    dataShapes: ['User', 'Thread', 'Reply', 'Vote'],
  },

  media: {
    id: 'media',
    label: 'Media / streaming catalog',
    triggers: /\b(streaming|video platform|podcast app|music app|media catalog|watch videos)\b/i,
    requiredRoutes: ['landing', 'browse', 'player', 'category', 'login', 'signup', 'library'],
    requiredFlows: [
      { id: 'browse_to_play', desc: 'Landing → browse grid → item → player with controls' },
      { id: 'save_to_library', desc: 'Signup → save item → library shows it' },
    ],
    dataShapes: ['User', 'MediaItem', 'Category'],
  },

  productivity: {
    id: 'productivity',
    label: 'Productivity tool / notes / tasks / kanban',
    triggers: /\b(notes app|note-taking|task manager|todo app|kanban|project tracker|notion-like|linear-like)\b/i,
    requiredRoutes: ['landing', 'login', 'signup', 'workspace', 'item_detail', 'settings'],
    requiredFlows: [
      { id: 'signup_to_workspace', desc: 'Signup → workspace seeded with sample items' },
      { id: 'crud_items', desc: 'Create/edit/delete item; persists via MockAPI' },
    ],
    dataShapes: ['User', 'Workspace', 'Item'],
  },

  landing_only: {
    id: 'landing_only',
    label: 'Landing page only (marketing site)',
    triggers: /\b(landing page|marketing site|one-pager|single page site|coming soon page|launch page)\b/i,
    requiredRoutes: ['landing'],
    requiredFlows: [
      { id: 'email_capture', desc: 'Hero email capture → success state (mock)' },
    ],
    dataShapes: ['Subscriber'],
    notes: 'Build ONE rich multi-section landing page. No auth, no app pages. Hero + features + social proof + pricing + FAQ + footer.',
  },
}

// ── Canonical route → file path mapping ──
// Keeps file naming consistent across archetypes. Shared across planner & builder.
export const ROUTE_FILE_MAP = {
  landing: 'pages/Landing.jsx',
  home: 'pages/Landing.jsx',
  features: 'pages/Features.jsx',
  pricing: 'pages/Pricing.jsx',
  about: 'pages/About.jsx',
  contact: 'pages/Contact.jsx',
  login: 'pages/Login.jsx',
  signup: 'pages/Signup.jsx',
  forgot_password: 'pages/ForgotPassword.jsx',
  onboarding: 'pages/Onboarding.jsx',
  dashboard: 'pages/Dashboard.jsx',
  settings: 'pages/Settings.jsx',
  profile: 'pages/Profile.jsx',
  search: 'pages/Search.jsx',
  browse: 'pages/Browse.jsx',
  shop: 'pages/Shop.jsx',
  cart: 'pages/Cart.jsx',
  checkout: 'pages/Checkout.jsx',
  orders: 'pages/Orders.jsx',
  my_listings: 'pages/MyListings.jsx',
  create_listing: 'pages/CreateListing.jsx',
  item_detail: 'pages/ItemDetail.jsx',
  product_detail: 'pages/ProductDetail.jsx',
  article_detail: 'pages/ArticleDetail.jsx',
  articles: 'pages/Articles.jsx',
  subscribe: 'pages/Subscribe.jsx',
  projects: 'pages/Projects.jsx',
  project_detail: 'pages/ProjectDetail.jsx',
  chat: 'pages/Chat.jsx',
  conversations: 'pages/Conversations.jsx',
  conversation_detail: 'pages/ConversationDetail.jsx',
  api_keys: 'pages/ApiKeys.jsx',
  feed: 'pages/Feed.jsx',
  post_detail: 'pages/PostDetail.jsx',
  notifications: 'pages/Notifications.jsx',
  data_table: 'pages/DataTable.jsx',
  detail: 'pages/Detail.jsx',
  contacts: 'pages/Contacts.jsx',
  contact_detail: 'pages/ContactDetail.jsx',
  pipeline: 'pages/Pipeline.jsx',
  activities: 'pages/Activities.jsx',
  courses: 'pages/Courses.jsx',
  course_detail: 'pages/CourseDetail.jsx',
  lesson: 'pages/Lesson.jsx',
  progress: 'pages/Progress.jsx',
  services: 'pages/Services.jsx',
  book: 'pages/Book.jsx',
  my_bookings: 'pages/MyBookings.jsx',
  thread_detail: 'pages/ThreadDetail.jsx',
  new_thread: 'pages/NewThread.jsx',
  player: 'pages/Player.jsx',
  category: 'pages/Category.jsx',
  library: 'pages/Library.jsx',
  workspace: 'pages/Workspace.jsx',
  my_listings_detail: 'pages/MyListingsDetail.jsx',
}

/**
 * Normalize a user-provided page name ("Sign Up", "My Account") to a route id.
 */
export function normalizeRouteName(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const aliases = {
    sign_up: 'signup', signup_page: 'signup',
    sign_in: 'login', log_in: 'login', log_in_page: 'login',
    forgot: 'forgot_password', reset_password: 'forgot_password',
    home: 'landing', landing_page: 'landing', index: 'landing',
    account: 'settings', my_account: 'settings',
    pricing_page: 'pricing', plans: 'pricing',
    product: 'product_detail', item: 'item_detail',
    article: 'article_detail', post: 'post_detail',
    blog: 'articles', posts: 'articles',
    messages: 'conversations', inbox: 'conversations',
    onboard: 'onboarding', welcome: 'onboarding',
  }
  return aliases[s] || s
}

/**
 * Regex-first archetype classifier.
 * Returns the highest-scoring archetype, with confidence based on trigger
 * match density. Caller can invoke classifyArchetypeLLM() for the ambiguous case.
 * @param {string} briefText
 * @returns {{archetype: Archetype, confidence: number, ambiguous: boolean, runnersUp?: Archetype[]}}
 */
export function classifyArchetypeFast(briefText) {
  const text = String(briefText || '')
  const scores = []
  for (const a of Object.values(ARCHETYPES)) {
    const matches = text.match(new RegExp(a.triggers.source, 'gi'))
    const score = matches ? matches.length : 0
    if (score > 0) scores.push({ archetype: a, score })
  }
  if (scores.length === 0) {
    return { archetype: ARCHETYPES.saas_tool, confidence: 0.3, ambiguous: true, runnersUp: [] }
  }
  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  const runnerUp = scores[1]
  const ambiguous = runnerUp && (top.score - runnerUp.score) < 1
  const confidence = ambiguous ? 0.55 : Math.min(0.95, 0.6 + top.score * 0.1)
  // Top-3 (including top) for recommended-archetypes UI
  const runnersUp = scores.slice(0, 3).map((s) => s.archetype)
  return { archetype: top.archetype, confidence, ambiguous: !!ambiguous, runnersUp }
}

/**
 * LLM-backed classifier for the ambiguous case. Uses a tiny gpt-4o-mini call
 * with JSON mode. Caller must inject an OpenAI-compatible provider.
 * @param {string} briefText
 * @param {{chat: Function}} provider
 * @returns {Promise<{archetype: Archetype, confidence: number, reasoning: string}>}
 */
export async function classifyArchetypeLLM(briefText, provider) {
  const list = Object.keys(ARCHETYPES).join(', ')
  const prompt = [
    { role: 'system', content: `You classify product briefs into ONE archetype id from this list: ${list}. If the brief spans multiple, pick the dominant one. Respond with strict JSON: {"archetype":"<id>","confidence":0.0-1.0,"reasoning":"one sentence"}.` },
    { role: 'user', content: String(briefText || '').slice(0, 2000) },
  ]
  const raw = await provider.chat(prompt, {
    temperature: 0,
    max_tokens: 150,
    response_format: { type: 'json_object' },
  })
  let parsed
  try { parsed = JSON.parse(raw) } catch { parsed = { archetype: 'saas_tool', confidence: 0.4, reasoning: 'parse_failed' } }
  const archetype = ARCHETYPES[parsed.archetype] || ARCHETYPES.saas_tool
  return {
    archetype,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    reasoning: parsed.reasoning || '',
  }
}

/**
 * End-to-end classifier: regex-first, LLM fallback on ambiguity.
 * @param {string} briefText
 * @param {{chat: Function}} [provider]
 */
export async function classifyArchetype(briefText, provider = null) {
  const fast = classifyArchetypeFast(briefText)
  if (!fast.ambiguous || !provider) {
    return { archetype: fast.archetype, confidence: fast.confidence, reasoning: 'regex_match' }
  }
  try {
    return await classifyArchetypeLLM(briefText, provider)
  } catch (e) {
    return { archetype: fast.archetype, confidence: fast.confidence, reasoning: `llm_fallback_failed:${e.message}` }
  }
}

/**
 * Merge archetype's required routes/flows with the user's explicitly requested
 * pages. User adds; archetype's required set is never subtracted.
 * @param {Archetype} archetype
 * @param {string[]} userPages - raw page names from the brief
 * @returns {{routes: string[], flows: ArchetypeFlow[], dataShapes: string[]}}
 */
export function mergeArchetypeWithBrief(archetype, userPages = []) {
  const normalizedUserRoutes = userPages
    .map(normalizeRouteName)
    .filter(r => r && r.length > 0 && r.length < 40)
  const routes = Array.from(new Set([...archetype.requiredRoutes, ...normalizedUserRoutes]))
  return {
    routes,
    flows: archetype.requiredFlows.slice(),
    dataShapes: archetype.dataShapes.slice(),
  }
}

/**
 * Get the file path for a route id. Returns null for unknown routes so the
 * caller can decide to skip or synthesize a path.
 */
export function routeToFile(routeId) {
  return ROUTE_FILE_MAP[routeId] || null
}
