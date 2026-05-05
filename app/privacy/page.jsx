/**
 * Privacy Policy — public-facing page accessible to anyone.
 *
 * This is intentionally a static MDX-ish JSX layout because the policy
 * needs to be human-reviewed and Versioned. Update the LAST_UPDATED
 * constant whenever the policy text changes.
 */
const LAST_UPDATED = 'May 5, 2026'
const COMPANY = 'Aetherly Studio LLC'
const PRODUCT = 'Auroraly'
const CONTACT_EMAIL = 'support@auroraly.co'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-3xl mx-auto px-6 py-16 lg:py-24">
        <a href="/" className="text-sm text-zinc-400 hover:text-zinc-200 transition" data-testid="privacy-home-link">← Back to Auroraly</a>
        <h1 className="text-4xl font-bold mt-6 mb-3" style={{ fontFamily: 'Fraunces, serif' }} data-testid="privacy-title">Privacy Policy</h1>
        <p className="text-sm text-zinc-400 mb-12">Last updated: {LAST_UPDATED}</p>

        <Section title="1. Introduction">
          <p>{COMPANY} ("we", "us", "our") operates {PRODUCT} (the "Service"). This Privacy Policy explains what information we collect, how we use it, and the choices you have. By using the Service you agree to the collection and use of information in accordance with this policy.</p>
        </Section>

        <Section title="2. Information We Collect">
          <p className="mb-3">We collect information in three ways:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong className="text-zinc-100">Account information</strong> — name, email address, and authentication identifiers when you sign up via email or Google OAuth.</li>
            <li><strong className="text-zinc-100">Content you create</strong> — the prompts, brand briefs, generated copy, palettes, images, and code files you produce in the Service. This is stored encrypted at rest.</li>
            <li><strong className="text-zinc-100">Usage data</strong> — IP address, browser type, pages visited, error logs, and credit-consumption events. We use this for security, billing, and product improvement.</li>
          </ul>
        </Section>

        <Section title="3. How We Use Your Information">
          <ul className="list-disc pl-6 space-y-2">
            <li>To operate, maintain, and improve the Service</li>
            <li>To process payments via Stripe (we never store card numbers ourselves)</li>
            <li>To send transactional emails (receipts, password resets, billing alerts)</li>
            <li>To respond to support requests</li>
            <li>To detect and prevent fraud, abuse, and security incidents</li>
          </ul>
        </Section>

        <Section title="4. Third-Party Processors">
          <p className="mb-3">We share limited information with the following third-party processors strictly for service delivery:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Supabase</strong> — authentication and user records</li>
            <li><strong>MongoDB Atlas</strong> — application data (projects, files, chat history)</li>
            <li><strong>Vercel</strong> — application hosting and edge networking</li>
            <li><strong>Stripe</strong> — payment processing</li>
            <li><strong>Anthropic, OpenAI, Google</strong> — AI inference for code, copy, and image generation. Prompt content is sent to these providers solely to generate the response you requested. We do not allow these providers to train models on your data.</li>
          </ul>
        </Section>

        <Section title="5. Your Content and IP">
          <p>You retain all rights to the content you create using {PRODUCT}. You grant us a limited license to store, process, and display that content solely for the purpose of operating the Service for you. We will not sell, license, or share your content with third parties for marketing purposes.</p>
        </Section>

        <Section title="6. Data Retention">
          <p>We retain your account information for as long as your account is active. You can delete projects, chat history, and your full account at any time from your account settings. Deleted data is permanently removed within 30 days from our active databases (backups may persist for up to 90 days for disaster recovery).</p>
        </Section>

        <Section title="7. Security">
          <p>We use industry-standard security practices including TLS encryption in transit, AES-256 encryption at rest, role-based access controls, and audit logging. No method of transmission over the Internet is 100% secure, however, and we cannot guarantee absolute security.</p>
        </Section>

        <Section title="8. Your Rights">
          <p className="mb-3">Depending on your jurisdiction (GDPR, CCPA, etc.) you may have the right to:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Access the personal data we hold about you</li>
            <li>Request correction or deletion of that data</li>
            <li>Object to or restrict certain processing</li>
            <li>Receive a portable copy of your data</li>
            <li>Withdraw consent at any time</li>
          </ul>
          <p className="mt-3">To exercise any of these rights, email <a href={`mailto:${CONTACT_EMAIL}`} className="text-cyan-400 hover:underline">{CONTACT_EMAIL}</a>.</p>
        </Section>

        <Section title="9. Children">
          <p>The Service is not directed to children under 13 years of age, and we do not knowingly collect personal information from children. If you believe a child has provided us their information, please contact us and we will promptly delete it.</p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. Material changes will be communicated via email or in-product notice at least 7 days before they take effect. The "Last updated" date at the top reflects the most recent revision.</p>
        </Section>

        <Section title="11. Contact">
          <p>Questions about this policy? Email <a href={`mailto:${CONTACT_EMAIL}`} className="text-cyan-400 hover:underline">{CONTACT_EMAIL}</a>.</p>
        </Section>

        <div className="mt-16 pt-8 border-t border-zinc-800 text-sm text-zinc-500 flex items-center justify-between">
          <a href="/terms" className="hover:text-zinc-300 transition">Terms of Service</a>
          <span>© {new Date().getFullYear()} {COMPANY}</span>
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-zinc-100 mb-3">{title}</h2>
      <div className="text-zinc-300 leading-relaxed">{children}</div>
    </section>
  )
}
