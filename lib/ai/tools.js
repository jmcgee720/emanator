/**
 * AI Tool Definitions for Function Calling
 * These define the actions the AI can take
 */

export const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_files',
      description: 'Create new files in the project. Use this when the user asks to build something new.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description: 'Brief description of what is being created'
          },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path relative to project root' },
                content: { type: 'string', description: 'Complete file content' },
                file_type: { type: 'string', description: 'File type (js, jsx, ts, tsx, html, css, json, md, etc.)' },
                description: { type: 'string', description: 'What this file does' }
              },
              required: ['path', 'content']
            },
            description: 'Array of files to create'
          },
          summary: {
            type: 'string',
            description: 'Summary of what was created'
          }
        },
        required: ['plan', 'files', 'summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_files',
      description: 'Update existing files in the project. Use this when modifying existing code.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description: 'Brief description of what is being updated'
          },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path to update' },
                content: { type: 'string', description: 'New complete file content' },
                changes: { type: 'string', description: 'Description of changes made' }
              },
              required: ['path', 'content']
            },
            description: 'Array of files to update'
          },
          summary: {
            type: 'string',
            description: 'Summary of what was updated'
          }
        },
        required: ['plan', 'files', 'summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'plan_project',
      description: 'Create a detailed implementation plan without generating code yet. Use when user wants to discuss approach first.',
      parameters: {
        type: 'object',
        properties: {
          overview: {
            type: 'string',
            description: 'High-level overview of the project'
          },
          architecture: {
            type: 'string',
            description: 'Proposed architecture and tech stack'
          },
          file_structure: {
            type: 'array',
            items: { type: 'string' },
            description: 'Proposed file/folder structure'
          },
          phases: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                tasks: { type: 'array', items: { type: 'string' } }
              }
            },
            description: 'Implementation phases'
          },
          considerations: {
            type: 'array',
            items: { type: 'string' },
            description: 'Important considerations and decisions needed'
          }
        },
        required: ['overview', 'architecture', 'file_structure', 'phases']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_plan',
      description: 'Propose an implementation plan for the user to review before any files are written. The user will approve, revise, or cancel. Do NOT create or update files — only propose what you intend to do. You MUST ground every file action in the real file context provided.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'One-paragraph summary of what will be built or changed'
          },
          intent: {
            type: 'string',
            description: 'Detected intent: build, edit, refactor, or bug_fix'
          },
          file_actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'File operation type. Use "update" for files that already exist, "create" only for new files.' },
                path: { type: 'string', description: 'File path relative to project root' },
                reason: { type: 'string', description: 'Why this file change is needed' },
                description: { type: 'string', description: 'What this file will contain or how it will change' },
                intent: { type: 'string', description: 'What this specific file action accomplishes' },
                grounded_on: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Exact code anchors or file state this action is based on. For updates, cite the specific function/section being changed. For creates, state "NONEXISTENT — new file".'
                }
              },
              required: ['action', 'path', 'reason']
            },
            description: 'Array of proposed file operations'
          },
          design_preset: {
            type: 'string',
            description: 'Design preset being used, if relevant (e.g., modern_saas, premium_dark)'
          },
          reasoning: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of reasoning steps explaining why this approach was chosen. Do NOT use placeholder language.'
          },
          constraints_checked: {
            type: 'object',
            properties: {
              has_file_actions: { type: 'boolean', description: 'true if file_actions is non-empty' },
              no_illegal_create: { type: 'boolean', description: 'true if no existing file is marked as create' },
              minimal_patch: { type: 'boolean', description: 'true if only necessary files are changed' },
              grounded_in_file_context: { type: 'boolean', description: 'true if all actions reference real file contents or NONEXISTENT markers' }
            },
            description: 'Self-check constraints'
          }
        },
        required: ['summary', 'intent', 'file_actions', 'reasoning', 'constraints_checked']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'summarize_project',
      description: 'Provide a summary of the current project state.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Overall project summary'
          },
          completed: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of completed features/tasks'
          },
          in_progress: {
            type: 'array',
            items: { type: 'string' },
            description: 'Features currently in progress'
          },
          next_steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Recommended next steps'
          }
        },
        required: ['summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_files',
      description: 'Delete files from the project. Use during refactoring to remove obsolete or duplicated files.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description: 'Brief description of why these files are being deleted'
          },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path to delete' },
                reason: { type: 'string', description: 'Why this file is being deleted' }
              },
              required: ['path']
            },
            description: 'Array of files to delete'
          },
          summary: {
            type: 'string',
            description: 'Summary of what was removed and why'
          }
        },
        required: ['plan', 'files', 'summary']
      }
    }
  }
]

/**
 * Subset of tools for plan-first mode — only propose_plan is allowed.
 */
export const PLAN_ONLY_TOOLS = AI_TOOLS.filter(t => t.function.name === 'propose_plan')

/**
 * Determine which tool mode to use based on user message
 */
export function detectToolMode(message) {
  const lowerMessage = message.toLowerCase()

  // Build/Create patterns
  if (
    lowerMessage.includes('build') ||
    lowerMessage.includes('create') ||
    lowerMessage.includes('generate') ||
    lowerMessage.includes('make me') ||
    lowerMessage.includes('set up') ||
    lowerMessage.includes('scaffold')
  ) {
    return 'create_files'
  }

  // Update/Edit patterns
  if (
    lowerMessage.includes('update') ||
    lowerMessage.includes('edit') ||
    lowerMessage.includes('modify') ||
    lowerMessage.includes('change') ||
    lowerMessage.includes('fix') ||
    lowerMessage.includes('add to')
  ) {
    return 'update_files'
  }

  // Plan patterns
  if (
    lowerMessage.includes('plan') ||
    lowerMessage.includes('how would you') ||
    lowerMessage.includes('what approach') ||
    lowerMessage.includes('architecture') ||
    lowerMessage.includes('design')
  ) {
    return 'plan_project'
  }

  // Summary patterns
  if (
    lowerMessage.includes('summary') ||
    lowerMessage.includes('summarize') ||
    lowerMessage.includes('what have we') ||
    lowerMessage.includes('status') ||
    lowerMessage.includes('progress')
  ) {
    return 'summarize_project'
  }

  // Default to chat_only
  return 'chat_only'
}
