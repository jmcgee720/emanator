# MyMergent — Master Checklist

## Phase 1 — Stability

- [x] Stabilize Plan → Execute flow
- [x] Stabilize Diff Review with reliable Apply/Discard
- [ ] Ensure correct file action labeling (~ vs +)
- [x] Ensure diffStatus always arrives in frontend metadata
- [x] Ensure no stale plan reuse across chats (planId + diffId enforcement)
- [ ] Ensure single-file edit prompts stay single-file

## Phase 2 — Internal Self-Editing Foundation

- [ ] Finish `lib/self_builder/request_router.js`
- [ ] Finish `lib/self_builder/feature_planner.js`
- [ ] Finish `lib/self_builder/file_ops_bridge.js`
- [ ] Finish `lib/self_builder/safe_apply.js`
- [ ] Finish `lib/self_builder/change_log.js`
- [ ] Finish `lib/self_builder/plan_validator.js`
- [ ] Verify self-builder flow: request → plan → validate → diff → apply → log

## Phase 3 — Builder Memory

- [x] Finish BuilderMemoryPanel (fetch from real API)
- [x] Connect it to real memory API/store (GET/POST/DELETE endpoints live)
- [ ] Show stored memory entries in panel
- [ ] Add sections:
  - [ ] Saved Prompt Patterns
  - [ ] User Preferences
  - [ ] Project Rules
  - [ ] Self-Builder Status

## Phase 4 — Adaptive Intelligence

- [ ] Prompt Library
- [ ] User preference memory
- [ ] Project-specific memory
- [ ] Correction learning
- [ ] Auto-routing improvements from memory
- [ ] Builder memory UI controls

## Phase 5 — Image / Asset Intelligence

- [ ] Stabilize image generation chat rendering
- [ ] Stabilize Variation Studio
- [ ] Improve style replacement controls
- [ ] Asset relationships
- [ ] Reference-image workflows
- [ ] Sprite state generation reliability

## Phase 6 — Product Structure

- [ ] Create Core System Workspace
- [ ] Create Core System Chat
- [ ] Make Core System Chat owner-only
- [ ] Separate normal builder chats from self-edit chats
- [ ] Add explicit self-edit target mode

## Phase 7 — Users / Safety

- [ ] Build User Dashboard
- [ ] Add roles:
  - [ ] owner
  - [ ] admin
  - [ ] member
  - [ ] child_monitored
- [ ] Add owner-only permissions for self-editing
- [ ] Add monitored child account mode
- [ ] Add activity/audit log viewer
- [ ] Add prompt/action review for monitored users

## Phase 8 — Versioned Self-Modification

- [ ] Version manager
- [ ] Workspace clone/sandbox
- [ ] Test-before-apply
- [ ] Deploy/promote flow
- [ ] Rollback to previous version
- [ ] Multiple MyMergent versions/workspaces

## Phase 9 — Proof Tests

- [x] MyMergent modifies its own UI safely (Proof Test #1 — March 19, 2026)
- [x] MyMergent extends Builder Memory safely (Proof Test #2 — March 19, 2026)
- [x] MyMergent proposes one internal improvement using self_builder (Proof Test #3 — March 19, 2026)
- [x] MyMergent executes one safe self-change end-to-end (Proof Test #1 — March 19, 2026)
- [x] MyMergent autonomously detects, selects, and executes safe self-change (Proof Test #4 — March 19, 2026)
