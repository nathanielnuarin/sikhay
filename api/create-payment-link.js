// POST /api/create-payment-link
// Creates a PayMongo payment link and returns the checkout URL.
// Body: { userId: string, email: string, plan: 'monthly' | 'yearly' }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { userId, email, plan } = req.body || {}
  if (!userId || !plan) return res.status(400).json({ error: 'Missing userId or plan' })

  // Amounts in centavos (1 PHP = 100 centavos)
  const amount = plan === 'yearly' ? 449000 : 49900  // ₱4,490 or ₱499

  const authHeader = 'Basic ' + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')

  try {
    const pmRes = await fetch('https://api.paymongo.com/v1/links', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount,
            description: 'Sikhay System — ' + (plan === 'yearly' ? 'Annual' : 'Monthly') + ' Subscription',
            remarks: userId  // stored here so webhook can identify the user
          }
        }
      })
    })

    const pmData = await pmRes.json()

    if (!pmRes.ok) {
      console.error('PayMongo error:', JSON.stringify(pmData))
      return res.status(502).json({ error: pmData.errors?.[0]?.detail || 'PayMongo error' })
    }

    const checkoutUrl = pmData.data?.attributes?.checkout_url
    if (!checkoutUrl) return res.status(502).json({ error: 'No checkout URL returned' })

    // Tell PayMongo to redirect back to our upgrade page after payment
    res.status(200).json({ url: checkoutUrl })

  } catch (e) {
    console.error('create-payment-link error:', e)
    res.status(500).json({ error: e.message })
  }
}
