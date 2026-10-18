
<script setup>
import { ref, computed, watch } from 'vue'
import specs from './specs.json'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import pdfFontUrl from './assets/DejaVuSans.ttf?url'
import logo from '../public/icon-512.png'

const STORE = 'barforge-orders-v1'
const WEIGHTS = [2.5, 2, 1.5, 1]
const QUYMA_WEIGHTS = [0.5, 1, 2]
const BLIN_WEIGHTS = [2.5, 5, 7.5, 10, 15, 20]
// Change these defaults whenever necessary (UZS per kilogram).
const DEFAULT_STANDARD_PRICE = 10000
const DEFAULT_QUYMA_PRICE = 12000
const standardPrice = ref(DEFAULT_STANDARD_PRICE)
const quymaPrice = ref(DEFAULT_QUYMA_PRICE)
const fmt = n => Number(n || 0).toLocaleString('uz-UZ')
const validPrice = v => Number.isFinite(Number(v)) && Number(v) >= 0
// Older orders stored every single-piece weight as 'quyma'.
// Reclassify weights above 2 kg as Blin without changing the storage key.
const kindOf = x => {
  if (x.type === 'blin') return 'blin'
  if (x.type === 'quyma') return BLIN_WEIGHTS.includes(Number(x.weight)) ? 'blin' : 'quyma'
  return 'standard'
}
const keyOf = (type, weight) => `${type}:${weight}`


const view = ref('calculator')
const mode = ref('standard')
const search = ref('')
const specSearch = ref('')
const name = ref('')
const lines = ref([])
const saved = ref(loadSaved())
const notice = ref(null)

function loadSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE) || '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

watch(
  saved,
  value => {
    try {
      localStorage.setItem(STORE, JSON.stringify(value))
    } catch {
      notice.value = 'Ma’lumotlarni saqlashda xatolik yuz berdi.'
    }
  },
  { deep: true }
)

const filteredSpecs = computed(() =>
  specs.filter(s => String(s.weight).includes(specSearch.value.trim()))
)

const shtangaOptions = computed(() => [
  ...specs.map(s => ({ type: 'standard', weight: Number(s.weight), spec: s })),
  ...QUYMA_WEIGHTS.map(weight => ({ type: 'quyma', weight, spec: null }))
].filter(item => String(item.weight).includes(search.value.trim()))
 .sort((a, b) => b.weight - a.weight))

function normalizeItems(items = []) {
  return items
    .map(x => {
      const type = kindOf(x)
      const weight = Number(x.weight)
      const qty = validQty(x.qty)
      const spec = type === 'standard'
        ? specs.find(s => Number(s.weight) === weight)
        : null
      return { type, weight, qty, spec }
    })
    .filter(x => x.qty > 0 && (
      x.type === 'quyma' ? QUYMA_WEIGHTS.includes(x.weight)
      : x.type === 'blin' ? BLIN_WEIGHTS.includes(x.weight)
      : Boolean(x.spec)
    ))
}
const lineItems = computed(() => normalizeItems(lines.value))
const usedQuymaWeights = computed(() =>
  QUYMA_WEIGHTS.filter(w => lineItems.value.some(x => x.type === 'quyma' && x.weight === w))
)
const usedBlinWeights = computed(() =>
  BLIN_WEIGHTS.filter(w => lineItems.value.some(x => x.type === 'blin' && x.weight === w))
)

const barCount = computed(() =>
  lineItems.value.reduce((n, x) => n + x.qty, 0)
)

// JAMI SHTANGALAR OG‘IRLIGI
function calculateTotalWeight(items) {
  return items.reduce((total, item) => {
    return total + Number(item.weight) * Number(item.qty)
  }, 0)
}

function weightFor(items, type) {
  return calculateTotalWeight(normalizeItems(items).filter(x => x.type === type))
}
const standardWeight = computed(() => weightFor(lineItems.value, 'standard'))
const quymaWeight = computed(() => weightFor(lineItems.value, 'quyma'))
const shtangaWeight = computed(() => standardWeight.value + quymaWeight.value)
const blinWeight = computed(() => weightFor(lineItems.value, 'blin'))
const totalWeight = computed(() => shtangaWeight.value + blinWeight.value)
const standardAmount = computed(() => shtangaWeight.value * Number(standardPrice.value || 0))
const blinAmount = computed(() => blinWeight.value * Number(quymaPrice.value || 0))
const totalAmount = computed(() => standardAmount.value + blinAmount.value)

function calculate(items) {
  const totals = Object.fromEntries(
    WEIGHTS.map(w => [
      String(w),
      { regular: 0, threaded: 0 }
    ])
  )

  const rods = {}

  for (const item of items) {
    if (kindOf(item) !== 'standard') continue
    const spec = specs.find(
      s => Number(s.weight) === Number(item.weight)
    )

    const qty = Number(item.qty)

    if (!spec || !Number.isSafeInteger(qty) || qty <= 0) {
      continue
    }

    const smallest = Math.min(
      ...Object.keys(spec.parts).map(Number)
    )

    for (const [w, count] of Object.entries(spec.parts)) {
      const total = 2 * count * qty
      const threaded = Number(w) === smallest ? 2 * qty : 0

      totals[w].threaded += threaded
      totals[w].regular += total - threaded
    }

    rods[spec.length] = (rods[spec.length] || 0) + qty
  }

  return { totals, rods }
}

const result = computed(() => calculate(lineItems.value))

const totalRegular = computed(() =>
  Object.values(result.value.totals).reduce(
    (n, x) => n + x.regular,
    0
  )
)

const totalThreaded = computed(() =>
  Object.values(result.value.totals).reduce(
    (n, x) => n + x.threaded,
    0
  )
)

function validQty(v) {
  const n = Number(v)

  return Number.isFinite(n)
    ? Math.max(0, Math.min(1000000, Math.trunc(n)))
    : 0
}

function setQty(type, weight, value) {
  const qty = validQty(value)
  const found = lines.value.find(x => kindOf(x) === type && Number(x.weight) === Number(weight))
  if (found) found.qty = qty
  else if (qty) lines.value.push({ type, weight: Number(weight), qty })
}
function getQty(type, weight) {
  return lines.value.find(x => kindOf(x) === type && Number(x.weight) === Number(weight))?.qty || 0
}
function removeLine(type, weight) {
  lines.value = lines.value.filter(x => !(kindOf(x) === type && Number(x.weight) === Number(weight)))
}
function orderPrices(order) {
  return {
    standard: Number(order?.prices?.standard ?? DEFAULT_STANDARD_PRICE),
    blin: Number(order?.prices?.blin ?? order?.prices?.quyma ?? DEFAULT_QUYMA_PRICE)
  }
}
function orderAmount(order) {
  const prices = orderPrices(order)
  return (weightFor(order.lines, 'standard') + weightFor(order.lines, 'quyma')) * prices.standard
    + weightFor(order.lines, 'blin') * prices.blin
}

function clearOrder() {
  if (
    barCount.value &&
    !confirm('Joriy buyurtma tozalansinmi?')
  ) {
    return
  }

  lines.value = []
  standardPrice.value = DEFAULT_STANDARD_PRICE
  quymaPrice.value = DEFAULT_QUYMA_PRICE
  mode.value = 'standard'
  name.value = ''
  notice.value = ''
}

function saveOrder() {
  if (!barCount.value) return
  if (!validPrice(standardPrice.value) || !validPrice(quymaPrice.value)) {
    notice.value = 'Narxlar manfiy bo‘lmagan son bo‘lishi kerak.'
    return
  }

  saved.value.unshift({
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()),
    name:
      name.value.trim() ||
      `Buyurtma ${new Date().toLocaleDateString('uz-UZ')}`,
    date: new Date().toISOString(),
    prices: { standard: Number(standardPrice.value), blin: Number(quymaPrice.value) },
    lines: lineItems.value.map(({ type, weight, qty }) => ({
      type, weight, qty
    }))
  })

  notice.value = 'Buyurtma ushbu qurilmada saqlandi.'
}

function loadOrder(order) {
  lines.value = normalizeItems(order.lines).map(({ type, weight, qty }) => ({ type, weight, qty }))
  const prices = orderPrices(order)
  standardPrice.value = prices.standard
  quymaPrice.value = prices.blin
  mode.value = 'standard'
  name.value = order.name
  view.value = 'calculator'

  notice.value =
    'Saqlangan buyurtma ochildi. O‘zgarishlar yangi buyurtma sifatida saqlanmaguncha avvalgisiga ta’sir qilmaydi.'

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  })
}

function deleteOrder(id) {
  if (confirm('Ushbu buyurtma qurilmadan o‘chirilsinmi?')) {
    saved.value = saved.value.filter(o => o.id !== id)
  }
}

async function downloadPDF(
  items = lineItems.value,
  title = name.value,
  prices = { standard: Number(standardPrice.value), blin: Number(quymaPrice.value) },
  reportType = 'manufacturer'
) {
  if (!items.length) {
    notice.value = 'PDF uchun avval mahsulotlarni kiriting.'
    return
  }

  try {
    items = normalizeItems(items)
    const { totals, rods } = calculate(items)
    const stdWeight = weightFor(items, 'standard')
    const castWeight = weightFor(items, 'quyma')
    const shtangaKg = stdWeight + castWeight
    const blinKg = weightFor(items, 'blin')
    const weight = shtangaKg + blinKg
    const blinPrice = Number(prices.blin ?? prices.quyma ?? DEFAULT_QUYMA_PRICE)
    const amount = shtangaKg * prices.standard + blinKg * blinPrice

    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)

    // Use the same Alyans Sport icon shown in the application.
    const logoBytes = await (await fetch(logo)).arrayBuffer()
    const pdfLogo = await pdf.embedPng(logoBytes)

    const fontBytes = await (
      await fetch(pdfFontUrl)
    ).arrayBuffer()

    const font = await pdf.embedFont(fontBytes, {
      subset: true
    })

    // Clean A4 report with paginated, aligned tables.
    const pageSize = [595.28, 841.89]
    const W = pageSize[0]
    const margin = 38
    const contentW = W - 2 * margin
    const navy = rgb(0.09, 0.16, 0.27)
    const muted = rgb(0.36, 0.43, 0.51)
    const accent = rgb(0.12, 0.39, 0.70)
    const pale = rgb(0.94, 0.96, 0.985)
    const border = rgb(0.84, 0.88, 0.92)
    const white = rgb(1, 1, 1)
    let page = pdf.addPage(pageSize)
    let y = 0
    let pageNumber = 1
    const money = n => `${fmt(n)} so‘m`
    const safe = t => String(t ?? '').replace(/[\r\n]+/g, ' ')
    function text(t, x, baseline, size = 9, color = navy) {
      page.drawText(safe(t), { x, y: baseline, size, font, color })
    }
    function right(t, x, baseline, size = 9, color = navy) {
      const str = safe(t)
      text(str, x - font.widthOfTextAtSize(str, size), baseline, size, color)
    }
    function lineAt(yy) {
      page.drawLine({ start: { x: margin, y: yy }, end: { x: W - margin, y: yy }, color: border, thickness: 0.7 })
    }
    function footer() {
      lineAt(37)
      text(`Alyans sport  •  ${reportType === 'client' ? 'Mijoz uchun buyurtma' : 'Ishlab chiqarish hisoboti'}`, margin, 23, 8, muted)
      right(`Sahifa ${pageNumber}`, W - margin, 23, 8, muted)
    }
    function newPage() {
      footer()
      page = pdf.addPage(pageSize)
      pageNumber++
      y = 785
      text('Alyans sport  /  DAVOMI', margin, 804, 9, accent)
      lineAt(794)
    }
    function ensure(height) {
      if (y - height < 55) newPage()
    }
    function section(title, columns, widths) {
      ensure(74)
      y -= 25
      text(title, margin, y, 11, navy)
      y -= 13
      const top = y
      page.drawRectangle({ x: margin, y: top - 27, width: contentW, height: 27, color: navy })
      let x = margin
      columns.forEach((col, i) => {
        const last = i === columns.length - 1
        if (last) right(col, x + widths[i] - 12, top - 18, 8, white)
        else text(col, x + 11, top - 18, 8, white)
        x += widths[i]
      })
      y = top - 27
    }
    function tableRow(cells, widths, opts = {}) {
      ensure(29)
      const h = 27
      if (opts.total) {
        page.drawRectangle({ x: margin, y: y - h, width: contentW, height: h, color: pale })
      } else if (opts.shade) {
        page.drawRectangle({ x: margin, y: y - h, width: contentW, height: h, color: rgb(0.985, 0.99, 1) })
      }
      let x = margin
      cells.forEach((cell, i) => {
        const last = i === cells.length - 1
        const size = opts.total ? 9 : 8.5
        if (last) right(cell, x + widths[i] - 12, y - 18, size, navy)
        else text(cell, x + 11, y - 18, size, opts.total ? navy : muted)
        x += widths[i]
      })
      lineAt(y - h)
      y -= h
    }
    function table(title, headers, widths, rows, totalRow = null) {
      if (!rows.length) return
      section(title, headers, widths)
      rows.forEach((r, i) => tableRow(r, widths, { shade: i % 2 === 1 }))
      if (totalRow) tableRow(totalRow, widths, { total: true })
    }

    // Header and order identity.
    page.drawRectangle({ x: 0, y: 745, width: W, height: 96, color: navy })
    const logoSize = 57
    page.drawImage(pdfLogo, {
      x: margin,
      y: 764,
      width: logoSize,
      height: logoSize
    })
    text('Alyans sport', margin + 70, 801, 22, white)
    text(reportType === 'client' ? 'BUYURTMA MA’LUMOTLARI' : 'ISHLAB CHIQARISH HISOBOTI', margin + 70, 778, 10, rgb(0.75, 0.85, 0.96))
    right(new Date().toLocaleDateString('uz-UZ'), W - margin, 802, 9, white)
    y = 725
    text('BUYURTMA', margin, y, 8, accent)
    y -= 21
    const orderName = safe(title || 'Nomsiz buyurtma')
    const shortName = orderName.length > 65 ? orderName.slice(0, 62) + '...' : orderName
    text(shortName, margin, y, 13)
    y -= 21
    lineAt(y)
    y -= 26

    // Client report: order, quantities, weights, prices.
    // Manufacturer report: all of the above plus parts and rods.
    const assembledItems = items.filter(x => x.type === 'standard').sort((a, b) => b.weight - a.weight)
    const castItems = items.filter(x => x.type === 'quyma').sort((a, b) => b.weight - a.weight)
    const blinItems = items.filter(x => x.type === 'blin').sort((a, b) => b.weight - a.weight)
    const shtangaItems = [...assembledItems, ...castItems].sort((a, b) => b.weight - a.weight)
    const shtangaQty = shtangaItems.reduce((n, x) => n + x.qty, 0)
    const blinQty = blinItems.reduce((n, x) => n + x.qty, 0)
    table('OG‘IRLIK VA NARXLAR', ['Turi', 'Soni', 'Og‘irlik', 'Narx / kg', 'Summa'],
      [145, 67, 90, 100, contentW - 402], [
        ['Shtanga', fmt(shtangaQty), `${fmt(shtangaKg)} kg`, money(prices.standard), money(shtangaKg * prices.standard)],
        ['Blin', fmt(blinQty), `${fmt(blinKg)} kg`, money(blinPrice), money(blinKg * blinPrice)]
      ], ['JAMI', fmt(shtangaQty + blinQty), `${fmt(weight)} kg`, '—', money(amount)])

    table('SHTANGALAR', ['Og‘irligi', 'Soni', 'Turi', 'Jami kg'],
      [145, 100, 135, contentW - 380],
      shtangaItems.map(x => [
        `${fmt(x.weight)} kg`, `${fmt(x.qty)} ta`,
        x.type === 'quyma' ? 'Quyma' : 'Yig‘ma', `${fmt(x.weight * x.qty)} kg`
      ]), shtangaItems.length ? ['JAMI', `${fmt(shtangaQty)} ta`, '', `${fmt(shtangaKg)} kg`] : null)

    table('BLINLAR', ['Og‘irligi', 'Soni', 'Jami og‘irlik'],
      [190, 145, contentW - 335],
      blinItems.map(x => [`${fmt(x.weight)} kg`, `${fmt(x.qty)} ta`, `${fmt(x.weight * x.qty)} kg`]),
      blinItems.length ? ['JAMI', `${fmt(blinQty)} ta`, `${fmt(blinKg)} kg`] : null)

    if (reportType === 'manufacturer' && assembledItems.length) {
      const partRows = WEIGHTS.map(w => {
        const t = totals[String(w)]
        return [`${w} kg`, fmt(t.regular), fmt(t.threaded), fmt(t.regular + t.threaded)]
      }).filter((_, i) => {
        const t = totals[String(WEIGHTS[i])]
        return t.regular + t.threaded > 0
      })
      const regular = Object.values(totals).reduce((n, t) => n + t.regular, 0)
      const threaded = Object.values(totals).reduce((n, t) => n + t.threaded, 0)
      table('SHTANGA UCHUN TOSH QISMLAR', ['Og‘irligi', 'Oddiy', 'Rezbali', 'Jami'],
        [145, 115, 115, contentW - 375], partRows,
        ['JAMI', fmt(regular), fmt(threaded), fmt(regular + threaded)])
      table('KERAKLI DASTALAR', ['Dasta uzunligi', 'Soni'],
        [contentW / 2, contentW / 2],
        Object.entries(rods).filter(([, q]) => q > 0).sort((a, b) => Number(b[0]) - Number(a[0]))
          .map(([len, qty]) => [`${len} sm`, `${fmt(qty)} ta`]))
    }
    ensure(42)
    y -= 22
    text(reportType === 'client'
      ? 'Quyma shtangalar: 0.5 kg, 1 kg va 2 kg.'
      : 'Quyma shtangalar bir butun. Qismlar va dastalar faqat yig‘ma shtangalar uchun.',
      margin, y, 8, muted)
    footer()

    const bytes = await pdf.save()

    const blob = new Blob([bytes], {
      type: 'application/pdf'
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download =
      `Alyans-sport-${reportType === 'client' ? 'mijoz' : 'ishlab-chiqarish'}-${new Date().toISOString().slice(0, 10)}.pdf`

    document.body.appendChild(link)
    link.click()
    link.remove()

    setTimeout(() => URL.revokeObjectURL(url), 3000)

    notice.value = 'PDF hisobot yuklab olindi.'
  } catch (e) {
    console.error(e)

    notice.value =
      'PDF yaratishda xatolik yuz berdi. Brauzer konsolini tekshiring.'
  }
}

const totalSaved = computed(() => saved.value.length)
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-icon"><img :src="logo" alt="" style="width: 50px;"></span>
        <div>
          <strong>Alyans sport</strong>
          <small>Ishlab chiqarish</small>
        </div>
      </div>

      <nav aria-label="Asosiy menyu">
        <button
          :class="{ active: view === 'calculator' }"
          @click="view = 'calculator'"
        >
          ▦ <span>Hisoblash</span>
        </button>

        <button
          :class="{ active: view === 'history' }"
          @click="view = 'history'"
        >
          ◷ <span>Saqlangan buyurtmalar</span>
          <em>{{ totalSaved }}</em>
        </button>

        <button
          :class="{ active: view === 'specs' }"
          @click="view = 'specs'"
        >
          ▤ <span>Texnik ma’lumotlar</span>
        </button>
      </nav>

      <div class="side-note">
        39 xil yig‘ma shtanga · 3 xil quyma · 6 xil blin
        <br />
        O‘rnatilgach internetsiz ishlaydi
      </div>
    </aside>

    <div class="main-wrap">
      <header class="topbar">
        <div class="mobile-brand">
          ▥ <strong>Alyans sport</strong>
        </div>

        <span class="topbar-sub">
          Shtanga ishlab chiqarish
        </span>

        <span class="pill">
          ● Mahalliy hisoblagich
        </span>
      </header>

      <main>
        <div v-if="notice" class="notice" role="status">
          {{ notice }}
          <button @click="notice = ''" aria-label="Yopish">
            ×
          </button>
        </div>

        <!-- HISOBLASH -->
        <template v-if="view === 'calculator'">
          <div class="page-heading">
            <div>
              <div class="eyebrow">
                ISHLAB CHIQARISH REJASI
              </div>

              <h1>Ishlab chiqarish hisoblagichi</h1>

              <p>
                Kerakli shtangalar sonini kiriting.
                Qismlar soni avtomatik hisoblanadi.
              </p>
            </div>

            <button class="btn ghost" @click="clearOrder">
              Tozalash
            </button>
          </div>

          <!-- STATISTIKA -->
          <div class="stats">
            <div class="stat">
              <span>Buyurtmadagi mahsulotlar</span>
              <strong>
                {{ barCount.toLocaleString('uz-UZ') }}
              </strong>
            </div>

            <!-- YANGI JAMI OG‘IRLIK -->
            <div class="stat">
              <span>Shtanga og‘irligi</span>
              <strong>{{ fmt(shtangaWeight) }} kg</strong>
            </div>
            <div class="stat">
              <span>Blin og‘irligi</span>
              <strong>{{ fmt(blinWeight) }} kg</strong>
            </div>
            <div class="stat">
              <span>Jami og‘irlik</span>
              <strong>
                {{ totalWeight.toLocaleString('uz-UZ') }}
                kg
              </strong>
            </div>

            <div class="stat">
              <span>Oddiy toshlar</span>
              <strong>
                {{ totalRegular.toLocaleString('uz-UZ') }}
              </strong>
            </div>

            <div class="stat accent">
              <span>Rezbali toshlar</span>
              <strong>
                {{ totalThreaded.toLocaleString('uz-UZ') }}
              </strong>
            </div>
          </div>

          <div class="columns">
            <!-- BUYURTMA KIRITISH -->
            <section class="panel">
              <div class="panel-header">
                <div>
                  <h2>Buyurtma ma’lumotlari</h2>
                  <p>
                    Shtangalar (yig‘ma va quyma) yoki blinlarni kiriting.
                  </p>
                </div>
              </div>

              <label class="field-label" for="order-name">
                Buyurtma nomi (ixtiyoriy)
              </label>

              <input
                id="order-name"
                v-model="name"
                placeholder="Masalan: Dushanba buyurtmasi"
                class="text-input"
                maxlength="100"
              />

              <div class="tabs">
                <button :class="{ selected: mode === 'standard' }" @click="mode = 'standard'">
                  Shtanga
                </button>
                <button :class="{ selected: mode === 'blin' }" @click="mode = 'blin'">
                  Blin
                </button>
              </div>

              <template v-if="mode === 'standard'">
                <p class="muted">Yashil rang: 0.5 kg, 1 kg va 2 kg quyma shtangalar.</p>
                <input v-model="search" class="text-input" type="search"
                  placeholder="Og‘irlikni qidiring, masalan 17" aria-label="Shtanga og‘irliklarini qidirish" />
                <div class="full-list">
                  <div v-for="item in shtangaOptions" :key="keyOf(item.type, item.weight)"
                    class="full-row"
                    :style="item.type === 'quyma'
                      ? { backgroundColor: '#e5f7eb', borderLeft: '4px solid #159447', paddingLeft: '10px' }
                      : {}">
                    <div>
                      <strong :style="item.type === 'quyma' ? { color: '#126c37' } : {}">
                        {{ item.weight }} kg
                        <span v-if="item.type === 'quyma'"> — QUYMA</span>
                      </strong>
                      <small>{{ item.type === 'quyma' ? 'Bir butun quyma shtanga' : `${item.spec.length} sm dasta · yig‘ma` }}</small>
                    </div>
                    <input :aria-label="`Soni: ${item.weight} kg ${item.type === 'quyma' ? 'quyma' : 'yig‘ma'} shtanga`"
                      type="number" min="0" max="1000000" step="1"
                      :value="getQty(item.type, item.weight)"
                      @input="setQty(item.type, item.weight, $event.target.value)" />
                  </div>
                </div>
              </template>
              <template v-else>
                <p class="muted">Blinlar — katta shtangalarga qo‘shiladigan alohida disklar.</p>
                <div class="full-list">
                  <div v-for="w in BLIN_WEIGHTS" :key="w" class="full-row">
                    <div><strong>{{ w }} kg</strong><small>Blin · disk</small></div>
                    <input :aria-label="`Soni: ${w} kg blin`" type="number" min="0"
                      max="1000000" step="1" :value="getQty('blin', w)"
                      @input="setQty('blin', w, $event.target.value)" />
                  </div>
                </div>
              </template>

              <div class="section-divider"></div>
              <h3>Buyurtma narxlari (so‘m/kg)</h3>
              <p class="muted">Har bir buyurtma uchun alohida o‘zgartirish mumkin.</p>
              <div class="entry-grid">
                <div>
                  <label class="field-label" for="standard-price">Shtanga (yig‘ma + quyma)</label>
                  <input id="standard-price" v-model.number="standardPrice" type="number"
                    min="0" step="100" class="text-input" />
                </div>
                <div>
                  <label class="field-label" for="quyma-price">Blin</label>
                  <input id="quyma-price" v-model.number="quymaPrice" type="number"
                    min="0" step="100" class="text-input" />
                </div>
              </div>
              <div class="info">
                Shtanga: {{ fmt(shtangaWeight) }} kg × {{ fmt(standardPrice) }} = {{ fmt(standardAmount) }} so‘m<br />
                Blin: {{ fmt(blinWeight) }} kg × {{ fmt(quymaPrice) }} = {{ fmt(blinAmount) }} so‘m<br />
                <strong>Jami narx: {{ fmt(totalAmount) }} so‘m</strong>
              </div>

              <div class="section-divider"></div>

              <h3>
                Buyurtmadagi mahsulotlar
                <span class="muted">
                  ({{ lineItems.length }} tur)
                </span>
              </h3>

              <div v-if="!lineItems.length" class="empty">
                Hali mahsulot qo‘shilmadi.
                Og‘irlik va sonini kiriting.
              </div>

              <div v-else class="order-lines">
                <div
                  v-for="item in [...lineItems].sort(
                    (a, b) => b.weight - a.weight
                  )"
                  :key="keyOf(item.type, item.weight)"
                  class="order-row"
                >
                  <div class="weight-bubble" :style="item.type === 'quyma' ? { backgroundColor: '#dcfce7', color: '#166534' } : {}">
                    {{ item.weight }}
                  </div>

                  <div class="order-description">
                    <strong>
                      {{ item.weight }} kg {{ item.type === 'quyma' ? 'quyma shtanga' : item.type === 'blin' ? 'blin' : 'yig‘ma shtanga' }}
                    </strong>

                    <small>
                      <template v-if="item.type === 'standard'">
                        {{ item.spec.length }} sm ·
                        {{ Object.entries(item.spec.parts).map(([w, n]) => `${n}×${w}`).join(' + ') }} / tomon
                      </template>
                      <template v-else>{{ item.type === 'quyma' ? 'Quyma · bir butun shtanga' : 'Blin · alohida disk' }}</template>
                    </small>
                  </div>

                  <input
                    type="number"
                    min="0"
                    step="1"
                    :aria-label="`Soni: ${item.weight} kg shtanga`"
                    :value="item.qty"
                    @input="setQty(item.type, item.weight, $event.target.value)"
                  />

                  <button
                    class="icon-button"
                    :aria-label="`O‘chirish: ${item.weight} kg`"
                    @click="removeLine(item.type, item.weight)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </section>

            <!-- KERAKLI QISMLAR -->
            <section class="panel result-panel">
              <div class="panel-header">
                <div>
                  <h2>Kerakli qismlar</h2>
                  <p>Yig‘ma shtangalar uchun qismlar; quyma shtangalar va blinlar alohida.</p>
                </div>

                <span class="tag">JONLI</span>
              </div>

              <div
                v-if="!barCount"
                class="empty results-empty"
              >
                Hisoblash uchun mahsulotlarni qo‘shing.
              </div>

              <template v-else>
                <div class="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Tosh og‘irligi</th>
                        <th>Oddiy</th>
                        <th>Rezbali</th>
                        <th>Jami</th>
                      </tr>
                    </thead>

                    <tbody>
                      <tr v-for="w in WEIGHTS" :key="w">
                        <td>
                          <strong>{{ w }} kg</strong>
                        </td>

                        <td>
                          {{
                            result.totals[
                              String(w)
                            ].regular.toLocaleString('uz-UZ')
                          }}
                        </td>

                        <td class="threaded">
                          {{
                            result.totals[
                              String(w)
                            ].threaded.toLocaleString('uz-UZ')
                          }}
                        </td>

                        <td>
                          {{
                            (
                              result.totals[String(w)].regular +
                              result.totals[String(w)].threaded
                            ).toLocaleString('uz-UZ')
                          }}
                        </td>
                      </tr>
                    </tbody>

                    <tfoot>
                      <tr>
                        <td>Jami</td>

                        <td>
                          {{
                            totalRegular.toLocaleString('uz-UZ')
                          }}
                        </td>

                        <td class="threaded">
                          {{
                            totalThreaded.toLocaleString('uz-UZ')
                          }}
                        </td>

                        <td>
                          {{
                            (
                              totalRegular + totalThreaded
                            ).toLocaleString('uz-UZ')
                          }}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <h3 class="subheading">Quyma shtangalar (0.5 / 1 / 2 kg)</h3>
                <div v-if="usedQuymaWeights.length" class="table-scroll">
                  <table>
                    <thead><tr><th>Og‘irligi</th><th>Soni</th><th>Jami kg</th></tr></thead>
                    <tbody>
                      <tr v-for="w in usedQuymaWeights" :key="w">
                        <td><strong>{{ w }} kg</strong></td>
                        <td>{{ fmt(getQty('quyma', w)) }}</td>
                        <td>{{ fmt(w * getQty('quyma', w)) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <h3 class="subheading">Blinlar</h3>
                <div v-if="usedBlinWeights.length" class="table-scroll">
                  <table>
                    <thead><tr><th>Og‘irligi</th><th>Soni</th><th>Jami kg</th></tr></thead>
                    <tbody>
                      <tr v-for="w in usedBlinWeights" :key="w">
                        <td><strong>{{ w }} kg</strong></td>
                        <td>{{ fmt(getQty('blin', w)) }}</td>
                        <td>{{ fmt(w * getQty('blin', w)) }}</td>
                      </tr>
                    </tbody>
                    <tfoot><tr><td>Jami</td><td>{{ fmt(lineItems.filter(x => x.type === 'blin').reduce((n,x) => n+x.qty, 0)) }}</td><td>{{ fmt(blinWeight) }} kg</td></tr></tfoot>
                  </table>
                </div>
                <div class="info">
                  <strong>Shtanga: {{ fmt(shtangaWeight) }} kg</strong> ·
                  <strong>Blin: {{ fmt(blinWeight) }} kg</strong> ·
                  <strong>Umumiy: {{ fmt(totalWeight) }} kg</strong><br />
                  <strong>Jami narx: {{ fmt(totalAmount) }} so‘m</strong>
                </div>

                <h3 class="subheading">
                  Kerakli dastalar
                </h3>

                <div class="rod-list">
                  <div
                    v-for="[length, qty] in Object.entries(
                      result.rods
                    ).sort(
                      (a, b) => Number(b[0]) - Number(a[0])
                    )"
                    :key="length"
                  >
                    <span>{{ length }} sm</span>

                    <strong>
                      {{ qty.toLocaleString('uz-UZ') }}
                      ta dasta
                    </strong>
                  </div>
                </div>

                <div class="info">
                  Har bir yig‘ma shtanga uchun 1 ta dasta va
                  2 ta rezbali tosh kerak — har tomondagi
                  eng kichik tosh rezbali, qolganlari oddiy.
                </div>

                <div class="actions">
                  <button
                    class="btn primary"
                    @click="saveOrder"
                  >
                    Buyurtmani saqlash
                  </button>

                  <button class="btn secondary" @click="downloadPDF(lineItems, name, undefined, 'client')">
                    Mijoz uchun PDF
                  </button>
                  <button class="btn secondary" @click="downloadPDF()">
                    Ishlab chiqarish PDF
                  </button>
                </div>
              </template>
            </section>
          </div>
        </template>

        <!-- SAQLANGAN BUYURTMALAR -->
        <template v-else-if="view === 'history'">
          <div class="page-heading">
            <div>
              <div class="eyebrow">
                QURILMADAGI MA’LUMOTLAR
              </div>

              <h1>Saqlangan buyurtmalar</h1>

              <p>
                Buyurtmalar shu qurilmada saqlanadi
                va boshqa qurilmalarga avtomatik uzatilmaydi.
              </p>
            </div>
          </div>

          <section class="panel">
            <div class="panel-header">
              <div>
                <h2>Buyurtmalar tarixi</h2>

                <p>
                  {{ saved.length }} ta saqlangan buyurtma
                </p>
              </div>
            </div>

            <div v-if="!saved.length" class="empty">
              Saqlangan buyurtmalar yo‘q.
              Hisob-kitobni saqlang.
            </div>

            <div
              v-for="o in saved"
              :key="o.id"
              class="history-row"
            >
              <div>
                <strong>{{ o.name }}</strong>

                <small>
                  {{
                    new Date(o.date).toLocaleString('uz-UZ')
                  }}
                  ·
                  {{
                    o.lines.reduce(
                      (n, l) => n + Number(l.qty),
                      0
                    )
                  }}
                  ta mahsulot
                </small>

                <!-- SAQLANGAN BUYURTMA OG‘IRLIGI -->
                <small>
                  Jami og‘irlik:
                  <strong>
                    {{
                      calculateTotalWeight(
                        o.lines
                      ).toLocaleString('uz-UZ')
                    }}
                    kg
                  </strong>
                </small>
                <small>Shtanga: {{ fmt(weightFor(o.lines, 'standard') + weightFor(o.lines, 'quyma')) }} kg · Blin: {{ fmt(weightFor(o.lines, 'blin')) }} kg</small>
                <small>Jami narx: <strong>{{ fmt(orderAmount(o)) }} so‘m</strong></small>
              </div>

              <div class="history-actions">
                <button
                  class="btn secondary small"
                  @click="loadOrder(o)"
                >
                  Ochish
                </button>

                  <button class="btn secondary small"
                    @click="downloadPDF(o.lines, o.name, orderPrices(o), 'client')">
                    Mijoz PDF
                  </button>
                  <button class="btn secondary small"
                    @click="downloadPDF(o.lines, o.name, orderPrices(o), 'manufacturer')">
                    Ishlab chiqarish PDF
                  </button>

                <button
                  class="btn danger small"
                  @click="deleteOrder(o.id)"
                >
                  O‘chirish
                </button>
              </div>
            </div>
          </section>
        </template>

        <!-- TEXNIK MA’LUMOTLAR -->
        <template v-else>
          <div class="page-heading">
            <div>
              <div class="eyebrow">
                ISHLAB CHIQARISH MA’LUMOTLARI
              </div>

              <h1>Ishlab chiqarish me’yorlari</h1>

              <p>
                Siz bergan jadvaldagi barcha 39 xil shtanga.
              </p>
            </div>
          </div>

          <section class="panel">
            <div class="panel-header">
              <div>
                <h2>Yig‘ish tarkibi</h2>

                <p>
                  Miqdorlar asl hujjatdagidek
                  faqat bir tomon uchun ko‘rsatilgan.
                </p>
              </div>
            </div>

            <input
              v-model="specSearch"
              type="search"
              class="text-input spec-search"
              placeholder="Shtanga og‘irligini qidirish..."
            />

            <div class="table-scroll">
              <table class="spec-table">
                <thead>
                  <tr>
                    <th>Bar</th>
                    <th>Uzunlik</th>
                    <th>2.5 kg</th>
                    <th>2 kg</th>
                    <th>1.5 kg</th>
                    <th>1 kg</th>
                    <th>Rezbali / tomon</th>
                  </tr>
                </thead>

                <tbody>
                  <tr
                    v-for="s in filteredSpecs"
                    :key="s.weight"
                  >
                    <td>
                      <strong>{{ s.weight }} kg</strong>
                    </td>

                    <td>
                      {{ s.length }} sm
                    </td>

                    <td
                      v-for="w in WEIGHTS"
                      :key="w"
                    >
                      {{
                        s.parts[String(w)] || '—'
                      }}
                    </td>

                    <td class="threaded">
                      {{
                        Math.min(
                          ...Object.keys(s.parts).map(Number)
                        )
                      }}
                      kg
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="info">
              Jadval shtanganing BIR tomoni uchun;
              uzunlik esa har bir shtangadagi BITTA
              dastaning o‘lchami.

              Hisoblagich qismlarni ikki baravar oladi
              va har tomondagi eng kichik toshni
              rezbali deb belgilaydi.

              Asl jadvalda metall sterjenning
              og‘irligi hisobga olinmagan.
            </div>
          </section>
        </template>
      </main>

      <footer>
        Alyans sport · Ishlab chiqarish hisoblagichi ·
        Internetsiz ishlaydigan PWA
      </footer>
    </div>

    <!-- MOBIL MENYU -->
    <nav class="bottom-nav" aria-label="Mobil menyu">
      <button
        :class="{ active: view === 'calculator' }"
        @click="view = 'calculator'"
      >
        <span>▦</span>
        Hisoblash
      </button>

      <button
        :class="{ active: view === 'history' }"
        @click="view = 'history'"
      >
        <span>☷</span>
        Buyurtmalar
      </button>

      <button
        :class="{ active: view === 'specs' }"
        @click="view = 'specs'"
      >
        <span>▤</span>
        Me’yorlar
      </button>
    </nav>
  </div>
</template>
