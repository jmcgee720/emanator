/**
 * Email service — uses Resend for transactional emails.
 * 
 * Setup:
 * 1. Sign up at https://resend.com
 * 2. Add RESEND_API_KEY to Vercel env vars
 * 3. Verify your sending domain (or use onboarding@resend.dev for testing)
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.EMAIL_FROM || 'onboarding@resend.dev'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.auroraly.co'

/**
 * Send a promo code email to a recipient.
 * @param {object} opts
 * @param {string} opts.to - Recipient email
 * @param {string} opts.code - Promo code
 * @param {string} opts.senderName - Name of the person who sent it
 */
export async function sendPromoCodeEmail({ to, code, senderName }) {
  if (!RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email send')
    return { sent: false, reason: 'no_api_key' }
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Auroraly Promo Code</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a1a; color: #e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a1a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #00e5ff; text-shadow: 0 0 20px rgba(0, 229, 255, 0.3);">
                🎉 You've Got Unlimited Credits!
              </h1>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #d0d0d0;">
                Hey there! 👋
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #d0d0d0;">
                <strong style="color: #00e5ff;">${senderName}</strong> sent you a promo code for <strong style="color: #00e5ff;">unlimited credits</strong> on Auroraly — the AI that builds full-stack apps from a single prompt.
              </p>
              
              <!-- Promo Code Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                <tr>
                  <td style="background: rgba(0, 229, 255, 0.1); border: 2px solid #00e5ff; border-radius: 12px; padding: 24px; text-align: center;">
                    <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #00e5ff; font-weight: 600;">Your Promo Code</p>
                    <p style="margin: 0; font-size: 32px; font-weight: 700; font-family: 'Courier New', monospace; color: #ffffff; letter-spacing: 2px; text-shadow: 0 0 10px rgba(0, 229, 255, 0.5);">
                      ${code}
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #d0d0d0;">
                With unlimited credits, you can:
              </p>
              <ul style="margin: 0 0 30px; padding-left: 20px; color: #d0d0d0;">
                <li style="margin-bottom: 8px;">Build unlimited full-stack apps</li>
                <li style="margin-bottom: 8px;">Use any AI model (GPT-4, Claude, Gemini)</li>
                <li style="margin-bottom: 8px;">Generate custom images with AI</li>
                <li style="margin-bottom: 8px;">Deploy to production with one click</li>
              </ul>
              
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${SITE_URL}/redeem?code=${code}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #00e5ff 0%, #0099cc 100%); color: #0a0a1a; text-decoration: none; font-weight: 700; font-size: 16px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0, 229, 255, 0.4); text-transform: uppercase; letter-spacing: 0.5px;">
                      Redeem Your Code
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 30px 0 0; font-size: 14px; line-height: 1.6; color: #888; text-align: center;">
                Or paste the code manually after signing in at <a href="${SITE_URL}" style="color: #00e5ff; text-decoration: none;">${SITE_URL}</a>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.1); background: rgba(0, 0, 0, 0.2);">
              <p style="margin: 0; font-size: 12px; color: #666;">
                This code is one-time use only. Questions? Reply to this email.
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #666;">
                © ${new Date().getFullYear()} Auroraly — Build anything with AI
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  const text = `
🎉 You've Got Unlimited Credits on Auroraly!

${senderName} sent you a promo code for unlimited credits.

Your Promo Code: ${code}

Redeem it here: ${SITE_URL}/redeem?code=${code}

Or paste the code manually after signing in at ${SITE_URL}

With unlimited credits, you can:
• Build unlimited full-stack apps
• Use any AI model (GPT-4, Claude, Gemini)
• Generate custom images with AI
• Deploy to production with one click

This code is one-time use only.

© ${new Date().getFullYear()} Auroraly — Build anything with AI
  `.trim()

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: `🎁 Your Auroraly Unlimited Credits Code: ${code}`,
        html,
        text,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || `Resend API error: ${response.status}`)
    }

    const result = await response.json()
    console.log('[Email] Promo code sent:', { to, code, id: result.id })
    return { sent: true, id: result.id }
  } catch (error) {
    console.error('[Email] Send failed:', error)
    throw error
  }
}
