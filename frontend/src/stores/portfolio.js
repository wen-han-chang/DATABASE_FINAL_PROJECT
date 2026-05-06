import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { findStock, getMockPrice } from '@/data/twStocks'

const STORAGE_KEY = 'invest_ai_portfolio'

function now() {
  return new Date().toLocaleString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

export const usePortfolioStore = defineStore('portfolio', () => {
  // ── Core state ────────────────────────────────────────────
  const capital  = ref(0)       // 使用者設定的初始資產
  const cash     = ref(0)       // 現金可用餘額
  const holdings = ref([])      // [{ code, name, sector, lots, avgCost }]  lots = 張
  const orders   = ref([])      // 交易紀錄
  const isReady  = ref(false)   // 已完成初始資產設定

  // ── Restore from localStorage ─────────────────────────────
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const d = JSON.parse(saved)
      capital.value  = d.capital  ?? 0
      cash.value     = d.cash     ?? 0
      holdings.value = d.holdings ?? []
      orders.value   = d.orders   ?? []
      isReady.value  = d.isReady  ?? false
    }
  } catch { /* ignore */ }

  // ── Persist on change ─────────────────────────────────────
  watch([capital, cash, holdings, orders, isReady], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      capital:  capital.value,
      cash:     cash.value,
      holdings: holdings.value,
      orders:   orders.value,
      isReady:  isReady.value,
    }))
  }, { deep: true })

  // ── Computed ──────────────────────────────────────────────
  const holdingsWithValue = computed(() =>
    holdings.value.map(h => {
      const stock      = findStock(h.code)
      const price      = stock ? getMockPrice(stock) : h.avgCost
      const marketVal  = h.lots * 1000 * price
      const costVal    = h.lots * 1000 * h.avgCost
      const pnl        = marketVal - costVal
      const pnlPct     = costVal > 0 ? (pnl / costVal) * 100 : 0
      return { ...h, price, marketVal, costVal, pnl, pnlPct }
    })
  )

  const totalHoldingsValue = computed(() =>
    holdingsWithValue.value.reduce((s, h) => s + h.marketVal, 0)
  )

  const totalAssets = computed(() => cash.value + totalHoldingsValue.value)
  const totalPnL    = computed(() => totalAssets.value - capital.value)
  const totalPnLPct = computed(() =>
    capital.value > 0 ? (totalPnL.value / capital.value) * 100 : 0
  )

  // ── Actions ───────────────────────────────────────────────
  function setup(amount) {
    capital.value  = amount
    cash.value     = amount
    holdings.value = []
    orders.value   = []
    isReady.value  = true
  }

  function reset() {
    capital.value  = 0
    cash.value     = 0
    holdings.value = []
    orders.value   = []
    isReady.value  = false
    localStorage.removeItem(STORAGE_KEY)
  }

  // 計算手續費（買賣雙向）
  function calcFee(amount) {
    return Math.max(20, amount * 0.001425)
  }

  // 計算證交稅（賣出時）
  function calcTax(amount, code) {
    // ETF 稅率 0.1%，一般股票 0.3%
    const isETF = ['0050','0056','00878','006208'].includes(code)
    return amount * (isETF ? 0.001 : 0.003)
  }

  function buy(stock, lots, price) {
    const faceAmount = lots * 1000 * price
    const fee        = calcFee(faceAmount)
    const totalCost  = faceAmount + fee

    if (cash.value < totalCost) {
      return { ok: false, msg: `現金不足，需 ${fmt(totalCost)} 元，可用 ${fmt(cash.value)} 元` }
    }

    cash.value -= totalCost

    const idx = holdings.value.findIndex(h => h.code === stock.code)
    if (idx >= 0) {
      const h = holdings.value[idx]
      const newAvg = (h.lots * h.avgCost + lots * price) / (h.lots + lots)
      holdings.value[idx] = { ...h, lots: h.lots + lots, avgCost: +newAvg.toFixed(4) }
    } else {
      holdings.value.push({
        code: stock.code, name: stock.name, sector: stock.sector,
        lots, avgCost: price,
      })
    }

    orders.value.unshift({
      id: Date.now(), type: 'buy',
      code: stock.code, name: stock.name,
      lots, price,
      faceAmount, fee, tax: 0,
      total: totalCost,
      timestamp: now(),
    })

    return { ok: true, msg: `買入 ${stock.name} ${lots} 張，扣款 ${fmt(totalCost)} 元（含手續費 ${fmt(fee)} 元）` }
  }

  function sell(stock, lots, price) {
    const idx = holdings.value.findIndex(h => h.code === stock.code)
    if (idx < 0 || holdings.value[idx].lots < lots) {
      const held = idx >= 0 ? holdings.value[idx].lots : 0
      return { ok: false, msg: `持股不足，目前持有 ${held} 張` }
    }

    const faceAmount = lots * 1000 * price
    const fee        = calcFee(faceAmount)
    const tax        = calcTax(faceAmount, stock.code)
    const received   = faceAmount - fee - tax

    cash.value += received

    const h = holdings.value[idx]
    if (h.lots === lots) {
      holdings.value.splice(idx, 1)
    } else {
      holdings.value[idx] = { ...h, lots: h.lots - lots }
    }

    orders.value.unshift({
      id: Date.now(), type: 'sell',
      code: stock.code, name: stock.name,
      lots, price,
      faceAmount, fee, tax,
      total: received,
      timestamp: now(),
    })

    return { ok: true, msg: `賣出 ${stock.name} ${lots} 張，到帳 ${fmt(received)} 元（手續費 ${fmt(fee)} 元，證交稅 ${fmt(tax)} 元）` }
  }

  function getHolding(code) {
    return holdings.value.find(h => h.code === code) ?? null
  }

  return {
    capital, cash, holdings, orders, isReady,
    holdingsWithValue, totalHoldingsValue,
    totalAssets, totalPnL, totalPnLPct,
    setup, reset, buy, sell, getHolding,
    calcFee, calcTax,
  }
})

function fmt(n) {
  return Math.round(n).toLocaleString('zh-TW')
}