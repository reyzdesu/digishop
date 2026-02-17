/*
 *  DigiShop — Digital Product Store
 *  Produk: AM, Premium, CapCut, Canva, dll
 *  Stok: email:password atau email saja
 *  Bot Telegram: addproduk, addstock, liststok, delproduk
 *  Payment: QRIS via Pakasir
 */

require('dotenv').config()
const express = require('express')
const cors = require('cors')
const fetch = require('node-fetch')
const path = require('path')
const { v4: uuid } = require('uuid')
const TelegramBot = require('node-telegram-bot-api')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static('public'))

// ─── IN-MEMORY DATABASE ───────────────────────────────────────────────────────
// products: { productId: { name, description, duration, durationType, price, emoji, createdAt } }
// stocks:   { productId: [ { id, credential, used, usedAt, orderId } ] }
// orders:   { orderId: { ... } }

let products = {}
let stocks = {}
let orders = {}

// ─── TELEGRAM BOT ─────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.telegramToken
const ADMIN_ID = process.env.telegramAdminId  // chat ID admin yang boleh manage

let bot
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true })
  setupBot()
}

function isAdmin(chatId) {
  return String(chatId) === String(ADMIN_ID)
}

function sendMsg(chatId, text, opts = {}) {
  if (!bot) return
  bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...opts }).catch(() => {})
}

function notifyAdmin(text) {
  if (ADMIN_ID) sendMsg(ADMIN_ID, text)
}

function setupBot() {
  // ── /start ──────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, (msg) => {
    const isAdm = isAdmin(msg.chat.id)
    sendMsg(msg.chat.id,
      `🛒 <b>DigiShop Bot</b>\n\n` +
      (isAdm ? `👑 Mode Admin aktif\n\n` +
        `<b>📦 Produk:</b>\n` +
        `/addproduk — Tambah produk baru\n` +
        `/listproduk — Lihat semua produk\n` +
        `/delproduk [id] — Hapus produk\n` +
        `/editproduk — Edit harga/nama produk\n\n` +
        `<b>📬 Stok:</b>\n` +
        `/addstock [id] [kredensial] — Tambah 1 stok\n` +
        `/bulkstock [id] — Tambah banyak stok (lanjut di next msg)\n` +
        `/liststok [id] — Lihat stok tersisa\n` +
        `/statsstok — Ringkasan semua stok\n\n` +
        `<b>📊 Order:</b>\n` +
        `/listorder — 10 order terakhir\n\n` +
        `Format addstock:\n` +
        `• Dengan password: <code>email:password</code>\n` +
        `• Email only: <code>email@gmail.com</code>`
        : `Kunjungi website kami untuk beli produk!`)
    )
  })

  // ── /addproduk ───────────────────────────────────────────────────────────────
  bot.onText(/\/addproduk/, (msg) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const id = uuid().slice(0, 8)
    userState[msg.chat.id] = { step: 'addprod_name', prodId: id }
    sendMsg(msg.chat.id,
      `➕ <b>Tambah Produk Baru</b>\nID otomatis: <code>${id}</code>\n\n` +
      `Kirim <b>nama produk</b>:\n` +
      `Contoh: <i>Netflix Premium 1 Bulan</i>`
    )
  })

  // ── /listproduk ──────────────────────────────────────────────────────────────
  bot.onText(/\/listproduk/, (msg) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const list = Object.entries(products)
    if (!list.length) return sendMsg(msg.chat.id, '📭 Belum ada produk.')
    let text = `📦 <b>Daftar Produk</b> (${list.length})\n\n`
    list.forEach(([id, p]) => {
      const stokCount = (stocks[id] || []).filter(s => !s.used).length
      text += `${p.emoji || '📦'} <b>${p.name}</b>\n`
      text += `   ID: <code>${id}</code>\n`
      text += `   💰 Rp ${p.price.toLocaleString()} · ⏱ ${p.duration} ${p.durationType}\n`
      text += `   📬 Stok tersisa: <b>${stokCount}</b>\n\n`
    })
    sendMsg(msg.chat.id, text)
  })

  // ── /delproduk ───────────────────────────────────────────────────────────────
  bot.onText(/\/delproduk (.+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const id = match[1].trim()
    if (!products[id]) return sendMsg(msg.chat.id, `❌ Produk <code>${id}</code> tidak ditemukan.`)
    const name = products[id].name
    delete products[id]
    delete stocks[id]
    sendMsg(msg.chat.id, `✅ Produk <b>${name}</b> berhasil dihapus.`)
  })

  // ── /editproduk ──────────────────────────────────────────────────────────────
  bot.onText(/\/editproduk/, (msg) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const list = Object.entries(products)
    if (!list.length) return sendMsg(msg.chat.id, '📭 Belum ada produk.')
    let text = `✏️ <b>Edit Produk</b>\n\nPilih produk yang ingin diedit:\n\n`
    list.forEach(([id, p]) => {
      text += `• <code>${id}</code> — ${p.emoji || '📦'} ${p.name}\n`
    })
    text += `\nBalas: <code>/editproduk [id] [field] [nilai]</code>\n`
    text += `Field: name, price, duration, description, emoji\n`
    text += `Contoh: <code>/editproduk abc123 price 25000</code>`
    sendMsg(msg.chat.id, text)
  })

  bot.onText(/\/editproduk (\S+) (\S+) (.+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const [, id, field, value] = match
    if (!products[id]) return sendMsg(msg.chat.id, `❌ Produk tidak ditemukan.`)
    if (!['name', 'price', 'duration', 'description', 'emoji'].includes(field))
      return sendMsg(msg.chat.id, `❌ Field tidak valid. Gunakan: name, price, duration, description, emoji`)
    if (field === 'price') products[id].price = parseInt(value)
    else if (field === 'duration') products[id].duration = parseInt(value)
    else products[id][field] = value
    sendMsg(msg.chat.id, `✅ Produk <b>${products[id].name}</b> diperbarui!\n<b>${field}</b> → <code>${value}</code>`)
  })

  // ── /addstock ────────────────────────────────────────────────────────────────
  bot.onText(/\/addstock (\S+) (.+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const [, prodId, credential] = match
    if (!products[prodId]) return sendMsg(msg.chat.id, `❌ Produk <code>${prodId}</code> tidak ditemukan.`)
    if (!stocks[prodId]) stocks[prodId] = []
    stocks[prodId].push({ id: uuid().slice(0, 8), credential: credential.trim(), used: false, usedAt: null, orderId: null })
    const total = stocks[prodId].filter(s => !s.used).length
    sendMsg(msg.chat.id,
      `✅ Stok ditambahkan ke <b>${products[prodId].name}</b>\n` +
      `📬 Stok tersisa sekarang: <b>${total}</b>\n` +
      `📝 Kredensial: <code>${credential.trim()}</code>`
    )
  })

  // ── /bulkstock ───────────────────────────────────────────────────────────────
  bot.onText(/\/bulkstock (.+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const prodId = match[1].trim()
    if (!products[prodId]) return sendMsg(msg.chat.id, `❌ Produk <code>${prodId}</code> tidak ditemukan.`)
    userState[msg.chat.id] = { step: 'bulkstock', prodId }
    sendMsg(msg.chat.id,
      `📋 <b>Bulk Add Stok</b> — <b>${products[prodId].name}</b>\n\n` +
      `Kirim semua kredensial dalam 1 pesan, pisah per baris:\n\n` +
      `<code>email1@gmail.com:password1\nemail2@gmail.com:password2\nemail3@gmail.com</code>\n\n` +
      `Bisa mix antara format email:pw dan email saja.`
    )
  })

  // ── /liststok ────────────────────────────────────────────────────────────────
  bot.onText(/\/liststok (.+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const prodId = match[1].trim()
    if (!products[prodId]) return sendMsg(msg.chat.id, `❌ Produk tidak ditemukan.`)
    const stok = (stocks[prodId] || []).filter(s => !s.used)
    if (!stok.length) return sendMsg(msg.chat.id, `📭 Stok <b>${products[prodId].name}</b> kosong!`)
    let text = `📬 <b>Stok ${products[prodId].name}</b> (${stok.length} tersisa)\n\n`
    stok.slice(0, 20).forEach((s, i) => {
      text += `${i + 1}. <code>${s.credential}</code>\n`
    })
    if (stok.length > 20) text += `\n... dan ${stok.length - 20} lainnya`
    sendMsg(msg.chat.id, text)
  })

  // ── /liststok semua ──────────────────────────────────────────────────────────
  bot.onText(/\/liststok$/, (msg) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    sendMsg(msg.chat.id, `Gunakan: /liststok [produk_id]\nContoh: /liststok abc123`)
  })

  // ── /statsstok ───────────────────────────────────────────────────────────────
  bot.onText(/\/statsstok/, (msg) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const list = Object.entries(products)
    if (!list.length) return sendMsg(msg.chat.id, '📭 Belum ada produk.')
    let text = `📊 <b>Statistik Stok</b>\n\n`
    let totalSold = 0
    list.forEach(([id, p]) => {
      const allStok = stocks[id] || []
      const available = allStok.filter(s => !s.used).length
      const sold = allStok.filter(s => s.used).length
      totalSold += sold
      const warn = available === 0 ? ' ⚠️ KOSONG' : available <= 3 ? ' ⚠️ HAMPIR HABIS' : ''
      text += `${p.emoji || '📦'} <b>${p.name}</b>${warn}\n`
      text += `   Tersisa: <b>${available}</b> · Terjual: ${sold}\n\n`
    })
    text += `💰 Total terjual: <b>${totalSold}</b> item`
    sendMsg(msg.chat.id, text)
  })

  // ── /listorder ───────────────────────────────────────────────────────────────
  bot.onText(/\/listorder/, (msg) => {
    if (!isAdmin(msg.chat.id)) return sendMsg(msg.chat.id, '❌ Bukan admin!')
    const list = Object.values(orders)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10)
    if (!list.length) return sendMsg(msg.chat.id, '📭 Belum ada order.')
    let text = `📋 <b>10 Order Terakhir</b>\n\n`
    list.forEach(o => {
      const statusEmoji = { pending: '⏳', completed: '✅', failed: '❌', canceled: '🚫' }[o.status] || '❓'
      text += `${statusEmoji} <code>${o.orderId}</code>\n`
      text += `   👤 ${o.buyerName} · ${o.productName}\n`
      text += `   💰 Rp ${o.amount.toLocaleString()} · ${new Date(o.createdAt).toLocaleString('id-ID')}\n\n`
    })
    sendMsg(msg.chat.id, text)
  })

  // ── State machine untuk flow multi-step ─────────────────────────────────────
  bot.on('message', (msg) => {
    const state = userState[msg.chat.id]
    if (!state || msg.text?.startsWith('/')) return

    // -- addproduk flow --
    if (state.step === 'addprod_name') {
      state.name = msg.text.trim()
      state.step = 'addprod_emoji'
      sendMsg(msg.chat.id, `✅ Nama: <b>${state.name}</b>\n\nKirim <b>emoji</b> untuk produk ini:\nContoh: 🎬 🎵 🖥️ 📱`)
      return
    }
    if (state.step === 'addprod_emoji') {
      state.emoji = msg.text.trim()
      state.step = 'addprod_desc'
      sendMsg(msg.chat.id, `✅ Emoji: ${state.emoji}\n\nKirim <b>deskripsi singkat</b> produk:`)
      return
    }
    if (state.step === 'addprod_desc') {
      state.description = msg.text.trim()
      state.step = 'addprod_duration'
      sendMsg(msg.chat.id, `✅ Deskripsi disimpan.\n\nKirim <b>durasi</b> (angka saja):\nContoh: <code>1</code> atau <code>30</code>`)
      return
    }
    if (state.step === 'addprod_duration') {
      const dur = parseInt(msg.text.trim())
      if (isNaN(dur) || dur <= 0) { sendMsg(msg.chat.id, '❌ Durasi harus angka positif!'); return }
      state.duration = dur
      state.step = 'addprod_durtype'
      sendMsg(msg.chat.id, `✅ Durasi: ${dur}\n\nKirim <b>satuan durasi</b>:\nKetik: <code>hari</code> / <code>bulan</code> / <code>tahun</code>`)
      return
    }
    if (state.step === 'addprod_durtype') {
      const dt = msg.text.trim().toLowerCase()
      if (!['hari', 'bulan', 'tahun'].includes(dt)) {
        sendMsg(msg.chat.id, '❌ Ketik: hari, bulan, atau tahun'); return
      }
      state.durationType = dt
      state.step = 'addprod_price'
      sendMsg(msg.chat.id, `✅ Durasi: ${state.duration} ${dt}\n\nKirim <b>harga</b> (angka, tanpa titik/koma):\nContoh: <code>15000</code>`)
      return
    }
    if (state.step === 'addprod_price') {
      const price = parseInt(msg.text.trim().replace(/\D/g, ''))
      if (isNaN(price) || price <= 0) { sendMsg(msg.chat.id, '❌ Harga harus angka positif!'); return }
      state.price = price
      // Simpan produk
      products[state.prodId] = {
        name: state.name,
        emoji: state.emoji,
        description: state.description,
        duration: state.duration,
        durationType: state.durationType,
        price: state.price,
        createdAt: Date.now()
      }
      stocks[state.prodId] = []
      delete userState[msg.chat.id]
      sendMsg(msg.chat.id,
        `🎉 <b>Produk berhasil ditambahkan!</b>\n\n` +
        `${state.emoji} <b>${state.name}</b>\n` +
        `📝 ${state.description}\n` +
        `⏱ ${state.duration} ${state.durationType}\n` +
        `💰 Rp ${state.price.toLocaleString()}\n` +
        `🆔 ID: <code>${state.prodId}</code>\n\n` +
        `Sekarang tambahkan stok:\n` +
        `/addstock ${state.prodId} email:password`
      )
      return
    }

    // -- bulkstock flow --
    if (state.step === 'bulkstock') {
      const lines = msg.text.trim().split('\n').map(l => l.trim()).filter(l => l)
      if (!lines.length) { sendMsg(msg.chat.id, '❌ Tidak ada data!'); return }
      if (!stocks[state.prodId]) stocks[state.prodId] = []
      let added = 0
      lines.forEach(line => {
        if (line) {
          stocks[state.prodId].push({ id: uuid().slice(0, 8), credential: line, used: false, usedAt: null, orderId: null })
          added++
        }
      })
      delete userState[msg.chat.id]
      const total = stocks[state.prodId].filter(s => !s.used).length
      sendMsg(msg.chat.id,
        `✅ <b>${added} stok</b> berhasil ditambahkan ke <b>${products[state.prodId].name}</b>\n` +
        `📬 Total tersisa: <b>${total}</b>`
      )
      return
    }
  })
}

// State per user untuk flow multi-step
const userState = {}

// ─── HELPER ───────────────────────────────────────────────────────────────────
async function sendTelegram(type, d) {
  if (!ADMIN_ID) return
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
  let msg = ''
  if (type === 'NEW_ORDER')
    msg = `🛒 <b>ORDER BARU</b>\n` +
          `🆔 <code>${d.orderId}</code>\n` +
          `👤 ${d.buyerName}\n` +
          `📦 ${d.productName}\n` +
          `⏱ ${d.duration} ${d.durationType}\n` +
          `💰 Rp ${d.amount.toLocaleString()}\n` +
          `🕐 ${time}`
  if (type === 'SUCCESS')
    msg = `✅ <b>PEMBAYARAN BERHASIL</b>\n` +
          `🆔 <code>${d.orderId}</code>\n` +
          `👤 ${d.buyerName}\n` +
          `📦 ${d.productName}\n` +
          `💰 Rp ${d.amount.toLocaleString()}\n` +
          `🕐 ${time}`
  if (type === 'STOK_HABIS')
    msg = `⚠️ <b>STOK HABIS!</b>\n` +
          `📦 ${d.productName}\n` +
          `Segera tambahkan stok: /addstock ${d.productId} email:pass`
  if (type === 'CANCELED')
    msg = `🚫 <b>ORDER DIBATALKAN</b>\n🆔 <code>${d.orderId}</code>`

  sendMsg(ADMIN_ID, msg)
}

async function sendTelegramToUser(chatId, text) {
  if (!bot || !chatId) return
  sendMsg(chatId, text)
}

// ─── PAKASIR PAYMENT ──────────────────────────────────────────────────────────
async function createQRIS(orderId, amount) {
  const res = await fetch('https://app.pakasir.com/api/transactioncreate/qris', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: process.env.pakasirSlug,
      order_id: orderId,
      amount,
      api_key: process.env.pakasirApiKey
    })
  })
  return res.json()
}

async function checkQRIS(orderId, amount) {
  const res = await fetch(
    `https://app.pakasir.com/api/transactiondetail?project=${process.env.pakasirSlug}&amount=${amount}&order_id=${orderId}&api_key=${process.env.pakasirApiKey}`
  )
  return res.json()
}

// ─── PROSES ORDER SUKSES ──────────────────────────────────────────────────────
async function processOrder(orderId) {
  const order = orders[orderId]
  if (!order || order.status === 'completed') return

  const productStocks = stocks[order.productId] || []
  const available = productStocks.find(s => !s.used)

  if (!available) {
    order.status = 'failed'
    order.error = 'Stok habis'
    sendTelegram('STOK_HABIS', { productName: order.productName, productId: order.productId })
    return
  }

  // Tandai stok terpakai
  available.used = true
  available.usedAt = Date.now()
  available.orderId = orderId

  order.status = 'completed'
  order.credential = available.credential
  order.completedAt = Date.now()

  // Hitung tanggal expired
  const expiredDate = new Date()
  if (order.durationType === 'hari') expiredDate.setDate(expiredDate.getDate() + order.duration)
  else if (order.durationType === 'bulan') expiredDate.setMonth(expiredDate.getMonth() + order.duration)
  else if (order.durationType === 'tahun') expiredDate.setFullYear(expiredDate.getFullYear() + order.duration)
  order.expiredAt = expiredDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

  sendTelegram('SUCCESS', order)

  // Cek sisa stok
  const remaining = productStocks.filter(s => !s.used).length
  if (remaining <= 3) sendTelegram('STOK_HABIS', { productName: order.productName, productId: order.productId })

  // Notif ke pembeli via Telegram kalau ada
  if (order.telegramId) {
    sendMsg(order.telegramId,
      `✅ <b>Pembayaran Berhasil!</b>\n\n` +
      `📦 <b>${order.productName}</b>\n` +
      `⏱ Berlaku hingga: <b>${order.expiredAt}</b>\n\n` +
      `🔑 <b>Akun kamu:</b>\n<code>${order.credential}</code>\n\n` +
      `Terima kasih sudah belanja! 🎉`
    )
  }
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// Halaman
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/home.html')))
app.get('/payment/:id', (req, res) => res.sendFile(path.join(__dirname, 'public/payment.html')))
app.get('/success/:id', (req, res) => res.sendFile(path.join(__dirname, 'public/success.html')))
app.get('/history', (req, res) => res.sendFile(path.join(__dirname, 'public/history.html')))

// Config untuk frontend
app.get('/api/config', (req, res) => {
  const pub = {}
  Object.entries(products).forEach(([id, p]) => {
    pub[id] = {
      ...p,
      stock: (stocks[id] || []).filter(s => !s.used).length
    }
  })
  res.json({
    products: pub,
    shopName: process.env.shopName || 'DigiShop',
    contacts: {
      wa: process.env.contactWa,
      tg: process.env.contactTg,
      ch: process.env.contactCh
    }
  })
})

// Buat order
app.post('/api/order', async (req, res) => {
  const { buyerName, productId, telegramId } = req.body
  if (!buyerName || buyerName.trim().length < 2)
    return res.status(400).json({ success: false, msg: 'Nama pembeli terlalu pendek (min 2 karakter)' })
  if (!products[productId])
    return res.status(400).json({ success: false, msg: 'Produk tidak ditemukan' })

  const stokAvail = (stocks[productId] || []).filter(s => !s.used).length
  if (stokAvail === 0)
    return res.status(400).json({ success: false, msg: 'Stok habis! Hubungi admin.' })

  const product = products[productId]
  const orderId = `DS-${Date.now()}-${Math.floor(Math.random() * 9999)}`

  try {
    const payData = await createQRIS(orderId, product.price)
    if (!payData.payment)
      return res.status(500).json({ success: false, msg: 'Gagal membuat QRIS. Coba lagi.' })

    orders[orderId] = {
      orderId,
      buyerName: buyerName.trim(),
      productId,
      productName: product.name,
      productEmoji: product.emoji,
      duration: product.duration,
      durationType: product.durationType,
      amount: product.price,
      status: 'pending',
      qrRaw: payData.payment.payment_number,
      telegramId: telegramId || null,
      createdAt: Date.now()
    }

    sendTelegram('NEW_ORDER', orders[orderId])
    res.json({ success: true, orderId })
  } catch (e) {
    res.status(500).json({ success: false, msg: 'Server error: ' + e.message })
  }
})

// Cek status order
app.get('/api/check/:id', async (req, res) => {
  const order = orders[req.params.id]
  if (!order) return res.json({ success: false, status: 'expired' })

  if (order.status === 'pending') {
    try {
      const json = await checkQRIS(order.orderId, order.amount)
      const status = (json.transaction?.status || json.status || '').toLowerCase()
      if (['paid', 'success', 'completed'].includes(status)) {
        await processOrder(order.orderId)
      }
    } catch {}
  }

  const o = orders[req.params.id]
  res.json({
    success: true,
    data: {
      orderId: o.orderId,
      buyerName: o.buyerName,
      productName: o.productName,
      productEmoji: o.productEmoji,
      duration: o.duration,
      durationType: o.durationType,
      amount: o.amount,
      status: o.status,
      qrRaw: o.qrRaw,
      credential: o.status === 'completed' ? o.credential : null,
      expiredAt: o.expiredAt || null,
      createdAt: o.createdAt
    }
  })
})

// Cancel order
app.post('/api/cancel', async (req, res) => {
  const { orderId } = req.body
  const order = orders[orderId]
  if (order && order.status === 'pending') {
    order.status = 'canceled'
    sendTelegram('CANCELED', order)
    try {
      await fetch('https://app.pakasir.com/api/transactioncancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: process.env.pakasirSlug,
          order_id: orderId,
          amount: order.amount,
          api_key: process.env.pakasirApiKey
        })
      })
    } catch {}
  }
  res.json({ success: true })
})

// Webhook Pakasir
app.post('/api/webhook/pakasir', async (req, res) => {
  const { order_id, status } = req.body
  if (orders[order_id] && ['paid', 'success', 'completed'].includes((status || '').toLowerCase())) {
    await processOrder(order_id)
  }
  res.json({ success: true })
})

// Cek order by ID (untuk history)
app.get('/api/order/:id', (req, res) => {
  const o = orders[req.params.id]
  if (!o) return res.json({ success: false })
  res.json({
    success: true,
    data: {
      orderId: o.orderId,
      buyerName: o.buyerName,
      productName: o.productName,
      productEmoji: o.productEmoji,
      duration: o.duration,
      durationType: o.durationType,
      amount: o.amount,
      status: o.status,
      credential: o.status === 'completed' ? o.credential : null,
      expiredAt: o.expiredAt || null,
      createdAt: o.createdAt
    }
  })
})

app.listen(PORT, () => console.log(`🚀 DigiShop running on port ${PORT}`))
