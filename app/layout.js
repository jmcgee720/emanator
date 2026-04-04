import './globals.css'
import { Toaster } from '@/components/ui/toaster'

export const metadata = {
  title: 'Emanator — AI Builder Platform',
  description: 'Build websites, apps, and more with AI',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
      </head>
      <body className="min-h-screen antialiased" style={{ background: 'transparent' }}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
