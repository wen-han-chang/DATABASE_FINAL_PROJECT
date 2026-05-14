<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="font-bold text-brand-primary flex items-center gap-2">
        <Lightbulb class="w-4 h-4 text-blue-500" />
        AI 決策沙盒
      </h2>
      <!-- Filter tabs -->
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

    <TransitionGroup name="card-list" tag="div" class="space-y-3">
      <div
        v-for="card in filteredCards"
        :key="card.id"
        class="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden
               hover:border-slate-200 hover:shadow transition-all duration-200"
      >
        <!-- Left accent bar -->
        <div class="flex">
          <div class="w-1 flex-shrink-0" :class="card.accentClass" />

          <div class="flex-1 p-4 space-y-3">
            <!-- Header -->
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-2.5">
                <span
                  class="px-2 py-0.5 rounded-md text-xs font-bold"
                  :class="card.badgeClass"
                >
                  {{ card.actionLabel }}
                </span>
                <div>
                  <p class="font-semibold text-sm text-brand-primary">{{ card.name }}</p>
                  <p class="text-xs text-brand-muted">{{ card.symbol }}</p>
                </div>
              </div>
              <div class="text-right">
                <p class="font-mono font-bold text-brand-primary text-sm">{{ card.price }}</p>
                <p class="text-xs" :class="card.changePositive ? 'text-stock-up' : 'text-stock-down'">
                  {{ card.changePositive ? '+' : '' }}{{ card.change }}%
                </p>
              </div>
            </div>

            <!-- Confidence bar -->
            <div>
              <div class="flex justify-between text-xs text-brand-muted mb-1.5">
                <span>AI 信心度</span>
                <span class="font-semibold text-brand-primary">{{ card.confidence }}%</span>
              </div>
              <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-700"
                  :class="card.barClass"
                  :style="{ width: card.confidence + '%' }"
                />
              </div>
            </div>

            <!-- Reason -->
            <p class="text-xs text-brand-muted leading-relaxed">{{ card.reason }}</p>

            <!-- Tags + 為什麼 -->
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
              <button
                @click="$emit('open-drawer', card.tags[0])"
                class="flex items-center gap-1 text-[11px] text-brand-muted hover:text-blue-500 transition-colors ml-1"
              >
                <HelpCircle class="w-3 h-3" />
                為什麼？
              </button>
            </div>
          </div>
        </div>
      </div>
    </TransitionGroup>

    <p v-if="filteredCards.length === 0" class="text-center text-brand-muted text-sm py-8">
      目前無此類型建議
    </p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Lightbulb, HelpCircle } from 'lucide-vue-next'

defineEmits(['open-drawer'])

const activeTab = ref('ALL')

const tabs = [
  { key: 'ALL',   label: '全部' },
  { key: 'BUY',   label: '買入' },
  { key: 'WATCH', label: '觀望' },
  { key: 'ALERT', label: '警示' },
]

const cards = [
  {
    id:             'tsmc',
    symbol:         '2330',
    name:           '台積電',
    action:         'BUY',
    actionLabel:    '買入',
    accentClass:    'bg-blue-500',
    badgeClass:     'bg-blue-100 text-blue-700',
    barClass:       'bg-blue-500',
    confidence:     82,
    price:          '580.0',
    change:         2.4,
    changePositive: true,
    reason:         '技術面突破整理平台，站上MA240長期均線，外資連買五日，法人籌碼持續流入，適合穩健型分批布局。',
    tags:           ['#站上MA240', '#外資買超', '#多頭排列'],
  },
  {
    id:             'hon',
    symbol:         '2317',
    name:           '鴻海',
    action:         'WATCH',
    actionLabel:    '觀望',
    accentClass:    'bg-amber-400',
    badgeClass:     'bg-amber-50 text-amber-700',
    barClass:       'bg-amber-400',
    confidence:     61,
    price:          '108.5',
    change:         -0.5,
    changePositive: false,
    reason:         '短線量縮橫盤整理中，等待MA5向上穿越MA20確認多方動能，突破前高伴隨量能放大再考慮進場。',
    tags:           ['#量縮整理', '#MA黃金交叉', '#等待確認'],
  },
  {
    id:             'etf',
    symbol:         '0050',
    name:           '元大台灣50',
    action:         'BUY',
    actionLabel:    '買入',
    accentClass:    'bg-green-500',
    badgeClass:     'bg-green-50 text-green-700',
    barClass:       'bg-green-500',
    confidence:     88,
    price:          '145.2',
    change:         1.1,
    changePositive: true,
    reason:         '指數型ETF，大盤技術面多頭格局維持，回測季線獲得支撐，適合長期定期定額投資人持續布局。',
    tags:           ['#季線支撐', '#ETF定存股', '#長期投資'],
  },
  {
    id:             'steel',
    symbol:         '2002',
    name:           '中鋼',
    action:         'ALERT',
    actionLabel:    '警示',
    accentClass:    'bg-red-500',
    badgeClass:     'bg-red-50 text-red-700',
    barClass:       'bg-red-400',
    confidence:     72,
    price:          '26.3',
    change:         -1.8,
    changePositive: false,
    reason:         '跌破MA120中期均線，量增價跌，技術面轉弱訊號出現。若持有部位，請確認停損點設置。',
    tags:           ['#跌破MA120', '#量增價跌', '#法人賣超'],
  },
]

const filteredCards = computed(() =>
  activeTab.value === 'ALL'
    ? cards
    : cards.filter(c => c.action === activeTab.value)
)
</script>

<style scoped>
.card-list-enter-active { transition: all 0.3s ease; }
.card-list-leave-active { transition: all 0.2s ease; position: absolute; width: 100%; }
.card-list-enter-from   { opacity: 0; transform: translateY(10px); }
.card-list-leave-to     { opacity: 0; transform: translateY(-6px); }
.card-list-move         { transition: transform 0.3s ease; }
</style>
