import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { findStock, getMockPrice } from '@/data/twStocks'
import {
  getPortfolioApi, setupPortfolioApi, resetPortfolioApi, buyApi, sellApi,
} from '@/services/api'

// 本地快取只負責讓畫面重整後先有資料；真正狀態仍以後端資料庫為準。
const CACHE_KEY = 'invest_ai_portfolio'

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function normalizeHolding(h) {
  const shares = Number(h.shares ?? ((h.lots ?? 0) * 1000))
  return {
    code: h.code,
    name: h.name,
    sector: h.sector,
    shares,
    avgCost: Number(h.avgCost),
  }
}

function normalizeOrder(o) {
  const shares = Number(o.shares ?? ((o.lots ?? 0) * 1000))
  return {
    id: o.id,
    type: o.type,
    code: o.code,
    name: o.name,
    shares,
    price: Number(o.price),
    faceAmount: Number(o.faceAmount ?? (shares * Number(o.price))),
    fee: Number(o.fee),
    tax: Number(o.tax || 0),
    total: Number(o.total),
    timestamp: o.timestamp,
  }
}

function persistCache(state) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(state))
}

export const usePortfolioStore = defineStore('portfolio', () => {
  const cached = loadCache()

  const capital  = ref(Number(cached?.capital) || 0)
  const cash     = ref(Number(cached?.cash) || 0)
  const holdings = ref((cached?.holdings || []).map(normalizeHolding))
  const orders   = ref((cached?.orders || []).map(normalizeOrder))
  const isReady  = ref(!!cached?.isReady)

  function saveLocalSnapshot() {
    persistCache({
      capital: capital.value,
      cash: cash.value,
      holdings: holdings.value,
      orders: orders.value,
      isReady: isReady.value,
    })
  }

  /**
   * 從後端載入完整投資組合。
   * 後端資料表目前依原始資料表設計存 lots（張），前端畫面統一顯示 shares（股）。
   */
  async function load() {
    try {
      const data = await getPortfolioApi()
      capital.value = Number(data.capital) || 0
      cash.value = Number(data.cash) || 0
      isReady.value = !!data.isReady
      holdings.value = (data.holdings || []).map(normalizeHolding)
      orders.value = (data.orders || []).map(normalizeOrder)
      saveLocalSnapshot()
    } catch {
      // 後端暫時未開時保留本地快取，避免畫面瞬間清空。
    }
  }

  const holdingsWithValue = computed(() =>
    holdings.value.map((h) => {
      const stock = findStock(h.code)
      const price = stock ? getMockPrice(stock) : h.avgCost
      const marketVal = h.shares * price
      const costVal = h.shares * h.avgCost
      const pnl = marketVal - costVal
      const pnlPct = costVal > 0 ? (pnl / costVal) * 100 : 0
      return { ...h, price, marketVal, costVal, pnl, pnlPct }
    }),
  )

  const totalHoldingsValue = computed(() =>
    holdingsWithValue.value.reduce((s, h) => s + h.marketVal, 0),
  )
  const totalAssets = computed(() => cash.value + totalHoldingsValue.value)
  const totalPnL = computed(() => totalAssets.value - capital.value)
  const totalPnLPct = computed(() =>
    capital.value > 0 ? (totalPnL.value / capital.value) * 100 : 0,
  )

  async function setup(amount) {
    await setupPortfolioApi(amount)
    await load()
  }

  async function reset() {
    await resetPortfolioApi()
    capital.value = 0
    cash.value = 0
    holdings.value = []
    orders.value = []
    isReady.value = false
    localStorage.removeItem(CACHE_KEY)
  }

  function calcFee(amount) {
    return Math.max(20, amount * 0.001425)
  }

  function calcTax(amount, code) {
    const isETF = ['0050', '0056', '00878', '006208'].includes(code)
    return amount * (isETF ? 0.001 : 0.003)
  }

  function sharesToLots(shares) {
    const nShares = Number(shares)
    if (!Number.isInteger(nShares) || nShares <= 0) {
      return { ok: false, msg: '下單股數必須是正整數' }
    }
    if (nShares % 1000 !== 0) {
      return { ok: false, msg: '目前後端資料表以「張」為交易單位，暫不支援零股下單' }
    }
    return { ok: true, lots: nShares / 1000 }
  }

  async function buy(stock, shares, price) {
    const converted = sharesToLots(shares)
    if (!converted.ok) return converted

    try {
      const r = await buyApi({ code: stock.code, lots: converted.lots, price })
      await load()
      return { ok: true, msg: r.msg }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }

  async function sell(stock, shares, price) {
    const converted = sharesToLots(shares)
    if (!converted.ok) return converted

    try {
      const r = await sellApi({ code: stock.code, lots: converted.lots, price })
      await load()
      return { ok: true, msg: r.msg }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }

  function getHolding(code) {
    return holdings.value.find((h) => h.code === code) ?? null
  }

  return {
    capital, cash, holdings, orders, isReady,
    holdingsWithValue, totalHoldingsValue,
    totalAssets, totalPnL, totalPnLPct,
    load, setup, reset, buy, sell, getHolding,
    calcFee, calcTax,
  }
})
