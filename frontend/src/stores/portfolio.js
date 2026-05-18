import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getQuote } from '@/services/twseApi'
import {
  getPortfolioApi, setupPortfolioApi, resetPortfolioApi, buyApi, sellApi,
  getMarginPositionsApi, marginOpenApi, marginCoverApi, marginSettleApi,
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
  // lots 欄位現在直接存股數（含零股），不再 × 1000
  const shares = Number(h.shares ?? h.lots ?? 0)
  return {
    code: h.code,
    name: h.name,
    sector: h.sector,
    shares,
    avgCost: Number(h.avgCost),
  }
}

function normalizeOrder(o) {
  const shares = Number(o.shares ?? o.lots ?? 0)
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

  const capital         = ref(Number(cached?.capital) || 0)
  const cash            = ref(Number(cached?.cash) || 0)
  const holdings        = ref((cached?.holdings || []).map(normalizeHolding))
  const orders          = ref((cached?.orders || []).map(normalizeOrder))
  const isReady         = ref(!!cached?.isReady)
  const livePrices      = ref({}) // code → 即時報價
  const marginPositions = ref([]) // 槓桿部位

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
      fetchLivePrices()
      // 同步載入槓桿部位
      try {
        const mp = await getMarginPositionsApi()
        marginPositions.value = mp.positions || []
      } catch {
        marginPositions.value = []
      }
    } catch {
      // 後端暫時未開時保留本地快取，避免畫面瞬間清空。
    }
  }

  // 為所有持股抓 TWSE 即時報價，用於損益計算
  async function fetchLivePrices() {
    for (const h of holdings.value) {
      try {
        const res = await getQuote(h.code)
        if (res.data?.price != null) {
          livePrices.value = { ...livePrices.value, [h.code]: res.data.price }
        }
      } catch {
        // 抓不到就沿用平均成本，不影響其他個股
      }
    }
  }

  const holdingsWithValue = computed(() =>
    holdings.value.map((h) => {
      const price = livePrices.value[h.code] ?? h.avgCost  // 有即時報價用即時，否則用均成本
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
    marginPositions.value = []
    localStorage.removeItem(CACHE_KEY)
  }

  async function openMargin(stock, shares, price, marginType) {
    const nShares = Number(shares)
    if (!Number.isInteger(nShares) || nShares <= 0) {
      return { ok: false, msg: '下單股數必須是正整數' }
    }
    try {
      const r = await marginOpenApi({ code: stock.code, shares: nShares, price, marginType })
      await load()
      return { ok: true, msg: r.msg }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }

  async function coverMargin(positionId, price) {
    try {
      const r = await marginCoverApi({ positionId, price })
      await load()
      return { ok: true, msg: r.msg }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }

  async function settleDefault() {
    try {
      const r = await marginSettleApi()
      await load()
      return { ok: true, msg: r.msg, settled: r.settled, totalPenalty: r.totalPenalty }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }

  async function loadMarginPositions() {
    try {
      const mp = await getMarginPositionsApi()
      marginPositions.value = mp.positions || []
    } catch {
      marginPositions.value = []
    }
  }

  // 整張最低 20 元，零股最低 1 元
  function calcFee(amount, isOddLot = false) {
    return Math.max(isOddLot ? 1 : 20, amount * 0.001425)
  }

  // 證交稅：ETF 0.1%；當沖 0.15%；一般 0.3%
  function calcTax(amount, code, isDayTrade = false) {
    const isETF = ['0050', '0056', '00878', '006208'].includes(code)
    if (isETF) return amount * 0.001
    return amount * (isDayTrade ? 0.0015 : 0.003)
  }

  async function buy(stock, shares, price) {
    const nShares = Number(shares)
    if (!Number.isInteger(nShares) || nShares <= 0) {
      return { ok: false, msg: '下單股數必須是正整數' }
    }
    try {
      const r = await buyApi({ code: stock.code, shares: nShares, price })
      await load()
      return { ok: true, msg: r.msg }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }

  async function sell(stock, shares, price) {
    const nShares = Number(shares)
    if (!Number.isInteger(nShares) || nShares <= 0) {
      return { ok: false, msg: '下單股數必須是正整數' }
    }
    try {
      const r = await sellApi({ code: stock.code, shares: nShares, price })
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
    capital, cash, holdings, orders, isReady, livePrices, marginPositions,
    holdingsWithValue, totalHoldingsValue,
    totalAssets, totalPnL, totalPnLPct,
    load, setup, reset, buy, sell, getHolding,
    fetchLivePrices, calcFee, calcTax,
    openMargin, coverMargin, settleDefault, loadMarginPositions,
  }
})
