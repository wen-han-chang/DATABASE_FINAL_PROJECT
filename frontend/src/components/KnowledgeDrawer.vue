<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition name="backdrop">
      <div
        v-if="isOpen"
        class="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
        @click="$emit('close')"
      />
    </Transition>

    <!-- Drawer panel -->
    <Transition name="drawer">
      <aside
        v-if="isOpen"
        class="fixed top-0 right-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div class="flex items-center gap-2">
            <BookOpen class="w-4 h-4 text-blue-500" />
            <span class="font-bold text-brand-primary text-sm">投資知識庫</span>
          </div>
          <button
            @click="$emit('close')"
            class="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <X class="w-4 h-4 text-brand-muted" />
          </button>
        </div>

        <!-- Content -->
        <div v-if="entry" class="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          <!-- Icon + title -->
          <div class="text-center py-4 bg-slate-50 rounded-2xl">
            <div class="text-4xl mb-3">{{ entry.icon }}</div>
            <h2 class="font-bold text-brand-primary text-lg">{{ entry.title }}</h2>
            <span class="text-xs text-brand-muted bg-white px-3 py-1 rounded-full mt-2 inline-block border border-slate-200">
              {{ entry.category }}
            </span>
          </div>

          <!-- 3-sentence explanation -->
          <div class="space-y-3">
            <div
              v-for="(sentence, i) in entry.sentences"
              :key="i"
              class="flex gap-3 p-3.5 bg-slate-50 rounded-xl"
            >
              <span
                class="w-5 h-5 rounded-full bg-brand-primary text-white text-[10px] font-bold
                       flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                {{ i + 1 }}
              </span>
              <p class="text-sm text-brand-muted leading-relaxed">{{ sentence }}</p>
            </div>
          </div>

          <!-- Related terms -->
          <div v-if="entry.related?.length">
            <p class="text-xs text-brand-muted font-semibold mb-2 uppercase tracking-wide">相關術語</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="rel in entry.related"
                :key="rel"
                @click="navigate(rel)"
                class="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full
                       hover:bg-blue-500 hover:text-white transition-all duration-150 font-medium"
              >
                {{ rel }}
              </button>
            </div>
          </div>
        </div>

        <!-- Fallback -->
        <div v-else class="flex-1 flex items-center justify-center text-brand-muted text-sm">
          找不到相關說明
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'
import { BookOpen, X } from 'lucide-vue-next'
import { knowledgeBase } from '@/data/knowledgeBase'

const props = defineProps({
  isOpen: Boolean,
  term:   String,
})

const emit = defineEmits(['close', 'navigate'])

const entry = computed(() => {
  if (!props.term) return null
  return knowledgeBase[props.term] ?? knowledgeBase['_default']
})

function navigate(rel) {
  emit('navigate', rel)
}
</script>

<style scoped>
.backdrop-enter-active,
.backdrop-leave-active { transition: opacity 0.25s ease; }
.backdrop-enter-from,
.backdrop-leave-to     { opacity: 0; }

.drawer-enter-active,
.drawer-leave-active { transition: transform 0.3s cubic-bezier(0.34, 1.2, 0.64, 1); }
.drawer-enter-from,
.drawer-leave-to     { transform: translateX(100%); }
</style>
