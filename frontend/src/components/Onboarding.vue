<template>
  <div class="min-h-screen bg-gradient-to-br from-brand-primary to-slate-800 flex items-center justify-center p-6">
    <div class="w-full max-w-lg">

      <!-- Header -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center gap-2 bg-white/10 text-white px-4 py-2 rounded-full text-sm mb-4">
          <TrendingUp class="w-4 h-4 text-blue-300" />
          投智 AI — 投資人輪廓設定
        </div>
        <h1 class="text-3xl font-bold text-white mb-2">讓我先了解你</h1>
        <p class="text-slate-300 text-sm">只需 3 個問題，為你打造專屬投資視角</p>
      </div>

      <!-- Progress bar -->
      <div class="flex gap-2 mb-8">
        <div
          v-for="i in 3" :key="i"
          class="flex-1 h-1 rounded-full transition-all duration-500"
          :class="i <= step ? 'bg-blue-400' : 'bg-white/20'"
        />
      </div>

      <!-- Step card -->
      <Transition name="step" mode="out-in">

        <!-- Step 1: Capital -->
        <div v-if="step === 1" key="step1" class="bg-white rounded-3xl p-8 shadow-2xl">
          <p class="text-xs font-semibold text-blue-500 uppercase tracking-widest mb-2">第 1 步 / 共 3 步</p>
          <h2 class="text-xl font-bold text-brand-primary mb-6">你預計投入多少資金？</h2>
          <div class="grid grid-cols-2 gap-3">
            <button
              v-for="opt in capitalOptions" :key="opt.value"
              @click="form.capitalRange = opt.value"
              class="p-4 rounded-2xl border-2 text-left transition-all"
              :class="form.capitalRange === opt.value
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-blue-300'"
            >
              <p class="text-2xl mb-1">{{ opt.emoji }}</p>
              <p class="font-semibold text-sm text-brand-primary">{{ opt.label }}</p>
              <p class="text-xs text-brand-muted mt-0.5">{{ opt.desc }}</p>
            </button>
          </div>
          <button
            @click="step++"
            :disabled="!form.capitalRange"
            class="mt-6 w-full py-3.5 rounded-2xl font-semibold text-white transition-all"
            :class="form.capitalRange ? 'bg-brand-primary hover:bg-slate-800' : 'bg-slate-300 cursor-not-allowed'"
          >
            下一步 →
          </button>
        </div>

        <!-- Step 2: Risk level -->
        <div v-else-if="step === 2" key="step2" class="bg-white rounded-3xl p-8 shadow-2xl">
          <p class="text-xs font-semibold text-blue-500 uppercase tracking-widest mb-2">第 2 步 / 共 3 步</p>
          <h2 class="text-xl font-bold text-brand-primary mb-2">你的風險承受程度？</h2>
          <p class="text-sm text-brand-muted mb-6">當投資組合短暫下跌 20%，你的反應是？</p>

          <div class="space-y-3 mb-6">
            <button
              v-for="opt in riskOptions" :key="opt.level"
              @click="form.riskLevel = opt.level"
              class="w-full p-4 rounded-2xl border-2 text-left flex items-center gap-4 transition-all"
              :class="form.riskLevel === opt.level
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-blue-300'"
            >
              <span class="text-2xl">{{ opt.emoji }}</span>
              <div>
                <p class="font-semibold text-sm text-brand-primary">{{ opt.label }}</p>
                <p class="text-xs text-brand-muted">{{ opt.desc }}</p>
              </div>
              <div
                class="ml-auto w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                :class="form.riskLevel === opt.level ? 'bg-blue-500 text-white' : 'bg-slate-100 text-brand-muted'"
              >
                {{ opt.level }}
              </div>
            </button>
          </div>

          <div class="flex gap-3">
            <button @click="step--" class="px-6 py-3.5 rounded-2xl border border-slate-200 text-brand-muted hover:bg-slate-50 transition-colors font-medium">
              ← 上一步
            </button>
            <button
              @click="step++"
              class="flex-1 py-3.5 rounded-2xl font-semibold text-white bg-brand-primary hover:bg-slate-800 transition-all"
            >
              下一步 →
            </button>
          </div>
        </div>

        <!-- Step 3: Period -->
        <div v-else-if="step === 3" key="step3" class="bg-white rounded-3xl p-8 shadow-2xl">
          <p class="text-xs font-semibold text-blue-500 uppercase tracking-widest mb-2">第 3 步 / 共 3 步</p>
          <h2 class="text-xl font-bold text-brand-primary mb-6">你的投資週期？</h2>
          <div class="space-y-3 mb-6">
            <button
              v-for="opt in periodOptions" :key="opt.value"
              @click="form.period = opt.value"
              class="w-full p-4 rounded-2xl border-2 text-left flex items-center gap-4 transition-all"
              :class="form.period === opt.value
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-blue-300'"
            >
              <span class="text-2xl">{{ opt.emoji }}</span>
              <div>
                <p class="font-semibold text-sm text-brand-primary">{{ opt.label }}</p>
                <p class="text-xs text-brand-muted">{{ opt.desc }}</p>
              </div>
            </button>
          </div>
          <div class="flex gap-3">
            <button @click="step--" class="px-6 py-3.5 rounded-2xl border border-slate-200 text-brand-muted hover:bg-slate-50 transition-colors font-medium">
              ← 上一步
            </button>
            <button
              @click="submit"
              :disabled="!form.period"
              class="flex-1 py-3.5 rounded-2xl font-semibold text-white transition-all"
              :class="form.period ? 'bg-blue-500 hover:bg-blue-600' : 'bg-slate-300 cursor-not-allowed'"
            >
              完成設定 ✓
            </button>
          </div>
        </div>

        <!-- Step 4: Result -->
        <div v-else key="result" class="bg-white rounded-3xl p-8 shadow-2xl text-center">
          <div class="text-6xl mb-4">{{ store.profileEmoji }}</div>
          <p class="text-sm text-blue-500 font-semibold mb-2">您的投資者畫像</p>
          <h2 class="text-3xl font-bold text-brand-primary mb-3">{{ store.profileLabel }}</h2>
          <p class="text-brand-muted text-sm mb-6">{{ store.capitalRange }} · {{ store.periodLabel }}</p>
          <div class="flex gap-2 justify-center flex-wrap">
            <span class="bg-blue-50 text-blue-600 text-xs px-3 py-1 rounded-full font-medium">
              風險偏好 Lv.{{ store.riskLevel }}
            </span>
            <span class="bg-slate-100 text-brand-muted text-xs px-3 py-1 rounded-full font-medium">
              {{ store.periodLabel }}
            </span>
          </div>
          <p class="text-xs text-slate-400 mt-6">正在載入您的個人化儀表板…</p>
        </div>

      </Transition>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { TrendingUp } from 'lucide-vue-next'
import { useInvestorStore } from '@/stores/investor'

const store  = useInvestorStore()
const router = useRouter()
const step   = ref(1)

const form = reactive({
  capitalRange: '',
  riskLevel:    3,
  period:       '',
})

const capitalOptions = [
  { value: '10萬以下',  emoji: '🌱', label: '10 萬以下',  desc: '輕鬆入門' },
  { value: '10-50萬',  emoji: '💼', label: '10–50 萬',  desc: '穩健起步' },
  { value: '50-200萬', emoji: '📊', label: '50–200 萬', desc: '認真佈局' },
  { value: '200萬以上', emoji: '🏦', label: '200 萬以上', desc: '專業規模' },
]

const riskOptions = [
  { level: 1, emoji: '😰', label: '極度保守',  desc: '我會立刻停損，盡快離場' },
  { level: 2, emoji: '😟', label: '保守謹慎',  desc: '我會減倉，觀望再說' },
  { level: 3, emoji: '🙂', label: '穩健中立',  desc: '我會持倉，等待反彈' },
  { level: 4, emoji: '😤', label: '積極進取',  desc: '我會加碼，逢低買進' },
  { level: 5, emoji: '🤑', label: '激進冒險',  desc: '這是入場好時機，全力進攻' },
]

const periodOptions = [
  { value: 'short', emoji: '⚡', label: '短線 < 3 個月', desc: '快進快出，抓波段機會' },
  { value: 'mid',   emoji: '🔄', label: '中線 3–12 個月', desc: '等待趨勢確立' },
  { value: 'long',  emoji: '🌳', label: '長線 > 1 年',   desc: '複利成長，耐心等待' },
]

function submit() {
  store.saveProfile(form)
  step.value = 4
  setTimeout(() => router.push('/'), 2500)
}
</script>

<style scoped>
.step-enter-active,
.step-leave-active { transition: all 0.3s ease; }
.step-enter-from   { opacity: 0; transform: translateX(24px); }
.step-leave-to     { opacity: 0; transform: translateX(-24px); }
</style>
