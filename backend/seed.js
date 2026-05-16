/**
 * seed.js — 市場資料種子腳本（台灣前 50 大股票）
 *
 * 用途：
 *   把 sectors / stocks / stock_daily_bars 三張表灌入可重現的資料，
 *   讓 orders、holdings 的外鍵（stock_id）有對象，買賣才跑得起來。
 *
 * ⚠️ 資料性質聲明（重要，避免誤用）：
 *   - 股票「代碼、名稱、產業別」沿用本專案前端 frontend/src/data/twStocks.js
 *     的既有清單，取「前 50 檔」（含 0050 等 4 檔 ETF）。
 *   - 股票的 base_price / volatility，以及產生的 stock_daily_bars（OHLCV），
 *     全部是「測試行情資料」，不是真實市場行情。演算法沿用前端原本的
 *     Mulberry32 PRNG + 幾何布朗運動（GBM），確保資料可重現。
 *   - 產品展示若要呈現真實行情，需使用 TWSE 同步後的資料，不可把測試行情資料當真。
 *
 * 如何執行：
 *   cd backend
 *   node seed.js            # 第一次灌入；若已有資料會跳過
 *   node seed.js --force    # 強制清掉這 3 張表重灌（見下方安全警告）
 *
 * ⚠️ --force 安全警告：
 *   --force 會先 DELETE stock_daily_bars / stocks / sectors。
 *   若 holdings / orders 已經參考到 stocks，DELETE 會被外鍵擋下並報錯
 *   （這是正確的保護：代表已有交易資料，不該隨意洗掉行情）。
 *   真要重來，請先清掉相關交易資料並確認已備份。
 *
 * 如何驗證：
 *   腳本結尾會印出三張表筆數；也可在 SSMS 跑：
 *   SELECT (SELECT COUNT(*) FROM dbo.sectors)  AS sectors,
 *          (SELECT COUNT(*) FROM dbo.stocks)   AS stocks,
 *          (SELECT COUNT(*) FROM dbo.stock_daily_bars) AS bars;
 */

import './loadEnv.js'
import { getPool, withTransaction, closePool, sql } from './db.js'
import { hashPassword } from './auth.js'

// ──────────────────────────────────────────────────────────────────────────
// 1. 台灣前 50 檔（鏡像自 frontend/src/data/twStocks.js 的前 50 筆）
//    欄位：code 代碼 / name 名稱 / price 測試起始價 / vol 波動係數 / sector 產業
// ──────────────────────────────────────────────────────────────────────────
const TOP50 = [
  { code: '2330', name: '台積電',   price: 580,  vol: 0.020, sector: '半導體' },
  { code: '2317', name: '鴻海',     price: 110,  vol: 0.022, sector: '電子製造' },
  { code: '2454', name: '聯發科',   price: 820,  vol: 0.028, sector: '半導體' },
  { code: '2882', name: '國泰金',   price: 52,   vol: 0.014, sector: '金融' },
  { code: '2881', name: '富邦金',   price: 78,   vol: 0.015, sector: '金融' },
  { code: '2412', name: '中華電',   price: 125,  vol: 0.010, sector: '電信' },
  { code: '1301', name: '台塑',     price: 68,   vol: 0.016, sector: '石化' },
  { code: '1303', name: '南亞',     price: 62,   vol: 0.016, sector: '石化' },
  { code: '2002', name: '中鋼',     price: 26,   vol: 0.018, sector: '鋼鐵' },
  { code: '2886', name: '兆豐金',   price: 38,   vol: 0.012, sector: '金融' },
  { code: '2884', name: '玉山金',   price: 28,   vol: 0.013, sector: '金融' },
  { code: '2891', name: '中信金',   price: 30,   vol: 0.013, sector: '金融' },
  { code: '2303', name: '聯電',     price: 48,   vol: 0.024, sector: '半導體' },
  { code: '3711', name: '日月光投控', price: 135, vol: 0.022, sector: '半導體封測' },
  { code: '2308', name: '台達電',   price: 295,  vol: 0.023, sector: '電源供應器' },
  { code: '2382', name: '廣達',     price: 280,  vol: 0.025, sector: '伺服器' },
  { code: '3008', name: '大立光',   price: 1820, vol: 0.030, sector: '光學' },
  { code: '2357', name: '華碩',     price: 385,  vol: 0.024, sector: '電腦' },
  { code: '2353', name: '宏碁',     price: 38,   vol: 0.022, sector: '電腦' },
  { code: '2395', name: '研華',     price: 310,  vol: 0.018, sector: '工業電腦' },
  { code: '4938', name: '和碩',     price: 72,   vol: 0.022, sector: '電子製造' },
  { code: '2379', name: '瑞昱',     price: 465,  vol: 0.026, sector: '半導體' },
  { code: '2408', name: '南亞科',   price: 58,   vol: 0.028, sector: '記憶體' },
  { code: '2376', name: '技嘉',     price: 155,  vol: 0.025, sector: '主機板' },
  { code: '2474', name: '可成',     price: 178,  vol: 0.020, sector: '機殼' },
  { code: '6505', name: '台塑化',   price: 88,   vol: 0.014, sector: '石化' },
  { code: '2207', name: '和泰車',   price: 580,  vol: 0.015, sector: '汽車' },
  { code: '2105', name: '正新',     price: 38,   vol: 0.016, sector: '橡膠' },
  { code: '1216', name: '統一',     price: 72,   vol: 0.012, sector: '食品' },
  { code: '2912', name: '統一超',   price: 272,  vol: 0.013, sector: '零售' },
  { code: '2327', name: '國巨',     price: 520,  vol: 0.030, sector: '被動元件' },
  { code: '2301', name: '光寶科',   price: 68,   vol: 0.020, sector: '電子' },
  { code: '3045', name: '台灣大',   price: 105,  vol: 0.011, sector: '電信' },
  { code: '4904', name: '遠傳',     price: 72,   vol: 0.011, sector: '電信' },
  { code: '5880', name: '合庫金',   price: 26,   vol: 0.012, sector: '金融' },
  { code: '2890', name: '永豐金',   price: 18,   vol: 0.014, sector: '金融' },
  { code: '1326', name: '台化',     price: 60,   vol: 0.015, sector: '石化' },
  { code: '2609', name: '陽明',     price: 42,   vol: 0.035, sector: '航運' },
  { code: '2603', name: '長榮',     price: 138,  vol: 0.035, sector: '航運' },
  { code: '2615', name: '萬海',     price: 48,   vol: 0.033, sector: '航運' },
  { code: '2618', name: '長榮航',   price: 28,   vol: 0.028, sector: '航空' },
  { code: '2610', name: '華航',     price: 18,   vol: 0.025, sector: '航空' },
  { code: '0050', name: '元大台灣50', price: 145, vol: 0.013, sector: 'ETF' },
  { code: '0056', name: '元大高股息', price: 38,  vol: 0.011, sector: 'ETF' },
  { code: '00878', name: '國泰永續高股息', price: 22, vol: 0.011, sector: 'ETF' },
  { code: '006208', name: '富邦台50', price: 88,  vol: 0.013, sector: 'ETF' },
  { code: '2347', name: '聯強',     price: 58,   vol: 0.018, sector: '通路' },
  { code: '3034', name: '聯詠',     price: 310,  vol: 0.028, sector: '半導體' },
  { code: '6415', name: '矽力-KY', price: 1380, vol: 0.032, sector: '半導體' },
  { code: '2356', name: '英業達',   price: 38,   vol: 0.020, sector: '伺服器' },
]

// ETF 代碼集合（影響 stocks.is_etf 與後續證交稅率 0.1%）
const ETF_CODES = new Set(['0050', '0056', '00878', '006208'])

// 每檔產生幾根日 K（與前端 getMockPrice 的 300 步一致）
const BARS_PER_STOCK = 300

// 測試 K 線的「結束日」= 今天；往回推 BARS_PER_STOCK 個交易日（跳週末）
const SEED_END_DATE = new Date('2026-05-15')

// ──────────────────────────────────────────────────────────────────────────
// 2. PRNG / GBM —— 與 frontend/src/data/twStocks.js 完全相同的演算法
//    （故意原樣搬過來，確保前端圖表算出的價格 = DB 裡的 close，避免不一致）
// ──────────────────────────────────────────────────────────────────────────

// 用 code 的數字部分當 seed（同一檔每次跑結果一致）
function seedFromCode(code) {
  return parseInt(String(code).replace(/\D/g, '')) || 1234
}

// Mulberry32：32 位元確定性偽亂數產生器
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Box-Muller：把均勻分布轉成常態分布（GBM 需要常態隨機）
function boxMuller(rand) {
  const u1 = Math.max(rand(), 1e-10)
  const u2 = rand()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * 產生某一檔股票的 300 根可重現測試日 K。
 * close 序列與前端 getMockPrice 完全相同；OHLC 的高低點再用同一個亂數源
 * 加一點日內振幅，保持「可重現」。
 *
 * @returns {Array<{trade_date:Date, open:number, high:number, low:number, close:number, volume:number}>}
 */
function generateDailyBars(stock, tradeDates) {
  const rand = mulberry32(seedFromCode(stock.code))
  const vol = stock.vol ?? 0.018

  const bars = []
  let p = stock.price // 當前價（= 上一根收盤）
  let m = 0           // 動量項（與前端公式一致）

  for (let i = 0; i < BARS_PER_STOCK; i++) {
    const open = p

    // ── 與前端完全相同的價格演進公式 ──
    const v = vol * (0.8 + rand() * 0.7)
    const lr = 0.0003 + m * 0.001 + v * boxMuller(rand)
    p = p * Math.exp(lr)
    m = m * 0.93 + lr
    const close = p

    // 日內高低：用同一亂數源產生 0~1，套一點振幅（測試行情，可重現）
    const span = Math.abs(lr) + v * 0.5
    const hi = Math.max(open, close) * (1 + span * (0.3 + rand() * 0.7))
    const lo = Math.min(open, close) * (1 - span * (0.3 + rand() * 0.7))

    // 成交量：基準量受波動放大，整數張數轉成股數規模
    const baseVol = 2_000_000
    const volume = Math.round(baseVol * (0.5 + rand() * 1.5) * (1 + Math.abs(lr) * 20))

    bars.push({
      trade_date: tradeDates[i],
      open: +open.toFixed(2),
      high: +hi.toFixed(2),
      low: +lo.toFixed(2),
      close: +close.toFixed(2),
      volume,
    })
  }

  return bars
}

/**
 * 產生 BARS_PER_STOCK 個「交易日」日期（跳過六、日），由舊到新，
 * 最後一天 = SEED_END_DATE。
 */
function buildTradeDates() {
  const dates = []
  const cursor = new Date(SEED_END_DATE)

  while (dates.length < BARS_PER_STOCK) {
    const day = cursor.getDay() // 0=日, 6=六
    if (day !== 0 && day !== 6) {
      // 存成 YYYY-MM-DD 字串，避免時區把日期偏移
      const y = cursor.getFullYear()
      const mo = String(cursor.getMonth() + 1).padStart(2, '0')
      const d = String(cursor.getDate()).padStart(2, '0')
      dates.push(`${y}-${mo}-${d}`)
    }
    cursor.setDate(cursor.getDate() - 1)
  }

  return dates.reverse() // 由舊到新
}

// ──────────────────────────────────────────────────────────────────────────
// 3. 主流程
// ──────────────────────────────────────────────────────────────────────────
async function main() {
  const force = process.argv.includes('--force')
  const pool = await getPool()

  // 3-0. 示範帳號（讓前端 Login.vue 的示範帳號 demo@invest.ai/demo123 可用）
  //      不論股票是否已灌都檢查；已存在就略過。
  const demoEmail = 'demo@invest.ai'
  const demoExist = await pool.request()
    .input('email', sql.VarChar(255), demoEmail)
    .query('SELECT id FROM dbo.users WHERE email = @email')
  if (demoExist.recordset.length === 0) {
    await pool.request()
      .input('email', sql.VarChar(255), demoEmail)
      .input('pw', sql.VarChar(255), hashPassword('demo123'))
      .input('name', sql.NVarChar(100), '示範用戶')
      .input('avatar', sql.NVarChar(10), '🧑‍💼')
      .query(`INSERT INTO dbo.users (email, password, name, avatar)
              VALUES (@email, @pw, @name, @avatar)`)
    console.log('[seed] 已建立示範帳號 demo@invest.ai / demo123')
  } else {
    console.log('[seed] 示範帳號已存在，略過')
  }

  // 3-1. 檢查是否已灌過
  const existing = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.stocks')
  const stockCount = existing.recordset[0].n

  if (stockCount > 0 && !force) {
    console.log(`[seed] stocks 已有 ${stockCount} 筆，略過。要重灌請加 --force。`)
    return
  }

  if (stockCount > 0 && force) {
    console.log('[seed] --force：清除 stock_daily_bars / stocks / sectors …')
    // 先子表後父表；若被 holdings/orders 外鍵參考會在此報錯（正確的保護）
    await pool.request().query('DELETE FROM dbo.stock_daily_bars')
    await pool.request().query('DELETE FROM dbo.stocks')
    await pool.request().query('DELETE FROM dbo.sectors')
  }

  // 3-2. 整段灌入包在一個交易裡：全成功才提交
  await withTransaction(async (tx) => {
    // (a) sectors：取所有不重複產業別
    const sectorNames = [...new Set(TOP50.map((s) => s.sector))]
    const sectorIdByName = new Map()

    for (const name of sectorNames) {
      const r = new sql.Request(tx)
      const out = await r
        .input('name', sql.NVarChar(50), name)
        .query('INSERT INTO dbo.sectors (name) OUTPUT INSERTED.id VALUES (@name)')
      sectorIdByName.set(name, out.recordset[0].id)
    }
    console.log(`[seed] sectors 灌入 ${sectorIdByName.size} 筆`)

    // (b) stocks
    const stockIdByCode = new Map()
    for (const s of TOP50) {
      const r = new sql.Request(tx)
      const out = await r
        .input('code', sql.VarChar(10), s.code)
        .input('name', sql.NVarChar(50), s.name)
        .input('sector_id', sql.SmallInt, sectorIdByName.get(s.sector))
        .input('base_price', sql.Decimal(10, 2), s.price)
        .input('volatility', sql.Decimal(6, 4), s.vol)
        .input('is_etf', sql.Bit, ETF_CODES.has(s.code) ? 1 : 0)
        .query(`INSERT INTO dbo.stocks (code, name, sector_id, base_price, volatility, is_etf, is_active)
                OUTPUT INSERTED.id
                VALUES (@code, @name, @sector_id, @base_price, @volatility, @is_etf, 1)`)
      stockIdByCode.set(s.code, out.recordset[0].id)
    }
    console.log(`[seed] stocks 灌入 ${stockIdByCode.size} 筆`)

    // (c) stock_daily_bars：每檔 300 根
    const tradeDates = buildTradeDates()
    let barCount = 0
    for (const s of TOP50) {
      const stockId = stockIdByCode.get(s.code)
      const bars = generateDailyBars(s, tradeDates)

      for (const b of bars) {
        const r = new sql.Request(tx)
        await r
          .input('stock_id', sql.SmallInt, stockId)
          .input('trade_date', sql.Date, b.trade_date)
          .input('open', sql.Decimal(10, 2), b.open)
          .input('high', sql.Decimal(10, 2), b.high)
          .input('low', sql.Decimal(10, 2), b.low)
          .input('close', sql.Decimal(10, 2), b.close)
          .input('volume', sql.BigInt, b.volume)
          .query(`INSERT INTO dbo.stock_daily_bars
                    (stock_id, trade_date, [open], high, low, [close], volume)
                  VALUES (@stock_id, @trade_date, @open, @high, @low, @close, @volume)`)
        barCount++
      }
    }
    console.log(`[seed] stock_daily_bars 灌入 ${barCount} 筆`)
  })

  // 3-3. 驗證
  const verify = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.sectors)          AS sectors,
      (SELECT COUNT(*) FROM dbo.stocks)           AS stocks,
      (SELECT COUNT(*) FROM dbo.stock_daily_bars) AS bars`)
  console.log('[seed] 完成，目前筆數：', verify.recordset[0])
}

main()
  .catch((err) => {
    console.error('[seed] 失敗：', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
