<template>
  <div class="min-h-screen bg-gradient-to-br from-brand-primary via-slate-800 to-slate-900
              flex items-center justify-center p-6">
    <div class="w-full max-w-md">

      <!-- Logo -->
      <div class="text-center mb-10">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl
                    bg-blue-500 shadow-lg shadow-blue-500/30 mb-4">
          <TrendingUp class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-3xl font-bold text-white tracking-tight">
          投智 <span class="text-blue-400">AI</span>
        </h1>
        <p class="text-slate-400 text-sm mt-2">您的智慧投資決策夥伴</p>
      </div>

      <!-- Card -->
      <div class="bg-white rounded-3xl shadow-2xl p-8">
        <h2 class="text-xl font-bold text-brand-primary mb-1">歡迎回來</h2>
        <p class="text-brand-muted text-sm mb-7">請登入以存取 AI 分析功能</p>

        <!-- Demo hint -->
        <div class="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 flex items-start gap-3">
          <Info class="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div class="text-xs text-blue-700 leading-relaxed">
            <span class="font-semibold">示範帳號：</span><br>
            demo@invest.ai ／ demo123
          </div>
        </div>

        <!-- Form -->
        <form @submit.prevent="handleSubmit" class="space-y-4">

          <!-- Email -->
          <div>
            <label class="block text-xs font-semibold text-brand-primary mb-1.5">
              電子郵件
            </label>
            <div class="relative">
              <Mail class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                v-model="email"
                type="email"
                placeholder="you@example.com"
                autocomplete="email"
                class="w-full pl-9 pr-4 py-3 rounded-xl border text-sm transition-colors outline-none
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                :class="authStore.error ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'"
              />
            </div>
          </div>

          <!-- Password -->
          <div>
            <label class="block text-xs font-semibold text-brand-primary mb-1.5">
              密碼
            </label>
            <div class="relative">
              <Lock class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="輸入密碼"
                autocomplete="current-password"
                class="w-full pl-9 pr-10 py-3 rounded-xl border text-sm transition-colors outline-none
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                :class="authStore.error ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'"
              />
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <Eye v-if="!showPassword" class="w-4 h-4" />
                <EyeOff v-else class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Error message -->
          <Transition name="err">
            <p v-if="authStore.error" class="text-xs text-red-500 flex items-center gap-1.5">
              <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
              {{ authStore.error }}
            </p>
          </Transition>

          <!-- Submit -->
          <button
            type="submit"
            :disabled="authStore.loading || !email || !password"
            class="w-full py-3.5 rounded-xl font-semibold text-white text-sm
                   transition-all duration-150 flex items-center justify-center gap-2
                   disabled:opacity-50 disabled:cursor-not-allowed"
            :class="authStore.loading ? 'bg-blue-400' : 'bg-brand-primary hover:bg-slate-800 active:scale-[0.98]'"
          >
            <Loader2 v-if="authStore.loading" class="w-4 h-4 animate-spin" />
            <LogIn v-else class="w-4 h-4" />
            {{ authStore.loading ? '驗證中…' : '登入' }}
          </button>
        </form>

        <!-- Quick fill -->
        <div class="mt-5 pt-5 border-t border-slate-100">
          <button
            @click="quickFill"
            class="w-full text-xs text-brand-muted hover:text-brand-primary transition-colors
                   flex items-center justify-center gap-1.5"
          >
            <Zap class="w-3.5 h-3.5" />
            快速填入示範帳號
          </button>
        </div>
      </div>

      <p class="text-center text-xs text-slate-500 mt-6">
        此為原型展示，帳號資料僅存在本地端
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  TrendingUp, Mail, Lock, Eye, EyeOff,
  LogIn, Loader2, AlertCircle, Info, Zap,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useInvestorStore } from '@/stores/investor'

const authStore    = useAuthStore()
const investorStore = useInvestorStore()
const router       = useRouter()
const email        = ref('')
const password     = ref('')
const showPassword = ref(false)

function quickFill() {
  email.value    = 'demo@invest.ai'
  password.value = 'demo123'
  authStore.error = ''
}

async function handleSubmit() {
  try {
    await authStore.login(email.value, password.value)
    // 載入此帳號在後端的問卷狀態，讓路由守衛能正確判斷要不要去 onboarding
    await investorStore.loadProfile()
    router.push('/')
  } catch {
    // error is set inside the store
  }
}
</script>

<style scoped>
.err-enter-active,
.err-leave-active { transition: all 0.2s ease; }
.err-enter-from,
.err-leave-to     { opacity: 0; transform: translateY(-4px); }
</style>
