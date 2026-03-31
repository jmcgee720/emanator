import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import JSZip from 'jszip'

export async function handle(route, method, path, request) {
  // Get exports for project
  if (route.match(/^\/projects\/[^/]+\/exports$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const exports = await db.exports.findByProjectId(projectId)
    return handleCORS(NextResponse.json(exports))
  }

  // Create export
  if (route.match(/^\/projects\/[^/]+\/exports$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const body = await request.json()
    const { export_type } = body
    
    const validTypes = ['web', 'pwa', 'ios', 'android', 'zip', 'manifest']
    if (!validTypes.includes(export_type)) {
      return handleCORS(NextResponse.json({ error: 'Invalid export type' }, { status: 400 }))
    }
    
    // Get project data
    const project = await db.projects.findById(projectId)
    const files = await db.projectFiles.findByProjectId(projectId)
    const canvas = await db.projectCanvas.findByProjectId(projectId)
    const chats = await db.chats.findByProjectId(projectId)
    const snapshots = await db.snapshots.findByProjectId(projectId)
    
    let artifactData = null
    
    // Generate export based on type
    if (export_type === 'manifest') {
      artifactData = {
        version: '1.0.0',
        format: 'mymergent-project',
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          type: project.type,
          settings: project.settings,
          created_at: project.created_at,
          updated_at: project.updated_at
        },
        files: files,
        canvas: canvas?.canvas_content || null,
        chats: chats.map(c => ({ id: c.id, title: c.title, created_at: c.created_at })),
        snapshots: snapshots.map(s => ({ id: s.id, name: s.name, created_at: s.created_at })),
        exported_at: new Date().toISOString(),
        exported_by: authUser.email
      }
    } else if (export_type === 'zip') {
      // Create ZIP with all project files
      const zip = new JSZip()
      
      // Add manifest
      const manifest = {
        version: '1.0.0',
        format: 'mymergent-project',
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          type: project.type,
          settings: project.settings
        },
        exported_at: new Date().toISOString()
      }
      zip.file('mymergent-manifest.json', JSON.stringify(manifest, null, 2))
      
      // Add project files
      const srcFolder = zip.folder('src')
      files.forEach(file => {
        srcFolder.file(file.path, file.content || '')
      })
      
      // Add canvas
      if (canvas?.canvas_content) {
        zip.file('canvas.json', JSON.stringify(canvas.canvas_content, null, 2))
      }
      
      // Generate ZIP
      const zipContent = await zip.generateAsync({ type: 'base64' })
      artifactData = { 
        zip_base64: zipContent, 
        filename: `${project.name.replace(/[^a-z0-9]/gi, '_')}.zip` 
      }
    }
    
    const exportRecord = await db.exports.create({
      project_id: projectId,
      export_type,
      status: artifactData ? 'completed' : 'pending',
      artifact_data: artifactData,
      metadata: {
        file_count: files.length,
        exported_by: authUser.email
      }
    })
    
    return handleCORS(NextResponse.json(exportRecord, { status: 201 }))
  }

  // Import project from manifest
  if (route === '/projects/import' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    
    const body = await request.json()
    const { manifest } = body
    
    if (!manifest || manifest.format !== 'mymergent-project') {
      return handleCORS(NextResponse.json({ error: 'Invalid project manifest' }, { status: 400 }))
    }
    
    // Create project
    const project = await db.projects.create({
      user_id: dbUser.id,
      name: manifest.project.name + ' (Imported)',
      description: manifest.project.description,
      type: manifest.project.type,
      settings: manifest.project.settings || {},
      imported_from: manifest.project.id,
      imported_at: new Date().toISOString()
    })
    
    // Import files
    if (manifest.files && manifest.files.length > 0) {
      const importedFiles = manifest.files.map(f => ({
        project_id: project.id,
        path: f.path,
        content: f.content || '',
        file_type: f.file_type || 'text',
        version: 1,
        imported: true
      }))
      await db.projectFiles.bulkInsert(importedFiles)
    }
    
    // Import canvas
    await db.projectCanvas.create({
      project_id: project.id,
      canvas_content: manifest.canvas || {
        project_overview: '',
        project_goals: [],
        key_decisions: [],
        architecture_notes: [],
        master_prompts: [],
        working_prompts: [],
        failed_prompts: [],
        successful_patterns: [],
        feature_requirements: [],
        technical_specs: [],
        constraints: [],
        open_tasks: [],
        completed_tasks: []
      }
    })
    
    return handleCORS(NextResponse.json({
      project,
      imported_files: manifest.files?.length || 0
    }, { status: 201 }))
  }

  return null
}
