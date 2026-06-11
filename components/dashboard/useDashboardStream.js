'use client'

/**
 * useDashboardStream — Streaming, plan execution, and diff management
 * 
 * Extracted from Dashboard.jsx. Manages the streaming chat connection,
 * plan approval/execution flow, and diff apply/cancel operations.
 */

import { useState, useRef } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { streamMessage } from '@/lib/stream-client'
import { getChatType, CHAT_TYPES } from '@/lib/constants'

// Whimsical status phrases for the build log
const BUILD_LOG_PHRASES = {
  connecting: 'Warming up the engines...',
  classifying_intent: 'Reading your mind (almost)...',
  intent_classified: 'Got it — plotting the game plan...',
  selecting_provider: 'Summoning the best brain for the job...',
  loading_context: 'Gathering all the ingredients...',
  scanning_files: 'Rummaging through your project files...',
  files_scanned: 'Found everything I need!',
  reading_files: 'Speed-reading your codebase...',
  direct_edit: 'Surgeon mode activated...',
  generating_images: 'Painting custom visuals for you...',
  images_ready: 'Artwork is ready!',
  finding_images: 'Scouting the perfect images...',
  config_mode: 'Tweaking the knobs...',
  applying_pending_diff: 'Stitching changes together...',
  verifying: 'Double-checking my work...',
  checking_completeness: 'Making sure nothing was missed...',
  continuation_discovered: 'Found more to do — on it!',
  executing_plan: 'Bringing the plan to life...',
  generating_image: 'Cooking up something visual...',
  generating: 'Generating your project...',
  proposing_plan: 'Creating the build plan...',
  analyzing: 'Analyzing codebase...',
  analysis_complete: 'Analysis complete, building...',
}

export function useDashboardStream(ctx) {
  const {
    selectedChat, selectedProject, files, setFiles,
    messages, setMessages, canvas, setCanvas,
    scope, aiProvider, aiModel, selfEditTarget, designPrefs, visualMode, builderMode,
    livePromoteState, creditsBalance, setCreditsBalance,
    projectFileIndex, setProjectFileIndex,
    setLivePreviewData, setGeneratedImageMap, setRuntimeTestScript,
    addLog, addMilestone, addBuildLogEntry, toast,
    loadProjectData, loadMessages,
    setActivityLevel, setActiveTab,
    streamAbortRef, previewQueueRef, previewDrainTimerRef,
    setAiProvider, setAiModel,
    sendMessageRef,
    setBuildLog, setBuildMilestones, setAssetsRefreshKey, briefBuildActiveRef,
    serverPreviewRefreshRef,
  } = ctx

  // Streaming-owned state
  const [streamingMessageId, setStreamingMessageId] = useState(null)
  const [streamingStatus, setStreamingStatus] = useState(null)
  const [pendingPlan, setPendingPlan] = useState(null)
  const [executingPlan, setExecutingPlan] = useState(false)
  const [pendingDiffs, setPendingDiffs] = useState([])
  const [applyingDiffs, setApplyingDiffs] = useState(false)
  const [diffMessageId, setDiffMessageId] = useState(null)
  const [diffPlanData, setDiffPlanData] = useState(null)
  const [imageGenProgress, setImageGenProgress] = useState(null)
  const [forkWarning, setForkWarning] = useState(null)

  // Helper to check if current chat is self-edit (used across multiple functions)
  const isSelfEditChat = selectedChat && getChatType(selectedChat) === CHAT_TYPES.SELF_EDIT

  const sendMessage = async (content, attachments, opts = {}) => {
    if (!selectedChat) { console.log('[sendMessage] blocked: no selectedChat'); return }
    if (!opts.silent && !(content || '').trim()) return
    if (streamingMessageId) { console.log('[sendMessage] blocked: streamingMessageId still set:', streamingMessageId); return }

    setActivityLevel(1)
    streamAbortRef.current?.abort()

    const streamingAssistantId = `streaming-${Date.now()}`
    const collectedDiffs = []
    const tempUserId = `temp-${Date.now()}`

    // Silent messages skip the user bubble entirely — only the AI response appears
    if (!opts.silent) {
      const tempUserMessage = {
        id: tempUserId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
        metadata: attachments ? { attachments } : undefined
      }
      setMessages(prev => [...prev, tempUserMessage])
    }

    const clientMessageKey = `cmk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const placeholderAssistant = {
      id: streamingAssistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      created_at: new Date().toISOString(),
      clientMessageKey,
    }
    setMessages(prev => [...prev, placeholderAssistant])
    setStreamingMessageId(streamingAssistantId)
    setStreamingStatus({ stage: 'connecting', detail: 'Connecting...' })
    setBuildLog([])
    setBuildMilestones([])
    setGeneratedImageMap([]) // Clear stale image mapping from previous builds

    // If there's a hidden instruction (from creative brief), send that to the AI instead of the display message
    const aiContent = opts.hiddenInstruction || content
    const streamOpts = { provider: aiProvider, model: aiModel, scope, designPrefs, attachments, visualMode }
    if (opts.hiddenInstruction) {
      streamOpts.displayContent = content // Save this as the visible user message
    }
    if (isSelfEditChat) {
      streamOpts.selfEditTarget = selfEditTarget || { id: 'all', path: null }
    }
    // v2 agent is now the default for all chats (includes image vision support).
    // To use the legacy v1 endpoint, set `localStorage.auroraly_use_v1_agent = '1'`.
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('auroraly_use_v1_agent') === '1') {
        streamOpts.useV1Agent = true
      }
    } catch {}
    if (opts.silent) {
      streamOpts.silent = true
    }

    const abortController = streamMessage(
      selectedChat.id,
      aiContent,
      streamOpts,
      {
        onUserMessage: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === tempUserId ? { ...m, id: data.id, created_at: data.created_at } : m
          ))
        },

        onStatus: (data) => {
          setStreamingStatus(data)
          addLog('info', `[${data.stage}] ${data.detail}`)
          // Add whimsical phrase to persistent build log
          const phrase = BUILD_LOG_PHRASES[data.stage]
          if (phrase) addBuildLogEntry(phrase)
          else if (data.detail && !data.detail.includes('Using ')) addBuildLogEntry(data.detail)
        },

        onToken: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, content: m.content + data.content }
              : m
          ))
        },

        onReplaceContent: (data) => {
          // Replace the ENTIRE message content (used by self-edit to strip AI preamble)
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, content: data.content }
              : m
          ))
        },

        onFile: (data) => {
          addLog('success', `${data.action === 'created' ? 'Created' : 'Updated'}: ${data.path}`)
          const cleanName = data.path?.replace(/^src\/(components|pages)\//, '').replace(/\.(jsx|tsx|js|ts|css)$/, '') || data.path
          addMilestone(`${data.action === 'created' ? 'Built' : 'Updated'} ${cleanName}`)
          addBuildLogEntry(`${data.action === 'created' ? 'Built' : 'Refined'} ${cleanName}`)
        },

        onDiffFile: (data) => {
          collectedDiffs.push(data)
          addLog('info', `Diff ready: ${data.action} ${data.path}`)
        },

        onPreviewPartial: (data) => {
          // Buffer partials and drain progressively for visible incremental updates
          if (!data?.path || !data?.content) return
          previewQueueRef.current.push(data)
          if (!isSelfEditChat) setActiveTab('preview')
          // Start draining if not already
          if (!previewDrainTimerRef.current) {
            // Show first partial immediately
            setLivePreviewData(previewQueueRef.current.shift())
            previewDrainTimerRef.current = setInterval(() => {
              if (previewQueueRef.current.length > 0) {
                setLivePreviewData(previewQueueRef.current.shift())
              } else {
                clearInterval(previewDrainTimerRef.current)
                previewDrainTimerRef.current = null
              }
            }, 200)
          }
        },

        onFilesSaved: async (data) => {
          // Files were saved by Creative Brief fast-path — refresh files and show preview
          console.log('[FilesSaved] Refreshing files and preview...')
          if (selectedProject) {
            try {
              const filesRes = await authFetch(`/api/projects/${selectedProject.id}/files`)
              if (filesRes.ok) {
                const filesData = await filesRes.json()
                const filesArr = Array.isArray(filesData) ? filesData : []
                setFiles(filesArr)
                if (!isSelfEditChat) setActiveTab('preview')
                // Force preview to recompile with new files
                setLivePreviewData(null)
                console.log(`[FilesSaved] Loaded ${filesArr.length} files, switched to preview`)
              }
            } catch (e) { console.warn('[FilesSaved] Error:', e.message) }
          }
        },

        onImageGenerated: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, metadata: { ...m.metadata, generatedImage: data } }
              : m
          ))
          addLog('success', `Image generated: ${data.filename} (${data.mode})`)
        },

        onCreativeBrief: () => {
          // Design context is used internally by the AI — not shown in chat
        },

        onGeneratedImagesMap: (data) => {
          if (data?.images?.length > 0) {
            // Merge with any prior emissions (e.g., stock/generated images arrive first,
            // then brand VFS map arrives after assets.js is saved). Dedupe by placeholder
            // key — latest emission wins for the same key.
            setGeneratedImageMap((prev) => {
              const byKey = new Map()
              ;(prev || []).forEach((entry) => { if (entry?.placeholder) byKey.set(entry.placeholder, entry) })
              data.images.forEach((entry) => { if (entry?.placeholder) byKey.set(entry.placeholder, entry) })
              return Array.from(byKey.values())
            })
            addLog('info', `Mapped ${data.images.length} ${data.source === 'brand_vfs' ? 'brand asset' : 'generated image'}(s) for preview`)
          }
        },

        onImageIntent: async (data) => {
          // ── HARD GUARD: Block image generation for BUILD / plan_patch requests ──
          const isBuildIntent = /\bINTENT:\s*BUILD\b/i.test(data.prompt || '')
          if (isBuildIntent) {
            console.warn('[Dashboard] Image generation blocked — INTENT: BUILD detected in prompt')
            return
          }

          // clientMessageKey is closed over from outer scope — stable identity that survives id swap
          addLog('info', `Generating ${data.mode} image... (this may take 30-60s)`)
          setImageGenProgress({ stage: 'preparing', progress: 5, label: 'Preparing request', mode: data.mode, startTime: Date.now() })
          setStreamingStatus({ stage: 'generating_image', detail: `Generating ${data.mode} with OpenAI...` })

          try {
            const res = await authFetch(`/api/projects/${data.projectId}/generate-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: data.prompt,
                mode: data.mode,
                spriteOpts: data.spriteOpts,
                size: data.size || '1024x1024',
                chatId: data.chatId,
                variation: data.variation || undefined,
              }),
            })

            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err.error || 'Image generation failed')
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let asset = null

            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              let currentEvent = null
              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  currentEvent = line.slice(7).trim()
                } else if (line.startsWith('data: ') && currentEvent) {
                  try {
                    const eventData = JSON.parse(line.slice(6))
                    if (currentEvent === 'image_stage') {
                      const progressUpdate = {
                        stage: eventData.stage,
                        progress: eventData.progress,
                        label: eventData.label,
                      }
                      setImageGenProgress(prev => ({ ...prev, ...progressUpdate }))
                      // Persist progress to message metadata for stable rendering
                      setMessages(prev => prev.map(m => 
                        m.clientMessageKey === clientMessageKey 
                          ? { ...m, metadata: { ...m.metadata, imageGenProgress: progressUpdate } }
                          : m
                      ))
                    } else if (currentEvent === 'image_complete') {
                      asset = eventData.asset
                      setImageGenProgress(prev => ({ ...prev, stage: 'rendering', progress: 100, label: 'Rendering preview' }))
                    } else if (currentEvent === 'image_error') {
                      throw new Error(eventData.error || 'Image generation failed')
                    }
                  } catch (parseErr) {
                    if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr
                  }
                  currentEvent = null
                }
              }
            }

            if (!asset) throw new Error('No image asset received from server')

            const genImage = {
              id: asset.id,
              path: asset.path,
              filename: asset.filename,
              prompt: asset.prompt,
              mode: asset.mode,
              size: asset.size,
              revisedPrompt: asset.revisedPrompt,
              duration: asset.duration,
              projectId: data.projectId,
              variationType: asset.variationType,
              sourceAssetPath: asset.sourceAssetPath,
              stateName: asset.stateName,
              characterName: asset.characterName,
            }

            const content = `## Image Generated\n\n**Prompt:** ${data.prompt.slice(0, 200)}\n**Mode:** ${asset.mode}\n**Size:** ${asset.size}\n**File:** \`${asset.path}\`\n${asset.revisedPrompt ? `**Revised prompt:** ${asset.revisedPrompt}\n` : ''}\n*Generated in ${(asset.duration / 1000).toFixed(1)}s*`

            try {
              const { recordGenerationDuration } = await import('./ImageGenerationProgress')
              recordGenerationDuration(asset.duration)
            } catch {}

            let realMsgId = null
            setMessages(prev => {
              const updated = prev.map(m => {
                if (m.clientMessageKey === clientMessageKey) {
                  realMsgId = m.id
                  // Clear imageGenProgress when attaching generatedImage
                  const { imageGenProgress: _, ...restMetadata } = m.metadata || {}
                  return { ...m, content, streaming: false, metadata: { ...restMetadata, generatedImage: genImage } }
                }
                return m
              })
              if (!realMsgId) {
                // Fallback for variation studio where toolMode is set
                return prev.map(m => {
                  if (!realMsgId && m.role === 'assistant' && m.metadata?.toolMode === 'image_gen' && !m.metadata?.generatedImage) {
                    realMsgId = m.id
                    const { imageGenProgress: _, ...restMetadata } = m.metadata || {}
                    return { ...m, content, streaming: false, metadata: { ...restMetadata, generatedImage: genImage } }
                  }
                  return m
                })
              }
              return updated
            })

            addLog('success', `Image generated: ${asset.filename} (${asset.mode}) in ${(asset.duration / 1000).toFixed(1)}s`)
            setImageGenProgress(null)
            setStreamingStatus(null)
            setStreamingMessageId(null)

            try {
              const filesRes = await authFetch(`/api/projects/${data.projectId}/files`)
              if (filesRes.ok) {
                const filesData = await filesRes.json()
                setFiles(filesData)
              }
            } catch {}

            setAssetsRefreshKey(k => k + 1)

            if (realMsgId && !realMsgId.startsWith('streaming-')) {
              try {
                await authFetch(`/api/messages/${realMsgId}/metadata`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ generatedImage: genImage }),
                })
              } catch {}
            }

          } catch (err) {
            console.error('[Dashboard] Image generation error:', err)
            setImageGenProgress({ stage: 'error', progress: 0, error: err.message, mode: data.mode })
            setMessages(prev => prev.map(m =>
              (m.clientMessageKey === clientMessageKey || (m.role === 'assistant' && m.metadata?.toolMode === 'image_gen' && !m.metadata?.generatedImage))
                ? { ...m, content: `Image generation failed: ${err.message}\n\nPlease try again.`, streaming: false }
                : m
            ))
            addLog('error', `Image generation failed: ${err.message}`)
            setStreamingStatus(null)
            setStreamingMessageId(null)
          }
        },

        onDone: (data) => {
          const hasDiffs = (data?.diffFiles?.length > 0) || (collectedDiffs.length > 0)
          setStreamingStatus({
            stage: hasDiffs ? 'diff_ready' : 'complete',
            detail: data.proposedPlan ? 'Plan proposed — awaiting approval' : hasDiffs ? `${(data?.diffFiles || collectedDiffs).length} file(s) ready for review` : 'Generation complete'
          })

          // Mark briefProgress as complete if this was a new-pipeline build
          if (data?.toolMode === 'new_pipeline') {
            setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
              ...m,
              metadata: {
                ...(m.metadata || {}),
                briefProgress: {
                  ...((m.metadata?.briefProgress) || {}),
                  status: 'complete',
                  completedAt: Date.now(),
                },
              },
            } : m))
          }

          if (hasDiffs) {
            const diffs = data?.diffFiles || collectedDiffs
            setPendingDiffs(diffs)
            addLog('info', `${diffs.length} file diff(s) ready for review`)
          }

          const meta = data || {}
          if (meta.provider) {
            const parts = [`${meta.provider}/${meta.model}`]
            if (meta.scope && meta.scope !== 'project') parts.push(`scope: ${meta.scope}`)
            if (meta.intent && meta.intent !== 'chat') parts.push(`intent: ${meta.intent}`)
            if (meta.fsStats) parts.push(`files scanned: ${meta.fsStats.scanned}, matched: ${meta.fsStats.matched}`)
            addLog('info', `Response via ${parts.join(' | ')}`)
          }

          if (meta.files?.length > 0) {
            addLog('success', `Generated ${meta.files.length} file(s)`)
          }

          if (meta.proposedPlan) {
            addLog('info', 'Plan proposed — waiting for user approval')
          }
        },

        onPlan: (data) => {
          setPendingPlan(data)
        },

        // ── New pipeline live-progress events ──
        onArchetype: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                archetype: data,
                status: 'planning',
                startedAt: (m.metadata?.briefProgress?.startedAt) || Date.now(),
              },
            },
          } : m))
        },
        onArtDirection: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                artDirection: data,
              },
            },
          } : m))
        },
        onDesignTokens: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                designTokens: data?.tokens || null,
              },
            },
          } : m))
        },
        onRecipeFamily: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                recipeFamily: data,
              },
            },
          } : m))
        },
        onLayoutBlueprint: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                layoutBlueprint: data?.blueprint || null,
              },
            },
          } : m))
        },
        onBuildManifest: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                manifest: data,
              },
            },
          } : m))
        },
        onScreenshotVerify: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                screenshotVerify: data,
              },
            },
          } : m))
          addLog('info', data?.matches
            ? `Visual verify: matches references (${Math.round((data.confidence || 0) * 100)}%)`
            : `Visual verify: ${data?.findings?.length || 0} mismatch(es) found`)
        },
        onVisualRepairComplete: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                visualRepair: { filesRepaired: data?.filesRepaired || [], round: data?.round },
              },
            },
          } : m))
          addLog('success', `Visual repair round ${data?.round || 1}: applied to ${data?.filesRepaired?.length || 0} file(s)`)
        },
        onVisualLoopSummary: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                visualLoopSummary: data,
              },
            },
          } : m))
          const r = data?.rounds?.length || 0
          addLog(data?.finalMatches ? 'success' : 'info',
            `Visual loop: ${r} round${r === 1 ? '' : 's'} · ${data?.initialFindings || 0} initial findings → ${data?.finalMatches ? 'MATCH' : 'partial match'} · ${data?.totalFilesRepaired || 0} file(s) repaired total`)
        },
        onBriefPlan: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                plan: data,
                waves: (data.waves || []).map(w => ({ id: w.id, label: w.label, status: 'pending', filesBuilt: [] })),
                status: 'building',
              },
            },
          } : m))
        },
        onWaveStart: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                waves: ((m.metadata?.briefProgress?.waves) || []).map(w =>
                  w.id === data.waveId ? { ...w, status: 'running' } : w
                ),
              },
            },
          } : m))
        },
        onWaveComplete: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                waves: ((m.metadata?.briefProgress?.waves) || []).map(w =>
                  w.id === data.waveId ? { ...w, status: 'complete', filesBuilt: data.filesBuilt || [] } : w
                ),
              },
            },
          } : m))
        },
        onWaveError: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                waves: ((m.metadata?.briefProgress?.waves) || []).map(w =>
                  w.id === data.waveId ? { ...w, status: 'error' } : w
                ),
              },
            },
          } : m))
          addLog('error', `Wave ${data.waveId} failed: ${data.message}`)
        },
        onBuildAborted: (data) => {
          addLog('error', `Build aborted: ${data.reason}`)
        },
        onReviewResult: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                review: data,
                status: data.ok ? 'complete' : 'repairing',
              },
            },
          } : m))
        },
        onRepairStart: (data) => {
          setMessages(prev => prev.map(m => m.id === streamingAssistantId ? {
            ...m,
            metadata: {
              ...(m.metadata || {}),
              briefProgress: {
                ...((m.metadata?.briefProgress) || {}),
                repair: { missing: data.missing, broken: data.broken, filesRepaired: [] },
                status: 'repairing',
              },
            },
          } : m))
        },

        onMessageSaved: async (data) => {
          const updatedMeta = { intent: data.intent, scope: data.scope }
          if (data.tool_mode) updatedMeta.toolMode = data.tool_mode
          if (data.proposedPlan) {
            updatedMeta.proposedPlan = data.proposedPlan
            updatedMeta.planStatus = 'proposed'
          }
          if (data.planExecuted) {
            updatedMeta.planExecuted = true
          }
          const diffs = data.diffFiles || (collectedDiffs.length > 0 ? collectedDiffs : null)
          if (diffs?.length > 0) {
            updatedMeta.diffFiles = diffs
            updatedMeta.diffStatus = data.diffStatus || 'pending'
            setDiffMessageId(data.id)
          }

          setMessages(prev => prev.map(m => {
            if (m.id !== streamingAssistantId) return m
            const existingImage = m.metadata?.generatedImage
            const existingBriefProgress = m.metadata?.briefProgress
            return {
              ...m,
              id: data.id,
              content: data.contentOverride || m.content,
              streaming: false,
              clientMessageKey: m.clientMessageKey,  // Preserve stable identity across id swap
              metadata: {
                ...updatedMeta,
                generatedImage: existingImage || null,
                // Preserve new-pipeline progress card — marks build as complete in-place
                ...(existingBriefProgress ? { briefProgress: { ...existingBriefProgress, status: 'complete', completedAt: existingBriefProgress.completedAt || Date.now() } } : {}),
              }
            }
          }))
          setStreamingMessageId(null)
          setStreamingStatus(null)

          if ((data.generatedFiles?.length > 0 || data.directEditMode) && !diffs?.length) {
            // Flush remaining preview queue and clear drain timer
            if (previewDrainTimerRef.current) {
              clearInterval(previewDrainTimerRef.current)
              previewDrainTimerRef.current = null
            }
            // Show the last queued partial before clearing
            if (previewQueueRef.current.length > 0) {
              setLivePreviewData(previewQueueRef.current[previewQueueRef.current.length - 1])
              previewQueueRef.current = []
            }
            // Small delay to let the last partial render, then load final files
            await new Promise(r => setTimeout(r, 300))
            setLivePreviewData(null)  // Clear streaming preview — final files coming
            const filesResponse = await authFetch(`/api/projects/${selectedProject.id}/files`)
            const filesData = await filesResponse.json()
            setFiles(Array.isArray(filesData) ? filesData : [])
            setActiveTab(isSelfEditChat ? 'code' : 'preview')
          }

          const refreshCanvas = async (retries = 2) => {
            for (let i = 0; i <= retries; i++) {
              try {
                if (i > 0) await new Promise(r => setTimeout(r, 500 * i))
                const res = await authFetch(`/api/projects/${selectedProject.id}/canvas`)
                if (res.ok) {
                  const d = await res.json()
                  if (d.canvas_content) {
                    setCanvas(d.canvas_content)
                    return
                  }
                }
              } catch {}
            }
          }
          await refreshCanvas()

          // PM auto-continue disabled — was causing cascading multi-stream failures
          if (briefBuildActiveRef.current) {
            briefBuildActiveRef.current = false
          }
        },

        // Auto-refresh preview after AI file-write/edit/delete (Feb 2026):
        // The V2 server already hits the runner's /sync-from-supabase
        // via notifyPreviewOfFileChange when these tools succeed, so the
        // RUNNER has the new bytes. All we need to do here is bump the
        // iframe key after a short HMR-settling delay so the user sees
        // the change. Vite typically reloads in <500ms, CRA ~1-2s,
        // static-site (npx serve) needs the hard reload because there's
        // no HMR. 800ms is the safe middle ground.
        onFilesSaved: (data) => {
          // Visible breadcrumb so users can see the auto-sync happened
          // even when the preview doesn't visibly change (e.g. they were
          // on the Code tab, or the iframe was off-screen).
          addBuildLogEntry(`Synced ${data.action || 'change'} → preview reloading`)
          if (serverPreviewRefreshRef?.current) {
            setTimeout(() => {
              try { serverPreviewRefreshRef.current() } catch {}
            }, 800)
          }
        },

        onError: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? {
                  ...m,
                  content: m.content || data.message,
                  streaming: false,
                  metadata: {
                    providerError: true,
                    error_type: data.error_type,
                    provider: data.provider,
                    partial: data.partial
                  }
                }
              : m
          ))
          setStreamingMessageId(null)
          setStreamingStatus(null)
          addLog('error', `Error: ${data.message}`)

          if (!data.partial) {
            toast({ title: 'Generation Issue', description: data.message, variant: 'destructive' })
          }
        },

        // ── Platform billing events ──
        onCreditsExhausted: (data) => {
          // The upsell message is already streamed as tokens — just update balance
          setCreditsBalance(data.balance)
          setStreamingMessageId(null)
          setStreamingStatus(null)
        },
        onCreditsUpdate: (data) => {
          setCreditsBalance(data.balance)
        },
        onForkSuggested: (data) => {
          // Soft warning: conversation is getting long (70-85%)
          toast({ 
            title: 'Conversation Getting Long', 
            description: `${Math.round(data.percentage)}% of context used. Consider forking soon to avoid hitting limits.`,
            variant: 'default'
          })
        },
        onForkRequired: (data) => {
          // Hard block: conversation is critical (>85%) — fork button already in message
          toast({ 
            title: 'Fork Required', 
            description: `This conversation is too long (${Math.round(data.percentage)}%). Click Fork to continue.`,
            variant: 'destructive'
          })
          setStreamingMessageId(null)
          setStreamingStatus(null)
        },
        onFallbackNotice: (data) => {
          toast({ title: 'Model Fallback', description: `Used ${data.model} for this request.` })
        },
        onRuntimeTests: (data) => {
          setRuntimeTestScript(data.script)
        },
        onCanvasUpdate: (data) => {
          window.dispatchEvent(new CustomEvent('canvas_update', { detail: data }))
          setCanvas(data.content)
        },

        // ── Stream timeout auto-recovery ──
        onStreamRecovery: async () => {
          if (!selectedChat || !selectedProject) return false
          // Poll until files are saved — show progress to user
          setStreamingStatus({ stage: 'recovering', detail: 'Saving your build...' })
          const delays = [0, 3000, 5000, 5000, 5000, 5000]
          for (let attempt = 0; attempt < delays.length; attempt++) {
            try {
              if (delays[attempt] > 0) await new Promise(r => setTimeout(r, delays[attempt]))
              console.log(`[StreamRecovery] Attempt ${attempt + 1}/${delays.length}...`)
              setStreamingStatus({ stage: 'recovering', detail: `Loading your build... (attempt ${attempt + 1})` })
              const msgRes = await authFetch(`/api/chats/${selectedChat.id}/messages`)
              if (!msgRes.ok) continue
              const savedMessages = await msgRes.json()
              const latestAssistant = [...savedMessages].reverse().find(m => m.role === 'assistant' && !m.metadata?.error)
              if (!latestAssistant) continue
              console.log('[StreamRecovery] Found saved assistant message:', latestAssistant.id)

              setMessages(prev => prev.map(m =>
                m.id === streamingAssistantId
                  ? { ...m, id: latestAssistant.id, content: latestAssistant.content, streaming: false, metadata: latestAssistant.metadata || {} }
                  : m
              ))
              setStreamingMessageId(null)
              setStreamingStatus(null)

              const filesRes = await authFetch(`/api/projects/${selectedProject.id}/files`)
              if (filesRes.ok) {
                const filesData = await filesRes.json()
                setFiles(Array.isArray(filesData) ? filesData : [])
              }
              setActiveTab(isSelfEditChat ? 'code' : 'preview')
              toast({ title: 'Recovered', description: 'Connection dropped but your build was saved. Files loaded.' })
              return true
            } catch (err) {
              console.error(`[StreamRecovery] Attempt ${attempt + 1} failed:`, err.message)
            }
          }
          return false
        }
      }
    )

    streamAbortRef.current = abortController
  }

  // Keep ref updated so event handlers always have latest sendMessage
  sendMessageRef.current = sendMessage

  const executePlan = async (messageId, planData) => {
    if (!selectedChat || executingPlan) return

    setExecutingPlan(true)
    setPendingDiffs([])
    setDiffMessageId(null)
    setDiffPlanData(planData)
    addLog('info', 'Generating file changes for review...')

    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, metadata: { ...m.metadata, planStatus: 'executing' } }
        : m
    ))

    const streamingAssistantId = `streaming-exec-${Date.now()}`
    const collectedDiffs = []

    const placeholderAssistant = {
      id: streamingAssistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      created_at: new Date().toISOString()
    }
    setMessages(prev => [...prev, placeholderAssistant])
    setStreamingMessageId(streamingAssistantId)
    setStreamingStatus({ stage: 'executing_plan', detail: 'Generating diffs...' })

    streamAbortRef.current?.abort()

    const abortController = streamMessage(
      selectedChat.id,
      `Execute the approved plan: ${planData.summary}`,
      { provider: aiProvider, model: aiModel, scope, designPrefs, executePlan: planData },
      {
        onUserMessage: () => {},
        onStatus: (data) => {
          setStreamingStatus(data)
          addLog('info', `[${data.stage}] ${data.detail}`)
        },
        onToken: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, content: m.content + data.content }
              : m
          ))
        },
        onReplaceContent: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, content: data.content }
              : m
          ))
        },
        onFile: () => {},
        onDiffFile: (data) => {
          collectedDiffs.push(data)
          addLog('info', `Diff ready: ${data.action} ${data.path}`)
        },
        onDone: (data) => {
          const diffs = data?.diffFiles || collectedDiffs
          if (diffs.length > 0) {
            setPendingDiffs(diffs)
            setStreamingStatus({ stage: 'diff_ready', detail: `${diffs.length} file(s) ready for review` })
            addLog('info', `${diffs.length} file diff(s) ready for review`)
          } else {
            setStreamingStatus({ stage: 'complete', detail: 'No file changes generated' })
          }
        },
        onPlan: () => {},
        onMessageSaved: async (data) => {
          const diffs = data.diffFiles || collectedDiffs
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? {
                  ...m,
                  id: data.id,
                  streaming: false,
                  metadata: {
                    intent: data.intent,
                    diffFiles: diffs,
                    diffStatus: diffs.length > 0 ? 'pending' : 'none',
                    planData: data.planData || planData,
                  }
                }
              : m
          ))

          setDiffMessageId(data.id)
          setStreamingMessageId(null)
          setStreamingStatus(null)
          setExecutingPlan(false)

          if (diffs.length > 0) {
            setMessages(prev => prev.map(m =>
              m.id === messageId
                ? { ...m, metadata: { ...m.metadata, planStatus: 'diff_review' } }
                : m
            ))
          }
        },
        onError: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, content: m.content || data.message, streaming: false, metadata: { providerError: true, error_type: data.error_type } }
              : m
          ))
          setStreamingMessageId(null)
          setStreamingStatus(null)
          setExecutingPlan(false)
          addLog('error', `Diff generation failed: ${data.message}`)
          toast({ title: 'Generation Issue', description: data.message, variant: 'destructive' })
        },
        onCreditsExhausted: (data) => {
          setCreditsBalance(data.balance)
          setStreamingMessageId(null)
          setStreamingStatus(null)
          setExecutingPlan(false)
        },
        onCreditsUpdate: (data) => {
          setCreditsBalance(data.balance)
        },
        onFallbackNotice: (data) => {
          toast({ title: 'Model Fallback', description: `Used ${data.model} for this request.` })
        },
        onRuntimeTests: (data) => {
          setRuntimeTestScript(data.script)
        },
        onCanvasUpdate: (data) => {
          window.dispatchEvent(new CustomEvent('canvas_update', { detail: data }))
          setCanvas(data.content)
        },

        // ── Stream timeout auto-recovery (executePlan) ──
        onStreamRecovery: async () => {
          if (!selectedChat || !selectedProject) return false
          setStreamingStatus({ stage: 'recovering', detail: 'Saving your build...' })
          const delays = [0, 3000, 5000, 5000, 5000, 5000]
          for (let attempt = 0; attempt < delays.length; attempt++) {
            try {
              if (delays[attempt] > 0) await new Promise(r => setTimeout(r, delays[attempt]))
              console.log(`[StreamRecovery-Plan] Attempt ${attempt + 1}/${delays.length}...`)
              setStreamingStatus({ stage: 'recovering', detail: `Loading your build... (attempt ${attempt + 1})` })
              const msgRes = await authFetch(`/api/chats/${selectedChat.id}/messages`)
              if (!msgRes.ok) continue
              const savedMessages = await msgRes.json()
              const latestAssistant = [...savedMessages].reverse().find(m => m.role === 'assistant' && !m.metadata?.error)
              if (!latestAssistant) continue

              setMessages(prev => prev.map(m =>
                m.id === streamingAssistantId
                  ? { ...m, id: latestAssistant.id, content: latestAssistant.content, streaming: false, metadata: latestAssistant.metadata || {} }
                  : m
              ))
              setStreamingMessageId(null)
              setStreamingStatus(null)
              setExecutingPlan(false)

              const filesRes = await authFetch(`/api/projects/${selectedProject.id}/files`)
              if (filesRes.ok) {
                const filesData = await filesRes.json()
                setFiles(Array.isArray(filesData) ? filesData : [])
              }
              setActiveTab(isSelfEditChat ? 'code' : 'preview')
              toast({ title: 'Recovered', description: 'Connection dropped but your build was saved. Files loaded.' })
              return true
            } catch (err) {
              console.error(`[StreamRecovery-Plan] Attempt ${attempt + 1} failed:`, err.message)
            }
          }
          return false
        }
      }
    )

    streamAbortRef.current = abortController
  }

      const applyDiffs = async (approvedFiles) => {
    if (!selectedProject || !selectedChat || applyingDiffs) return

    setApplyingDiffs(true)
    addLog('info', `Applying ${approvedFiles.length} approved file(s)...`)

    try {
      let serverPendingMsg = null

      for (let i = 0; i < 10; i++) {
        const messagesRes = await authFetch(`/api/chats/${selectedChat.id}/messages`)
        const messagesData = await messagesRes.json()

        if (Array.isArray(messagesData)) {
          serverPendingMsg = [...messagesData].reverse().find(
            m =>
              m.role === 'assistant' &&
              m.metadata?.diffStatus === 'pending' &&
              m.metadata?.diffFiles?.length > 0
          )
        }

        if (serverPendingMsg) break
        await new Promise(r => setTimeout(r, 800))
      }

      if (!serverPendingMsg) {
        addLog('error', 'Apply blocked: pending diff message not yet saved on server')
        toast({
          title: 'Apply Not Ready',
          description: 'The diff is still being saved. Wait 2–3 seconds, then click Apply All again.',
          variant: 'destructive'
        })
        return
      }

      const planId = serverPendingMsg?.metadata?.planId || null
      const diffId = serverPendingMsg?.metadata?.diffId || null

      const response = await authFetch(`/api/projects/${selectedProject.id}/apply-diffs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedFiles,
          planData: diffPlanData,
          chatId: selectedChat.id,
          planId,
          diffId,
          provider: aiProvider,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setMessages(prev =>
          prev.map(m =>
            m.id === serverPendingMsg.id
              ? { ...m, metadata: { ...m.metadata, diffStatus: 'applied' } }
              : m
          )
        )

        if (result.snapshot) {
          addLog('info', `Snapshot created: ${result.snapshot.name}`)
        }

        addLog(
          'success',
          `Applied ${result.written.length} file(s)${
            result.deleted.length > 0 ? `, deleted ${result.deleted.length}` : ''
          }`
        )

        if (result.errors.length > 0) {
          for (const err of result.errors) {
            addLog('error', typeof err === 'string' ? err : `${err.path} — ${err.error}`)
          }
        }

        const filesResponse = await authFetch(`/api/projects/${selectedProject.id}/files`)
        const filesData = await filesResponse.json()
        setFiles(Array.isArray(filesData) ? filesData : [])
        setActiveTab(selectedChat && getChatType(selectedChat) === CHAT_TYPES.SELF_EDIT ? 'code' : 'preview')

        try {
          const res = await authFetch(`/api/projects/${selectedProject.id}/canvas`)
          if (res.ok) {
            const d = await res.json()
            if (d.canvas_content) setCanvas(d.canvas_content)
          }
        } catch {}

        toast({
          title: 'Changes Applied',
          description: `${result.written.length} file(s) written. Snapshot saved.`
        })

        setPendingDiffs([])
        setDiffMessageId(null)
        setDiffPlanData(null)
        setPendingPlan(null)

        // Auto-continuation: if server returned a next step, send it after a short delay
        if (result.continuation?.nextStep) {
          const { nextStep, remainingSteps, originalTask } = result.continuation
          addLog('info', `Continuing: ${nextStep}`)
          toast({
            title: 'Continuing to next step...',
            description: nextStep.length > 80 ? nextStep.slice(0, 80) + '...' : nextStep,
          })
          setTimeout(() => {
            sendMessage(`Continue the task: ${originalTask}\n\nNext step: ${nextStep}`, { scope: 'project' })
          }, 1500)
        }
      } else {
        addLog('error', `Apply failed: ${result.error}`)
        toast({ title: 'Apply Failed', description: result.error, variant: 'destructive' })
      }
    } catch (err) {
      addLog('error', `Apply error: ${err.message}`)
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
      } finally {
    setApplyingDiffs(false)
  }
}
  const cancelDiffs = (messageId) => {
    if (messageId || diffMessageId) {
      setMessages(prev => prev.map(m =>
        m.id === (messageId || diffMessageId)
          ? { ...m, metadata: { ...m.metadata, diffStatus: 'cancelled' } }
          : m
      ))
    }
    setPendingDiffs([])
    setDiffMessageId(null)
    setDiffPlanData(null)
    addLog('info', 'Changes discarded — no files were written')
    toast({ title: 'Changes Discarded', description: 'No files were modified.' })
  }

  const cancelPlan = (messageId) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, metadata: { ...m.metadata, planStatus: 'cancelled' } }
        : m
    ))
    setPendingPlan(null)
    addLog('info', 'Plan cancelled')
    toast({ title: 'Plan Cancelled', description: 'No files were changed.' })
  }

  const retryWithFallback = async (errorMessage) => {
    const idx = messages.findIndex(m => m.id === errorMessage.id)
    const prevUser = idx > 0
      ? messages.slice(0, idx).reverse().find(m => m.role === 'user')
      : null

    if (!prevUser) {
      toast({ title: 'Nothing to retry', description: 'Could not find the original message.', variant: 'destructive' })
      return
    }

    const failedProvider = errorMessage.metadata?.provider
    const fallbackProvider = failedProvider === 'openai' ? 'anthropic' : 'openai'
    const fallbackModel = fallbackProvider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6'

    setAiProvider(fallbackProvider)
    setAiModel(fallbackModel)

    addLog('info', `Retrying with ${fallbackProvider}/${fallbackModel}...`)
    await sendMessage(prevUser.content)
  }

  return {
    sendMessage, executePlan, retryWithFallback,
    applyDiffs, cancelDiffs, cancelPlan,
    streamingMessageId, streamingStatus, setStreamingMessageId, setStreamingStatus,
    pendingPlan, setPendingPlan,
    executingPlan,
    pendingDiffs, setPendingDiffs,
    applyingDiffs,
    diffMessageId,
    diffPlanData,
    imageGenProgress, setImageGenProgress,
  }
}
