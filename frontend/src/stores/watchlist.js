import { defineStore } from 'pinia'
import { ref } from 'vue'

const CACHE_KEY = 'invest_ai_watchlist'

export const useWatchlistStore = defineStore('watchlist', () => {
  const items = ref(JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'))

  function save() {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items.value))
  }

  function isWatched(code) {
    return items.value.some((s) => s.code === code)
  }

  function toggle(stock) {
    if (isWatched(stock.code)) {
      items.value = items.value.filter((s) => s.code !== stock.code)
    } else {
      items.value = [...items.value, { code: stock.code, name: stock.name, sector: stock.sector }]
    }
    save()
  }

  function remove(code) {
    items.value = items.value.filter((s) => s.code !== code)
    save()
  }

  return { items, isWatched, toggle, remove }
})
