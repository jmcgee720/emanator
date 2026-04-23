import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'

export const metadata = {
  title: 'Emanator — AI Builder Platform',
  description: 'Build websites, apps, and more with AI',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);window.addEventListener("unhandledrejection",function(e){if(e.reason&&e.reason.name==="AbortError"&&e.reason.message&&e.reason.message.includes("lock")){e.preventDefault();console.warn("[Auth] Suppressed lock AbortError")}});'}} />
      </head>
      <body className="min-h-screen antialiased" style={{ background: 'transparent' }}>
        {children}
        <Toaster />
        {/* Vercel Analytics + Speed Insights — no-op outside Vercel. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
