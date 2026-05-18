<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-brand-primary flex items-center gap-2">
          <LineChart class="w-6 h-6 text-emerald-500" />
          股票建議
        </h1>
        <p class="text-sm text-brand-muted mt-1">
          每次進入本頁時，系統都會依最新資料分析下單練習中的股票並產生股票建議。
        </p>
      </div>
      <RouterLink
        to="/assistant/chat"
        class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-primary hover:border-blue-300"
      >
        <MessageSquare class="w-4 h-4" />
        前往 AI 聊天室
      </RouterLink>
    </header>

    <section v-if="loading" class="bg-white rounded-3xl border border-slate-200 p-8 text-center text-brand-muted">
      載入建議中…
    </section>

    <section v-else-if="error" class="bg-white rounded-3xl border border-red-200 p-8 text-center">
      <h2 class="font-bold text-red-600">建議載入失敗</h2>
      <p class="text-sm text-brand-muted mt-2">{{ error }}</p>
    </section>

    <section v-else-if="!recommendation" class="bg-white rounded-3xl border border-slate-200 p-8 text-center">
      <Clock3 class="w-10 h-10 mx-auto text-slate-300 mb-3" />
      <h2 class="font-bold text-brand-primary">目前還沒有建議快照</h2>
      <p class="text-sm text-brand-muted mt-2">
        進入本頁後會自動產生最新分析。
      </p>
    </section>

    <template v-else>
      <section class="bg-brand-primary text-white rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-xs text-slate-300">本次分析</p>
          <h2 class="text-xl font-bold mt-1">{{ slotTitle }}</h2>
          <p class="text-sm text-slate-300 mt-1">
            {{ recommendation.slotDate }}
          </p>
        </div>
        <div class="text-sm text-slate-300">
          重新進入本頁即可再次取得最新建議
        </div>
      </section>

      <section class="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div
          v-for="card in summaryCards"
          :key="card.label"
          class="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm"
        >
          <p class="text-xs text-brand-muted">{{ card.label }}</p>
          <p class="text-xl font-bold mt-2" :class="card.valueClass">{{ card.value }}</p>
          <p class="text-xs text-brand-muted mt-1">{{ card.note }}</p>
        </div>
      </section>

      <section class="space-y-4">
        <div>
          <h2 class="text-lg font-bold text-brand-primary">持股分析</h2>
          <p class="text-sm text-brand-muted mt-1">根據你的下單練習持股，整理目前損益與續抱 / 賣出傾向。</p>
        </div>

        <div v-if="holdingItems.length" class="grid lg:grid-cols-2 gap-4">
          <article
            v-for="item in holdingItems"
            :key="`holding-${item.code}`"
            class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-bold text-brand-primary">{{ item.name }}</p>
                <p class="text-xs text-brand-muted">{{ item.code }}</p>
              </div>
              <span class="text-xs font-bold px-2.5 py-1 rounded-full" :class="actionClass(item.actionCode)">
                {{ item.actionLabel }}
              </span>
            </div>

            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p class="text-xs text-brand-muted">目前價</p>
                <p class="font-semibold">{{ formatNumber(item.price) }}</p>
              </div>
              <div>
                <p class="text-xs text-brand-muted">平均成本</p>
                <p class="font-semibold">{{ formatNumber(item.avgCost) }}</p>
              </div>
              <div>
                <p class="text-xs text-brand-muted">持有股數</p>
                <p class="font-semibold">{{ item.shares?.toLocaleString('zh-TW') }}</p>
              </div>
              <div>
                <p class="text-xs text-brand-muted">帳面損益</p>
                <p class="font-semibold" :class="profitClass(item.pnl)">
                  {{ signedMoney(item.pnl) }}（{{ signedPct(item.pnlPct) }}）
                </p>
              </div>
            </div>

            <p class="text-sm leading-7 text-brand-muted">{{ item.reason }}</p>
          </article>
        </div>
        <div v-else class="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-brand-muted">
          目前沒有持股，因此沒有持股分析。
        </div>
      </section>

      <section class="space-y-4">
        <div>
          <h2 class="text-lg font-bold text-brand-primary">自選清單分析</h2>
          <p class="text-sm text-brand-muted mt-1">針對你加入自選清單的股票，整理是否值得進場。</p>
        </div>

        <div v-if="watchlistItems.length" class="grid lg:grid-cols-2 gap-4">
          <article
            v-for="item in watchlistItems"
            :key="`watch-${item.code}`"
            class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-bold text-brand-primary">{{ item.name }}</p>
                <p class="text-xs text-brand-muted">{{ item.code }}</p>
              </div>
              <span class="text-xs font-bold px-2.5 py-1 rounded-full" :class="actionClass(item.actionCode)">
                {{ item.actionLabel }}
              </span>
            </div>

            <div>
              <p class="text-xs text-brand-muted">目前價</p>
              <p class="font-semibold">{{ formatNumber(item.price) }}</p>
            </div>

            <p class="text-sm leading-7 text-brand-muted">{{ item.reason }}</p>
          </article>
        </div>
        <div v-else class="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-brand-muted">
          目前沒有自選股票。
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Clock3, LineChart, MessageSquare } from 'lucide-vue-next'
import { getLatestRecommendationApi } from '@/services/api'

const recommendation = ref(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const result = await getLatestRecommendationApi()
    recommendation.value = result.recommendation
  } catch (err) {
    error.value = err?.message || '目前無法取得股票建議。'
  } finally {
    loading.value = false
  }
})

const holdingItems = computed(() =>
  recommendation.value?.items?.filter((item) => item.category === 'holding') || [],
)

const watchlistItems = computed(() =>
  recommendation.value?.items?.filter((item) => item.category === 'watchlist') || [],
)

const holdingSummary = computed(() =>
  recommendation.value?.summary?.holdingSummary || {
    holdingCount: 0,
    totalCost: 0,
    totalValue: 0,
    totalPnl: 0,
    totalPnlPct: 0,
    profitableCount: 0,
    losingCount: 0,
  },
)

const slotTitle = computed(() => {
  if (recommendation.value?.slotLabel === '0830') return '08:30 盤前建議'
  if (recommendation.value?.slotLabel === '1350') return '13:50 盤中建議'
  return '即時股票建議'
})

const summaryCards = computed(() => [
  {
    label: '目前持股檔數',
    value: `${holdingSummary.value.holdingCount} 檔`,
    note: `獲利 ${holdingSummary.value.profitableCount} 檔 / 虧損 ${holdingSummary.value.losingCount} 檔`,
    valueClass: 'text-brand-primary',
  },
  {
    label: '持股總成本',
    value: `${formatMoney(holdingSummary.value.totalCost)} 元`,
    note: '以下單練習中的平均成本計算',
    valueClass: 'text-brand-primary',
  },
  {
    label: '目前持股市值',
    value: `${formatMoney(holdingSummary.value.totalValue)} 元`,
    note: '依最近一次可取得價格估算',
    valueClass: 'text-brand-primary',
  },
  {
    label: '帳面總損益',
    value: signedMoney(holdingSummary.value.totalPnl),
    note: signedPct(holdingSummary.value.totalPnlPct),
    valueClass: profitClass(holdingSummary.value.totalPnl),
  },
])

function formatNumber(value) {
  return value == null ? '—' : Number(value).toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function signedMoney(value) {
  const n = Number(value || 0)
  return `${n >= 0 ? '+' : '-'}${formatMoney(Math.abs(n))} 元`
}

function signedPct(value) {
  const n = Number(value || 0)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function profitClass(value) {
  return Number(value || 0) >= 0 ? 'text-stock-up' : 'text-stock-down'
}

function actionClass(code) {
  if (['hold', 'consider_buy'].includes(code)) {
    return 'bg-red-50 text-red-600'
  }
  if (['reduce_or_sell', 'avoid_entry'].includes(code)) {
    return 'bg-emerald-50 text-emerald-700'
  }
  if (code === 'take_profit') {
    return 'bg-amber-50 text-amber-700'
  }
  return 'bg-slate-100 text-slate-600'
}
</script>
