// TypeScript-like type definitions as JSDoc comments for reference

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} email
 * @property {'owner'|'member'} role
 * @property {string|null} invited_by
 * @property {boolean} is_allowlisted
 * @property {string} created_at
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} user_id
 * @property {string} name
 * @property {string} description
 * @property {'app'|'website'|'image'|'document'} type
 * @property {Object} settings
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} Chat
 * @property {string} id
 * @property {string} project_id
 * @property {string} title
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} chat_id
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 * @property {Object} metadata
 * @property {string} created_at
 */

/**
 * @typedef {Object} ProjectFile
 * @property {string} id
 * @property {string} project_id
 * @property {string} path
 * @property {string} content
 * @property {string} file_type
 * @property {number} version
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} id
 * @property {string} project_id
 * @property {string} name
 * @property {Object} files_snapshot
 * @property {Object} metadata
 * @property {string} created_at
 */

/**
 * @typedef {Object} ProjectCanvas
 * @property {string} id
 * @property {string} project_id
 * @property {Object} canvas_content
 * @property {string} last_updated
 */

/**
 * @typedef {Object} Export
 * @property {string} id
 * @property {string} project_id
 * @property {'web'|'pwa'|'ios'|'android'|'zip'|'manifest'} export_type
 * @property {'pending'|'processing'|'completed'|'failed'} status
 * @property {string|null} artifact_path
 * @property {Object} metadata
 * @property {string} created_at
 */

export {}
