# Claude Fable 5 — Premium Mythos-Class Model

## Overview

**Claude Fable 5** is Anthropic's newest premium "Mythos-class" model — a tier above Opus. It's the most expensive model in Auroraly's lineup, designed for complex autonomous work where cheaper models would require multiple correction rounds.

## Pricing

- **Input:** $10/MTok
- **Output:** $50/MTok
- **Auroraly credits:** 5.0 per message
- **Cost comparison:**
  - ~4x more expensive than Sonnet 4.5 (1.25 cr)
  - ~2x more expensive than Opus 4.5 (2.5 cr)
  - ~16x more expensive than Haiku 4.5 (0.3 cr)

## When to Use Fable 5

### ✅ **Best Use Cases**

1. **Large codebase migrations**
   - Converting entire projects between frameworks
   - Refactoring 10+ files in one pass
   - Architectural redesigns

2. **Complex autonomous tasks**
   - Multi-step workflows that cheaper models break on
   - Tasks requiring deep reasoning across many files
   - High-stakes production fixes

3. **Document analysis**
   - Long PDFs or technical specs
   - Legal/financial reasoning
   - Detailed vision tasks (complex screenshots)

4. **When cheaper models have failed**
   - You've tried Sonnet/Opus and got low-quality output
   - The task requires multiple correction rounds with cheaper models
   - Total cost of retries exceeds Fable's upfront cost

### ❌ **When NOT to Use Fable 5**

1. **Quick edits**
   - Typo fixes, color changes, simple CSS tweaks
   - Use Haiku (0.3 cr) instead — 16x cheaper

2. **Iterative development**
   - Building a feature step-by-step over 10+ messages
   - Use Sonnet (1.25 cr) — you'll save 37.5 credits over 10 turns

3. **Exploratory work**
   - "Try this approach and see if it works"
   - Start with Haiku/Sonnet, upgrade if needed

4. **Standard builds**
   - Creating a new component or page
   - Use Sonnet (1.25 cr) — proven for 90% of builds

## Cost-Benefit Analysis

### Example: Multi-File Refactor

**Scenario:** Refactor authentication across 8 files

**Option A: Fable 5 (one shot)**
- 1 message × 5.0 credits = **5.0 credits**
- Success rate: ~95%
- Total time: 2 minutes

**Option B: Sonnet 4.5 (iterative)**
- 3 messages × 1.25 credits = **3.75 credits**
- Success rate: ~80% (may need corrections)
- Total time: 10 minutes

**Option C: Haiku 4.5 (cheap)**
- 6 messages × 0.3 credits = **1.8 credits**
- Success rate: ~60% (likely needs multiple retries)
- Total time: 20 minutes

**Verdict:** Fable is worth it if you value time over credits. Sonnet is the sweet spot for most users.

---

### Example: Typo Fix

**Scenario:** Fix "Welcom" → "Welcome" in header

**Option A: Fable 5**
- 1 message × 5.0 credits = **5.0 credits**
- Massive overkill

**Option B: Haiku 4.5**
- 1 message × 0.3 credits = **0.3 credits**
- Perfect for this task

**Verdict:** Using Fable here wastes 4.7 credits. Always use Haiku for simple edits.

## How to Enable Fable 5

1. Open any chat in Auroraly
2. Click the **model selector** (top-right, shows current model)
3. Expand the **Anthropic** section
4. Select **Claude Fable 5** (marked "Ultra")

The selector will show:
- Badge: "Ultra"
- Cost: 5.0 cr
- Note: "Premium model for complex autonomous work, large migrations, and high-value tasks."

## Auto-Selection

When **Auto mode** is enabled, Fable 5 will be automatically selected if:
- Your prompt contains keywords like "migrate", "refactor entire", "convert all"
- You mention 5+ files in one operation
- The prompt is very long (>600 chars) with complex requirements

You can always override the auto-selection if you prefer a different model.

## Comparison with Other Premium Models

| Model | Credits | Best For | Strengths |
|-------|---------|----------|-----------|
| **Fable 5** | 5.0 | Autonomous migrations, complex reasoning | Best overall reasoning, handles long context |
| **Opus 4.5** | 2.5 | Complex refactors, integrations | Strong coding, good balance of cost/quality |
| **GPT-5.2** | 1.5 | Latest OpenAI features | Fast, good for creative tasks |
| **O3** | 2.0 | Advanced reasoning | Strong on math/logic, slower |

## Tips for Maximizing Value

1. **Batch complex tasks**
   - Instead of 5 separate Sonnet calls, do one Fable call
   - Example: "Refactor auth, add error handling, update tests, fix types, and optimize performance"

2. **Use for one-shot migrations**
   - "Convert this CRA app to Vite" in one message
   - Cheaper than 10 Sonnet iterations

3. **Leverage long context**
   - Fable excels at understanding large codebases
   - Attach multiple files or long docs in one message

4. **Don't use for iteration**
   - If you're building incrementally, stick to Sonnet
   - Fable's cost adds up fast over 20+ messages

## Real User Scenarios

### ✅ **Good Use: Codebase Migration**
**User:** "Migrate my entire Next.js app from Pages Router to App Router — update all 30 route files, move API routes, convert getServerSideProps to server components, and update the layout structure."

**Model:** Fable 5 (5.0 cr)

**Result:** Completed in one pass, all files updated correctly, no follow-up needed.

**Cost:** 5.0 credits

**Alternative (Sonnet):** Would take 4-5 messages with corrections = 5-6.25 credits + 30 minutes

---

### ❌ **Bad Use: Simple Edit**
**User:** "Change the button color from blue to green"

**Model:** Fable 5 (5.0 cr)

**Result:** Worked perfectly, but...

**Cost:** 5.0 credits (wasted 4.7 credits)

**Alternative (Haiku):** Same result for 0.3 credits

---

### ✅ **Good Use: Complex Integration**
**User:** "Integrate Stripe Checkout with webhook handling, create a credits system, add purchase history, and set up automatic email receipts"

**Model:** Fable 5 (5.0 cr)

**Result:** All components wired correctly, edge cases handled, production-ready code.

**Cost:** 5.0 credits

**Alternative (Sonnet):** Would take 3-4 messages = 3.75-5.0 credits, but likely needs debugging

## FAQ

**Q: Is Fable 5 always better than Opus/Sonnet?**
A: No. It's more expensive, so only use it when the task justifies the cost. For 90% of tasks, Sonnet is the sweet spot.

**Q: Can I use Fable 5 in Core System mode?**
A: Yes, but Core System defaults to Sonnet for safety. You can manually select Fable if needed.

**Q: Does Fable 5 support vision (screenshots)?**
A: Yes! Fable excels at detailed vision tasks — analyzing complex UIs, diagrams, or documents.

**Q: How do I know if Fable is worth it for my task?**
A: Ask yourself: "Would this take 4+ messages with Sonnet?" If yes, Fable is worth it. If no, stick to Sonnet.

**Q: Can I set Fable as my default model?**
A: Yes, but we don't recommend it — you'll burn through credits fast. Use auto-selection instead.

## Summary

**Use Fable 5 when:**
- The task is complex and high-value
- Cheaper models have failed
- You need one-shot autonomous work
- Time is more valuable than credits

**Don't use Fable 5 when:**
- The task is simple or iterative
- You're exploring or experimenting
- You're on a tight credit budget

**Sweet spot:** Reserve Fable for the 5-10% of tasks that truly need premium reasoning. Use Sonnet for everything else.

---

**Last updated:** 2025-01-XX
