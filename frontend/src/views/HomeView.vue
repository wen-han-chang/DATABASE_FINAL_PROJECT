<template>
  <div class="p-6 space-y-6 max-w-screen-xl mx-auto">
    <!-- Top bar: greeting + profile badge -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-brand-primary">歡迎回來</h1>
        <p class="text-brand-muted text-sm mt-0.5">{{ formattedDate }}</p>
      </div>
      <div class="flex items-center gap-2 bg-white rounded-xl px-4 py-2.5 shadow-sm border border-slate-100">
        <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span class="text-xs font-medium text-brand-muted">AI 分析中</span>
      </div>
    </div>

    <!-- 後端串接驗證面板：預設隱藏，需要時才展開（給 demo / 除錯用，不干擾首頁） -->
    <div>
      <button
        @click="showTwsePanel = !showTwsePanel"
        class="text-xs text-brand-muted hover:text-brand-primary inline-flex items-center gap-1
               border border-slate-200 rounded-lg px-3 py-1.5 bg-white"
      >
        <span>{{ showTwsePanel ? '▾' : '▸' }}</span>
        後端 TWSE 串接驗證（{{ showTwsePanel ? '點此收起' : '點此展開' }}）
      </button>
      <div v-if="showTwsePanel" class="mt-3">
        <TwseMarketPanel />
      </div>
    </div>

    <!-- AI Market Summary + proactive question -->
    <MarketAIView @open-drawer="openDrawer" />

    <!-- Main grid: K-line chart + Decision sidebar -->
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
      <!-- K-line chart (wider) -->
      <div class="xl:col-span-7">
        <StockChart />
      </div>
      <!-- Decision sandbox (narrower) -->
      <div class="xl:col-span-5">
        <DecisionSandbox @open-drawer="openDrawer" />
      </div>
    </div>

    <!-- Knowledge Drawer -->
    <KnowledgeDrawer
      :is-open="drawerOpen"
      :term="drawerTerm"
      @close="drawerOpen = false"
      @navigate="navigateTerm"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import MarketAIView    from '@/components/MarketAIView.vue'
import StockChart      from '@/components/StockChart.vue'
import DecisionSandbox from '@/components/DecisionSandbox.vue'
import KnowledgeDrawer from '@/components/KnowledgeDrawer.vue'
import TwseMarketPanel from '@/components/TwseMarketPanel.vue'

const drawerOpen   = ref(false)
const drawerTerm   = ref('')
const showTwsePanel = ref(false)   // 後端串接驗證面板，預設隱藏

const formattedDate = computed(() => {
  return new Date().toLocaleDateString('zh-TW', {
    year:    'numeric',
    month:   'long',
    day:     'numeric',
    weekday: 'long',
  })
})

function openDrawer(tag) {
  drawerTerm.value = tag
  drawerOpen.value = true
}

function navigateTerm(tag) {
  drawerTerm.value = tag
}
</script>
