/**
 * Phase-state persistence (MongoDB).
 * Stores intermediate output of each phase so we can resume, audit, or
 * debug failed runs without re-doing expensive LLM/image calls.
 */
import { getDb } from '../mongodb.js'

const COLLECTION = 'phase_states'

async function coll() {
  const db = await getDb()
  return db.collection(COLLECTION)
}

export const phaseStates = {
  async upsertByRunId(runId, doc) {
    const c = await coll()
    const patch = { ...doc, runId, updatedAt: new Date() }
    delete patch._id
    await c.updateOne({ runId }, { $set: patch }, { upsert: true })
    return { runId }
  },

  async findByRunId(runId) {
    const c = await coll()
    return await c.findOne({ runId }, { projection: { _id: 0 } })
  },

  async findLatestForProject(projectId) {
    const c = await coll()
    return await c.findOne({ projectId }, { projection: { _id: 0 }, sort: { updatedAt: -1 } })
  },
}
