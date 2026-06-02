<template>
  <div class="p-6 space-y-6 max-w-screen-xl mx-auto">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-brand-primary">首頁總覽</h1>
        <p class="text-brand-muted text-sm mt-0.5">{{ formattedDate }}</p>
      </div>
      <div class="flex items-center gap-2 bg-white rounded-xl px-4 py-2.5 shadow-sm border border-slate-100">
        <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span class="text-xs font-medium text-brand-muted">API 資料同步中</span>
      </div>
    </div>

    <MarketAIView @open-drawer="openDrawer" />

    <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
      <div class="xl:col-span-7">
        <MarketIndexOverview />
      </div>
      <div class="xl:col-span-5">
        <DecisionSandbox @open-drawer="openDrawer" />
      </div>
    </div>

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
import MarketAIView from '@/components/MarketAIView.vue'
import MarketIndexOverview from '@/components/MarketIndexOverview.vue'
import DecisionSandbox from '@/components/DecisionSandbox.vue'
import KnowledgeDrawer from '@/components/KnowledgeDrawer.vue'

const drawerOpen = ref(false)
const drawerTerm = ref('')

const formattedDate = computed(() =>
  new Date().toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }),
)

function openDrawer(tag) {
  drawerTerm.value = tag
  drawerOpen.value = true
}

function navigateTerm(tag) {
  drawerTerm.value = tag
}
</script>
