<template>
  <!-- 即時報價條：圖表不變，只是多出這一小條數值。預設只在進入/換股票時抓一次，
       使用者想更新再按「更新」按鈕，不主動狂打官方 API。 -->
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
    <!-- 載入中 -->
    <span v-if="loading" class="text-brand-muted">即時報價載入中…</span>

    <!-- 失敗：不擋畫面，只提示，圖表照常 -->
    <span v-else-if="error" class="text-amber-600">
      即時報價暫時取不到（{{ error }}）
    </span>

    <!-- 成功 -->
    <template v-else-if="q">
      <span class="font-bold text-sm" :class="priceClass">
        {{ q.price != null ? q.price.toFixed(2) : '—' }}
      </span>
      <span :class="priceClass">
        {{ q.change >= 0 ? '▲' : '▼' }}
        {{ q.change != null ? Math.abs(q.change).toFixed(2) : '—' }}
        ({{ q.changePct != null ? (q.changePct >= 0 ? '+' : '') + q.changePct.toFixed(2) : '—' }}%)
      </span>
      <span class="text-brand-muted">開 {{ fmt(q.open) }}</span>
      <span class="text-brand-muted">高 {{ fmt(q.high) }}</span>
      <span class="text-brand-muted">低 {{ fmt(q.low) }}</span>
      <span class="text-brand-muted">量 {{ q.volume != null ? q.volume.toLocaleString('zh-TW') : '—' }}</span>
      <span class="text-[11px] text-slate-400">
        TWSE 即時 · {{ q.time || '—' }}{{ q.closed ? '（收盤）' : '' }}
      </span>
      <button
        @click="load"
        class="text-[11px] text-blue-500 hover:text-blue-600 border border-blue-200
               rounded px-1.5 py-0.5"
      >
        🔄 更新
      </button>
    </template>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { getQuote } from '@/services/twseApi'

const props = defineProps({
  code: { type: String, required: true },
})

const q = ref(null)
const loading = ref(false)
const error = ref('')

function fmt(n) {
  return n != null ? n.toFixed(2) : '—'
}

// 紅漲綠跌（與 K 線圖一致：漲=紅、跌=綠）
const priceClass = ref('')
function updateClass() {
  priceClass.value =
    q.value && q.value.change >= 0 ? 'text-stock-up' : 'text-stock-down'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getQuote(props.code)
    q.value = res.data
    updateClass()
  } catch (e) {
    error.value = e.message || '失敗'
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
  refreshTimer = setInterval(() => { if (isMarketHours()) load(); else stopRefresh() }, 15_000)
}

onMounted(() => { load(); startRefresh() })
watch(() => props.code, () => { load(); startRefresh() })
onUnmounted(stopRefresh)
</script>
