/**
 * Phase-state persistence (MongoDB).
 *
 * Stores intermediate output of each phase so we can resume, audit, or
 * debug failed runs without re-doing expensive LLM/image calls.
 *
 * IMAGE STORAGE: Image data URLs (base64 PNGs, often 1-2 MB each) live
 * in a SEPARATE collection — `phase_images` — keyed by runId. The main
 * `phase_states` document stores only image *metadata* (role, source,
 * subject, errors) so it stays well under the 16 MB BSON limit even
 * for runs with 10+ generated images.
 *
 * Loaders:
 *   findByRunId(runId)           → state with light image refs (no dataUrls)
 *   loadImagesForRun(runId)      → array of { role, dataUrl, ... } with full base64
 *   hydrateImages(state, runId)  → mutates state.results.images.images to
 *                                  include dataUrls (used by compose phase)
 */
import { getDb } from '../../mongodb.js'

const STATE_COLLECTION = 'phase_states'
const IMAGE_COLLECTION = 'phase_images'

async function stateColl() {
  const db = await getDb()
  return db.collection(STATE_COLLECTION)
}

async function imageColl() {
  const db = await getDb()
  return db.collection(IMAGE_COLLECTION)
}

export const phaseStates = {
  async upsertByRunId(runId, doc) {
    const c = await stateColl()
    // Strip image dataUrls before persisting to keep doc <16 MB.
    const patch = { ...doc, runId, updatedAt: new Date() }
    delete patch._id
    if (patch.results?.images?.images) {
      patch.results = {
        ...patch.results,
        images: {
          ...patch.results.images,
          images: patch.results.images.images.map((img) => ({
            role: img.role,
            source: img.source,
            subject: img.subject,
            // dataUrl explicitly omitted — lives in phase_images
          })),
        },
      }
    }
    await c.updateOne({ runId }, { $set: patch }, { upsert: true })
    return { runId }
  },

  async findByRunId(runId) {
    const c = await stateColl()
    return await c.findOne({ runId }, { projection: { _id: 0 } })
  },

  async findLatestForProject(projectId) {
    const c = await stateColl()
    return await c.findOne({ projectId }, { projection: { _id: 0 }, sort: { updatedAt: -1 } })
  },

  /**
   * Persist the full image payloads for a run. One document per image so
   * each fits comfortably under 16 MB even for high-quality Nano Banana
   * outputs (~1.5 MB each as base64).
   */
  async saveImagesForRun(runId, images) {
    const c = await imageColl()
    // Wipe any prior images for this runId (re-runs of phase 4)
    await c.deleteMany({ runId })
    if (!images?.length) return
    const docs = images.map((img, idx) => ({
      runId,
      idx,
      role: img.role,
      source: img.source,
      subject: img.subject,
      dataUrl: img.dataUrl,
      createdAt: new Date(),
    }))
    await c.insertMany(docs)
  },

  async loadImagesForRun(runId) {
    const c = await imageColl()
    const docs = await c.find({ runId }, { projection: { _id: 0 } }).sort({ idx: 1 }).toArray()
    return docs
  },

  /**
   * Mutates `state.results.images.images` to include `dataUrl` fields
   * loaded from the phase_images collection. Used by compose phase.
   */
  async hydrateImages(state, runId) {
    if (!state?.results?.images?.images) return state
    const fullImages = await this.loadImagesForRun(runId)
    if (!fullImages.length) return state
    const byRole = new Map()
    for (const img of fullImages) {
      // Use idx as the join key — role can repeat across a manifest.
      byRole.set(img.idx, img)
    }
    state.results.images.images = state.results.images.images.map((img, idx) => ({
      ...img,
      dataUrl: byRole.get(idx)?.dataUrl || null,
    }))
    return state
  },
}
