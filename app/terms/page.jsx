/**
 * Terms of Service — public-facing page accessible to anyone.
 *
 * As with the Privacy Policy, this is intentionally a static JSX layout
 * because the terms need human review and version tracking. Update
 * LAST_UPDATED whenever the text changes.
 */
const LAST_UPDATED = 'May 5, 2026'
const COMPANY = 'Aetherly Studio LLC'
const PRODUCT = 'Auroraly'
const CONTACT_EMAIL = 'support@auroraly.co'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-3xl mx-auto px-6 py-16 lg:py-24">
        <a href="/" className="text-sm text-zinc-400 hover:text-zinc-200 transition" data-testid="terms-home-link">← Back to Auroraly</a>
        <h1 className="text-4xl font-bold mt-6 mb-3" style={{ fontFamily: 'Fraunces, serif' }} data-testid="terms-title">Terms of Service</h1>
        <p className="text-sm text-zinc-400 mb-12">Last updated: {LAST_UPDATED}</p>

        <Section title="1. Acceptance of Terms">
          <p>By accessing or using {PRODUCT} (the "Service") provided by {COMPANY} ("we", "us", "our"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
        </Section>

        <Section title="2. Eligibility">
          <p>You must be at least 13 years old to use the Service. If you use the Service on behalf of an organization, you represent that you have authority to bind that organization to these Terms.</p>
        </Section>

        <Section title="3. Account Registration">
          <p>You are responsible for maintaining the confidentiality of your login credentials. You are responsible for all activity that occurs under your account. Notify us immediately at <a href={`mailto:${CONTACT_EMAIL}`} className="text-cyan-400 hover:underline">{CONTACT_EMAIL}</a> if you suspect unauthorized access.</p>
        </Section>

        <Section title="4. Credits and Payments">
          <ul className="list-disc pl-6 space-y-2">
            <li>The Service uses a credit-based model. Credits are consumed when AI features are invoked (chat messages, image generation, builds).</li>
            <li>Credits are sold in packages via Stripe. All purchases are final and non-refundable except where required by law.</li>
            <li>Credit prices are listed at /pricing. We may change prices with 30 days notice; previously purchased credits retain their original purchasing power.</li>
            <li>Unused credits do not expire as long as your account remains active.</li>
          </ul>
        </Section>

        <Section title="5. Acceptable Use">
          <p className="mb-3">You agree NOT to use the Service to:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Generate content that is illegal, defamatory, harassing, threatening, or violates the rights of others</li>
            <li>Generate spam, phishing pages, malware, or fraudulent content</li>
            <li>Generate content that infringes copyright, trademark, or other IP rights</li>
            <li>Generate content depicting minors in sexual or violent contexts</li>
            <li>Reverse engineer, decompile, or attempt to extract our source code or models</li>
            <li>Resell access to the Service without an explicit reseller agreement</li>
            <li>Circumvent rate limits, credit deductions, or other technical restrictions</li>
          </ul>
          <p className="mt-3">We reserve the right to suspend or terminate accounts that violate these rules and to delete content that violates them.</p>
        </Section>

        <Section title="6. User Content and Ownership">
          <p>You retain all rights to the brand briefs, generated copy, images, and code files you create using the Service. You grant us a limited, non-exclusive license to host, store, and display this content solely for the purpose of operating the Service for you.</p>
          <p className="mt-3">AI-generated content is provided "as-is" — generative models can produce inaccurate, biased, or unintended output. You are responsible for reviewing output before deploying it commercially. {PRODUCT} makes no warranty that generated content is original, accurate, or fit for a particular purpose.</p>
        </Section>

        <Section title="7. Intellectual Property">
          <p>The Service, including all software, design, branding, and documentation, is owned by {COMPANY} and protected by copyright, trademark, and other laws. You may not copy, modify, or create derivative works of the Service itself without our written permission.</p>
        </Section>

        <Section title="8. Third-Party Services">
          <p>The Service relies on third-party providers (Anthropic, OpenAI, Google, Stripe, Supabase, MongoDB Atlas, Vercel) to function. Outages or changes by those providers may affect the Service. We are not liable for third-party outages or changes outside our control.</p>
        </Section>

        <Section title="9. Termination">
          <p>You may delete your account at any time from account settings. We may suspend or terminate your account if you violate these Terms, with or without notice depending on severity. On termination, your right to use the Service ceases. Sections 4 (payments), 6 (content ownership), 10 (warranty disclaimer), and 11 (liability) survive termination.</p>
        </Section>

        <Section title="10. Disclaimers">
          <p className="uppercase tracking-wide text-sm">The Service is provided "AS IS" and "AS AVAILABLE" without warranty of any kind, whether express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components.</p>
        </Section>

        <Section title="11. Limitation of Liability">
          <p className="uppercase tracking-wide text-sm">To the maximum extent permitted by law, {COMPANY.toUpperCase()} SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM OR RELATING TO THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM.</p>
        </Section>

        <Section title="12. Indemnification">
          <p>You agree to indemnify and hold {COMPANY} harmless from claims, damages, and expenses (including reasonable attorneys' fees) arising from your violation of these Terms or your use of the Service in violation of any law or third-party right.</p>
        </Section>

        <Section title="13. Governing Law">
          <p>These Terms are governed by the laws of the State of New York, USA, without regard to conflict-of-law principles. Disputes will be resolved in the state or federal courts located in New York County, New York.</p>
        </Section>

        <Section title="14. Changes to These Terms">
          <p>We may update these Terms from time to time. Material changes will be communicated via email or in-product notice at least 7 days before they take effect. Continued use of the Service after changes constitutes acceptance.</p>
        </Section>

        <Section title="15. Contact">
          <p>Questions? Email <a href={`mailto:${CONTACT_EMAIL}`} className="text-cyan-400 hover:underline">{CONTACT_EMAIL}</a>.</p>
        </Section>

        <div className="mt-16 pt-8 border-t border-zinc-800 text-sm text-zinc-500 flex items-center justify-between">
          <a href="/privacy" className="hover:text-zinc-300 transition">Privacy Policy</a>
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
