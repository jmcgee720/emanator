# MyMergent - Private AI Builder Platform

trigger deploy

A private, internal AI builder platform for creating websites, web apps, app product specs, UI screens, images/assets, code files, and exportable app packages.

## Features

### Core Capabilities
- **Project System**: Create and manage multiple projects with different builder modes (App, Website, Image, Document)
- **Chat Interface**: AI-powered conversation system for describing and building projects
- **Split-Screen Dashboard**: Resizable layout with 35% left panel (chat) and 65% right panel (workspace)
- **Workspace Tabs**: Preview, Code, Assets, Logs, Export, Deploy

### Access Control
- **Private Access Only**: Allowlist-based authentication
- **Role System**: Owner and Member roles
- **Admin Panel**: User management for owners to add/remove users and assign roles

### Project Knowledge Canvas
- Automatic AI memory system that learns from conversations
- 13 structured sections for project context:
  - Project Overview, Goals, Key Decisions
  - Architecture Notes, Technical Specifications
  - Master/Working/Failed Prompts
  - Feature Requirements, Constraints
  - Open/Completed Tasks

### Import/Export System
- **ZIP Source Export**: Download complete project with all files
- **Project Manifest Export**: JSON format for re-importing projects
- **Project Import**: Import previously exported MyMergent projects
- **Cross-Platform Ready**: Architecture prepared for Web, PWA, iOS, Android exports

### Global Search
- Search across all projects, chats, messages, and files
- Filter by content type
- Quick navigation to results

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui
- **Auth**: Supabase Authentication
- **Database**: MongoDB
- **Storage**: Supabase Storage (prepared)

## Database Schema

### Collections
- `users` - User accounts with roles and allowlist status
- `projects` - Project metadata and settings
- `chats` - Conversation threads
- `messages` - Chat messages
- `project_files` - Generated code files
- `project_canvas` - Knowledge canvas content
- `canvas_events` - Canvas update history
- `snapshots` - Project version snapshots
- `exports` - Export records
- `deployments` - Deployment records

## API Endpoints

### Public
- `GET /api/health` - Health check
- `POST /api/auth/check` - Verify email allowlist status

### Admin (Owner only)
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Add user to allowlist
- `PUT /api/admin/users/:id` - Update user role
- `DELETE /api/admin/users/:id` - Remove user

### Projects
- `GET /api/projects` - List user's projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project details
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Chats & Messages
- `GET /api/projects/:id/chats` - List project chats
- `POST /api/projects/:id/chats` - Create chat
- `DELETE /api/chats/:id` - Delete chat
- `GET /api/chats/:id/messages` - Get messages
- `POST /api/chats/:id/messages` - Send message

### Files
- `GET /api/projects/:id/files` - List project files
- `POST /api/projects/:id/files` - Create/update file
- `DELETE /api/projects/:id/files/:fileId` - Delete file

### Canvas
- `GET /api/projects/:id/canvas` - Get project canvas
- `PUT /api/projects/:id/canvas` - Update canvas

### Snapshots
- `GET /api/projects/:id/snapshots` - List snapshots
- `POST /api/projects/:id/snapshots` - Create snapshot
- `POST /api/snapshots/:id/restore` - Restore snapshot

### Export/Import
- `GET /api/projects/:id/exports` - List exports
- `POST /api/projects/:id/exports` - Create export (zip, manifest)
- `POST /api/projects/import` - Import project from manifest

### Search
- `POST /api/search` - Global search

### Deployments
- `GET /api/projects/:id/deployments` - List deployments
- `POST /api/projects/:id/deployments` - Create deployment (placeholder)

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# MongoDB
MONGO_URL=mongodb://localhost:27017
DB_NAME=mymergent

# Default Owner
DEFAULT_OWNER_EMAIL=your_email@example.com

# Future: OpenAI
OPENAI_API_KEY=your_openai_key
```

## Project Structure

```
/app
├── app/
│   ├── api/[[...path]]/route.js  # All API routes
│   ├── page.js                    # Main app entry
│   ├── layout.js                  # Root layout
│   └── globals.css                # Global styles
├── components/
│   ├── auth/
│   │   └── LoginPage.jsx          # Auth UI
│   ├── dashboard/
│   │   ├── Dashboard.jsx          # Main dashboard
│   │   ├── TopBar.jsx             # Header bar
│   │   ├── LeftPanel.jsx          # Chat panel
│   │   ├── RightPanel.jsx         # Workspace tabs
│   │   ├── AdminPanel.jsx         # User management
│   │   ├── SearchPanel.jsx        # Global search
│   │   ├── CanvasPanel.jsx        # Knowledge canvas
│   │   └── tabs/
│   │       ├── PreviewTab.jsx
│   │       ├── CodeTab.jsx
│   │       ├── AssetsTab.jsx
│   │       ├── LogsTab.jsx
│   │       ├── ExportTab.jsx
│   │       └── DeployTab.jsx
│   └── ui/                        # shadcn components
├── lib/
│   ├── supabase/
│   │   ├── client.js              # Browser client
│   │   ├── server.js              # Server client
│   │   └── admin.js               # Admin client
│   ├── constants.js               # App constants
│   └── types.js                   # Type definitions
└── .env                           # Environment config
```

## Phase 2 Roadmap

Features planned for next phase:
- Full AI generation engine (OpenAI integration)
- Real code execution sandbox
- Image generation capabilities
- Vercel deployment integration
- PWA export generation
- iOS/Android wrapper export (Capacitor)
- Real-time canvas updates from AI

## License

Private internal tool - not for public distribution.

<!-- deploy: 2026-05-01 -->
