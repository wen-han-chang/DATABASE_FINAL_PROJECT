<template>
  <div class="space-y-4">
    <!-- AI summary card -->
    <div class="bg-brand-primary rounded-2xl p-6 text-white">
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span class="text-xs text-blue-300 font-semibold uppercase tracking-widest">AI 盤勢解讀</span>
          </div>

          <!-- Skeleton while loading -->
          <div v-if="loading" class="space-y-2 mt-1">
            <div v-for="i in 3" :key="i" class="h-3 bg-white/10 rounded animate-pulse"
              :style="{ width: ['95%','85%','70%'][i-1] }" />
          </div>

          <p v-else class="text-sm leading-7 text-slate-200">
            {{ currentSummary }}
          </p>
        </div>

        <BrainCircuit class="w-10 h-10 text-blue-400 flex-shrink-0 opacity-70" />
      </div>

      <!-- Sentiment pills -->
      <div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-white/10">
        <span v-for="pill in sentimentPills" :key="pill.label"
          class="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-medium"
          :class="pill.positive ? 'bg-green-500/20 text-green-300' : pill.negative ? 'bg-red-500/20 text-red-300' : 'bg-white/10 text-slate-300'"
        >
          <component :is="pill.icon" class="w-3 h-3" />
          {{ pill.label }}
        </span>
      </div>
    </div>

    <!-- Proactive system question -->
    <Transition name="fade">
      <div v-if="showQuestion"
        class="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3"
      >
        <div class="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
          <MessageCircle class="w-4 h-4 text-blue-500" />
        </div>
        <div class="flex-1">
          <p class="text-sm font-semibold text-brand-primary mb-1">{{ proactiveQuestion.title }}</p>
          <p class="text-sm text-brand-muted leading-relaxed">{{ proactiveQuestion.body }}</p>
          <div class="flex items-center gap-3 mt-3">
            <button
              @click="$emit('open-drawer', proactiveQuestion.tag)"
              class="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              {{ proactiveQuestion.cta }}
            </button>
            <button
              @click="showQuestion = false"
              class="text-xs text-brand-muted hover:text-brand-primary transition-colors"
            >
              稍後再說
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
import { ref, onMounted } from 'vue'
import { BrainCircuit, MessageCircle, TrendingUp, TrendingDown, Minus, X } from 'lucide-vue-next'
import { useInvestorStore } from '@/stores/investor'

defineEmits(['open-drawer'])

const store       = useInvestorStore()
const loading     = ref(true)
const showQuestion = ref(false)

const summaries = [
  `本週台股加權指數收 18,420 點，週線上漲 1.2%。科技族群持續引領大盤，半導體類股法人連買五日，台積電突破近期整理平台。根據您的「${store.profileLabel}」風格，目前盤面技術面偏多，量能仍在擴增中，建議關注核心持股是否維持在主要均線上方。`,
  `美股四大指數週線收紅，AI 概念股動能不減，帶動台股電子權值股走揚。外資單週買超逾 80 億，籌碼面轉趨積極。依您的投資偏好，可考慮在 K 線圖技術訊號確認後，適度提高核心持倉比例，但留意美債殖利率走向帶來的波動風險。`,
  `台股本週在 18,000 點整數關卡附近整理，成交量較前週縮減 15%，呈現量縮橫盤格局。此為強勢股整理的健康型態，籌碼逐步收斂。建議以均線多頭排列且量縮整理的個股為優先觀察對象，等待量能回升再行進場。`,
]

const currentSummary = ref('')

const sentimentPills = [
  { label: '指數 +1.2%',   positive: true,  negative: false, icon: TrendingUp   },
  { label: '外資買超',     positive: true,  negative: false, icon: TrendingUp   },
  { label: 'VIX 14.8',    positive: false, negative: false, icon: Minus        },
  { label: '量能擴增',     positive: true,  negative: false, icon: TrendingUp   },
]

const proactiveQuestion = {
  title: '我注意到您關注的個股出現 MA5 黃金交叉訊號',
  body:  'MA5 向上穿越 MA20，短線動能轉強，配合近日量能擴增，技術面出現潛在買入訊號。依您的投資風格，是否要進一步了解這個訊號的意義？',
  tag:   '#MA黃金交叉',
  cta:   '了解黃金交叉',
}

onMounted(() => {
  currentSummary.value = summaries[Math.floor(Date.now() / 86400000) % summaries.length]
  setTimeout(() => {
    loading.value = false
    setTimeout(() => { showQuestion.value = true }, 1200)
  }, 900)
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active { transition: all 0.35s ease; }
.fade-enter-from   { opacity: 0; transform: translateY(-8px); }
.fade-leave-to     { opacity: 0; transform: translateY(-4px); }
</style>
