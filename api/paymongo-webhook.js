// POST /api/paymongo-webhook
// Receives PayMongo payment events and activates subscriptions in Supabase.
// Configure this URL in PayMongo Dashboard → Webhooks.

const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

// Vercel streams raw body — we need it for signature verification
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // ── Signature verification ───────────────────────────────────
  // PayMongo-Signature format: "t=TIMESTAMP,te=HMAC_TEST,li=HMAC_LIVE"
  const sigHeader = req.headers['paymongo-signature'] || ''
  const parts     = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')))
  const timestamp = parts.t
  const hmacKey   = parts.li || parts.te  // live key preferred, fall back to test

  if (timestamp && hmacKey && process.env.PAYMONGO_WEBHOOK_SECRET) {
    const payload  = timestamp + '.' + JSON.stringify(req.body)
    const expected = crypto
      .createHmac('sha256', process.env.PAYMONGO_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex')

    if (hmacKey !== expected) {
      console.warn('PayMongo webhook: invalid signature')
      return res.status(401).json({ error: 'Invalid signature' })
    }
  }

  // ── Handle event ─────────────────────────────────────────────
  const event = req.body?.data
  const type  = event?.attributes?.type

  console.log('PayMongo webhook event:', type)

  if (type === 'payment.paid' || type === 'link.payment.paid') {
    // userId was stored in the payment link's `remarks` field
    const userId = event?.attributes?.data?.attributes?.remarks

    if (userId) {
      const sb = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )

      const { error } = await sb
        .from('profiles')
        .update({
          plan:                'active',
          subscription_status: 'active',
          paymongo_sub_id:     event.id,
          updated_at:          new Date().toISOString()
        })
        .eq('user_id', userId)

      if (error) {
        console.error('Supabase update error:', error)
        return res.status(500).json({ error: 'Database update failed' })
      }

      console.log('Subscription activated for user:', userId)
    }
  }

  res.status(200).json({ received: true })
}
