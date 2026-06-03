<template>
  <section class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
    <div class="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-100">
      <div>
        <p class="text-xs font-semibold text-blue-500 uppercase tracking-widest">TWSE Market Index</p>
        <h2 class="text-lg font-bold text-brand-primary mt-1">大盤加權指數</h2>
      </div>
      <div class="text-right">
        <p class="text-[11px] text-brand-muted">資料日期</p>
        <p class="text-sm font-semibold text-brand-primary">{{ displayDate }}</p>
      </div>
    </div>

    <div v-if="loading" class="p-5 space-y-3">
      <div class="h-8 w-40 bg-slate-100 rounded animate-pulse" />
      <div class="h-4 w-56 bg-slate-100 rounded animate-pulse" />
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
        <div v-for="i in 4" :key="i" class="h-20 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    </div>

    <div v-else-if="error" class="p-5">
      <div class="rounded-xl bg-red-50 border border-red-200 p-4">
        <p class="text-sm font-semibold text-red-700">大盤資料讀取失敗</p>
        <p class="text-sm text-red-600 mt-1">{{ error }}</p>
      </div>
    </div>

    <div v-else class="p-5 space-y-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-4xl font-bold font-mono text-brand-primary">{{ formatIndex(taiex?.close) }}</p>
          <p class="text-sm font-semibold mt-2" :class="changeClass(taiex?.changePct)">
            {{ signed(taiex?.changePoint) }} / {{ signedPercent(taiex?.changePct) }}
          </p>
        </div>
        <div class="text-sm text-brand-muted max-w-sm leading-6">
          {{ summary }}
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div v-for="item in keyIndices" :key="item.name" class="rounded-xl bg-slate-50 p-3">
          <p class="text-[11px] text-brand-muted mb-1">{{ item.name }}</p>
          <p class="font-mono font-semibold text-brand-primary">{{ formatIndex(item.close) }}</p>
          <p class="text-xs mt-1" :class="changeClass(item.changePct)">
            {{ signedPercent(item.changePct) }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="rounded-xl border border-green-100 bg-green-50/70 p-4">
          <p class="text-xs font-semibold text-green-700 mb-2">強勢類股</p>
          <div v-for="sector in strongSectors" :key="sector.name" class="flex items-center justify-between py-1 text-sm">
            <span class="text-brand-primary">{{ sector.name }}</span>
            <span class="font-mono font-semibold text-stock-up">{{ signedPercent(sector.changePct) }}</span>
          </div>
        </div>
        <div class="rounded-xl border border-red-100 bg-red-50/70 p-4">
          <p class="text-xs font-semibold text-red-700 mb-2">弱勢類股</p>
          <div v-for="sector in weakSectors" :key="sector.name" class="flex items-center justify-between py-1 text-sm">
            <span class="text-brand-primary">{{ sector.name }}</span>
            <span class="font-mono font-semibold text-stock-down">{{ signedPercent(sector.changePct) }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getMarketIndex } from '@/services/twseApi'

const loading = ref(true)
const error = ref('')
const rows = ref([])

function parseNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function normalizeRow(row) {
  if (!row) return null
  return {
    name: row['指數'],
    close: parseNumber(row['收盤指數']),
    changePoint: parseNumber(row['漲跌點數']) * (row['漲跌'] === '-' ? -1 : 1),
    changePct: parseNumber(row['漲跌百分比']),
    date: row['日期'],
  }
}

function findRow(name) {
  return normalizeRow(rows.value.find((row) => row['指數'] === name))
}

function formatIndex(value) {
  return Number(value || 0).toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function signed(value) {
  const n = Number(value || 0)
  return `${n >= 0 ? '+' : ''}${formatIndex(n)}`
}

function signedPercent(value) {
  const n = Number(value || 0)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function changeClass(value) {
  const n = Number(value || 0)
  if (n > 0) return 'text-stock-up'
  if (n < 0) return 'text-stock-down'
  return 'text-brand-muted'
}

function formatTwseDate(value) {
  const text = String(value || '')
  if (!/^\d{7}$/.test(text)) return '-'
  const year = Number(text.slice(0, 3)) + 1911
  return `${year}-${text.slice(3, 5)}-${text.slice(5, 7)}`
}

const taiex = computed(() => findRow('發行量加權股價指數'))

const displayDate = computed(() => formatTwseDate(taiex.value?.date))

const keyIndices = computed(() =>
  [
    findRow('臺灣50指數'),
    findRow('電子工業類指數'),
    findRow('金融保險類指數'),
    findRow('航運類指數'),
  ].filter(Boolean),
)

const sectorRows = computed(() =>
  rows.value
    .map(normalizeRow)
    .filter((row) => row?.name?.endsWith('類指數'))
    .sort((a, b) => b.changePct - a.changePct),
)

const strongSectors = computed(() => sectorRows.value.slice(0, 4))
const weakSectors = computed(() => sectorRows.value.slice(-4).reverse())

const summary = computed(() => {
  if (!taiex.value) return '尚未取得加權指數資料。'
  const strongest = strongSectors.value[0]
  const weakest = weakSectors.value[0]
  return `加權指數今日 ${signedPercent(taiex.value.changePct)}。${
    strongest ? `強勢族群為${strongest.name}。` : ''
  }${weakest ? `相對弱勢為${weakest.name}。` : ''}`
})

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const payload = await getMarketIndex()
    rows.value = Array.isArray(payload.data) ? payload.data : []
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function isMarketHours() {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const t = now.getHours() * 60 + now.getMinutes()
  return t >= 9 * 60 && t <= 13 * 60 + 35
}

let refreshTimer = null
function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
}
function startRefresh() {
  stopRefresh()
  if (!isMarketHours()) return
  refreshTimer = setInterval(() => { if (isMarketHours()) loadData(); else stopRefresh() }, 60_000)
}

onMounted(() => { loadData(); startRefresh() })
onUnmounted(stopRefresh)
</script>
