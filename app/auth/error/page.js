'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react'
import Link from 'next/link'

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error') || 'An unknown error occurred'

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <CardTitle>Authentication Error</CardTitle>
          <CardDescription>There was a problem with your authentication</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg bg-muted text-sm text-muted-foreground">
            {error}
          </div>
          
          <div className="flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link href="/">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Login
              </Link>
            </Button>
            <Button variant="outline" asChild className="w-full">
              <Link href="/">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Link>
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            If this problem persists, please contact the administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    }>
      <AuthErrorContent />
    </Suspense>
  )
}
