<template>
  <div class="p-6 max-w-5xl mx-auto h-full flex flex-col gap-5">
    <header>
      <h1 class="text-2xl font-bold text-brand-primary flex items-center gap-2">
        <Bot class="w-6 h-6 text-blue-500" />
        AI 助理
      </h1>
      <p class="text-sm text-brand-muted mt-1">
        可詢問台股個股、ETF、技術面、成分股與資料型推薦；非台股問題會直接婉拒。
      </p>
    </header>

    <section class="bg-white border border-slate-200 rounded-2xl shadow-sm flex-1 min-h-[520px] flex flex-col overflow-hidden">
      <div ref="messageWrap" class="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/70">
        <article
          v-for="(message, index) in messages"
          :key="index"
          class="flex"
          :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div class="max-w-[80%] space-y-2">
            <div
              class="rounded-2xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap"
              :class="message.role === 'user'
                ? 'bg-brand-primary text-white rounded-br-md'
                : 'bg-white text-brand-primary border border-slate-200 rounded-bl-md'"
            >
              {{ message.content }}
            </div>

            <div
              v-if="message.role === 'assistant' && message.evidence?.length"
              class="bg-white border border-blue-100 rounded-2xl rounded-bl-md p-4 text-xs text-brand-primary shadow-sm"
            >
              <p class="font-semibold text-blue-600 mb-3">本次分析依據</p>
              <div class="space-y-3">
                <div
                  v-for="item in message.evidence"
                  :key="evidenceKey(item)"
                  class="rounded-xl border p-3"
                  :class="item.kind === 'screening'
                    ? 'bg-amber-50/70 border-amber-100'
                    : 'bg-slate-50 border-slate-100'"
                >
                  <template v-if="item.kind === 'stock_analysis'">
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                      <span class="font-semibold text-sm">{{ item.code }} {{ item.name }}</span>
                      <span class="text-brand-muted">{{ item.asOfDate }}</span>
                      <span class="text-brand-muted">收盤 {{ formatValue(item.close) }}</span>
                      <span v-if="item.fundamentals?.priceAdjusted" class="text-blue-600 font-semibold">
                        已用最新價校正
                      </span>
                    </div>
                    <div class="grid sm:grid-cols-4 gap-2 mb-3">
                      <div class="rounded-lg bg-white/80 px-2 py-1">
                        <span class="text-brand-muted">殖利率</span>
                        <span class="ml-1 font-semibold">{{ formatValue(item.fundamentals?.dividendYield) }}%</span>
                      </div>
                      <div class="rounded-lg bg-white/80 px-2 py-1">
                        <span class="text-brand-muted">PE</span>
                        <span class="ml-1 font-semibold">{{ formatValue(item.fundamentals?.peRatio) }}</span>
                      </div>
                      <div class="rounded-lg bg-white/80 px-2 py-1">
                        <span class="text-brand-muted">PB</span>
                        <span class="ml-1 font-semibold">{{ formatValue(item.fundamentals?.pbRatio) }}</span>
                      </div>
                      <div class="rounded-lg bg-white/80 px-2 py-1">
                        <span class="text-brand-muted">技術分</span>
                        <span class="ml-1 font-semibold">{{ formatValue(item.technical?.technicalRules?.scoring?.totalScore) }}</span>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <span :class="badgeClass(item.technical?.movingAverages?.structure)">
                        MA {{ item.technical?.movingAverages?.structure || '資料不足' }}
                      </span>
                      <span :class="badgeClass(item.technical?.kd?.signal)">
                        KD {{ item.technical?.kd?.signal || '資料不足' }}
                      </span>
                      <span :class="badgeClass(item.technical?.rsi?.signal)">
                        RSI14 {{ formatValue(item.technical?.rsi?.rsi14) }} · {{ item.technical?.rsi?.signal || '資料不足' }}
                      </span>
                      <span :class="badgeClass(item.technical?.macd?.signal)">
                        MACD {{ item.technical?.macd?.signal || '資料不足' }}
                      </span>
                      <span :class="badgeClass(item.technical?.bollinger?.signal)">
                        BB {{ item.technical?.bollinger?.signal || '資料不足' }}
                      </span>
                    </div>
                    <p v-if="item.fundamentals?.priceAdjusted" class="text-brand-muted mt-2">
                      基準價 {{ formatValue(item.fundamentals?.rawClosePrice) }}，校正價 {{ formatValue(item.fundamentals?.valuationPrice) }}
                    </p>
                    <p
                      v-if="valuationUnavailableReason(item.fundamentals, 'peRatio')"
                      class="text-orange-700 mt-2"
                    >
                      PE：{{ valuationUnavailableReason(item.fundamentals, 'peRatio') }}
                    </p>
                  </template>

                  <template v-else-if="item.kind === 'technical'">
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                      <span class="font-semibold text-sm">{{ item.code }}</span>
                      <span class="text-brand-muted">{{ item.asOfDate }}</span>
                      <span class="text-brand-muted">收盤 {{ formatValue(item.close) }}</span>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <span :class="badgeClass(item.movingAverages?.structure)">
                        MA {{ item.movingAverages?.structure || '資料不足' }}
                      </span>
                      <span :class="badgeClass(item.kd?.signal)">
                        KD {{ item.kd?.signal || '資料不足' }}
                      </span>
                      <span :class="badgeClass(item.rsi?.signal)">
                        RSI14 {{ formatValue(item.rsi?.rsi14) }} · {{ item.rsi?.signal || '資料不足' }}
                      </span>
                      <span :class="badgeClass(item.macd?.signal)">
                        MACD {{ item.macd?.signal || '資料不足' }}
                      </span>
                      <span :class="badgeClass(item.bollinger?.signal)">
                        BB {{ item.bollinger?.signal || '資料不足' }}
                      </span>
                    </div>
                  </template>

                  <template v-else-if="item.kind === 'fundamentals'">
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                      <span class="font-semibold text-sm">{{ item.code }} {{ item.name }}</span>
                      <span class="text-brand-muted">{{ item.tradeDate }}</span>
                      <span v-if="item.priceAdjusted" class="text-blue-600 font-semibold">
                        已用最新價校正
                      </span>
                    </div>
                    <div class="grid sm:grid-cols-3 gap-2 mb-2">
                      <div class="rounded-lg bg-white/80 px-2 py-1">
                        <span class="text-brand-muted">殖利率</span>
                        <span class="ml-1 font-semibold">{{ formatValue(item.dividendYield) }}%</span>
                      </div>
                      <div class="rounded-lg bg-white/80 px-2 py-1">
                        <span class="text-brand-muted">PE</span>
                        <span class="ml-1 font-semibold">{{ formatValue(item.peRatio) }}</span>
                      </div>
                      <div class="rounded-lg bg-white/80 px-2 py-1">
                        <span class="text-brand-muted">PB</span>
                        <span class="ml-1 font-semibold">{{ formatValue(item.pbRatio) }}</span>
                      </div>
                    </div>
                    <p v-if="item.priceAdjusted" class="text-brand-muted">
                      基準價 {{ formatValue(item.rawClosePrice) }}，校正價 {{ formatValue(item.valuationPrice) }}
                    </p>
                    <p
                      v-if="valuationUnavailableReason(item, 'peRatio')"
                      class="text-orange-700 mt-2"
                    >
                      PE：{{ valuationUnavailableReason(item, 'peRatio') }}
                    </p>
                  </template>

                  <template v-else>
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="inline-flex items-center justify-center min-w-6 h-6 rounded-full bg-amber-500 text-white font-bold">
                          {{ item.rank }}
                        </span>
                        <span class="font-semibold text-sm">{{ item.code }} {{ item.name }}</span>
                        <span
                          v-if="item.universeLabel"
                          class="inline-flex items-center rounded-full bg-white text-amber-700 border border-amber-100 px-2.5 py-1"
                        >
                          範圍：{{ item.universeLabel }}
                        </span>
                      </div>
                      <span class="text-amber-700 font-semibold">{{ scoreLabel(item) }} {{ formatValue(item.score) }}</span>
                    </div>
                    <p
                      v-if="item.dataBasis && item.rank === 1"
                      class="text-brand-muted mb-2"
                    >
                      資料：{{ item.dataBasis.price }}；{{ item.dataBasis.fundamentals }}；{{ item.dataBasis.technicals }}
                    </p>
                    <p
                      v-if="item.industryConcentration?.hasConcentration && item.rank === 1"
                      class="rounded-lg bg-orange-100/70 text-orange-800 border border-orange-200 px-2 py-1 mb-2"
                    >
                      產業集中提示：{{ industryConcentrationLabel(item) }}
                    </p>
                    <div class="grid sm:grid-cols-3 gap-2 mb-2">
                      <div
                        v-if="showEtfWeight(item)"
                        class="rounded-lg bg-white/80 px-2 py-1"
                      >
                        <span class="text-brand-muted">ETF 權重</span>
                        <span class="ml-1 font-semibold">{{ formatValue(item.weight) }}%</span>
                      </div>
                      <div
                        v-if="showDividendYield(item)"
                        class="rounded-lg bg-white/80 px-2 py-1"
                      >
                        <span class="text-brand-muted">殖利率</span>
                        <span class="ml-1 font-semibold">{{ dividendYieldLabel(item) }}</span>
                      </div>
                      <div
                        v-if="showValuation(item)"
                        class="rounded-lg bg-white/80 px-2 py-1"
                      >
                        <span class="text-brand-muted">PE / PB</span>
                        <span class="ml-1 font-semibold">
                          {{ formatValue(item.fundamentals?.peRatio) }} / {{ formatValue(item.fundamentals?.pbRatio) }}
                        </span>
                      </div>
                    </div>
                    <div
                      v-if="factorBreakdownItems(item).length"
                      class="grid sm:grid-cols-4 gap-2 mb-2"
                    >
                      <div
                        v-for="factor in factorBreakdownItems(item)"
                        :key="factor.factor"
                        class="rounded-lg bg-white/80 px-2 py-1"
                      >
                        <span class="text-brand-muted">{{ factor.label }}</span>
                        <span class="ml-1 font-semibold">{{ factor.rankLabel }}</span>
                        <span class="ml-1 text-brand-muted">{{ factor.valueLabel }}</span>
                      </div>
                    </div>
                    <div
                      v-if="item.industry || item.topics?.length"
                      class="flex flex-wrap gap-2 mb-2"
                    >
                      <span
                        v-if="item.industry"
                        class="inline-flex items-center rounded-full bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1"
                      >
                        產業：{{ item.industry }}
                      </span>
                      <span
                        v-for="topic in item.topics"
                        :key="topic.code"
                        class="inline-flex items-center rounded-full bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-100 px-2.5 py-1"
                      >
                        題材：{{ topic.name }}
                      </span>
                    </div>
                    <p
                      v-if="valuationUnavailableReason(item.fundamentals, 'peRatio')"
                      class="text-orange-700 mb-2"
                    >
                      PE：{{ valuationUnavailableReason(item.fundamentals, 'peRatio') }}
                    </p>
                    <div class="flex flex-wrap gap-2">
                      <span
                        v-for="factor in rankingLabels(item)"
                        :key="factor"
                        class="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-1"
                      >
                        {{ factor }}
                      </span>
                      <span
                        v-for="reason in item.technicalReasons"
                        :key="reason"
                        class="inline-flex items-center rounded-full bg-white text-brand-primary border border-amber-100 px-2.5 py-1"
                      >
                        {{ reason }}
                      </span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article v-if="loading" class="flex justify-start">
          <div class="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-slate-300 animate-bounce" />
              <span class="w-2 h-2 rounded-full bg-slate-300 animate-bounce [animation-delay:120ms]" />
              <span class="w-2 h-2 rounded-full bg-slate-300 animate-bounce [animation-delay:240ms]" />
            </div>
            <p v-if="slowNotice" class="text-xs text-brand-muted mt-2">
              資料量較大，仍在整理分析結果...
            </p>
          </div>
        </article>
      </div>

      <form class="border-t border-slate-200 bg-white p-4" @submit.prevent="sendMessage">
        <div class="flex gap-3">
          <textarea
            v-model="draft"
            rows="2"
            placeholder="例如：請幫我分析 2330 最近走勢，或比較 0050 與 0056"
            class="flex-1 resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <button
            type="submit"
            :disabled="loading || !draft.trim()"
            class="self-end rounded-2xl bg-blue-500 text-white px-5 py-3 text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            送出
          </button>
        </div>
        <p v-if="error" class="text-sm text-red-500 mt-2">{{ error }}</p>
      </form>
    </section>
  </div>
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { Bot } from 'lucide-vue-next'
import { chatAssistantApi } from '@/services/api'
import { useAssistantStore } from '@/stores/assistant'

const assistant = useAssistantStore()
const messages = assistant.messages
const draft = ref('')
const loading = ref(false)
const error = ref('')
const messageWrap = ref(null)
const slowNotice = ref(false)
let slowNoticeTimer = null

function formatValue(value) {
  return value == null ? '—' : value
}

function evidenceKey(item) {
  if (item.kind === 'screening') return `screening-${item.rank}-${item.code}`
  if (item.kind === 'stock_analysis') return `stock-analysis-${item.code}-${item.asOfDate}`
  if (item.kind === 'fundamentals') return `fundamentals-${item.code}-${item.tradeDate}`
  return `technical-${item.code}-${item.asOfDate}`
}

function badgeClass(signal) {
  const positiveSignals = ['多頭排列', '黃金交叉', '偏強', '多方增強', '位於中軌之上', '接近或突破上軌']
  const negativeSignals = ['空頭排列', '死亡交叉', '偏弱', '偏弱整理', '空方增強', '位於中軌之下', '接近或跌破下軌']

  if (positiveSignals.includes(signal)) {
    return 'inline-flex items-center rounded-full bg-red-50 text-red-600 border border-red-100 px-2.5 py-1'
  }
  if (negativeSignals.includes(signal)) {
    return 'inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1'
  }
  return 'inline-flex items-center rounded-full bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-1'
}

function rankingFactorLabel(factor) {
  return {
    technical_strength: '技術面',
    dividend_yield: '殖利率',
    low_pe: '低本益比',
    low_pb: '低股價淨值比',
    etf_weight: 'ETF 權重',
  }[factor] || factor
}

function showEtfWeight(item) {
  return item.universeType === 'etf_holdings' && item.weight != null
}

function showDividendYield(item) {
  return item.fundamentals?.dividendYield != null
}

function dividendYieldLabel(item) {
  const value = item.fundamentals?.dividendYield
  if (value == null) return '—'
  return Number(value) === 0 ? '近年未配息' : `${value}%`
}

function showValuation(item) {
  return item.fundamentals?.peRatio != null || item.fundamentals?.pbRatio != null
}

function valuationUnavailableReason(fundamentals, field) {
  const detail = fundamentals?.valuationAvailability?.[field]
  return detail && detail.available === false ? detail.reason : ''
}

function rankingLabels(item) {
  const factors = item.rankingFactors || []
  const isComposite = ['technical_strength', 'dividend_yield', 'low_pe', 'low_pb']
    .every((factor) => factors.includes(factor))
  if (isComposite) return ['綜合評估']
  return factors.map(rankingFactorLabel)
}

function scoreLabel(item) {
  return rankingLabels(item).includes('綜合評估') ? '綜合分數' : '分數'
}

function factorValueLabel(factor, value, available = true) {
  if (!available) return '資料不足'
  if (value == null) return ''
  if (factor === 'dividend_yield' || factor === 'etf_weight') return `${value}%`
  if (factor === 'technical_strength') return `分數 ${value}`
  return value
}

function factorBreakdownItems(item) {
  const breakdown = item.factorBreakdown || {}
  return Object.entries(breakdown).map(([factor, detail]) => ({
    factor,
    label: rankingFactorLabel(factor),
    rank: detail.rank,
    total: detail.total,
    rankLabel: detail.rank ? `#${detail.rank}${detail.total ? `/${detail.total}` : ''}` : '—',
    valueLabel: factorValueLabel(factor, detail.value, detail.available !== false),
  }))
}

function industryConcentrationLabel(item) {
  const groups = item.industryConcentration?.groups || []
  if (!groups.length) return '推薦名單中有多檔屬於相同產業，需留意同產業風險。'
  return groups.map((group) => `${group.industry} ${group.count} 檔`).join('、')
}

async function scrollToBottom() {
  await nextTick()
  if (messageWrap.value) {
    messageWrap.value.scrollTop = messageWrap.value.scrollHeight
  }
}

async function sendMessage() {
  const content = draft.value.trim()
  if (!content || loading.value) return

  assistant.appendMessage({ role: 'user', content })
  draft.value = ''
  error.value = ''
  loading.value = true
  slowNotice.value = false
  if (slowNoticeTimer) window.clearTimeout(slowNoticeTimer)
  slowNoticeTimer = window.setTimeout(() => {
    slowNotice.value = true
  }, 20000)
  await scrollToBottom()

  try {
    const result = await chatAssistantApi(content)
    assistant.appendMessage({
      role: 'assistant',
      content: result.reply,
      evidence: result.evidence || [],
    })
  } catch (err) {
    error.value = err?.message || 'AI 助理暫時無法回覆。'
  } finally {
    if (slowNoticeTimer) {
      window.clearTimeout(slowNoticeTimer)
      slowNoticeTimer = null
    }
    slowNotice.value = false
    loading.value = false
    await scrollToBottom()
  }
}
</script>
