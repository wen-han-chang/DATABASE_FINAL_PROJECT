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
import SideNav from '@/components/layout/SideNav.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<style>
.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to     { opacity: 0; }
</style>
