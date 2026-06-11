# Model Auto-Selection Guide

## Overview

Auroraly's **Smart Model Auto-Selector** analyzes your prompts and automatically recommends the most cost-effective model for each task. This helps you save credits by routing simple edits to fast/cheap models and complex work to premium models.

## How It Works

The auto-selector analyzes:
- **Keywords** (e.g., "migrate", "refactor", "fix typo")
- **Prompt length** (short = simple, long = complex)
- **Code blocks** (multiple blocks = complex)
- **File counts** ("edit 5 files" = multi-file operation)
- **Context** (initial build vs. quick edit)

Based on this analysis, it recommends one of four tiers:

### Model Tiers

| Tier | Credits | Best For | Models |
|------|---------|----------|--------|
| **FAST** | 0.25-0.3 | Quick edits, typo fixes, simple changes | Haiku 4.5, GPT-4o mini, Gemini Flash |
| **BALANCED** | 1.0-1.25 | Standard builds, moderate complexity | Sonnet 4.5, GPT-4o, Gemini Pro |
| **POWERFUL** | 2.5 | Complex refactors, large features | Opus 4.5, O3 |
| **ULTRA** | 5.0 | Autonomous migrations, multi-file orchestration | **Fable 5**, GPT-5.2 |

## When to Use Each Tier

### FAST (0.25-0.3 credits)
✅ **Use for:**
- Fixing typos or small bugs
- Changing colors, text, or styles
- Adding padding/margins
- Simple one-line edits

❌ **Avoid for:**
- Initial app builds (may struggle)
- Complex logic or algorithms
- Multi-file changes

### BALANCED (1.0-1.25 credits)
✅ **Use for:**
- Building new features
- Standard component creation
- Moderate refactoring
- Most day-to-day coding tasks

### POWERFUL (2.5 credits)
✅ **Use for:**
- Large refactors
- Adding authentication/payments
- API integrations
- Performance optimization
- Complex business logic

### ULTRA (5.0 credits)
✅ **Use for:**
- Migrating entire codebases
- Architectural redesigns
- Multi-file autonomous work
- High-stakes production fixes
- Complex document analysis

❌ **Avoid for:**
- Quick edits (massive overkill)
- Iterative development (burns credits fast)

## Claude Fable 5 Specifics

**Cost:** 5.0 credits per message (~4x Sonnet, ~16x Haiku)

**When to use:**
- You need the absolute best reasoning for a critical task
- Cheaper models have failed or produced low-quality output
- The task requires deep understanding of a large codebase
- You're doing a one-shot migration or architectural change

**When NOT to use:**
- Iterative development (use Sonnet or Haiku instead)
- Simple edits (use Haiku or Flash)
- Exploratory work (start cheap, upgrade if needed)

## Cost-Saving Tips

1. **Start cheap, upgrade if needed**
   - Try Haiku first for edits
   - If it struggles, bump to Sonnet
   - Only use Fable/Opus for truly complex work

2. **Use auto-selection**
   - Let the system analyze your prompt
   - Accept recommendations when confidence is high
   - Override when you know better

3. **Batch similar tasks**
   - Group simple edits into one message
   - Use Haiku for the batch instead of multiple Sonnet calls

4. **Be specific in prompts**
   - Clear prompts = better results = fewer retries
   - Fewer retries = lower total cost

## Example Scenarios

### Scenario 1: Typo Fix
**Prompt:** "Fix the typo in the header — it says 'Welcom' instead of 'Welcome'"

**Auto-selected:** FAST (Haiku 4.5, 0.3 credits)

**Why:** Simple text change, short prompt, explicit "fix typo" keyword

---

### Scenario 2: New Feature
**Prompt:** "Add a user profile page with avatar upload, bio editing, and social links"

**Auto-selected:** BALANCED (Sonnet 4.5, 1.25 credits)

**Why:** Standard feature build, moderate complexity, single-page scope

---

### Scenario 3: Authentication Integration
**Prompt:** "Integrate Supabase auth with Google OAuth, add protected routes, and create a session management system"

**Auto-selected:** POWERFUL (Opus 4.5, 2.5 credits)

**Why:** Complex integration, multiple components, security-critical

---

### Scenario 4: Codebase Migration
**Prompt:** "Migrate the entire app from Create React App to Vite — update all imports, config files, and build scripts across 50+ files"

**Auto-selected:** ULTRA (Fable 5, 5.0 credits)

**Why:** Multi-file operation, architectural change, "migrate entire" keyword

## FAQ

**Q: Can I override the auto-selection?**
A: Yes! Auto-selection is a recommendation, not a requirement. You can always manually select any model.

**Q: What if the auto-selector is wrong?**
A: The system shows confidence levels. If confidence is low (<70%), it's uncertain. You can dismiss the suggestion and pick manually.

**Q: Does auto-selection work in Core System mode?**
A: Yes, but Core System chats default to Sonnet 4.5 for safety (self-editing the platform requires strong reasoning).

**Q: How do I enable auto-selection?**
A: Look for the "Auto" toggle next to the model selector in the chat interface. When enabled, the system will automatically pick the best model for each message.

**Q: Can I see why a model was recommended?**
A: Yes! The auto-selector shows a brief reason (e.g., "Simple task keyword detected", "Multi-file operation (5 files)").

## Best Practices

1. **Trust the system for routine work** — it's calibrated to save you money
2. **Override for edge cases** — you know your task better than heuristics
3. **Monitor your credit usage** — check the dashboard to see which models you use most
4. **Experiment** — try different models on the same task to find your sweet spot
5. **Report issues** — if auto-selection consistently picks wrong, let us know!

---

**Last updated:** 2025-01-XX
