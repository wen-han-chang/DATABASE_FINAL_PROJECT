<template>
  <nav class="w-56 bg-brand-primary text-white flex flex-col py-6 px-3 flex-shrink-0 overflow-y-auto">
    <!-- Logo -->
    <div class="px-3 mb-8 flex items-center gap-2">
      <div class="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
        <TrendingUp class="w-4 h-4 text-white" />
      </div>
      <span class="text-lg font-bold tracking-tight">投智<span class="text-blue-400"> AI</span></span>
    </div>

    <!-- Logged-in user badge -->
    <div class="mx-3 mb-4 bg-white/10 rounded-xl p-3 flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-full bg-blue-500/30 flex items-center justify-center text-base flex-shrink-0">
        {{ auth.user?.avatar ?? '👤' }}
      </div>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-white truncate">{{ auth.user?.name }}</p>
        <p class="text-[11px] text-slate-400 truncate">{{ auth.user?.email }}</p>
      </div>
    </div>

    <!-- Nav items -->
    <div class="space-y-1 flex-1">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
        :class="$route.path === item.path
          ? 'bg-white/15 text-white'
          : 'text-slate-400 hover:bg-white/10 hover:text-white'"
      >
        <component :is="item.icon" class="w-4 h-4 flex-shrink-0" />
        {{ item.label }}
      </RouterLink>
    </div>

    <!-- Bottom actions -->
    <div class="mt-4 space-y-1 border-t border-white/10 pt-4">
      <button
        @click="handleLogout"
        class="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm text-slate-400
               hover:bg-red-500/20 hover:text-red-300 transition-colors"
      >
        <LogOut class="w-4 h-4 flex-shrink-0" />
        登出
      </button>
    </div>
  </nav>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { TrendingUp, LayoutDashboard, LogOut, Search, Wallet } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

const auth   = useAuthStore()
const route  = useRoute()
const router = useRouter()

const navItems = [
  { path: '/',        label: '首頁總覽', icon: LayoutDashboard },
  { path: '/search',  label: '個股查詢', icon: Search },
  { path: '/trading', label: '下單練習', icon: Wallet },
]

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>
