'use client'

import { useState } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Gift, CheckCircle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function PromoRedeemDialog({ open, onOpenChange, onSuccess }) {
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [success, setSuccess] = useState(false)
  const { toast } = useToast()

  const redeemCode = async () => {
    if (!code.trim()) return
    setRedeeming(true)
    try {
      const r = await authFetch('/api/promo/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() })
      })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.error || 'Failed to redeem code')
      }
      const result = await r.json()
      setSuccess(true)
      toast({ 
        title: 'Promo Code Redeemed!', 
        description: `You now have ${result.plan === 'unlimited' ? 'unlimited' : result.plan} credits!`
      })
      setTimeout(() => {
        setSuccess(false)
        setCode('')
        onOpenChange(false)
        if (onSuccess) onSuccess(result)
      }, 2000)
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' })
    } finally {
      setRedeeming(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !redeeming && code.trim()) {
      redeemCode()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-amber-400" />
            Redeem Promo Code
          </DialogTitle>
          <DialogDescription>
            Enter your promo code to unlock unlimited credits
          </DialogDescription>
        </DialogHeader>
        
        {success ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-emerald-400">Code redeemed successfully!</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Input
              type="text"
              placeholder="Enter promo code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              className="font-mono text-center text-lg tracking-wider"
              maxLength={20}
              autoFocus
            />
            <Button 
              onClick={redeemCode} 
              disabled={redeeming || !code.trim()}
              className="w-full"
            >
              {redeeming ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Redeeming...
                </>
              ) : (
                'Redeem Code'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
