/**
 * Image Prefetch Module
 * 
 * Tier 1 (Stock): Curated Unsplash URLs by category — instant, free
 * Tier 2 (Custom): AI-generated images via OpenAI GPT Image 1 — slower, premium
 */

// ── Curated Stock Photo Library ──
// All URLs are permanent Unsplash CDN links with fit=crop for consistent sizing
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

// ── Keyword → Category Mapping ──
const KEYWORD_MAP = {
  plants:       ['plant', 'plants', 'houseplant', 'botanical', 'greenery', 'succulent', 'monstera', 'fern', 'cactus', 'garden', 'herb', 'leaf', 'leaves'],
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

/**
 * Detect image-relevant categories from user message
 * Returns array of matched category names
 */
export function detectImageCategories(userMessage) {
  if (!userMessage) return []
  const lower = userMessage.toLowerCase()
  const matched = new Set()

  for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        matched.add(category)
        break
      }
    }
  }

  return [...matched]
}

/**
 * Check if a message implies visual/image needs (even without specific category keywords)
 */
export function hasVisualIntent(userMessage) {
  if (!userMessage) return false
  const lower = userMessage.toLowerCase()
  const visualSignals = [
    'image', 'images', 'photo', 'photos', 'picture', 'pictures',
    'visual', 'visually', 'stunning', 'beautiful', 'gorgeous',
    'lush', 'realistic', 'photography', 'illustration',
    'hero image', 'banner', 'gallery', 'portfolio',
    'landing page', 'website', 'homepage',
  ]
  return visualSignals.some(s => lower.includes(s))
}

/**
 * Get curated stock photo URLs for detected categories
 * Returns shuffled selection of URLs
 */
export function getStockPhotos(categories, maxPerCategory = 3) {
  const results = []
  for (const cat of categories) {
    const library = STOCK_LIBRARY[cat]
    if (!library) continue
    // Shuffle and pick
    const shuffled = [...library].sort(() => Math.random() - 0.5)
    const picked = shuffled.slice(0, maxPerCategory)
    results.push(...picked.map(img => ({ ...img, category: cat })))
  }
  return results
}

/**
 * Generate custom AI images for premium tier
 * Uses OpenAI GPT Image 1 via the existing provider
 */
export async function generateCustomImages(provider, userMessage, categories, count = 3) {
  const results = []

  // Build descriptive prompts based on user request + categories
  const categoryHints = categories.join(', ')
  const basePrompt = `High-quality, professional web design image. Theme: ${categoryHints}. Context: ${userMessage.slice(0, 200)}`

  const prompts = [
    `${basePrompt}. Style: hero banner, wide format, atmospheric lighting, modern and clean.`,
    `${basePrompt}. Style: product/feature showcase, studio lighting, detail-focused.`,
    `${basePrompt}. Style: lifestyle scene, natural lighting, warm tones, editorial quality.`,
  ].slice(0, count)

  for (const prompt of prompts) {
    try {
      const result = await provider.generateImage(prompt, {
        size: '1536x1024',
        quality: 'auto',
      })

      if (result.b64_json) {
        // Convert to data URL for immediate use
        results.push({
          url: `data:image/png;base64,${result.b64_json}`,
          alt: result.revised_prompt || prompt.slice(0, 100),
          category: categories[0] || 'custom',
          isGenerated: true,
        })
      } else if (result.url) {
        results.push({
          url: result.url,
          alt: result.revised_prompt || prompt.slice(0, 100),
          category: categories[0] || 'custom',
          isGenerated: true,
        })
      }
    } catch (err) {
      console.error('[ImagePrefetch] Custom image generation failed:', err.message)
    }
  }

  return results
}

/**
 * Build the image context block to inject into the system prompt
 */
export function buildImagePromptContext(images, isCustom = false) {
  if (!images || images.length === 0) return ''

  const tier = isCustom ? 'Custom AI-generated' : 'Curated stock'
  let block = `\n\n### AVAILABLE IMAGES (${tier} — use these exact URLs in your code):\n`
  block += `You MUST use these real image URLs in <img> tags or CSS background-image. Do NOT say you cannot add images.\n\n`

  images.forEach((img, i) => {
    block += `- Image ${i + 1} (${img.category}): \`${img.url}\`\n  Alt: "${img.alt}"\n`
  })

  block += `\nEmbed these images using: <img src="URL" alt="description" className="..." /> or style={{ backgroundImage: 'url(URL)' }}\n`
  block += `Use ALL provided images in the design. Create a visually rich layout.\n`

  return block
}
