# Emanator PRD

## Original Problem Statement
Build a self-editing AI builder (Emanator) that can reliably modify its own core files using targeted patches instead of destructive full-file rewrites. Also make the regular project builder as capable as the Core System.

## Core Architecture
- Next.js 14 App Router conversational AI builder
- Self-edit pipeline: reads file → applies patches → saves → Apply to Live → health check → auto-revert on failure
- Tools: `patch_files` (code edits), `update_canvas` (checklist/notes), `create_files`/`update_files` (regular projects)
- Safety: syntax validation + bracket balance + import validation + auto-revert on health check failure

## What's Been Implemented

### Phase 1-5: Self-Edit Pipeline (COMPLETE)
- patch_files with fuzzy matching, silent retry, export validation

### Core Canvas PM Portal (COMPLETE)
- Markdown editor, interactive checkboxes, auto-save, AI auto-updates

### Broken Promise Fix — All Core System (COMPLETE - Apr 12)
- identifyTargetFile() 3-strategy file identification
- Pre-identification loads target file content upfront

### Stream Timeout Auto-Recovery (COMPLETE - Apr 13)
- Real keepalive SSE events every 8s, auto-recovery from DB

### Auth Resilience (COMPLETE - Apr 13)
- navigator.locks patch, 15s sign-in timeout, "Service Unavailable" toast

### Auto-Revert Self-Healing (COMPLETE - Apr 13)
- AI explains + retries after auto-revert, works for ALL project types
- Bracket balance pre-check prevents most syntax-error reverts

### AI Conversation Memory (COMPLETE - Apr 13)
- Silent messages save full_content in metadata
- Conversational overrides prevent misclassification as inspect mode

### Regular Builder AI Parity (COMPLETE - Apr 14)

#### Smart File Context Injection
- Auto-identifies which file(s) user wants to edit from their message
- 3 strategies: filename match, keyword-to-content match, fallback to main page
- Injects up to 2 relevant files (60K char cap) into AI context
- AI can now see actual code and write precise updates

#### Broken Promise + Stalling Detector
- Catches both action promises ("I'll build that") AND stalling ("Can you confirm the requirements?")
- Stalling only triggers when user gave detailed specs (100+ chars) — prevents false positives on genuine ambiguity
- Forces tool_choice retry with file context injection

#### Action Enforcement Prompt
- For detailed user requests (100+ chars) on existing projects, system prompt now says: "Act immediately — do NOT ask clarifying questions"

#### Post-Build Auto-Continue
- Silent "what's next?" follow-up after Apply to Live for ALL project types

### Zero-Apply Save Prevention (COMPLETE - Apr 14)
- When ALL patches fail (0/N applied), the file is NOT saved to DB
- Prevents corrupted/unchanged files from overwriting good versions
- Shows clear "All patches failed — no changes saved" status

### Level 3 Fuzzy Patch Matching (COMPLETE - Apr 14)
- Normalizes whitespace (collapse spaces, trim lines) for comparison
- Catches patches where AI wrote slightly different whitespace
- Applied to both `patch_files` tool and `<<<PATCHES>>>` format

## Known Issues
- Supabase free tier may pause/slow after inactivity
- Very large files (60K+) may exceed context window

## Remaining Backlog
- [ ] CSV export option (Emanator to self-implement)
- [ ] Conversational AI phases 2-5 (classifyUserIntent)
- [ ] Deploy integration (/api/projects/:id/export-zip)
- [ ] Vision support for Core System chat
- [ ] Refactor message-stream.js (~2900 lines) and service.js (~2600 lines)

## Tech Stack
- Next.js 14 App Router, OpenAI GPT-4o via Emergent LLM Key
- Supabase (DB/Auth), MongoDB (credits), Stripe (payments)
- Tailwind CSS + Shadcn UI
