/**
 * Image Prefetch & Art Direction Module
 * 
 * Tier 1 (Stock): Curated Unsplash URLs by category — instant, free, legally clear
 * Tier 2 (Custom): AI art-directed image generation — unique, on-brand, premium
 */

// ── Curated Stock Photo Library (Unsplash License — free commercial use) ──
const STOCK_LIBRARY = {
  plants: [
    { url: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=600&h=700&fit=crop', alt: 'Lush green houseplant' },
    { url: 'https://images.unsplash.com/photo-1463936575829-25148e1db1b8?w=600&h=800&fit=crop', alt: 'Indoor plant in white pot' },
    { url: 'https://images.unsplash.com/photo-1501004318855-ed801e3abe65?w=600&h=700&fit=crop', alt: 'Tropical plant leaves' },
    { url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600&h=700&fit=crop', alt: 'Green fern close-up' },
    { url: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=600&h=700&fit=crop', alt: 'Succulent plant arrangement' },
    { url: 'https://images.unsplash.com/photo-1509423350716-97f9360b4e09?w=600&h=700&fit=crop', alt: 'Monstera leaf detail' },
    { url: 'https://images.unsplash.com/photo-1466781783364-36c955e42a7f?w=600&h=700&fit=crop', alt: 'Cactus and succulents' },
    { url: 'https://images.unsplash.com/photo-1518882336236-17e4e5e2a724?w=600&h=700&fit=crop', alt: 'Indoor garden shelf' },
  ],
  nature: [
    { url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&h=500&fit=crop', alt: 'Sunlit forest path' },
    { url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&h=500&fit=crop', alt: 'Misty mountain valley' },
    { url: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&h=500&fit=crop', alt: 'Scenic mountain lake' },
    { url: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&h=500&fit=crop', alt: 'Rolling green hills' },
    { url: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=800&h=500&fit=crop', alt: 'Waterfall in forest' },
    { url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&h=500&fit=crop', alt: 'Golden sunset landscape' },
  ],
  food: [
    { url: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&h=600&fit=crop', alt: 'Fresh healthy bowl' },
    { url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&h=600&fit=crop', alt: 'Gourmet plated dish' },
    { url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&h=600&fit=crop', alt: 'Artisan pizza' },
    { url: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&h=600&fit=crop', alt: 'Pancake stack with berries' },
    { url: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&h=600&fit=crop', alt: 'Colorful salad bowl' },
    { url: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&h=600&fit=crop', alt: 'Breakfast spread' },
  ],
  people: [
    { url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop', alt: 'Professional headshot' },
    { url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop', alt: 'Smiling woman portrait' },
    { url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop', alt: 'Man portrait' },
    { url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop', alt: 'Woman headshot' },
    { url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop', alt: 'Professional profile' },
    { url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop', alt: 'Fashion portrait' },
  ],
  architecture: [
    { url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&h=500&fit=crop', alt: 'Modern glass skyscraper' },
    { url: 'https://images.unsplash.com/photo-1448630360428-65456885c650?w=800&h=500&fit=crop', alt: 'City skyline' },
    { url: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=800&h=500&fit=crop', alt: 'Modern building facade' },
    { url: 'https://images.unsplash.com/photo-1431576901776-e539bd916ba2?w=800&h=500&fit=crop', alt: 'Architectural interior' },
  ],
  technology: [
    { url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=500&fit=crop', alt: 'Circuit board close-up' },
    { url: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&h=500&fit=crop', alt: 'Cybersecurity visualization' },
    { url: 'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=800&h=500&fit=crop', alt: 'Laptop on desk' },
    { url: 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&h=500&fit=crop', alt: 'Tech abstract' },
  ],
  animals: [
    { url: 'https://images.unsplash.com/photo-1474511320723-9a56873571b7?w=600&h=600&fit=crop', alt: 'Dog portrait' },
    { url: 'https://images.unsplash.com/photo-1415369629372-26f2fe60c467?w=600&h=600&fit=crop', alt: 'Cat close-up' },
    { url: 'https://images.unsplash.com/photo-1437622368342-7a3d73a34c8f?w=600&h=600&fit=crop', alt: 'Sea turtle' },
    { url: 'https://images.unsplash.com/photo-1456926631375-92c8ce872def?w=600&h=600&fit=crop', alt: 'Bird in nature' },
  ],
  fashion: [
    { url: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=500&h=700&fit=crop', alt: 'Fashion editorial' },
    { url: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=500&h=700&fit=crop', alt: 'Stylish outfit' },
    { url: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=500&h=700&fit=crop', alt: 'Fashion store' },
    { url: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=500&h=700&fit=crop', alt: 'Shopping bags' },
  ],
  fitness: [
    { url: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=600&h=600&fit=crop', alt: 'Gym workout' },
    { url: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=600&h=600&fit=crop', alt: 'Yoga pose' },
    { url: 'https://images.unsplash.com/photo-1549060279-7e168fcee0c2?w=600&h=600&fit=crop', alt: 'Running athlete' },
    { url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&h=600&fit=crop', alt: 'Fitness equipment' },
  ],
  travel: [
    { url: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&h=500&fit=crop', alt: 'Travel map planning' },
    { url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=500&fit=crop', alt: 'Tropical beach' },
    { url: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&h=500&fit=crop', alt: 'Road trip highway' },
    { url: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800&h=500&fit=crop', alt: 'Mountain adventure' },
  ],
  interior: [
    { url: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=700&h=500&fit=crop', alt: 'Modern living room' },
    { url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=700&h=500&fit=crop', alt: 'Minimalist bedroom' },
    { url: 'https://images.unsplash.com/photo-1556909172-54557c7e4fb7?w=700&h=500&fit=crop', alt: 'Cozy reading nook' },
    { url: 'https://images.unsplash.com/photo-1600210492493-0946911123ea?w=700&h=500&fit=crop', alt: 'Scandinavian kitchen' },
  ],
  abstract: [
    { url: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=600&h=600&fit=crop', alt: 'Abstract paint swirl' },
    { url: 'https://images.unsplash.com/photo-1509281373149-e957c6296406?w=600&h=600&fit=crop', alt: 'Gradient liquid art' },
    { url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=600&h=600&fit=crop', alt: 'Geometric pattern' },
    { url: 'https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?w=600&h=600&fit=crop', alt: 'Neon abstract' },
  ],
}

// ── Vibe Translation System ──
// Maps natural-language descriptors to concrete visual parameters
const VIBE_LEXICON = {
  // Mood → Visual Treatment
  moods: {
    luxurious:    { lighting: 'dramatic side-lighting with deep shadows', palette: 'black, gold, ivory', texture: 'marble, velvet, brushed metal', typography: 'serif, high contrast', space: 'generous negative space' },
    minimal:      { lighting: 'soft diffused natural light', palette: 'white, off-white, single accent', texture: 'matte, clean surfaces', typography: 'thin sans-serif, monospaced', space: 'extreme whitespace, sparse elements' },
    vibrant:      { lighting: 'bright, saturated, high-key', palette: 'bold primaries, neon accents', texture: 'glossy, gradient overlays', typography: 'bold geometric sans', space: 'dense, energetic, overlapping elements' },
    moody:        { lighting: 'low-key, chiaroscuro, rim lighting', palette: 'deep blacks, muted tones, single color pop', texture: 'grain, noise, film artifacts', typography: 'condensed, high-weight', space: 'tight crops, cinematic framing' },
    organic:      { lighting: 'golden hour, warm natural light', palette: 'earth tones, sage, terracotta, cream', texture: 'raw linen, handmade paper, wood grain', typography: 'rounded, humanist', space: 'flowing, asymmetric, breathing' },
    futuristic:   { lighting: 'neon glow, holographic reflections', palette: 'electric blue, cyan, magenta on black', texture: 'glass, chrome, translucent layers', typography: 'geometric, all-caps, tracking-wide', space: 'grid-based, precise, mathematical' },
    playful:      { lighting: 'bright, flat, pop-art style', palette: 'pastels with bold accents, unexpected combos', texture: 'flat illustration, paper cutout', typography: 'rounded, bouncy, variable weight', space: 'dynamic, off-grid, rotated elements' },
    elegant:      { lighting: 'soft studio lighting, subtle gradients', palette: 'champagne, blush, navy, slate', texture: 'silk, fine paper, subtle emboss', typography: 'classic serif, generous kerning', space: 'balanced, golden-ratio proportions' },
    raw:          { lighting: 'harsh flash, overexposed highlights', palette: 'high contrast B&W with color bleed', texture: 'concrete, rust, torn edges', typography: 'handwritten, distressed, all-caps', space: 'tight, claustrophobic, collision' },
    ethereal:     { lighting: 'soft backlight, lens flare, bloom', palette: 'lavender, soft blue, pearl, translucent white', texture: 'bokeh, soft focus, double exposure', typography: 'light weight, airy tracking', space: 'open, floating, weightless' },
  },

  // Subject cues → photography style
  subjects: {
    product:      'product photography, studio lighting, clean background, center-frame, high detail',
    portrait:     'editorial portrait, shallow depth of field, catchlight in eyes, environmental context',
    landscape:    'wide-angle landscape, leading lines, foreground interest, golden ratio composition',
    food:         'overhead food photography, natural window light, styled surface, complementary garnish',
    architecture: 'architectural photography, converging lines, symmetry, blue-hour lighting',
    abstract:     'abstract macro photography, color field, texture detail, pattern repetition',
    lifestyle:    'candid lifestyle photography, natural moment, environmental storytelling, warm grade',
    nature:       'nature photography, shallow DOF on subject, environmental context, organic framing',
  },
}

// ── Creative Brief Parser ──

/**
 * Parse a user's message into a structured creative brief
 * Extracts mood, subject, color cues, style, and specific visual requirements
 */
export function parseCreativeBrief(userMessage) {
  if (!userMessage) return null
  const lower = userMessage.toLowerCase()

  const brief = {
    mood: null,
    moodParams: null,
    subjects: [],
    colors: [],
    lightingCues: [],
    styleCues: [],
    specificRequests: [],
    rawMessage: userMessage,
  }

  // Detect mood
  const moodKeywords = {
    luxurious: ['luxury', 'luxurious', 'premium', 'high-end', 'upscale', 'opulent', 'lavish', 'exclusive'],
    minimal: ['minimal', 'minimalist', 'clean', 'simple', 'whitespace', 'sparse'],
    vibrant: ['vibrant', 'colorful', 'bold', 'energetic', 'bright', 'vivid', 'dynamic'],
    moody: ['moody', 'dark', 'noir', 'dramatic', 'atmospheric', 'cinematic', 'glow', 'glowing', 'bioluminescent', 'neon'],
    organic: ['organic', 'natural', 'earthy', 'rustic', 'handmade', 'artisan', 'botanical', 'lush', 'green'],
    futuristic: ['futuristic', 'sci-fi', 'cyber', 'tech', 'holographic', 'digital', 'matrix', 'neon'],
    playful: ['playful', 'fun', 'whimsical', 'cartoon', 'cute', 'quirky', 'bouncy'],
    elegant: ['elegant', 'sophisticated', 'refined', 'classic', 'timeless', 'graceful'],
    raw: ['raw', 'gritty', 'punk', 'industrial', 'urban', 'street', 'underground'],
    ethereal: ['ethereal', 'dreamy', 'magical', 'enchanting', 'fairy', 'mystical', 'heavenly'],
  }

  for (const [mood, keywords] of Object.entries(moodKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) {
      brief.mood = mood
      brief.moodParams = VIBE_LEXICON.moods[mood]
      break
    }
  }

  // Detect subjects
  const subjectKeywords = {
    product: ['product', 'item', 'merchandise', 'goods', 'showcase', 'retail', 'shop', 'store', 'ecommerce'],
    portrait: ['portrait', 'headshot', 'team', 'people', 'person', 'face', 'profile', 'about us'],
    landscape: ['landscape', 'scenic', 'vista', 'horizon', 'panorama', 'outdoor'],
    food: ['food', 'restaurant', 'recipe', 'cuisine', 'chef', 'cooking', 'menu', 'cafe', 'bakery'],
    architecture: ['building', 'architecture', 'real estate', 'property', 'interior', 'room', 'house', 'apartment'],
    abstract: ['abstract', 'pattern', 'texture', 'gradient', 'geometric', 'generative'],
    lifestyle: ['lifestyle', 'wellness', 'fitness', 'yoga', 'travel', 'adventure'],
    nature: ['plant', 'plants', 'flower', 'flowers', 'tree', 'forest', 'garden', 'leaf', 'botanical', 'nature', 'floral', 'succulent', 'fern', 'monstera', 'orchid', 'bioluminescent'],
  }

  for (const [subject, keywords] of Object.entries(subjectKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) {
      brief.subjects.push(subject)
    }
  }

  // Detect color cues
  const colorPatterns = [
    { pattern: /\b(green|emerald|jade|sage|olive|mint|lime)\b/i, color: 'green' },
    { pattern: /\b(blue|navy|cobalt|azure|teal|cyan|cerulean)\b/i, color: 'blue' },
    { pattern: /\b(red|crimson|scarlet|burgundy|ruby|cherry)\b/i, color: 'red' },
    { pattern: /\b(purple|violet|lavender|amethyst|plum|magenta)\b/i, color: 'purple' },
    { pattern: /\b(gold|golden|amber|honey|brass|champagne)\b/i, color: 'gold' },
    { pattern: /\b(pink|rose|blush|coral|salmon|fuchsia)\b/i, color: 'pink' },
    { pattern: /\b(orange|tangerine|peach|copper|rust)\b/i, color: 'orange' },
    { pattern: /\b(black|dark|noir|midnight|charcoal|onyx)\b/i, color: 'black' },
    { pattern: /\b(white|bright|light|clean|snow|ivory|cream)\b/i, color: 'white' },
    { pattern: /\b(earth|brown|tan|beige|terracotta|sienna|wood)\b/i, color: 'earth' },
  ]
  for (const { pattern, color } of colorPatterns) {
    if (pattern.test(lower)) brief.colors.push(color)
  }

  // Detect lighting cues
  const lightingCues = [
    { pattern: /\b(glow|glowing|bioluminescen|phosphorescen|luminescen|neon)\b/i, cue: 'bioluminescent glow, self-illuminated, light emanating from subject' },
    { pattern: /\b(dark|night|shadow|dim|moody)\b/i, cue: 'low-key lighting, deep shadows, dramatic contrast' },
    { pattern: /\b(bright|sunny|daylight|natural light)\b/i, cue: 'bright natural light, high-key, airy' },
    { pattern: /\b(golden hour|sunset|warm light|warm glow)\b/i, cue: 'golden hour warmth, long shadows, amber tones' },
    { pattern: /\b(studio|professional|commercial)\b/i, cue: 'professional studio lighting, controlled, clean' },
  ]
  for (const { pattern, cue } of lightingCues) {
    if (pattern.test(lower)) brief.lightingCues.push(cue)
  }

  // Detect style cues
  const styleCues = [
    { pattern: /\b(stunning|award|beautiful|gorgeous|breathtaking)\b/i, cue: 'award-winning design quality, exceptional visual craftsmanship' },
    { pattern: /\b(modern|contemporary)\b/i, cue: 'contemporary design, current trends' },
    { pattern: /\b(vintage|retro|nostalgic)\b/i, cue: 'vintage aesthetic, nostalgic feel' },
    { pattern: /\b(3d|three-dimensional|depth|layered)\b/i, cue: '3D depth, layered composition, parallax feel' },
    { pattern: /\b(flat|illustration|illustrated|cartoon)\b/i, cue: 'flat illustration style, clean vector graphics' },
    { pattern: /\b(photo|photorealistic|realistic|real)\b/i, cue: 'photorealistic, high-fidelity imagery' },
  ]
  for (const { pattern, cue } of styleCues) {
    if (pattern.test(lower)) brief.styleCues.push(cue)
  }

  // Default mood if none detected
  if (!brief.mood) {
    if (brief.colors.includes('black') || brief.lightingCues.length > 0) {
      brief.mood = 'moody'
    } else if (brief.subjects.includes('nature')) {
      brief.mood = 'organic'
    } else {
      brief.mood = 'elegant'
    }
    brief.moodParams = VIBE_LEXICON.moods[brief.mood]
  }

  return brief
}

/**
 * Construct art-directed image generation prompts from a creative brief
 * Returns an array of detailed prompts for different placements
 */
export function constructArtDirectedPrompts(brief, count = 2) {
  const mood = brief.moodParams || VIBE_LEXICON.moods.elegant
  const subjectStyles = brief.subjects.map(s => VIBE_LEXICON.subjects[s] || '').filter(Boolean)
  const colorDesc = brief.colors.length > 0 ? `Color palette: ${brief.colors.join(', ')}.` : ''
  const lightingDesc = brief.lightingCues.length > 0 ? brief.lightingCues.join('. ') : mood.lighting
  const styleDesc = brief.styleCues.length > 0 ? brief.styleCues.join('. ') : 'high-quality, professional'

  // Build base context from the user's raw message
  const contextHint = brief.rawMessage.slice(0, 150)

  const placements = [
    {
      role: 'hero',
      size: '1536x1024',
      prompt: `Hero banner image. ${contextHint}. ${subjectStyles[0] || 'editorial photography'}. Lighting: ${lightingDesc}. ${colorDesc} Mood: ${mood.palette}, ${mood.texture}. ${styleDesc}. Wide composition with breathing room for text overlay on the left or center. Ultra high quality, 8K detail.`,
    },
    {
      role: 'feature',
      size: '1024x1024',
      prompt: `Feature showcase image. ${contextHint}. ${subjectStyles[0] || 'product detail shot'}. Lighting: ${lightingDesc}. ${colorDesc} Mood: ${mood.palette}. Center-framed subject with clean background. Intimate, detail-focused. ${styleDesc}.`,
    },
    {
      role: 'gallery_1',
      size: '1024x1536',
      prompt: `Gallery image (vertical). ${contextHint}. ${subjectStyles[0] || 'artistic composition'}. Lighting: ${lightingDesc}. ${colorDesc} ${mood.texture}. Artistic angle, unique perspective, depth-of-field blur on background. ${styleDesc}.`,
    },
    {
      role: 'gallery_2',
      size: '1024x1024',
      prompt: `Gallery image (square). ${contextHint}. ${subjectStyles.length > 1 ? subjectStyles[1] : subjectStyles[0] || 'atmospheric scene'}. Lighting: ${lightingDesc}. ${colorDesc} Environmental context, storytelling composition. ${styleDesc}.`,
    },
    {
      role: 'accent',
      size: '1024x1024',
      prompt: `Accent/detail image. ${contextHint}. Extreme close-up or macro detail shot. ${subjectStyles[0] || 'texture and pattern detail'}. Lighting: ${lightingDesc}. ${colorDesc} Abstract quality, can work as background or decorative element. ${styleDesc}.`,
    },
    {
      role: 'background',
      size: '1536x1024',
      prompt: `Full-bleed background image. ${contextHint}. ${subjectStyles[0] || 'atmospheric landscape'}. Lighting: ${lightingDesc}. ${colorDesc} Mood: ${mood.palette}. Subtle, not competing with foreground text. Slightly out of focus or with gradient fade. ${styleDesc}.`,
    },
  ]

  return placements.slice(0, count)
}

/**
 * Generate custom AI images with art direction
 * Uses OpenAI GPT Image 1 via the provider
 */
export async function generateArtDirectedImages(provider, brief, count = 2) {
  const prompts = constructArtDirectedPrompts(brief, count)
  const TIMEOUT_MS = 45_000  // 45 second timeout for all images combined

  // Run all image generations in parallel for speed
  const allSettled = await Promise.race([
    Promise.allSettled(
      prompts.map(placement =>
        provider.generateImage(placement.prompt, {
          size: placement.size,
          quality: 'medium',
        }).then(result => ({ result, placement }))
      )
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Image generation batch timed out')), TIMEOUT_MS)
    ),
  ]).catch(err => {
    console.error(`[ArtDirection] ${err.message}`)
    return []
  })

  const results = []
  for (const item of allSettled) {
    if (item.status !== 'fulfilled') continue
    const { result, placement } = item.value
    if (result.b64_json) {
      results.push({
        url: `data:image/png;base64,${result.b64_json}`,
        alt: `${brief.mood} ${placement.role} image`,
        role: placement.role,
        size: placement.size,
        isGenerated: true,
      })
      console.log(`[ArtDirection] Generated ${placement.role} image (${Math.round(result.b64_json.length / 1024)}KB)`)
    } else if (result.url) {
      results.push({
        url: result.url,
        alt: `${brief.mood} ${placement.role} image`,
        role: placement.role,
        size: placement.size,
        isGenerated: true,
      })
      console.log(`[ArtDirection] Generated ${placement.role} image (URL)`)
    }
  }

  return results
}

// ── Stock Photo Functions ──

/**
 * Detect image-relevant categories from user message (for stock tier)
 */
export function detectImageCategories(userMessage) {
  if (!userMessage) return []
  const lower = userMessage.toLowerCase()
  const matched = new Set()

  const KEYWORD_MAP = {
    plants:       ['plant', 'plants', 'houseplant', 'botanical', 'greenery', 'succulent', 'monstera', 'fern', 'cactus', 'garden', 'herb', 'leaf', 'leaves', 'flower', 'flowers', 'floral', 'blossom', 'orchid', 'rose', 'tulip', 'bioluminescent', 'glow', 'glowing'],
    nature:       ['nature', 'forest', 'mountain', 'landscape', 'outdoor', 'scenic', 'wilderness', 'valley', 'waterfall', 'river', 'lake', 'ocean', 'sea', 'sky', 'sunset', 'sunrise'],
    food:         ['food', 'recipe', 'restaurant', 'cooking', 'meal', 'dish', 'cuisine', 'chef', 'menu', 'bakery', 'cafe', 'coffee', 'pizza', 'sushi', 'burger'],
    people:       ['people', 'team', 'portrait', 'headshot', 'testimonial', 'about us', 'staff', 'employee', 'profile', 'avatar'],
    architecture: ['building', 'architecture', 'skyscraper', 'real estate', 'property', 'house', 'apartment', 'office', 'construction'],
    technology:   ['technology', 'tech', 'software', 'hardware', 'computer', 'digital', 'cyber', 'ai', 'data', 'code', 'programming', 'saas'],
    animals:      ['animal', 'animals', 'pet', 'pets', 'dog', 'cat', 'wildlife', 'bird', 'fish', 'veterinary', 'zoo'],
    fashion:      ['fashion', 'clothing', 'apparel', 'outfit', 'style', 'dress', 'wear', 'boutique', 'shopping'],
    fitness:      ['fitness', 'gym', 'workout', 'exercise', 'yoga', 'health', 'wellness', 'sport', 'athletic', 'training'],
    travel:       ['travel', 'vacation', 'trip', 'tourism', 'destination', 'hotel', 'flight', 'beach', 'adventure', 'explore'],
    interior:     ['interior', 'furniture', 'decor', 'home design', 'living room', 'bedroom', 'kitchen', 'minimalist'],
    abstract:     ['abstract', 'creative', 'artistic', 'gradient', 'pattern', 'colorful', 'modern art'],
  }

  for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { matched.add(category); break }
    }
  }

  return [...matched]
}

/**
 * Check if a message implies visual/image needs
 */
export function hasVisualIntent(userMessage) {
  if (!userMessage) return false
  const lower = userMessage.toLowerCase()
  const signals = [
    'image', 'images', 'photo', 'photos', 'picture', 'pictures',
    'visual', 'visually', 'stunning', 'beautiful', 'gorgeous',
    'lush', 'realistic', 'photography', 'illustration',
    'hero image', 'banner', 'gallery', 'portfolio',
    'landing page', 'website', 'homepage',
  ]
  return signals.some(s => lower.includes(s))
}

/**
 * Get curated stock photo URLs for detected categories
 */
export function getStockPhotos(categories, maxPerCategory = 4) {
  const results = []
  for (const cat of categories) {
    const library = STOCK_LIBRARY[cat]
    if (!library) continue
    const shuffled = [...library].sort(() => Math.random() - 0.5)
    results.push(...shuffled.slice(0, maxPerCategory).map(img => ({ ...img, category: cat, role: 'stock' })))
  }
  return results
}

/**
 * Build the image context block to inject into the system prompt
 */
export function buildImagePromptContext(images, brief, isCustom = false) {
  if (!images || images.length === 0) return ''

  const tier = isCustom ? 'Custom AI-generated' : 'Curated stock'
  let block = `\n\n### AVAILABLE IMAGES (${tier} — use these EXACT URLs in your code):\n`
  block += `You MUST use these real image URLs in your code via <img> tags or CSS background-image. Do NOT use placeholder URLs. Do NOT say you cannot add images. Do NOT tell the user to find their own images. You are a coder — you write <img src="URL" /> tags directly in JSX.\n\n`

  images.forEach((img, i) => {
    const roleLabel = img.role ? ` [${img.role}]` : ''
    // For base64 data URLs (generated images), use a short placeholder token
    // The actual data URL will be injected post-generation in file-operations.js
    let displayUrl = img.url
    if (displayUrl && displayUrl.startsWith('data:')) {
      displayUrl = `https://emanator-generated.img/__gen_img_${i + 1}.png`
      img._placeholderUrl = displayUrl  // Store mapping for post-processor
    }
    block += `- Image ${i + 1}${roleLabel}: \`${displayUrl}\`\n  Alt: "${img.alt}"\n`
  })

  // Add placement guidance based on the creative brief
  if (brief) {
    const mood = brief.moodParams || VIBE_LEXICON.moods.elegant
    block += `\n### IMAGE PLACEMENT GUIDANCE:\n`
    block += `- Hero section: Use the widest image as a full-bleed background with text overlay\n`
    block += `- Gallery/grid: Use square and vertical images in a masonry or card layout\n`
    block += `- Feature sections: Pair images with text blocks, image on one side, text on the other\n`
    block += `- NEVER remove existing page sections to make room for images. ADD images INTO the existing layout.\n`
    block += `- Apply consistent styling: ${mood.texture}, with ${mood.lighting}\n`
  }

  block += `\nEmbed using: <img src="URL" alt="..." className="..." /> or style={{ backgroundImage: 'url(URL)' }}\n`

  return block
}

/**
 * Build a design intelligence block for the system prompt
 * This teaches the AI to think like a creative director
 */
export function buildDesignIntelligencePrompt(brief) {
  if (!brief) return ''

  const mood = brief.moodParams || VIBE_LEXICON.moods.elegant
  const moodName = brief.mood || 'elegant'

  return `
### DESIGN INTELLIGENCE — You are an award-winning web designer.

**Detected Creative Direction: "${moodName}" vibe**
- Lighting treatment: ${mood.lighting}
- Color palette: ${mood.palette}
- Texture/Material: ${mood.texture}
- Typography approach: ${mood.typography}
- Spatial composition: ${mood.space}

**Core Design Principles (apply these to EVERY element):**

1. **Visual Hierarchy**: Every page has exactly ONE focal point. Everything else supports it. Size, contrast, color, and whitespace create a clear reading order. The eye should flow: hero → primary CTA → supporting content → secondary CTA.

2. **Contrast Creates Impact**: Dark backgrounds make light elements pop. A single accent color against neutrals is more powerful than a rainbow. High contrast = energy. Low contrast = sophistication.

3. **Whitespace is a Design Element**: More breathing room = more premium feel. Don't fill every pixel. Let sections breathe. Padding should be 2-3x what feels "enough."

4. **Image Treatment**: Images should feel cohesive — same color grade, same lighting quality, same aspect ratio within a section. Apply consistent border-radius, shadow, and hover effects. Images carry the emotional weight of the page.

5. **Typography Sets Tone**: ${mood.typography}. Limit to 2 fonts maximum. Size hierarchy: hero text 4-6rem, section headings 2-3rem, body 1-1.125rem. Line height 1.5-1.8 for readability.

6. **Motion = Life**: Add subtle hover transforms (scale 1.02-1.05), opacity transitions on scroll, and staggered entrance animations. Motion should feel natural, not mechanical. Transition timing: 0.3-0.5s ease-out.

7. **Color Application**: Use CSS variables for the palette. Background: dominant color. Text: high-contrast against background. Accents: sparingly on CTAs, links, and interactive elements. Never more than 3 colors + neutrals.

**CRITICAL — Layout Preservation Rule:**
When the user asks to "add images" or "make it more visual," you must SURGICALLY ADD images into the existing layout. NEVER delete or simplify existing sections. Identify the right placement (hero background, feature cards, gallery grid, testimonial avatars) and insert images there while keeping ALL existing content intact.
`
}
