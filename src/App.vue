
<script setup>
import { ref, computed, watch } from 'vue'
import specs from './specs.json'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import pdfFontUrl from './assets/DejaVuSans.ttf?url'

const STORE = 'barforge-orders-v1'
const WEIGHTS = [2.5, 2, 1.5, 1]

const view = ref('calculator')
const mode = ref('quick')
const search = ref('')
const specSearch = ref('')
const selectedWeight = ref(40)
const selectedQty = ref(1)
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

const fullSpecs = computed(() =>
  specs.filter(s => String(s.weight).includes(search.value.trim()))
)

const lineItems = computed(() =>
  lines.value
    .filter(x => x.qty > 0)
    .map(x => ({
      ...x,
      spec: specs.find(s => s.weight === x.weight)
    }))
    .filter(x => x.spec)
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

const totalWeight = computed(() =>
  calculateTotalWeight(lineItems.value)
)

function calculate(items) {
  const totals = Object.fromEntries(
    WEIGHTS.map(w => [
      String(w),
      { regular: 0, threaded: 0 }
    ])
  )

  const rods = {}

  for (const item of items) {
    const spec = specs.find(
      s => s.weight === Number(item.weight)
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

function setQty(weight, value) {
  const qty = validQty(value)
  const found = lines.value.find(x => x.weight === weight)

  if (found) {
    found.qty = qty
  } else if (qty) {
    lines.value.push({ weight, qty })
  }
}

function getQty(weight) {
  return lines.value.find(x => x.weight === weight)?.qty || 0
}

function addQuick() {
  const weight = Number(selectedWeight.value)

  setQty(
    weight,
    getQty(weight) + validQty(selectedQty.value)
  )

  notice.value = 'Shtanga buyurtmaga qo‘shildi.'
}

function removeLine(weight) {
  lines.value = lines.value.filter(x => x.weight !== weight)
}

function clearOrder() {
  if (
    barCount.value &&
    !confirm('Joriy buyurtma tozalansinmi?')
  ) {
    return
  }

  lines.value = []
  name.value = ''
  notice.value = ''
}

function saveOrder() {
  if (!barCount.value) return

  saved.value.unshift({
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()),
    name:
      name.value.trim() ||
      `Buyurtma ${new Date().toLocaleDateString('uz-UZ')}`,
    date: new Date().toISOString(),
    lines: lineItems.value.map(({ weight, qty }) => ({
      weight,
      qty
    }))
  })

  notice.value = 'Buyurtma ushbu qurilmada saqlandi.'
}

function loadOrder(order) {
  lines.value = order.lines.map(x => ({ ...x }))
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
  title = name.value
) {
  if (!items.length) {
    notice.value = 'PDF uchun avval shtangalarni kiriting.'
    return
  }

  try {
    const { totals, rods } = calculate(items)
    const weight = calculateTotalWeight(items)

    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)

    const fontBytes = await (
      await fetch(pdfFontUrl)
    ).arrayBuffer()

    const font = await pdf.embedFont(fontBytes, {
      subset: true
    })

    const pageSize = [595.28, 841.89]
    let page = pdf.addPage(pageSize)

    const margin = 42
    let y = 797

    const navy = rgb(0.10, 0.16, 0.26)
    const gray = rgb(0.34, 0.40, 0.48)
    const line = rgb(0.83, 0.87, 0.91)

    const fmt = n => Number(n).toLocaleString('uz-UZ')

    function write(t, x, size = 10, color = navy) {
      page.drawText(String(t), {
        x,
        y,
        size,
        font,
        color
      })
    }

    function next(amount = 20) {
      y -= amount

      if (y < 70) {
        page = pdf.addPage(pageSize)
        y = 797
      }
    }

    function rule() {
      page.drawLine({
        start: { x: margin, y: y - 7 },
        end: { x: 553, y: y - 7 },
        thickness: 0.6,
        color: line
      })

      next(17)
    }

    function heading(t) {
      next(12)
      write(t, margin, 13)
      next(27)
    }

    function row(cells, xs, bold = false) {
      cells.forEach((cell, i) => {
        write(
          cell,
          xs[i],
          bold ? 10 : 9,
          bold ? navy : gray
        )
      })

      next(22)
      rule()
    }

    write('BARFORGE', margin, 21)
    next(30)

    write('ISHLAB CHIQARISH HISOBOTI', margin, 14)
    next(27)

    write(
      `Buyurtma: ${title || 'Nomsiz buyurtma'}`,
      margin,
      10
    )
    next(20)

    write(
      `Sana: ${new Date().toLocaleString('uz-UZ')}`,
      margin,
      10
    )
    next(20)

    write(
      `Jami shtangalar: ${fmt(
        items.reduce((n, i) => n + Number(i.qty), 0)
      )} ta`,
      margin,
      10
    )
    next(20)

    // PDF UCHUN JAMI OG‘IRLIK
    write(
      `Jami og‘irlik: ${fmt(weight)} kg`,
      margin,
      10
    )

    heading('SHTANGALAR VA DASTALAR')

    row(
      ['Og‘irligi', 'Soni', 'Dasta uzunligi'],
      [margin, 225, 370],
      true
    )

    for (const item of [...items].sort(
      (a, b) => b.weight - a.weight
    )) {
      const spec = specs.find(
        s => s.weight === Number(item.weight)
      )

      row(
        [
          `${item.weight} kg`,
          `${fmt(item.qty)} ta`,
          `${spec?.length ?? '—'} sm`
        ],
        [margin, 225, 370]
      )
    }

    heading('KERAKLI TOSH QISMLAR')

    row(
      ['Og‘irligi', 'Oddiy', 'Rezbali', 'Jami'],
      [margin, 170, 305, 445],
      true
    )

    let regular = 0
    let threaded = 0

    for (const w of WEIGHTS) {
      const t = totals[String(w)]

      regular += t.regular
      threaded += t.threaded

      row(
        [
          `${w} kg`,
          fmt(t.regular),
          fmt(t.threaded),
          fmt(t.regular + t.threaded)
        ],
        [margin, 170, 305, 445]
      )
    }

    row(
      [
        'JAMI',
        fmt(regular),
        fmt(threaded),
        fmt(regular + threaded)
      ],
      [margin, 170, 305, 445],
      true
    )

    heading('KERAKLI DASTALAR')

    row(
      ['Dasta uzunligi', 'Soni'],
      [margin, 305],
      true
    )

    for (const [length, qty] of Object.entries(rods).sort(
      (a, b) => Number(b[0]) - Number(a[0])
    )) {
      row(
        [`${length} sm`, `${fmt(qty)} ta`],
        [margin, 305]
      )
    }

    next(12)

    write(
      'Har bir shtanga uchun bitta dasta va ikkita rezbali tosh kerak.',
      margin,
      9,
      gray
    )

    const bytes = await pdf.save()

    const blob = new Blob([bytes], {
      type: 'application/pdf'
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download =
      `barforge-hisobot-${new Date().toISOString().slice(0, 10)}.pdf`

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
        <span class="brand-icon">▥</span>
        <div>
          <strong>BARFORGE</strong>
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
        39 xil shtanga · 2–40 kg
        <br />
        O‘rnatilgach internetsiz ishlaydi
      </div>
    </aside>

    <div class="main-wrap">
      <header class="topbar">
        <div class="mobile-brand">
          ▥ <strong>BARFORGE</strong>
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
              <span>Yig‘iladigan shtangalar</span>
              <strong>
                {{ barCount.toLocaleString('uz-UZ') }}
              </strong>
            </div>

            <!-- YANGI JAMI OG‘IRLIK -->
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
                    39 xil og‘irlikdan istalganini qo‘shing.
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
                <button
                  :class="{ selected: mode === 'quick' }"
                  @click="mode = 'quick'"
                >
                  Tez qo‘shish
                </button>

                <button
                  :class="{ selected: mode === 'full' }"
                  @click="mode = 'full'"
                >
                  Barcha 39 og‘irlik
                </button>
              </div>

              <template v-if="mode === 'quick'">
                <div class="entry-grid">
                  <div>
                    <label class="field-label" for="bar-weight">
                      Shtanga og‘irligi
                    </label>

                    <select
                      id="bar-weight"
                      v-model.number="selectedWeight"
                      class="text-input"
                    >
                      <option
                        v-for="s in specs"
                        :key="s.weight"
                        :value="s.weight"
                      >
                        {{ s.weight }} kg · {{ s.length }} sm
                      </option>
                    </select>
                  </div>

                  <div>
                    <label class="field-label" for="bar-qty">
                      Soni
                    </label>

                    <input
                      id="bar-qty"
                      v-model.number="selectedQty"
                      type="number"
                      min="1"
                      max="1000000"
                      step="1"
                      class="text-input"
                    />
                  </div>
                </div>

                <button
                  class="btn primary full"
                  :disabled="validQty(selectedQty) === 0"
                  @click="addQuick"
                >
                  + Buyurtmaga qo‘shish
                </button>
              </template>

              <template v-else>
                <input
                  v-model="search"
                  class="text-input"
                  type="search"
                  placeholder="Og‘irlikni qidiring, masalan 17"
                  aria-label="Shtanga og‘irliklarini qidirish"
                />

                <div class="full-list">
                  <div
                    v-for="s in fullSpecs"
                    :key="s.weight"
                    class="full-row"
                  >
                    <div>
                      <strong>{{ s.weight }} kg</strong>
                      <small>{{ s.length }} sm dasta</small>
                    </div>

                    <input
                      :aria-label="`Soni: ${s.weight} kg shtanga`"
                      type="number"
                      min="0"
                      max="1000000"
                      step="1"
                      :value="getQty(s.weight)"
                      @input="setQty(s.weight, $event.target.value)"
                    />
                  </div>
                </div>
              </template>

              <div class="section-divider"></div>

              <h3>
                Buyurtmadagi shtangalar
                <span class="muted">
                  ({{ lineItems.length }} tur)
                </span>
              </h3>

              <div v-if="!lineItems.length" class="empty">
                Hali shtanga qo‘shilmadi.
                Og‘irlik va sonini kiriting.
              </div>

              <div v-else class="order-lines">
                <div
                  v-for="item in [...lineItems].sort(
                    (a, b) => b.weight - a.weight
                  )"
                  :key="item.weight"
                  class="order-row"
                >
                  <div class="weight-bubble">
                    {{ item.weight }}
                  </div>

                  <div class="order-description">
                    <strong>
                      {{ item.weight }} kg shtanga
                    </strong>

                    <small>
                      {{ item.spec.length }} sm ·
                      {{
                        Object.entries(item.spec.parts)
                          .map(([w, n]) => `${n}×${w}`)
                          .join(' + ')
                      }}
                      / tomon
                    </small>
                  </div>

                  <input
                    type="number"
                    min="0"
                    step="1"
                    :aria-label="`Soni: ${item.weight} kg shtanga`"
                    :value="item.qty"
                    @input="setQty(item.weight, $event.target.value)"
                  />

                  <button
                    class="icon-button"
                    :aria-label="`O‘chirish: ${item.weight} kg`"
                    @click="removeLine(item.weight)"
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
                  <p>
                    Butun buyurtma uchun toshlar va dastalar soni.
                  </p>
                </div>

                <span class="tag">JONLI</span>
              </div>

              <div
                v-if="!barCount"
                class="empty results-empty"
              >
                Hisoblash uchun shtangalarni qo‘shing.
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
                  Har bir shtanga uchun 1 ta dasta va
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

                  <button
                    class="btn secondary"
                    @click="downloadPDF()"
                  >
                    PDF yuklab olish
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
                  ta shtanga
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
              </div>

              <div class="history-actions">
                <button
                  class="btn secondary small"
                  @click="loadOrder(o)"
                >
                  Ochish
                </button>

                <button
                  class="btn secondary small"
                  @click="downloadPDF(o.lines, o.name)"
                >
                  PDF yuklab olish
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
        BARFORGE · Ishlab chiqarish hisoblagichi ·
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
        <span>▤</span>
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
