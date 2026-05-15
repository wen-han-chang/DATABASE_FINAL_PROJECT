import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { findStock, getMockPrice } from '@/data/twStocks'
import {
  getPortfolioApi, setupPortfolioApi, resetPortfolioApi, buyApi, sellApi,
} from '@/services/api'

// 本地快取（沿用原本 key），讓重新整理後 isReady 等狀態能同步先顯示；
// 真正資料來源是後端 portfolios / holdings / orders 三張表，load() 會覆蓋。
const CACHE_KEY = 'invest_ai_portfolio'

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const usePortfolioStore = defineStore('portfolio', () => {
  const cached = loadCache()

  // ── Core state ────────────────────────────────────────────
  const capital  = ref(cached?.capital  ?? 0)
  const cash     = ref(cached?.cash     ?? 0)
  const holdings = ref(cached?.holdings ?? [])  // [{ code, name, sector, lots, avgCost }]
  const orders   = ref(cached?.orders   ?? [])  // 交易紀錄
  const isReady  = ref(cached?.isReady  ?? false)

  function persistCache() {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      capital: capital.value, cash: cash.value,
      holdings: holdings.value, orders: orders.value, isReady: isReady.value,
    }))
  }

  /**
   * 從後端載入完整投資組合（portfolio + 持股 + 委託）。
   * 登入後、進入交易頁、或下單完成後都會呼叫，確保畫面與 DB 一致。
   */
  async function load() {
    try {
      const data = await getPortfolioApi()
      capital.value  = Number(data.capital) || 0
      cash.value     = Number(data.cash) || 0
      isReady.value  = !!data.isReady
      // 數值欄位統一轉 Number（DB DECIMAL 經 JSON 後可能是字串）
      holdings.value = (data.holdings || []).map((h) => ({
        code: h.code, name: h.name, sector: h.sector,
        lots: Number(h.lots), avgCost: Number(h.avgCost),
      }))
      orders.value = (data.orders || []).map((o) => ({
        id: o.id, type: o.type, code: o.code, name: o.name,
        lots: Number(o.lots), price: Number(o.price),
        faceAmount: Number(o.faceAmount), fee: Number(o.fee), tax: Number(o.tax),
        total: Number(o.total), timestamp: o.timestamp,
      }))
      persistCache()
    } catch {
      // 載入失敗（後端沒開等）不清掉畫面，維持快取
    }
  }

  // ── Computed（與舊版相同，元件不用改）────────────────────
  const holdingsWithValue = computed(() =>
    holdings.value.map((h) => {
      const stock     = findStock(h.code)
      const price     = stock ? getMockPrice(stock) : h.avgCost
      const marketVal = h.lots * 1000 * price
      const costVal   = h.lots * 1000 * h.avgCost
      const pnl       = marketVal - costVal
      const pnlPct    = costVal > 0 ? (pnl / costVal) * 100 : 0
      return { ...h, price, marketVal, costVal, pnl, pnlPct }
    }),
  )

  const totalHoldingsValue = computed(() =>
    holdingsWithValue.value.reduce((s, h) => s + h.marketVal, 0),
  )
  const totalAssets = computed(() => cash.value + totalHoldingsValue.value)
  const totalPnL    = computed(() => totalAssets.value - capital.value)
  const totalPnLPct = computed(() =>
    capital.value > 0 ? (totalPnL.value / capital.value) * 100 : 0,
  )

  // ── Actions（簽名與舊版一致，但改為 async 打後端 API）──────
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

  // 手續費（買賣雙向）：與後端 dao.js 規則一致，供下單前預覽
  function calcFee(amount) {
    return Math.max(20, amount * 0.001425)
  }
  // 證交稅（賣出）：ETF 0.1%，一般股 0.3%
  function calcTax(amount, code) {
    const isETF = ['0050', '0056', '00878', '006208'].includes(code)
    return amount * (isETF ? 0.001 : 0.003)
  }

  /**
   * 買入。簽名維持 buy(stock, lots, price)，回 { ok, msg }（與舊版相同），
   * 但實際下單交給後端（含資料庫交易）。成功後重新載入組合。
   */
  async function buy(stock, lots, price) {
    try {
      const r = await buyApi({ code: stock.code, lots, price })
      await load()
      return { ok: true, msg: r.msg }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }

  async function sell(stock, lots, price) {
    try {
      const r = await sellApi({ code: stock.code, lots, price })
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
