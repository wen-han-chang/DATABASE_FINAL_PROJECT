import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getWatchlistApi, syncWatchlistApi } from '@/services/api'

const CACHE_KEY = 'invest_ai_watchlist'

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveCache(items) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(items))
}

export const useWatchlistStore = defineStore('watchlist', () => {
  const items = ref(loadCache())
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const backend = await getWatchlistApi()
      const remoteItems = backend.items || []

      // 舊版自選股只存在 localStorage；若後端還沒有資料，就把既有快取搬上去。
      if (!remoteItems.length && items.value.length) {
        const synced = await syncWatchlistApi(items.value.map((item) => item.code))
        items.value = synced.items || []
      } else {
        items.value = remoteItems
      }
      saveCache(items.value)
    } catch {
      // 後端暫時未開時，保留本地快取，讓既有畫面仍能使用。
    } finally {
      loading.value = false
    }
  }

  async function persist() {
    saveCache(items.value)
    try {
      const result = await syncWatchlistApi(items.value.map((item) => item.code))
      items.value = result.items || []
      saveCache(items.value)
    } catch {
      // 失敗時保留本地結果；下次 load() 會再同步。
    }
  }

  function isWatched(code) {
    return items.value.some((s) => s.code === code)
  }

  async function toggle(stock) {
    if (isWatched(stock.code)) {
      items.value = items.value.filter((s) => s.code !== stock.code)
    } else {
      items.value = [...items.value, { code: stock.code, name: stock.name, sector: stock.sector }]
    }
    await persist()
  }

  async function remove(code) {
    items.value = items.value.filter((s) => s.code !== code)
    await persist()
  }

  function clearLocal() {
    items.value = []
    localStorage.removeItem(CACHE_KEY)
  }

  return { items, loading, load, isWatched, toggle, remove, clearLocal }
})
