import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { AIService } from '@/lib/ai/service'
import { SELF_EDIT_PREFIX } from '@/lib/constants'
import { creditsDb, CREDIT_COSTS } from '@/lib/credits/service'

export async function handle(route, method, path, request) {
  if (route.match(/^\/projects\/[^/]+\/apply-diffs$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const body = await request.json()
    const { approvedFiles, planData, chatId } = body

    if (!approvedFiles || !Array.isArray(approvedFiles) || approvedFiles.length === 0) {
      return handleCORS(NextResponse.json({ error: 'No files to apply' }, { status: 400 }))
    }

    const guardErrors = []
    const normPath = (p) => (p || '').replace(/^\.\//, '').replace(/^\//, '')

    let pendingMessage = null
    if (chatId) {
      const chatMessages = await db.messages.findByChatId(chatId)
      pendingMessage = chatMessages.reverse().find(m =>
        m.metadata?.diffStatus === 'pending' && m.metadata?.diffFiles?.length > 0
      )
    }

    if (!pendingMessage) {
      guardErrors.push('No pending diff review found for this chat')
    }

    if (pendingMessage && pendingMessage.metadata?.diffStatus !== 'pending') {
      guardErrors.push(`diffStatus is "${pendingMessage.metadata?.diffStatus}", expected "pending"`)
    }

    const serverDiffFiles = pendingMessage?.metadata?.diffFiles || []
    if (pendingMessage && serverDiffFiles.length === 0) {
      guardErrors.push('Server-side metadata.diffFiles is empty')
    }

    for (const diff of approvedFiles) {
      diff.path = normPath(diff.path)
    }
    const serverPaths = new Set(serverDiffFiles.map(f => normPath(f.path)))
    const approvedPaths = new Set(approvedFiles.map(f => f.path))

    if (serverDiffFiles.length > 0) {
      if (approvedFiles.length !== serverDiffFiles.length) {
        guardErrors.push(`Diff set size mismatch: approved ${approvedFiles.length} vs server ${serverDiffFiles.length}`)
      }
      for (const p of approvedPaths) {
        if (!serverPaths.has(p)) guardErrors.push(`"${p}": not in server-side pending diff set`)
      }
      for (const p of serverPaths) {
        if (!approvedPaths.has(p)) guardErrors.push(`"${p}": in server-side pending set but not in approved files`)
      }
    }

    if (planData && pendingMessage?.metadata?.planData) {
      const { hashPlan: hp } = await import('@/lib/ai/plan-validator.js')
      const clientHash = hp(planData)
      const serverHash = hp(pendingMessage.metadata.planData)
      if (clientHash !== serverHash) {
        guardErrors.push('Plan hash does not match pending diff review context')
      }
    }

    if (planData?.planId && pendingMessage?.metadata?.planId) {
      if (planData.planId !== pendingMessage.metadata.planId) {
        guardErrors.push('STALE_PLAN_OR_DIFF_ID: planId mismatch')
      }
    }

    if (body.diffId && pendingMessage?.metadata?.diffId) {
      if (body.diffId !== pendingMessage.metadata.diffId) {
        guardErrors.push('STALE_PLAN_OR_DIFF_ID: diffId mismatch')
      }
    }

    const existingFiles = await db.projectFiles.findByProjectId(projectId)
    const existingByPath = new Map(existingFiles.map(f => [normPath(f.path), f]))

    for (const diff of approvedFiles) {
      if (diff.action === 'create' && existingByPath.has(diff.path)) {
        guardErrors.push(`"${diff.path}": illegal create \u2014 file already exists`)
      }
      if (diff.action === 'update' && diff.newContent != null) {
        const existing = existingByPath.get(diff.path)
        if (existing && existing.content === diff.newContent) {
          guardErrors.push(`"${diff.path}": no-op update \u2014 content identical to current file`)
        }
      }
    }

    if (guardErrors.length > 0) {
      const { logPlanEvent } = await import('@/lib/ai/changelog.js')
      const { hashPlan } = await import('@/lib/ai/plan-validator.js')
      logPlanEvent({
        projectId,
        chatId: chatId || null,
        userId: null,
        userTask: planData?.summary || 'apply-diffs',
        taskMode: 'diff_review_rejected',
        validatorResult: { valid: false, errors: guardErrors, warnings: [], mode: 'diff_review_rejected' },
        planHash: planData ? hashPlan(planData) : null,
        rejectionReasons: guardErrors,
        planSummary: planData?.summary || null,
        fileActions: approvedFiles.map(d => ({ action: d.action, path: d.path })),
      }).catch(e => console.warn('[changelog] diff_review_rejected logPlanEvent failed:', e.message))

      return handleCORS(NextResponse.json({
        success: false,
        error: 'DiffReviewGuard rejected',
        rejection_reasons: guardErrors,
      }, { status: 422 }))
    }

    // Credit pre-check before diff execution
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    try {
      const creditBalance = await creditsDb.getBalance(dbUser.id)
      const requiredCredits = CREDIT_COSTS.file_apply || 3.0
      if (creditBalance.balance < requiredCredits) {
        return handleCORS(NextResponse.json({
          success: false,
          error: `You're out of credits. You need at least ${requiredCredits} credits to apply changes (current balance: ${creditBalance.balance.toFixed(2)}). Tap Buy Credits to top up.`,
          credits_exhausted: true,
          balance: creditBalance.balance,
          required: requiredCredits,
        }, { status: 402 }))
      }
    } catch (creditErr) {
      console.warn('[Credits] Diff credit check failed, proceeding:', creditErr.message)
    }

    const aiService = new AIService(body.provider || 'openai')
    const results = await aiService.applyDiffs(projectId, chatId, authUser.id, approvedFiles, planData)

    if (pendingMessage && !results.diffStatusTransitioned) {
      try {
        await db.messages.update(pendingMessage.id, {
          metadata: { ...pendingMessage.metadata, diffStatus: 'applied' }
        })
      } catch {}
    }

    // Deduct credits after successful diff application
    if (!results.rolledBack) {
      creditsDb.deductCredits(dbUser.id, 'file_apply').catch(e =>
        console.warn('[Credits] Post-diff deduct failed:', e.message)
      )
    }

    import('@/lib/self_builder/change_log').then(async ({ logChange }) => {
      let chatType = 'builder'
      if (chatId) {
        try {
          const chat = await db.chats.findById(chatId)
          if (chat?.title?.startsWith(SELF_EDIT_PREFIX)) chatType = 'self_edit'
        } catch {}
      }
      logChange({
        projectId,
        chatId: chatId || null,
        userId: authUser.id,
        userTask: planData?.summary || '',
        taskMode: 'apply',
        result: results.rolledBack ? 'rolled_back' : 'applied',
        filePaths: [...(results.written || []), ...(results.deleted || [])],
        fileActions: [
          ...(results.written || []).map(p => ({ path: p, action: 'write' })),
          ...(results.deleted || []).map(p => ({ path: p, action: 'delete' })),
        ],
        chatType,
      })
    }).catch(e => console.warn('[changelog] apply logChange failed:', e.message))

    // Record adaptive learning event for diff approval
    import('@/lib/ai/adaptive-learning.js').then(async ({ recordLearningEvent }) => {
      await recordLearningEvent(projectId, {
        event_type: results.rolledBack ? 'diff_rolled_back' : 'diff_approved',
        context: {
          files: approvedFiles.map(d => d.path),
          task: planData?.summary || 'diff_review',
          file_count: approvedFiles.length,
        },
      })
    }).catch(() => {})

    const nextStep = (!results.rolledBack && planData?.next_steps?.length > 0) ? planData.next_steps[0] : null
    const remainingSteps = (!results.rolledBack && planData?.next_steps?.length > 1) ? planData.next_steps.slice(1) : []

    return handleCORS(NextResponse.json({
      success: !results.rolledBack,
      snapshot: results.snapshot ? { id: results.snapshot.id, name: results.snapshot.name } : null,
      written: results.written,
      deleted: results.deleted,
      skipped: results.skipped,
      errors: results.errors,
      rolledBack: results.rolledBack || false,
      continuation: nextStep ? { nextStep, remainingSteps, originalTask: planData?.summary || '' } : null,
    }))
  }

  return null
}
