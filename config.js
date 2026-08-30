// config.js — Supabase configuration for Sikhay Creatives

const SUPABASE_URL      = 'https://wqjaoktmgjuytmtxuxwb.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_tLdlIFXJIXCRwkt8bbFt3w_TwpJLA0e'

// Preload Supabase SDK as early as possible so SikhayDB finds it ready
;(function () {
  const src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
  if (!document.querySelector(`script[src="${src}"]`)) {
    const s = document.createElement('script')
    s.src   = src
    document.head.appendChild(s)
  }
})()
