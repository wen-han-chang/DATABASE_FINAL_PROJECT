<template>
  <div class="flex h-screen bg-brand-bg font-sans overflow-hidden">
    <SideNav v-if="auth.isLoggedIn" />
    <main class="flex-1 overflow-y-auto scrollbar-thin">
      <Transition name="fade" mode="out-in">
        <RouterView />
      </Transition>
    </main>
  </div>
</template>

<script setup>
import { watch } from 'vue'
import SideNav from '@/components/layout/SideNav.vue'
import { useAuthStore } from '@/stores/auth'
import { useWatchlistStore } from '@/stores/watchlist'

const auth = useAuthStore()
const watchlist = useWatchlistStore()

watch(
  () => auth.isLoggedIn,
  (isLoggedIn) => {
    if (isLoggedIn) watchlist.load()
  },
  { immediate: true },
)
</script>

<style>
.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to     { opacity: 0; }
</style>
