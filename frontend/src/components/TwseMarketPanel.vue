<template>
  <section class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
    <!-- 標題區：讓使用者知道這是實際串接後端資料，不是模擬資料 -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-lg font-bold text-brand-primary">TWSE 市場資料</h2>
        <p class="text-xs text-brand-muted mt-1">
          這一塊直接呼叫 backend，再由 backend 轉抓 TWSE 官方 OpenAPI。
        </p>
      </div>

      <div class="text-right">
        <p class="text-[11px] text-brand-muted">狀態</p>
        <p class="text-sm font-semibold" :class="loading ? 'text-amber-600' : error ? 'text-red-500' : 'text-green-600'">
          {{ loading ? '載入中' : error ? '失敗' : '成功' }}
        </p>
      </div>
    </div>

    <!-- 載入中狀態 -->
    <div v-if="loading" class="space-y-2">
      <div class="h-3 bg-slate-100 rounded animate-pulse w-3/4"></div>
      <div class="h-3 bg-slate-100 rounded animate-pulse w-1/2"></div>
      <div class="h-3 bg-slate-100 rounded animate-pulse w-5/6"></div>
    </div>

    <!-- 錯誤狀態 -->
    <div v-else-if="error" class="rounded-xl bg-red-50 border border-red-200 p-4">
      <p class="text-sm font-semibold text-red-700 mb-1">資料讀取失敗</p>
      <p class="text-sm text-red-600 leading-6">{{ error }}</p>
    </div>

    <!-- 成功狀態 -->
    <div v-else class="space-y-3">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-xl bg-slate-50 p-3">
          <p class="text-[11px] text-brand-muted mb-1">來源</p>
          <p class="text-sm font-semibold text-brand-primary">TWSE OpenAPI</p>
        </div>
        <div class="rounded-xl bg-slate-50 p-3">
          <p class="text-[11px] text-brand-muted mb-1">API 端點</p>
          <p class="text-sm font-semibold text-brand-primary break-all">{{ endpoint }}</p>
        </div>
        <div class="rounded-xl bg-slate-50 p-3">
          <p class="text-[11px] text-brand-muted mb-1">資料型態</p>
          <p class="text-sm font-semibold text-brand-primary">{{ payloadType }}</p>
        </div>
      </div>

      <div class="rounded-xl bg-slate-900 text-slate-100 p-4 overflow-auto">
        <p class="text-xs text-slate-400 mb-2">回傳資料預覽</p>
        <pre class="text-xs leading-6 whitespace-pre-wrap break-words">{{ previewText }}</pre>
      </div>
    </div>
  </section>
</template>

<script setup>
/**
 * 這個元件的角色很單純：
 * 1. 進入頁面後呼叫 backend。
 * 2. backend 再去抓 TWSE 官方資料。
 * 3. 把結果顯示成一個可讀的預覽區塊。
 *
 * 這是最容易讓你驗證「有沒有真的串成功」的方式。
 */

import { computed, onMounted, ref } from 'vue'
import { getMarketIndex } from '@/services/twseApi'

const loading = ref(true)
const error = ref('')
const payload = ref(null)

const endpoint = computed(() => payload.value?.endpoint || '/exchangeReport/MI_INDEX')

const payloadType = computed(() => {
  if (!payload.value) return '-'
  const data = payload.value.data
  if (Array.isArray(data)) return `陣列(array) / ${data.length} 筆`
  if (data && typeof data === 'object') return '物件(object)'
  return typeof data
})

const previewText = computed(() => {
  if (!payload.value) return ''

  // 只顯示前一部分內容，避免畫面被整包 JSON 塞滿。
  return JSON.stringify(payload.value.data, null, 2).slice(0, 1500)
})

onMounted(async () => {
  loading.value = true
  error.value = ''

  try {
    payload.value = await getMarketIndex()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
})
</script>
