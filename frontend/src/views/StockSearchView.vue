<template>
  <div class="p-6 space-y-6 max-w-screen-xl mx-auto">

    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold text-brand-primary flex items-center gap-2">
        <Search class="w-6 h-6 text-blue-500" />
        個股查詢
      </h1>
      <p class="text-brand-muted text-sm mt-1">輸入股票代碼或名稱，即時查看技術分析圖表</p>
    </div>

    <!-- Search bar -->
    <div class="relative" ref="searchWrap">
      <div
        class="flex items-center gap-3 bg-white border-2 rounded-2xl px-4 py-3 shadow-sm transition-colors"
        :class="focused ? 'border-blue-500 shadow-blue-100' : 'border-slate-200'"
      >
        <Search class="w-5 h-5 text-slate-400 flex-shrink-0" />
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          placeholder="搜尋股票代碼或名稱，例如：台積電、2330、航運…"
          class="flex-1 outline-none text-brand-primary placeholder:text-slate-400 text-sm bg-transparent"
          @focus="focused = true"
          @blur="onBlur"
          @keydown.down.prevent="moveHighlight(1)"
          @keydown.up.prevent="moveHighlight(-1)"
          @keydown.enter="selectHighlighted"
          @keydown.escape="closeDropdown"
          autocomplete="off"
        />
        <button
          v-if="query"
          @click="clearQuery"
          class="text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Autocomplete dropdown -->
      <Transition name="dropdown">
        <div
          v-if="showDropdown && results.length"
          class="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200
                 rounded-2xl shadow-xl z-20 overflow-hidden"
        >
          <button
            v-for="(stock, i) in results"
            :key="stock.code"
            @mousedown.prevent="selectStock(stock)"
            @mouseover="highlighted = i"
            class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-50 last:border-0"
            :class="highlighted === i ? 'bg-blue-50' : 'hover:bg-slate-50'"
          >
            <!-- Code badge -->
            <span class="w-16 text-center text-xs font-bold py-1 rounded-lg flex-shrink-0"
              :class="highlighted === i ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600'">
              {{ stock.code }}
            </span>
            <!-- Name + sector -->
            <div class="flex-1 min-w-0">
              <span class="text-sm font-semibold text-brand-primary">{{ stock.name }}</span>
              <span class="text-xs text-brand-muted ml-2">{{ stock.sector }}</span>
            </div>
            <!-- Price -->
            <span class="text-sm font-mono text-brand-muted flex-shrink-0">
              {{ stock.price.toFixed(1) }}
            </span>
          </button>
        </div>
      </Transition>

      <!-- No results -->
      <Transition name="dropdown">
        <div
          v-if="showDropdown && query.trim() && !results.length && !selected"
          class="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200
                 rounded-2xl shadow-xl z-20 px-4 py-6 text-center"
        >
          <p class="text-brand-muted text-sm">找不到「{{ query }}」，試試其他關鍵字</p>
        </div>
      </Transition>
    </div>

    <!-- Hot stocks quick picks -->
    <div v-if="!selected">
      <p class="text-xs font-semibold text-brand-muted mb-3 uppercase tracking-wide">熱門個股</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="s in hotStocks" :key="s.code"
          @click="selectStock(s)"
          class="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200
                 hover:border-blue-400 hover:bg-blue-50 transition-all text-sm shadow-sm"
        >
          <span class="text-xs font-bold text-blue-600">{{ s.code }}</span>
          <span class="text-brand-primary font-medium">{{ s.name }}</span>
          <span class="text-xs text-brand-muted">{{ s.sector }}</span>
        </button>
      </div>
    </div>

    <!-- Selected stock content -->
    <Transition name="fade" mode="out-in">
      <div v-if="selected" :key="selected.code" class="space-y-5">

        <!-- Stock header -->
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-2xl bg-brand-primary flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {{ selected.code.slice(0, 2) }}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-xl font-bold text-brand-primary">{{ selected.name }}</h2>
                <span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  {{ selected.sector }}
                </span>
              </div>
              <p class="text-brand-muted text-sm">{{ selected.code }} · TWSE 資料</p>
            </div>
          </div>

          <!-- Price + stats row -->
          <div class="flex items-center gap-6">
            <div class="text-right">
              <p class="text-3xl font-bold font-mono" :class="priceChange >= 0 ? 'text-stock-up' : 'text-stock-down'">
                {{ latestClose.toFixed(1) }}
              </p>
              <p class="text-sm font-semibold mt-0.5" :class="priceChange >= 0 ? 'text-stock-up' : 'text-stock-down'">
                {{ priceChange >= 0 ? '+' : '' }}{{ priceChange.toFixed(2) }}
                ({{ priceChangePct >= 0 ? '+' : '' }}{{ priceChangePct.toFixed(2) }}%)
              </p>
            </div>
          </div>
        </div>

        <!-- Stats strip -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div v-for="stat in statsStrip" :key="stat.label"
            class="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
            <p class="text-xs text-brand-muted mb-1">{{ stat.label }}</p>
            <p class="font-semibold text-brand-primary text-sm" :class="stat.colorClass">{{ stat.value }}</p>
          </div>
        </div>

        <!-- K-line chart -->
        <StockChart :stock="selected" :height="460" />

        <!-- AI technical analysis summary -->
        <div class="bg-brand-primary rounded-2xl p-5 text-white">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span class="text-xs font-semibold text-blue-300 uppercase tracking-widest">AI 技術分析摘要</span>
          </div>
          <p class="text-sm leading-7 text-slate-200">{{ aiAnalysis }}</p>
          <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/10">
            <span v-for="tag in aiTags" :key="tag"
              class="text-xs bg-white/10 text-slate-300 px-2.5 py-1 rounded-full">
              {{ tag }}
            </span>
          </div>
        </div>

      </div>
    </Transition>

    <!-- Empty state -->
    <div v-if="!selected && !query" class="text-center py-20 text-brand-muted">
      <BarChart2 class="w-12 h-12 mx-auto mb-4 opacity-20" />
      <p class="text-sm">輸入股票代碼或名稱開始查詢</p>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Search, X, BarChart2 } from 'lucide-vue-next'
import StockChart from '@/components/StockChart.vue'
import { searchStocks, TW_STOCKS, seedFromCode } from '@/data/twStocks'

// ── Search state ──────────────────────────────
const query       = ref('')
const focused     = ref(false)
const highlighted = ref(0)
const results     = ref([])
const showDropdown = ref(false)
const inputEl     = ref(null)
const searchWrap  = ref(null)

let skipNextWatch = false

watch(query, (q) => {
  if (skipNextWatch) { skipNextWatch = false; return }
  results.value      = searchStocks(q)
  highlighted.value  = 0
  showDropdown.value = q.trim().length > 0
})

function moveHighlight(dir) {
  const len = results.value.length
  if (!len) return
  highlighted.value = (highlighted.value + dir + len) % len
}

function selectHighlighted() {
  if (results.value[highlighted.value]) selectStock(results.value[highlighted.value])
}

function closeDropdown() {
  showDropdown.value = false
}

function onBlur() {
  focused.value = false
  setTimeout(() => { showDropdown.value = false }, 150)
}

function clearQuery() {
  query.value = ''
  selected.value = null
  inputEl.value?.focus()
}

// ── Stock selection ───────────────────────────
const selected = ref(null)

function selectStock(stock) {
  selected.value     = stock
  skipNextWatch      = true
  query.value        = `${stock.code} ${stock.name}`
  showDropdown.value = false
  focused.value      = false
}

// ── Hot stocks ────────────────────────────────
const hotStocks = TW_STOCKS.filter(s =>
  ['2330','2454','2382','0050','2603','3008','2317','2327'].includes(s.code)
)

// ── Mock latest price stats ───────────────────
// Derive deterministic values from the seeded PRNG last bar
function getLastTwoBars(stock) {
  // Small inline re-generation of just last 2 closes
  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const rand = mulberry32(seedFromCode(stock.code))
  // Run 298 steps to get to second-to-last, then last
  let p = stock.price, prev = stock.price
  for (let i = 0; i < 300; i++) {
    const vol = (stock.vol ?? 0.018) * (0.8 + rand() * 0.7)
    const u1 = Math.max(rand(), 1e-10), u2 = rand()
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    const next = p * Math.exp(0.0003 + vol * z)
    if (i === 297) prev = p
    if (i === 299) { return { prev, last: next } }
    p = next
  }
  return { prev: p, last: p }
}

const latestClose = computed(() => {
  if (!selected.value) return 0
  return getLastTwoBars(selected.value).last
})

const prevClose = computed(() => {
  if (!selected.value) return 0
  return getLastTwoBars(selected.value).prev
})

const priceChange = computed(() => latestClose.value - prevClose.value)
const priceChangePct = computed(() => (priceChange.value / prevClose.value) * 100)

const statsStrip = computed(() => {
  if (!selected.value) return []
  const lc = latestClose.value
  const seed = seedFromCode(selected.value.code)
  // Deterministic pseudo-stats from seed
  const r = ((seed * 1234567) % 1000) / 1000
  return [
    { label: '開盤',   value: (lc * (0.99 + r * 0.02)).toFixed(1),  colorClass: '' },
    { label: '最高',   value: (lc * (1.01 + r * 0.01)).toFixed(1),  colorClass: 'text-stock-up' },
    { label: '最低',   value: (lc * (0.98 - r * 0.005)).toFixed(1), colorClass: 'text-stock-down' },
    { label: '成交量', value: `${Math.round(20000 + r * 80000).toLocaleString()} 張`, colorClass: '' },
  ]
})

// ── AI analysis text (per stock) ─────────────
const aiAnalysis = computed(() => {
  if (!selected.value) return ''
  const s  = selected.value
  const up = priceChange.value >= 0
  const templates = [
    `${s.name}（${s.code}）目前股價位於近期整理區間${up ? '上緣' : '下緣'}，技術面${up ? '多頭動能持續' : '出現修正跡象'}。均線結構方面，MA5 與 MA20 之間的差距逐漸${up ? '擴大，顯示短線動能偏強' : '收斂，留意均線壓制'}。成交量維持在近期均量附近，籌碼面尚屬穩定。`,
    `從 ${s.name}（${s.code}）的 K 線形態觀察，近期走勢呈現${up ? '量增價漲的多頭格局，站穩重要均線支撐' : '量縮回檔態勢，逢阻力壓回'}。${s.sector}族群整體基本面${up ? '仍佳，法人持續布局' : '面臨短期不確定性'}，技術面配合基本面操作較為合宜。`,
  ]
  return templates[seedFromCode(s.code) % 2]
})

const aiTags = computed(() => {
  if (!selected.value) return []
  const up = priceChange.value >= 0
  return up
    ? ['#多頭格局', '#站上均線', '#量能配合']
    : ['#修正整理', '#觀察支撐', '#量縮回調']
})
</script>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active { transition: all 0.18s ease; }
.dropdown-enter-from,
.dropdown-leave-to     { opacity: 0; transform: translateY(-6px); }

.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to     { opacity: 0; }
</style>
