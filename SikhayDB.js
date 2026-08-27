// SikhayDB.js — Firebase-backed offline-first data layer for Sikhay Creatives
// Depends on: config.js (FIREBASE_CONFIG + preloads Firebase compat SDK)

class SikhayDB {
  constructor() {
    this._app     = null
    this._auth    = null
    this._db      = null
    this._user    = null
    this._pending = JSON.parse(localStorage.getItem('sikhay_pending_sync') || '[]')
    window.addEventListener('online', () => this._flushPending())
  }

  // ── FIREBASE INIT ─────────────────────────────────────────────

  async _ensureFirebase() {
    if (this._db) return true
    await this._waitForFirebase()
    if (typeof firebase === 'undefined' || typeof FIREBASE_CONFIG === 'undefined') return false
    if (!firebase.apps.length) {
      this._app = firebase.initializeApp(FIREBASE_CONFIG)
    } else {
      this._app = firebase.app()
    }
    this._auth = firebase.auth()
    this._db   = firebase.firestore()
    return true
  }

  _waitForFirebase() {
    return new Promise(resolve => {
      if (typeof firebase !== 'undefined' && firebase.auth && firebase.firestore) {
        resolve(); return
      }
      const iv = setInterval(() => {
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.firestore) {
          clearInterval(iv); resolve()
        }
      }, 50)
      setTimeout(() => { clearInterval(iv); resolve() }, 12000)
    })
  }

  // ── AUTH ──────────────────────────────────────────────────────

  static async requireAuth() {
    const db = new SikhayDB()
    const ok = await db._ensureFirebase()
    if (!ok) return db  // no Firebase configured — local-only mode

    return new Promise(resolve => {
      const unsub = db._auth.onAuthStateChanged(user => {
        unsub()
        if (user) {
          db._user = user
          resolve(db)
        } else {
          window.location.href = 'login.html'
          resolve(null)
        }
      })
    })
  }

  async getSession() {
    if (!this._auth) return null
    return this._auth.currentUser
  }

  async signIn(email, password) {
    const ok = await this._ensureFirebase()
    if (!ok) throw new Error('Firebase not configured')
    const cred = await this._auth.signInWithEmailAndPassword(email, password)
    this._user = cred.user
    return cred.user
  }

  async signOut() {
    if (this._auth) await this._auth.signOut()
    window.location.href = 'login.html'
  }

  async getCurrentUser() {
    if (!this._auth) return null
    return this._auth.currentUser
  }

  // ── INTERNAL ──────────────────────────────────────────────────

  _lsRead(key, def) {
    try { return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(def)) }
    catch(e) { return def }
  }

  _lsWrite(key, val) { localStorage.setItem(key, JSON.stringify(val)) }

  // Returns Firestore CollectionReference under /users/{uid}/{col}
  _col(col) {
    if (!this._db || !this._user) return null
    return this._db.collection('users').doc(this._user.uid).collection(col)
  }

  async _fetchAll(col) {
    const ref = this._col(col)
    if (!ref) return null
    try {
      const snap = await ref.get()
      return snap.docs.map(d => d.data().data).filter(Boolean)
    } catch(e) { return null }
  }

  async _fetchMap(col, pkProp) {
    const rows = await this._fetchAll(col)
    if (rows === null) return null
    const map = {}
    rows.forEach(r => { if (r[pkProp]) map[r[pkProp]] = r })
    return map
  }

  async _fetchSingleton(col, docId) {
    const ref = this._col(col)
    if (!ref) return null
    try {
      const snap = await ref.doc(docId).get()
      return snap.exists ? (snap.data().data ?? null) : null
    } catch(e) { return null }
  }

  async _upsert(col, pkProp, record) {
    const ref = this._col(col)
    if (!ref) { this._queuePending({ col, pkProp, record }); return }
    try {
      await ref.doc(String(record[pkProp])).set({
        data:      record,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      })
    } catch(e) { this._queuePending({ col, pkProp, record }) }
  }

  async _upsertSingleton(col, docId, docData) {
    const ref = this._col(col)
    if (!ref) { this._pending.push({ _type: 'singleton', col, docId, docData, ts: Date.now() }); this._lsWrite('sikhay_pending_sync', this._pending); return }
    try {
      await ref.doc(docId).set({
        data:      docData,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      })
    } catch(e) {
      this._pending.push({ _type: 'singleton', col, docId, docData, ts: Date.now() })
      this._lsWrite('sikhay_pending_sync', this._pending)
    }
  }

  _queuePending(item) {
    this._pending.push({ ...item, ts: Date.now() })
    this._lsWrite('sikhay_pending_sync', this._pending)
  }

  async _flushPending() {
    const q = [...this._pending]
    this._pending = []
    this._lsWrite('sikhay_pending_sync', [])
    for (const item of q) {
      if (item._type === 'singleton') {
        await this._upsertSingleton(item.col, item.docId, item.docData)
      } else {
        await this._upsert(item.col, item.pkProp, item.record)
      }
    }
  }

  // ── ORDERS ────────────────────────────────────────────────────

  async getOrders() {
    const cloud = await this._fetchAll('orders')
    if (cloud !== null) { this._lsWrite('sikhay_ot_v1', cloud); return cloud }
    return this._lsRead('sikhay_ot_v1', [])
  }

  async saveOrder(order) {
    const list = this._lsRead('sikhay_ot_v1', [])
    const idx  = list.findIndex(o => o.id === order.id)
    if (idx >= 0) list[idx] = order; else list.unshift(order)
    this._lsWrite('sikhay_ot_v1', list)
    await this._upsert('orders', 'id', order)
  }

  async saveOrders(list) {
    this._lsWrite('sikhay_ot_v1', list)
    for (const order of list) await this._upsert('orders', 'id', order)
  }

  async deleteOrderById(id) {
    const list = this._lsRead('sikhay_ot_v1', []).filter(o => o.id !== id)
    this._lsWrite('sikhay_ot_v1', list)
    const ref = this._col('orders')
    if (ref) { try { await ref.doc(String(id)).delete() } catch(e) {} }
  }

  async updateOrder(id, fields) {
    const list = this._lsRead('sikhay_ot_v1', [])
    const idx  = list.findIndex(o => o.id === id)
    if (idx < 0) return
    Object.assign(list[idx], fields)
    this._lsWrite('sikhay_ot_v1', list)
    await this._upsert('orders', 'id', list[idx])
  }

  // ── DESIGNS ───────────────────────────────────────────────────

  async getDesigns() {
    const cloud = await this._fetchAll('designs')
    if (cloud !== null) { this._lsWrite('sikhay_dt_v1', cloud); return cloud }
    return this._lsRead('sikhay_dt_v1', [])
  }

  async saveDesign(design) {
    const list = this._lsRead('sikhay_dt_v1', [])
    const idx  = list.findIndex(d => d.id === design.id)
    if (idx >= 0) list[idx] = design; else list.unshift(design)
    this._lsWrite('sikhay_dt_v1', list)
    await this._upsert('designs', 'id', design)
  }

  async saveDesigns(list) {
    this._lsWrite('sikhay_dt_v1', list)
    for (const d of list) await this._upsert('designs', 'id', d)
  }

  async deleteDesignById(id) {
    const list = this._lsRead('sikhay_dt_v1', []).filter(d => d.id !== id)
    this._lsWrite('sikhay_dt_v1', list)
    const ref = this._col('designs')
    if (ref) { try { await ref.doc(String(id)).delete() } catch(e) {} }
  }

  // ── PRODUCTION ────────────────────────────────────────────────

  async getProduction() {
    const cloud = await this._fetchMap('production', 'orderId')
    if (cloud !== null) {
      const map = {}
      Object.entries(cloud).forEach(([k, v]) => {
        const { orderId, ...checklist } = v
        map[k] = checklist
      })
      this._lsWrite('sikhay_pc_v1', map)
      return map
    }
    return this._lsRead('sikhay_pc_v1', {})
  }

  async saveProduction(orderId, checklist) {
    const all = this._lsRead('sikhay_pc_v1', {})
    all[orderId] = checklist
    this._lsWrite('sikhay_pc_v1', all)
    await this._upsert('production', 'orderId', { orderId, ...checklist })
  }

  // ── DELIVERIES ────────────────────────────────────────────────

  async getDeliveries() {
    const cloud = await this._fetchAll('deliveries')
    if (cloud !== null) { this._lsWrite('sikhay_dlv_v1', cloud); return cloud }
    return this._lsRead('sikhay_dlv_v1', [])
  }

  async saveDelivery(dlv) {
    const list = this._lsRead('sikhay_dlv_v1', [])
    const idx  = list.findIndex(d => d.orderId === dlv.orderId)
    if (idx >= 0) list[idx] = dlv; else list.push(dlv)
    this._lsWrite('sikhay_dlv_v1', list)
    await this._upsert('deliveries', 'orderId', dlv)
  }

  // ── AFTER-SALES ───────────────────────────────────────────────

  async getAfterSales() {
    const cloud = await this._fetchAll('aftersales')
    if (cloud !== null) { this._lsWrite('sikhay_as_v1', cloud); return cloud }
    return this._lsRead('sikhay_as_v1', [])
  }

  async saveAfterSales(rec) {
    const list = this._lsRead('sikhay_as_v1', [])
    const idx  = list.findIndex(r => r.orderId === rec.orderId)
    if (idx >= 0) list[idx] = rec; else list.push(rec)
    this._lsWrite('sikhay_as_v1', list)
    await this._upsert('aftersales', 'orderId', rec)
  }

  // ── FINANCE ───────────────────────────────────────────────────

  async getFinance() {
    const cloud = await this._fetchSingleton('singletons', 'finance')
    if (cloud !== null) { this._lsWrite('sikhay_fin_v1', cloud); return cloud }
    return this._lsRead('sikhay_fin_v1', { expenses: [], orderCosts: [] })
  }

  async saveFinance(fin) {
    this._lsWrite('sikhay_fin_v1', fin)
    await this._upsertSingleton('singletons', 'finance', fin)
  }

  // ── HR ────────────────────────────────────────────────────────

  async getHR() {
    const cloud = await this._fetchSingleton('singletons', 'hr')
    if (cloud !== null) { this._lsWrite('sikhay_hr_v1', cloud); return cloud }
    return this._lsRead('sikhay_hr_v1', { employees: [], payrolls: [] })
  }

  async saveHR(hr) {
    this._lsWrite('sikhay_hr_v1', hr)
    await this._upsertSingleton('singletons', 'hr', hr)
  }

  // ── CRM ───────────────────────────────────────────────────────

  async getCRM() {
    const cloud = await this._fetchSingleton('singletons', 'crm')
    if (cloud !== null) { this._lsWrite('sikhay_crm_v1', cloud); return cloud }
    return this._lsRead('sikhay_crm_v1', { leads: [], clients: [] })
  }

  async saveCRM(crm) {
    this._lsWrite('sikhay_crm_v1', crm)
    await this._upsertSingleton('singletons', 'crm', crm)
  }

  // ── INVOICE DOCS ──────────────────────────────────────────────

  async getInvoiceDocs() {
    const cloud = await this._fetchSingleton('singletons', 'invoiceDocs')
    if (cloud !== null) { this._lsWrite('sikhay_docs_v2', cloud); return cloud }
    return this._lsRead('sikhay_docs_v2', [])
  }

  async saveInvoiceDocs(data) {
    this._lsWrite('sikhay_docs_v2', data)
    await this._upsertSingleton('singletons', 'invoiceDocs', data)
  }

  // ── DRAFT ORDERS ──────────────────────────────────────────────

  async getDraftOrders() {
    const cloud = await this._fetchAll('draftOrders')
    if (cloud !== null) { this._lsWrite('sikhay_drafts_v1', cloud); return cloud }
    return this._lsRead('sikhay_drafts_v1', [])
  }

  async saveDraftOrder(draft) {
    const list = this._lsRead('sikhay_drafts_v1', [])
    const idx  = list.findIndex(d => d.id === draft.id)
    if (idx >= 0) list[idx] = draft; else list.unshift(draft)
    this._lsWrite('sikhay_drafts_v1', list)
    await this._upsert('draftOrders', 'id', draft)
  }

  async deleteDraftOrder(id) {
    const list = this._lsRead('sikhay_drafts_v1', []).filter(d => d.id !== id)
    this._lsWrite('sikhay_drafts_v1', list)
    const ref = this._col('draftOrders')
    if (ref) { try { await ref.doc(String(id)).delete() } catch(e) {} }
  }

  // ── CLOUD MIGRATION ───────────────────────────────────────────
  // One-time push of all localStorage data to Firestore

  async migrateLocalToCloud(onProgress) {
    const report = { orders: 0, designs: 0, production: 0, deliveries: 0, aftersales: 0, finance: false, hr: false, draftOrders: 0 }
    const prog = (msg) => { if (onProgress) onProgress(msg) }

    const orders = this._lsRead('sikhay_ot_v1', [])
    prog(`Uploading ${orders.length} orders…`)
    for (const o of orders) { await this._upsert('orders', 'id', o); report.orders++ }

    const designs = this._lsRead('sikhay_dt_v1', [])
    prog(`Uploading ${designs.length} designs…`)
    for (const d of designs) { await this._upsert('designs', 'id', d); report.designs++ }

    const production = this._lsRead('sikhay_pc_v1', {})
    const prodEntries = Object.entries(production)
    prog(`Uploading ${prodEntries.length} production records…`)
    for (const [orderId, checklist] of prodEntries) {
      await this._upsert('production', 'orderId', { orderId, ...checklist }); report.production++
    }

    const deliveries = this._lsRead('sikhay_dlv_v1', [])
    prog(`Uploading ${deliveries.length} deliveries…`)
    for (const d of deliveries) { await this._upsert('deliveries', 'orderId', d); report.deliveries++ }

    const aftersales = this._lsRead('sikhay_as_v1', [])
    prog(`Uploading ${aftersales.length} after-sales records…`)
    for (const a of aftersales) { await this._upsert('aftersales', 'orderId', a); report.aftersales++ }

    const finance = this._lsRead('sikhay_fin_v1', null)
    if (finance) { prog('Uploading finance data…'); await this._upsertSingleton('singletons', 'finance', finance); report.finance = true }

    const hr = this._lsRead('sikhay_hr_v1', null)
    if (hr) { prog('Uploading HR data…'); await this._upsertSingleton('singletons', 'hr', hr); report.hr = true }

    const drafts = this._lsRead('sikhay_drafts_v1', [])
    prog(`Uploading ${drafts.length} draft orders…`)
    for (const d of drafts) { await this._upsert('draftOrders', 'id', d); report.draftOrders++ }

    const crm = this._lsRead('sikhay_crm_v1', null)
    if (crm) { prog('Uploading CRM data…'); await this._upsertSingleton('singletons', 'crm', crm); report.crm = true }

    const invDocs = this._lsRead('sikhay_docs_v2', null)
    if (invDocs) { prog('Uploading invoice docs…'); await this._upsertSingleton('singletons', 'invoiceDocs', invDocs); report.invoiceDocs = true }

    localStorage.setItem('sikhay_cloud_synced', '1')
    prog('Done!')
    return report
  }
}
