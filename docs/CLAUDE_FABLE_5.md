# Claude Fable 5 — When to Use It

## Overview

**Claude Fable 5** is Anthropic's new premium "Mythos-class" model — a tier above Opus 4.8. It's designed for the hardest autonomous tasks where cheaper models need too much correction.

## Pricing

- **Input**: $10 per million tokens
- **Output**: $50 per million tokens
- **Cost vs Opus 4.8**: ~2x more expensive ($5/$25 for Opus)
- **Auroraly Credits**: 5.0 credits per request (vs 2.5 for Opus, 1.25 for Sonnet)

## When to Use Fable 5

Use Fable 5 for:

✅ **Hard autonomous coding tasks**
  - Large codebase migrations
  - Complex refactoring across multiple files
  - Architectural changes that require deep reasoning

✅ **Long-horizon agentic work**
  - Multi-step workflows that need to maintain context
  - Tasks that require planning and execution over many turns

✅ **Complex document analysis**
  - Large context analysis (200K token window)
  - Finance and legal reasoning
  - Detailed technical specifications

✅ **High-value knowledge work**
  - Tasks where cheaper models need multiple correction rounds
  - Work where getting it right the first time saves more than the cost difference

✅ **Detailed vision tasks**
  - Complex screenshot analysis
  - UI/UX debugging with visual context

## When NOT to Use Fable 5

❌ **Quick edits and small changes**
  - Use Sonnet 4.5 or Haiku 4.5 instead
  - Fable's premium cost isn't justified for simple tasks

❌ **Exploratory conversations**
  - Use Sonnet for general chat and brainstorming
  - Save Fable for execution

❌ **Budget-constrained projects**
  - Fable burns 5x the credits of Haiku
  - Consider if the quality improvement justifies the cost

## How to Use

### API Usage

Pass the model name in the request metadata:

\`\`\`javascript
{
  content: "Your message",
  metadata: {
    provider: "anthropic",
    model: "claude-fable-5"
  }
}
\`\`\`

### Default Behavior

Fable 5 is **not** the default model. Users must explicitly select it. The system defaults to:
- **Self-edit chats**: Claude Sonnet 4.5
- **Project chats**: Claude Sonnet 4.5 or GPT-4o (depending on provider setting)

## Fallback Strategy

If Fable 5 is unavailable, the system falls back to:
1. **Claude Opus 4.5** (next-best Anthropic model)
2. **Claude Sonnet 4.5** (if Opus is also down)

## Cost-Benefit Analysis

**Example scenario**: A large codebase migration

- **With Haiku (0.3 credits)**: 10 attempts × 0.3 = 3.0 credits + user frustration
- **With Sonnet (1.25 credits)**: 4 attempts × 1.25 = 5.0 credits + some back-and-forth
- **With Fable (5.0 credits)**: 1 attempt × 5.0 = 5.0 credits + done right the first time

**Verdict**: For complex tasks, Fable often costs the same or less than multiple cheaper attempts.

## Technical Details

- **Context window**: 200,000 tokens (same as Sonnet/Opus)
- **Provider**: Anthropic
- **Model ID**: `claude-fable-5`
- **Tier**: Ultra (highest tier in Auroraly)
- **Fallback chain**: Fable 5 → Opus 4.5 → Sonnet 4.5 → Haiku 4.5

## References

- [Anthropic announcement](https://www.anthropic.com/news/claude-fable-5-mythos-5)
- [Pricing details](https://www.truefoundry.com/blog/claude-fable-5-api-benchmarks-pricing-how-to-use-it)
- [Simon Willison's initial impressions](https://simonwillison.net/2026/Jun/9/claude-fable-5)
