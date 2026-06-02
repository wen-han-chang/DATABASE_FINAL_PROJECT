<template>
  <div class="space-y-4">
    <div class="bg-brand-primary rounded-2xl p-6 text-white">
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span class="text-xs text-blue-300 font-semibold uppercase tracking-widest">市場總覽</span>
          </div>

          <div v-if="loading" class="space-y-2 mt-1">
            <div v-for="i in 3" :key="i" class="h-3 bg-white/10 rounded animate-pulse"
              :style="{ width: ['95%','85%','70%'][i - 1] }" />
          </div>

          <div v-else-if="error" class="rounded-xl bg-red-500/15 border border-red-400/30 px-4 py-3">
            <p class="text-sm text-red-100">{{ error }}</p>
          </div>

          <p v-else class="text-sm leading-7 text-slate-200">
            {{ marketSummary }}
          </p>
        </div>

        <BrainCircuit class="w-10 h-10 text-blue-400 flex-shrink-0 opacity-70" />
      </div>

      <div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-white/10">
        <span v-for="pill in sentimentPills" :key="pill.label"
          class="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-medium"
          :class="pillClass(pill)"
        >
          <component :is="pill.icon" class="w-3 h-3" />
          {{ pill.label }}
        </span>
      </div>
    </div>

    <Transition name="fade">
      <div v-if="showQuestion && strongestSector"
        class="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3"
      >
        <div class="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
          <MessageCircle class="w-4 h-4 text-blue-500" />
        </div>
        <div class="flex-1">
          <p class="text-sm font-semibold text-brand-primary mb-1">今日強勢族群：{{ strongestSector.name }}</p>
          <p class="text-sm text-brand-muted leading-relaxed">
            {{ strongestSector.name }}收盤漲跌幅為 {{ signedPercent(strongestSector.changePct) }}，
            可進一步觀察同族群個股是否同步放量或突破短期壓力。
          </p>
          <div class="flex items-center gap-3 mt-3">
            <button
              @click="$emit('open-drawer', sectorKbKey(strongestSector.name))"
              class="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              查看族群說明
            </button>
            <button
              @click="showQuestion = false"
              class="text-xs text-brand-muted hover:text-brand-primary transition-colors"
            >
              稍後再看
            </button>
          </div>
        </div>
        <button @click="showQuestion = false" class="text-slate-300 hover:text-slate-500 flex-shrink-0">
          <X class="w-4 h-4" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { BrainCircuit, MessageCircle, TrendingUp, TrendingDown, Minus, X } from 'lucide-vue-next'
import { getMarketIndex } from '@/services/twseApi'

defineEmits(['open-drawer'])

const SECTOR_KB_KEY = {
  // 半導體
  '半導體類指數':         '#半導體',
  // 電子相關
  '電子工業類指數':       '#電子',
  '電腦及週邊設備類指數': '#電子',
  '其他電子類指數':       '#電子',
  '光電類指數':           '#電子',
  '通信網路類指數':       '#電子',
  '電子零組件類指數':     '#電子',
  '電子通路類指數':       '#電子',
  '資訊服務類指數':       '#電子',
  '數位雲端類指數':       '#電子',
  '機電類指數':           '#電子',
  '電機機械類指數':       '#電子',
  '電器電纜類指數':       '#電子',
  // 金融
  '金融保險類指數':       '#金融',
  // 航運
  '航運類指數':           '#航運',
  // 鋼鐵
  '鋼鐵類指數':           '#鋼鐵',
  // 生技
  '生技醫療類指數':       '#生技',
  '化學生技醫療類指數':   '#生技',
  // 傳產
  '塑膠類指數':           '#傳產',
  '塑膠化工類指數':       '#傳產',
  '紡織纖維類指數':       '#傳產',
  '食品類指數':           '#傳產',
  '化學類指數':           '#傳產',
  '橡膠類指數':           '#傳產',
  '汽車類指數':           '#傳產',
  '造紙類指數':           '#傳產',
  '水泥類指數':           '#傳產',
  '水泥窯製類指數':       '#傳產',
  '玻璃陶瓷類指數':       '#傳產',
  '貿易百貨類指數':       '#傳產',
  '油電燃氣類指數':       '#傳產',
  '建材營造類指數':       '#傳產',
  '觀光餐旅類指數':       '#傳產',
  '運動休閒類指數':       '#傳產',
  '居家生活類指數':       '#傳產',
  // 其他
  '綠能環保類指數':       '#台股',
  '其他類指數':           '#台股',
}

function sectorKbKey(name) {
  return SECTOR_KB_KEY[name] || `#${name}`
}

const loading = ref(true)
const error = ref('')
const rows = ref([])
const showQuestion = ref(false)

function parseNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function findIndexRow(name) {
  return rows.value.find((row) => row['指數'] === name) || null
}

function normalizeRow(row) {
  if (!row) return null
  return {
    name: row['指數'],
    close: parseNumber(row['收盤指數']),
    changePoint: parseNumber(row['漲跌點數']),
    changePct: parseNumber(row['漲跌百分比']),
    sign: row['漲跌'] === '-' ? -1 : 1,
    date: row['日期'],
  }
}

function signedPercent(value) {
  const n = Number(value) || 0
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function formatIndex(value) {
  return Number(value || 0).toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const taiex = computed(() => normalizeRow(findIndexRow('發行量加權股價指數')))
const taiwan50 = computed(() => normalizeRow(findIndexRow('臺灣50指數')))
const electronics = computed(() => normalizeRow(findIndexRow('電子工業類指數')))
const finance = computed(() => normalizeRow(findIndexRow('金融保險類指數')))

const sectorRows = computed(() =>
  rows.value
    .map(normalizeRow)
    .filter((row) => row?.name?.endsWith('類指數'))
    .sort((a, b) => b.changePct - a.changePct),
)

const strongestSector = computed(() => sectorRows.value[0] || null)
const weakestSector = computed(() => sectorRows.value.at(-1) || null)

const marketSummary = computed(() => {
  if (!taiex.value) return '尚未取得 TWSE 市場指數資料。'
  const leader = strongestSector.value
  const laggard = weakestSector.value
  const parts = [
    `加權指數收在 ${formatIndex(taiex.value.close)}，漲跌幅 ${signedPercent(taiex.value.changePct)}。`,
  ]
  if (taiwan50.value) parts.push(`臺灣50指數 ${signedPercent(taiwan50.value.changePct)}。`)
  if (electronics.value) parts.push(`電子類股 ${signedPercent(electronics.value.changePct)}。`)
  if (finance.value) parts.push(`金融保險 ${signedPercent(finance.value.changePct)}。`)
  if (leader && laggard) {
    parts.push(`盤面較強族群為${leader.name}，較弱族群為${laggard.name}。`)
  }
  return parts.join(' ')
})

const sentimentPills = computed(() => {
  const base = [
    taiex.value && { label: `加權 ${signedPercent(taiex.value.changePct)}`, value: taiex.value.changePct },
    taiwan50.value && { label: `臺灣50 ${signedPercent(taiwan50.value.changePct)}`, value: taiwan50.value.changePct },
    electronics.value && { label: `電子 ${signedPercent(electronics.value.changePct)}`, value: electronics.value.changePct },
    finance.value && { label: `金融 ${signedPercent(finance.value.changePct)}`, value: finance.value.changePct },
  ].filter(Boolean)

  return base.map((item) => ({
    ...item,
    icon: item.value > 0 ? TrendingUp : item.value < 0 ? TrendingDown : Minus,
  }))
})

function pillClass(pill) {
  if (pill.value > 0) return 'bg-green-500/20 text-green-300'
  if (pill.value < 0) return 'bg-red-500/20 text-red-300'
  return 'bg-white/10 text-slate-300'
}

onMounted(async () => {
  loading.value = true
  error.value = ''
  try {
    const payload = await getMarketIndex()
    rows.value = Array.isArray(payload.data) ? payload.data : []
    setTimeout(() => { showQuestion.value = true }, 600)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active { transition: all 0.35s ease; }
.fade-enter-from   { opacity: 0; transform: translateY(-8px); }
.fade-leave-to     { opacity: 0; transform: translateY(-4px); }
</style>
