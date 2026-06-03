<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="font-bold text-brand-primary flex items-center gap-2">
        <Lightbulb class="w-4 h-4 text-blue-500" />
        即時個股觀察
      </h2>
      <div class="flex gap-1 bg-slate-100 rounded-lg p-1">
        <button
          v-for="tab in tabs" :key="tab.key"
          @click="activeTab = tab.key"
          class="px-2.5 py-1 rounded-md text-xs font-semibold transition-all"
          :class="activeTab === tab.key
            ? 'bg-white text-brand-primary shadow-sm'
            : 'text-brand-muted hover:text-brand-primary'"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <div v-if="loading || watchlist.loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
        <div class="h-4 w-24 bg-slate-100 rounded animate-pulse mb-3" />
        <div class="h-3 w-full bg-slate-100 rounded animate-pulse" />
      </div>
    </div>

    <div v-else-if="error" class="bg-red-50 border border-red-200 rounded-xl p-4">
      <p class="text-sm font-semibold text-red-700">即時資料讀取失敗</p>
      <p class="text-sm text-red-600 mt-1">{{ error }}</p>
    </div>

    <div v-else-if="isWatchlistEmpty"
         class="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
      <p class="text-sm font-semibold text-blue-700">尚未加入自選股</p>
      <p class="text-sm text-blue-600 mt-1">
        請先前往「下單練習 &gt; 自選清單」加入想觀察的股票，最多顯示前 5 檔。
      </p>
    </div>

    <TransitionGroup v-else name="card-list" tag="div" class="space-y-3">
      <div
        v-for="card in filteredCards"
        :key="card.code"
        class="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden
               hover:border-slate-200 hover:shadow transition-all duration-200"
      >
        <div class="flex">
          <div class="w-1 flex-shrink-0" :class="card.accentClass" />

          <div class="flex-1 p-4 space-y-3">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-2.5">
                <span
                  class="px-2 py-0.5 rounded-md text-xs font-bold"
                  :class="card.badgeClass"
                >
                  {{ card.statusLabel }}
                </span>
                <div>
                  <p class="font-semibold text-sm text-brand-primary">{{ card.name }}</p>
                  <p class="text-xs text-brand-muted">{{ card.code }} · {{ card.sector }}</p>
                </div>
              </div>
              <div class="text-right">
                <p class="font-mono font-bold text-brand-primary text-sm">{{ formatPrice(card.price) }}</p>
                <p class="text-xs" :class="card.changePct >= 0 ? 'text-stock-up' : 'text-stock-down'">
                  {{ signed(card.change) }} / {{ signedPercent(card.changePct) }}
                </p>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2 text-xs">
              <div class="rounded-lg bg-slate-50 px-2 py-2">
                <p class="text-brand-muted">開盤</p>
                <p class="font-mono font-semibold text-brand-primary mt-0.5">{{ formatPrice(card.open) }}</p>
              </div>
              <div class="rounded-lg bg-slate-50 px-2 py-2">
                <p class="text-brand-muted">最高</p>
                <p class="font-mono font-semibold text-stock-up mt-0.5">{{ formatPrice(card.high) }}</p>
              </div>
              <div class="rounded-lg bg-slate-50 px-2 py-2">
                <p class="text-brand-muted">最低</p>
                <p class="font-mono font-semibold text-stock-down mt-0.5">{{ formatPrice(card.low) }}</p>
              </div>
            </div>

            <p class="text-xs text-brand-muted leading-relaxed">
              {{ card.reason }}
            </p>

            <div class="flex flex-wrap gap-1.5 items-center">
              <button
                v-for="tag in card.tags"
                :key="tag"
                @click="$emit('open-drawer', tag)"
                class="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600
                       hover:bg-blue-500 hover:text-white transition-all duration-150 font-medium"
              >
                {{ tag }}
              </button>
              <span class="text-[11px] text-brand-muted ml-auto">
                {{ card.time || '盤後資料' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </TransitionGroup>

    <p v-if="!loading && !error && filteredCards.length === 0" class="text-center text-brand-muted text-sm py-8">
      目前沒有符合條件的即時觀察資料。
    </p>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Lightbulb } from 'lucide-vue-next'
import { getQuote, searchDbStocks } from '@/services/twseApi'
import { useWatchlistStore } from '@/stores/watchlist'

defineEmits(['open-drawer'])

const watchlist = useWatchlistStore()
const watchCodes = computed(() => watchlist.items.slice(0, 5).map(i => i.code))
const isWatchlistEmpty = computed(() => !watchlist.loading && watchlist.items.length === 0)

const activeTab = ref('ALL')
const loading = ref(true)
const error = ref('')
const cards = ref([])

const tabs = [
  { key: 'ALL', label: '全部' },
  { key: 'UP', label: '上漲' },
  { key: 'DOWN', label: '下跌' },
  { key: 'FLAT', label: '平盤' },
]

function finiteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function formatPrice(value) {
  const n = finiteNumber(value)
  return n.toLocaleString('zh-TW', {
    minimumFractionDigits: n >= 100 ? 0 : 1,
    maximumFractionDigits: 2,
  })
}

function signed(value) {
  const n = finiteNumber(value)
  return `${n >= 0 ? '+' : ''}${formatPrice(n)}`
}

function signedPercent(value) {
  const n = finiteNumber(value)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function classify(changePct) {
  if (changePct > 0.05) return 'UP'
  if (changePct < -0.05) return 'DOWN'
  return 'FLAT'
}

function decorateStatus(status) {
  if (status === 'UP') {
    return {
      statusLabel: '上漲',
      accentClass: 'bg-green-500',
      badgeClass: 'bg-green-50 text-green-700',
    }
  }
  if (status === 'DOWN') {
    return {
      statusLabel: '下跌',
      accentClass: 'bg-red-500',
      badgeClass: 'bg-red-50 text-red-700',
    }
  }
  return {
    statusLabel: '平盤',
    accentClass: 'bg-slate-400',
    badgeClass: 'bg-slate-100 text-slate-600',
  }
}

function buildReason(stock, quote, status) {
  const changePct = finiteNumber(quote.changePct)
  const volume = finiteNumber(quote.volume)
  const direction = status === 'UP' ? '上漲' : status === 'DOWN' ? '下跌' : '平盤附近'
  const volumeText = volume > 0 ? `成交量 ${volume.toLocaleString('zh-TW')} 股。` : '成交量資料暫未回傳。'
  return `${stock.name}今日即時價格呈現${direction}，漲跌幅 ${signedPercent(changePct)}，${volumeText}`
}

function buildTags(stock, quote) {
  const tags = [`#${stock.sector || '台股'}`]

  const changePct = finiteNumber(quote.changePct)
  const price     = finiteNumber(quote.price)
  const prevClose = finiteNumber(quote.prevClose, price)
  const open      = finiteNumber(quote.open, price)
  const high      = finiteNumber(quote.high, price)
  const low       = finiteNumber(quote.low, price)

  if (prevClose > 0) {
    const gapPct = (open - prevClose) / prevClose * 100
    if (gapPct >= 1)       tags.push('#跳空開高')
    else if (gapPct <= -1) tags.push('#跳空開低')
  }

  if      (changePct >= 9.5)  tags.push('#漲停鎖死')
  else if (changePct >= 3)    tags.push('#強勢上漲')
  else if (changePct >= 0.5)  tags.push('#溫和上漲')
  else if (changePct <= -9.5) tags.push('#跌停鎖死')
  else if (changePct <= -3)   tags.push('#弱勢下跌')
  else if (changePct <= -0.5) tags.push('#溫和下跌')
  else                        tags.push('#盤整平盤')

  if (prevClose > 0 && high > low) {
    const range = high - low
    if (range / prevClose > 0.03) tags.push('#震盪加劇')
    const upperShadow = high - Math.max(price, open)
    const lowerShadow = Math.min(price, open) - low
    if (upperShadow / range > 0.5)      tags.push('#長上影線')
    else if (lowerShadow / range > 0.5) tags.push('#長下影線')
  }

  return tags.slice(0, 4)
}

async function loadCards() {
  if (!watchCodes.value.length) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const rows = await Promise.all(watchCodes.value.map(async (code) => {
      const [stockPayload, quotePayload] = await Promise.all([
        searchDbStocks(code, { limit: 1 }),
        getQuote(code),
      ])
      const stock = stockPayload.data?.find((item) => item.code === code) || stockPayload.data?.[0] || { code, name: code, sector: '未分類' }
      const quote = quotePayload.data || {}
      const price = finiteNumber(quote.price, finiteNumber(stock.price))
      const prevClose = finiteNumber(quote.prevClose, price)
      const change = finiteNumber(quote.change, price - prevClose)
      const changePct = finiteNumber(quote.changePct, prevClose ? (change / prevClose) * 100 : 0)
      const status = classify(changePct)
      return {
        ...decorateStatus(status),
        code,
        name: stock.name,
        sector: stock.sector || '未分類',
        status,
        price,
        prevClose,
        change,
        changePct,
        open: finiteNumber(quote.open, price),
        high: finiteNumber(quote.high, price),
        low: finiteNumber(quote.low, price),
        time: quote.time,
        reason: buildReason(stock, { ...quote, changePct }, status),
        tags: buildTags(stock, { ...quote, changePct }),
      }
    }))
    cards.value = rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

const filteredCards = computed(() =>
  activeTab.value === 'ALL'
    ? cards.value
    : cards.value.filter((card) => card.status === activeTab.value),
)

watch(watchCodes, (newCodes, oldCodes) => {
  if (JSON.stringify(newCodes) !== JSON.stringify(oldCodes)) {
    loadCards()
  }
})

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
  refreshTimer = setInterval(() => {
    if (isMarketHours()) loadCards()
    else stopRefresh()
  }, 30_000)
}

onMounted(() => { loadCards(); startRefresh() })
onUnmounted(stopRefresh)
</script>

<style scoped>
.card-list-enter-active { transition: all 0.3s ease; }
.card-list-leave-active { transition: all 0.2s ease; position: absolute; width: 100%; }
.card-list-enter-from   { opacity: 0; transform: translateY(10px); }
.card-list-leave-to     { opacity: 0; transform: translateY(-6px); }
.card-list-move         { transition: transform 0.3s ease; }
</style>
