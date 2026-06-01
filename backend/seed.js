/**
 * ════════════════════════════════════════════════════════════════════════════
 * seed.js  —  資料庫初始化種子腳本
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 【這個檔案是做什麼的？】
 *
 *   整個專題的買賣功能需要「股票清單」和「歷史股價」才能運作。
 *   資料庫一開始是空的，seed.js 的工作是：
 *
 *     1. 把台灣50的股票代號、名稱、產業別 → 寫進 stocks 表
 *     2. 對每一檔股票向 TWSE（台灣證券交易所）抓取最近 2 個月的真實日 K 線
 *        → 寫進 stock_daily_bars 表
 *     3. 在 stock_sync 表記錄「這檔資料來自 TWSE，初始化於今天」
 *        → 讓 dao.js 之後判斷是否需要更新時能正確運作
 *     4. 建立一個示範帳號（demo@invest.ai / demo123）供展示用
 *
 *   這樣系統首頁一開始就有真實 K 線可以顯示，不再用假資料墊底。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 【資料真實性說明】
 *
 *   本版本 seed.js 不產生任何假資料。
 *   K 線資料全部來自 TWSE 官方歷史日線 API（www.twse.com.tw/STOCK_DAY）。
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  seed.js 初始化 → 抓真實 TWSE 日 K（最近 2 個月）       │
 *   │  使用者查詢個股 → dao.js 自動更新至完整 13 個月（背景）  │
 *   └──────────────────────────────────────────────────────────┘
 *
 *   為什麼 seed 只抓 2 個月而不是 13 個月？
 *   → 50 支股票 × 13 個月需要請求 650 次 TWSE API，約需 3~5 分鐘。
 *   → 2 個月只需 100 次請求，約需 40~60 秒，夠顯示 MA20，速度合理。
 *   → 使用者點進個股後，dao.js 會自動在背景補滿 13 個月歷史資料。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 【這個腳本會碰到哪幾張資料表？】
 *
 *   sectors          → 產業別（例如：半導體、金融、航運）
 *   stocks           → 股票主檔（代號、名稱、是否 ETF、所屬產業）
 *   stock_daily_bars → 日 K 線資料（每檔最近 2 個月的真實資料）
 *   stock_sync       → 記錄每檔 K 線的資料來源與最後同步時間
 *   users            → 只新增示範帳號，不會動到一般使用者
 *
 *   【不會碰到的表】
 *   orders、holdings、portfolios 都不會被動到。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 【有幾種執行模式？分別什麼時候用？】
 *
 *   ① node seed.js
 *      一般模式。如果 stocks 表已有資料就直接跳過，不做任何事。
 *      → 適用於：第一次佈署、全新空資料庫
 *
 *   ② node seed.js --sync-stocks
 *      同步模式。不刪資料，只補缺少的股票與 K 線。
 *      → 適用於：台灣50清單有異動（新增/移除股票）時
 *      → 已有真實 K 線的股票不會重抓，只補沒有資料的股票
 *
 *   ③ node seed.js --force
 *      強制重灌模式。先刪三張表再全部重寫（包含重抓真實 K 線）。
 *      → ⚠️ 若 orders/holdings 有資料，外鍵會擋住刪除並報錯（正確保護）
 *         此時請先在 SSMS 清掉 orders/holdings，再執行 --force
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 【台灣50是什麼？資料怎麼來的？多久更新一次？】
 *
 *   台灣50（0050）追蹤台灣市值前 50 大的上市公司。
 *   成分股由 FTSE Russell 決定，每半年審核一次（通常 6 月和 12 月）。
 *
 *   正確的成分股清單來源：元大投信官網 → 0050 持股明細
 *   https://www.yuantaetfs.com/product/detail/0050/ratio
 *
 *   ⚠️ 本檔案的清單是 2026-06-01 手動對照元大投信官網的快照。
 *   下次需要更新時間：2026 年 12 月（下次半年審核後）。
 */

import './loadEnv.js'
import { getPool, withTransaction, closePool, sql } from './db.js'
import { hashPassword } from './auth.js'
import { fetchRecentHistoryWithFallback } from './twseExtra.js'

// ════════════════════════════════════════════════════════════════════════════
// 第一部分：設定常數
// ════════════════════════════════════════════════════════════════════════════

/**
 * seed 時每支股票抓幾個月的真實 K 線。
 * 設定 2 個月原因：
 *   - 夠顯示 MA5、MA10、MA20
 *   - 50 支股票總共約 40~60 秒可以跑完
 *   - 使用者點進個股後，dao.js 會在背景自動補滿 13 個月
 */
const SEED_MONTHS = 2

/**
 * 每抓完一支股票後的等待時間（毫秒）。
 * 對 TWSE 官方伺服器客氣一點，避免太頻繁請求被擋。
 */
const INTER_STOCK_DELAY_MS = 350

/**
 * 哪些代號屬於 ETF（不是普通股）。
 * ETF 的證交稅計算方式不同（0.1% 而非 0.3%），所以要特別標記。
 */
const ETF_CODES = new Set(['0050', '0056', '00878', '006208'])

// ════════════════════════════════════════════════════════════════════════════
// 第二部分：台灣50股票清單
// ════════════════════════════════════════════════════════════════════════════

/**
 * 台灣50成分股清單（2026-06-01 快照）
 *
 * 每一筆物件的欄位說明：
 *   code    → 股票代號（4~6 碼字串，例如 '2330'）
 *   name    → 股票名稱（中文，用於顯示）
 *   sector  → 所屬產業別（對應 sectors 表的 name 欄位）
 *
 * 注意：這個版本移除了 price 和 vol 欄位，因為 K 線資料直接來自 TWSE，
 * 不再需要用假的起始股價和波動係數來模擬股價。
 *
 * 來源：元大投信 0050 持股明細（https://www.yuantaetfs.com/product/detail/0050/ratio）
 * ⚠️ 下次半年審核（2026年12月）前務必至元大投信官網比對並更新清單。
 */
// 以下清單依元大投信 0050 官方持股明細排序（權重由高至低）
// 資料來源：https://www.yuantaetfs.com/product/detail/0050/ratio
// 資料日期：2026-06-01（CSV 下載版本）
// 下次半年審核：2026 年 12 月，屆時請重新下載 CSV 並比對更新
const TOP50 = [
  { code: '2330', name: '台積電',     sector: '半導體' },       // 57.65%
  { code: '2454', name: '聯發科',     sector: '半導體' },       // 6.71%
  { code: '2308', name: '台達電',     sector: '電子零組件' },   // 4.71%
  { code: '2317', name: '鴻海',       sector: '電子製造' },     // 3.59%
  { code: '3711', name: '日月光投控', sector: '半導體封測' },   // 1.98%
  { code: '2303', name: '聯電',       sector: '半導體' },       // 1.70%
  { code: '2383', name: '台光電',     sector: '電子零組件' },   // 1.46%
  { code: '3037', name: '欣興',       sector: '電路板' },       // 1.40%
  { code: '2345', name: '智邦',       sector: '網通' },         // 1.25%
  { code: '2327', name: '國巨',       sector: '被動元件' },     // 1.23%
  { code: '2891', name: '中信金',     sector: '金融' },         // 1.10%
  { code: '2382', name: '廣達',       sector: '伺服器' },       // 0.99%
  { code: '2360', name: '致茂',       sector: '量測設備' },     // 0.96%
  { code: '2881', name: '富邦金',     sector: '金融' },         // 0.92%
  { code: '3017', name: '奇鋐',       sector: '散熱' },         // 0.91%
  { code: '2882', name: '國泰金',     sector: '金融' },         // 0.83%
  { code: '2885', name: '元大金',     sector: '金融' },         // 0.65%
  { code: '2357', name: '華碩',       sector: '電腦' },         // 0.57%
  { code: '2887', name: '台新新光金', sector: '金融' },         // 0.57%
  { code: '6669', name: '緯穎',       sector: '伺服器' },       // 0.57%
  { code: '2412', name: '中華電',     sector: '電信' },         // 0.54%
  { code: '1303', name: '南亞',       sector: '塑化' },         // 0.53%
  { code: '3231', name: '緯創',       sector: '伺服器' },       // 0.53%
  { code: '2344', name: '華邦電',     sector: '記憶體' },       // 0.52%
  { code: '2886', name: '兆豐金',     sector: '金融' },         // 0.49%
  { code: '2884', name: '玉山金',     sector: '金融' },         // 0.48%
  { code: '2301', name: '光寶科',     sector: '電子' },         // 0.46%
  { code: '2368', name: '金像電',     sector: '電路板' },       // 0.46%
  { code: '2408', name: '南亞科',     sector: '記憶體' },       // 0.43%
  { code: '7769', name: '鴻勁',       sector: '半導體設備' },   // 0.43%
  { code: '2890', name: '永豐金',     sector: '金融' },         // 0.39%
  { code: '3661', name: '世鎧-KY',   sector: '精密零件' },     // 0.39%
  { code: '3008', name: '大立光',     sector: '光學' },         // 0.37%
  { code: '1216', name: '統一',       sector: '食品' },         // 0.36%
  { code: '2883', name: '凱基金',     sector: '金融' },         // 0.36%
  { code: '2449', name: '京元電子',   sector: '半導體測試' },   // 0.35%
  { code: '3653', name: '健策',       sector: '散熱' },         // 0.32%
  { code: '2880', name: '華南金',     sector: '金融' },         // 0.31%
  { code: '2059', name: '川湖',       sector: '機構件' },       // 0.30%
  { code: '2892', name: '第一金',     sector: '金融' },         // 0.30%
  { code: '2395', name: '研華',       sector: '工業電腦' },     // 0.24%
  { code: '2603', name: '長榮',       sector: '航運' },         // 0.24%
  { code: '5880', name: '合庫金',     sector: '金融' },         // 0.24%
  { code: '1301', name: '台塑',       sector: '塑化' },         // 0.21%
  { code: '2002', name: '中鋼',       sector: '鋼鐵' },         // 0.21%
  { code: '4904', name: '遠傳',       sector: '電信' },         // 0.17%
  { code: '3045', name: '台灣大',     sector: '電信' },         // 0.16%
  { code: '2207', name: '和泰車',     sector: '汽車' },         // 0.13%
  { code: '6919', name: '康舒',       sector: '電源供應器' },   // 0.10%
  { code: '6505', name: '台塑化',     sector: '塑化' },         // 0.06%
]

// ════════════════════════════════════════════════════════════════════════════
// 第三部分：寫入前自動驗證
// ════════════════════════════════════════════════════════════════════════════

/**
 * validateTop50()
 *
 * 寫入資料庫前先做 5 項檢查，任何一項不過就中止。
 * 防止清單改錯卻把錯資料寫進去。
 *
 * 驗證項目：
 *   (1) 陣列長度必須剛好 50
 *   (2) 不能有重複的股票代號
 *   (3) 每一筆都必須有代號和名稱
 *   (4) 2345 智邦必須存在（已確認是台灣50成分股，作為固定正確性基準）
 *   (5) 2474 可成不可存在（已確認不是台灣50成分股，作為固定排除基準）
 */
function validateTop50() {
  const errors = []

  if (TOP50.length !== 50) {
    errors.push(`清單數量錯誤：預期 50，實際 ${TOP50.length}`)
  }

  const codes = TOP50.map((s) => s.code)
  const dupCodes = codes.filter((c, i) => codes.indexOf(c) !== i)
  if (dupCodes.length > 0) {
    errors.push(`發現重複代號：${[...new Set(dupCodes)].join(', ')}`)
  }

  const emptyEntries = TOP50.filter((s) => !s.code?.trim() || !s.name?.trim())
  if (emptyEntries.length > 0) {
    errors.push(`發現空白代號或名稱：${emptyEntries.map((s) => s.code).join(', ')}`)
  }

  if (!TOP50.some((s) => s.code === '2345')) {
    errors.push('驗證失敗：2345 智邦 不在清單中，請確認清單來源')
  }

  if (TOP50.some((s) => s.code === '2474')) {
    errors.push('驗證失敗：2474 可成 不應出現在台灣50清單中')
  }

  // 列印完整清單讓人可以目視確認
  console.log('\n[seed] ── 準備寫入的 50 檔股票 ──')
  TOP50.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2, '0')}. ${s.code}  ${s.name.padEnd(8)}  ${s.sector}`)
  })
  console.log('[seed] ──────────────────────────────────\n')

  if (errors.length > 0) {
    console.error('[seed] ✗ 驗證失敗，停止寫入：')
    errors.forEach((e) => console.error(`  - ${e}`))
    throw new Error('TOP50 清單驗證未通過，中止 seed')
  }

  console.log('[seed] ✓ 清單驗證通過：50 檔、無重複、2345 存在、2474 不存在\n')
}

// ════════════════════════════════════════════════════════════════════════════
// 第四部分：工具函式
// ════════════════════════════════════════════════════════════════════════════

/**
 * sleep(ms)
 * 等待指定毫秒後繼續，用於控制抓 TWSE API 的頻率。
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * writeBarsAndSync(pool, stockId, bars, provider)
 *
 * 【這個函式做什麼？】
 *   把從 TWSE 抓到的 K 線資料寫進資料庫，並更新 stock_sync 表。
 *
 * 【為什麼要更新 stock_sync？】
 *   dao.js 靠 stock_sync 判斷這檔的 K 線資料是真實來源還是假資料：
 *   - source = 'twse'  → 來自 TWSE，dao.js 顯示圖時直接用，不再重抓
 *   - source = 'finmind' → 來自 FinMind 備援，同樣視為真實資料
 *   - stock_sync 裡沒有這檔 → dao.js 會去 TWSE 補抓
 *
 *   seed 初始化後把 stock_sync 標好，使用者第一次看首頁就有真實 K 線可看。
 *
 * @param {object} pool      - mssql 連線池
 * @param {number} stockId   - stocks 表的 id
 * @param {Array}  bars      - fetchRecentHistoryWithFallback 回傳的 bars 陣列
 * @param {string} provider  - 資料來源（'twse' 或 'finmind'）
 */
async function writeBarsAndSync(pool, stockId, bars, provider) {
  await withTransaction(async (tx) => {
    // 先把這檔舊的 K 線清掉（如果有的話），再寫新的進去
    await new sql.Request(tx)
      .input('sid', sql.SmallInt, stockId)
      .query('DELETE FROM dbo.stock_daily_bars WHERE stock_id = @sid')

    // 一根一根寫進 stock_daily_bars
    for (const b of bars) {
      await new sql.Request(tx)
        .input('sid',  sql.SmallInt,      stockId)
        .input('d',    sql.Date,           b.date)
        .input('o',    sql.Decimal(10, 2), b.open)
        .input('h',    sql.Decimal(10, 2), b.high)
        .input('l',    sql.Decimal(10, 2), b.low)
        .input('c',    sql.Decimal(10, 2), b.close)
        .input('v',    sql.BigInt,          b.volume)
        .query(`INSERT INTO dbo.stock_daily_bars
                  (stock_id, trade_date, [open], high, low, [close], volume)
                VALUES (@sid, @d, @o, @h, @l, @c, @v)`)
    }

    // 更新 stock_sync 表：記錄資料來源和同步時間
    // IF EXISTS ... UPDATE ELSE INSERT 是 SQL Server 的「upsert」寫法
    await new sql.Request(tx)
      .input('sid',    sql.SmallInt,   stockId)
      .input('source', sql.NVarChar(20), provider)
      .query(`IF EXISTS (SELECT 1 FROM dbo.stock_sync WHERE stock_id = @sid)
                 UPDATE dbo.stock_sync
                    SET source = @source, last_synced = SYSDATETIME()
                  WHERE stock_id = @sid;
               ELSE
                 INSERT INTO dbo.stock_sync (stock_id, source, last_synced)
                 VALUES (@sid, @source, SYSDATETIME());`)
  })
}

// ════════════════════════════════════════════════════════════════════════════
// 第五部分：主流程
// ════════════════════════════════════════════════════════════════════════════

/**
 * main()
 *
 * 整個腳本的主要執行流程：
 *
 *   步驟 0：建立示範帳號（如果還不存在）
 *   步驟 1：判斷要用哪種模式（--sync-stocks / --force / 一般）
 *   步驟 1.5：寫入前驗證（validateTop50）
 *   步驟 2：在一個交易裡寫入 sectors 和 stocks
 *   步驟 3：對每一支股票向 TWSE 抓取真實 K 線並寫入資料庫
 *   步驟 4：印出最終各表筆數和成功/失敗數量
 */
async function main() {
  const force      = process.argv.includes('--force')
  const syncStocks = process.argv.includes('--sync-stocks')
  const pool       = await getPool()

  // ── 步驟 0：示範帳號 ──────────────────────────────────────────────────────
  const demoEmail = 'demo@invest.ai'
  const demoExist = await pool.request()
    .input('email', sql.VarChar(255), demoEmail)
    .query('SELECT id FROM dbo.users WHERE email = @email')
  if (demoExist.recordset.length === 0) {
    await pool.request()
      .input('email',  sql.VarChar(255),  demoEmail)
      .input('pw',     sql.VarChar(255),  hashPassword('demo123'))
      .input('name',   sql.NVarChar(100), '示範用戶')
      .input('avatar', sql.NVarChar(10),  '🧑‍💼')
      .query(`INSERT INTO dbo.users (email, password, name, avatar)
              VALUES (@email, @pw, @name, @avatar)`)
    console.log('[seed] 已建立示範帳號 demo@invest.ai / demo123')
  } else {
    console.log('[seed] 示範帳號已存在，略過')
  }

  // ── 步驟 1：--sync-stocks 模式 ────────────────────────────────────────────
  if (syncStocks) {
    await syncTop50Stocks(pool)
    return
  }

  // ── 步驟 1：一般模式 / --force 模式 ─────────────────────────────────────
  const existing   = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.stocks')
  const stockCount = existing.recordset[0].n

  if (stockCount > 0 && !force) {
    console.log(`[seed] stocks 已有 ${stockCount} 筆，略過。要重灌請加 --force。`)
    return
  }

  // ── 步驟 1.5：寫入前驗證（必須在任何 DELETE 之前執行）────────────────────
  // ⚠️ 順序很重要：先驗證 TOP50 清單正確，再決定要不要刪資料。
  //    如果驗證放在 DELETE 之後，一旦清單有問題會導致資料被刪掉卻沒有重新寫入。
  validateTop50()

  if (stockCount > 0 && force) {
    console.log('[seed] --force：清除 stock_daily_bars / stocks / sectors …')
    // 包在同一個交易裡，避免三個 DELETE 只做到一半
    await withTransaction(async (tx) => {
      await new sql.Request(tx).query('DELETE FROM dbo.stock_daily_bars')
      await new sql.Request(tx).query('DELETE FROM dbo.stocks')
      await new sql.Request(tx).query('DELETE FROM dbo.sectors')
    })
  }

  // ── 步驟 2：寫入 sectors + stocks（包在一個交易裡，快速完成）────────────
  // 這段不做任何網路請求，只是把股票代號/名稱/產業寫進資料庫。
  // 等所有 stocks 都寫好，才開始逐一向 TWSE 抓 K 線。
  const stockIdByCode = new Map()  // 記住每個代號對應到資料庫的哪個 id

  await withTransaction(async (tx) => {
    // (a) 取出所有不重複的產業別，一次寫進 sectors 表
    const sectorNames    = [...new Set(TOP50.map((s) => s.sector))]
    const sectorIdByName = new Map()

    for (const name of sectorNames) {
      const r   = new sql.Request(tx)
      const out = await r
        .input('name', sql.NVarChar(50), name)
        .query('INSERT INTO dbo.sectors (name) OUTPUT INSERTED.id VALUES (@name)')
      sectorIdByName.set(name, out.recordset[0].id)
    }
    console.log(`[seed] sectors 灌入 ${sectorIdByName.size} 筆`)

    // (b) 寫入 stocks 表（股票主檔）
    // base_price 和 volatility 這邊都設為 0，因為真實價格來自 TWSE，不再需要這兩個欄位
    for (const s of TOP50) {
      const r   = new sql.Request(tx)
      const out = await r
        .input('code',      sql.VarChar(10),   s.code)
        .input('name',      sql.NVarChar(50),  s.name)
        .input('sector_id', sql.SmallInt,       sectorIdByName.get(s.sector))
        .input('is_etf',    sql.Bit,            ETF_CODES.has(s.code) ? 1 : 0)
        .query(`INSERT INTO dbo.stocks (code, name, sector_id, base_price, volatility, is_etf, is_active)
                OUTPUT INSERTED.id
                VALUES (@code, @name, @sector_id, 0, 0, @is_etf, 1)`)
      stockIdByCode.set(s.code, out.recordset[0].id)
    }
    console.log(`[seed] stocks 灌入 ${stockIdByCode.size} 筆\n`)
  })

  // ── 步驟 3：逐一向 TWSE 抓真實 K 線並寫入 ─────────────────────────────
  // 每支股票分開處理（不在同一個 transaction），這樣某一支失敗不影響其他支。
  console.log(`[seed] 開始抓取 TWSE 真實 K 線（${SEED_MONTHS} 個月 / 50 支，預計 40~60 秒）…\n`)

  let successCount = 0
  let failCount    = 0
  const failed     = []

  for (let i = 0; i < TOP50.length; i++) {
    const s       = TOP50[i]
    const stockId = stockIdByCode.get(s.code)
    const label   = `${String(i + 1).padStart(2, '0')}/50  ${s.code} ${s.name}`

    process.stdout.write(`[seed]  ${label} … `)

    try {
      const { bars, provider } = await fetchRecentHistoryWithFallback(s.code, SEED_MONTHS)

      if (bars.length === 0) {
        // TWSE 回傳空陣列（例如今天是假日、該股暫停交易）
        process.stdout.write(`⚠ TWSE 無資料\n`)
        failCount++
        failed.push(`${s.code} ${s.name}（TWSE 無資料）`)
      } else {
        await writeBarsAndSync(pool, stockId, bars, provider)
        process.stdout.write(`✓ ${bars.length} 筆（${provider}）\n`)
        successCount++
      }
    } catch (err) {
      // 網路錯誤或 API 異常，跳過這支，繼續下一支
      process.stdout.write(`✗ 失敗：${err.message}\n`)
      failCount++
      failed.push(`${s.code} ${s.name}（${err.message}）`)
    }

    // 最後一支不需要等，其他的等一下再抓下一支
    if (i < TOP50.length - 1) {
      await sleep(INTER_STOCK_DELAY_MS)
    }
  }

  // ── 步驟 4：最終報告 ─────────────────────────────────────────────────────
  console.log()
  console.log(`[seed] ✓ 完成：${successCount} 支成功，${failCount} 支失敗`)

  if (failed.length > 0) {
    console.log('[seed] 失敗清單（可稍後手動重試 --sync-stocks）：')
    failed.forEach((f) => console.log(`  - ${f}`))
  }

  const verify = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.sectors)          AS sectors,
      (SELECT COUNT(*) FROM dbo.stocks)           AS stocks,
      (SELECT COUNT(*) FROM dbo.stock_daily_bars) AS bars,
      (SELECT COUNT(*) FROM dbo.stock_sync)       AS synced`)
  console.log('[seed] 資料庫目前筆數：', verify.recordset[0])
}

// ════════════════════════════════════════════════════════════════════════════
// 第六部分：--sync-stocks 模式
// ════════════════════════════════════════════════════════════════════════════

/**
 * syncTop50Stocks(pool)
 *
 * 【這個函式做什麼？】
 *   非破壞性地把 TOP50 清單同步到資料庫：
 *   - 股票已存在 → 更新名稱、產業、is_active（確保資料最新）
 *   - 股票不存在 → 新增
 *   - 已有真實 K 線的股票 → 不重抓（保留已有的資料）
 *   - 沒有真實 K 線的股票 → 向 TWSE 抓取並寫入
 *
 * 【和 --force 的差別】
 *   --force：砍掉全部重來（需要 orders/holdings 是空的）
 *   --sync-stocks：只補缺的，已有交易資料也可以安全執行
 *
 * @param {object} pool - mssql 連線池物件
 */
async function syncTop50Stocks(pool) {
  validateTop50()

  console.log('[seed] --sync-stocks：開始同步股票主檔…')
  let stockUpserts = 0
  let barsFetched  = 0
  let barsSkipped  = 0
  const failed     = []

  for (let i = 0; i < TOP50.length; i++) {
    const s = TOP50[i]

    // Step A：upsert 股票主檔（有就更新，沒有就新增）
    const out = await pool.request()
      .input('sector',  sql.NVarChar(50),  s.sector)
      .input('code',    sql.VarChar(10),   s.code)
      .input('name',    sql.NVarChar(50),  s.name)
      .input('is_etf',  sql.Bit,           ETF_CODES.has(s.code) ? 1 : 0)
      .query(`
        DECLARE @sectorId smallint;
        SELECT @sectorId = id FROM dbo.sectors WHERE name = @sector;
        IF @sectorId IS NULL
        BEGIN
          INSERT INTO dbo.sectors (name) VALUES (@sector);
          SET @sectorId = CONVERT(smallint, SCOPE_IDENTITY());
        END;

        IF EXISTS (SELECT 1 FROM dbo.stocks WHERE code = @code)
        BEGIN
          UPDATE dbo.stocks
             SET name      = @name,
                 sector_id = @sectorId,
                 is_etf    = @is_etf,
                 is_active = 1
           WHERE code = @code;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.stocks
            (code, name, sector_id, base_price, volatility, is_etf, is_active)
          VALUES
            (@code, @name, @sectorId, 0, 0, @is_etf, 1);
        END;

        SELECT id FROM dbo.stocks WHERE code = @code;
      `)

    const stockId = out.recordset[0].id
    stockUpserts++

    // Step B：檢查這支股票是否已有真實 K 線（source = 'twse' 或 'finmind'）
    const syncRow = await pool.request()
      .input('sid', sql.SmallInt, stockId)
      .query(`SELECT source FROM dbo.stock_sync WHERE stock_id = @sid`)

    const existingSource = syncRow.recordset[0]?.source
    const hasRealData    = existingSource === 'twse' || existingSource === 'finmind'

    if (hasRealData) {
      // 已有真實 K 線，不重抓
      barsSkipped++
      continue
    }

    // Step C：沒有真實資料，向 TWSE 抓取
    const label = `${String(i + 1).padStart(2, '0')}/50  ${s.code} ${s.name}`
    process.stdout.write(`[seed]  ${label} … `)

    try {
      const { bars, provider } = await fetchRecentHistoryWithFallback(s.code, SEED_MONTHS)

      if (bars.length === 0) {
        process.stdout.write(`⚠ TWSE 無資料\n`)
        failed.push(`${s.code} ${s.name}`)
      } else {
        await writeBarsAndSync(pool, stockId, bars, provider)
        process.stdout.write(`✓ ${bars.length} 筆（${provider}）\n`)
        barsFetched++
      }
    } catch (err) {
      process.stdout.write(`✗ 失敗：${err.message}\n`)
      failed.push(`${s.code} ${s.name}（${err.message}）`)
    }

    if (i < TOP50.length - 1) {
      await sleep(INTER_STOCK_DELAY_MS)
    }
  }

  // Step D：下架不在 TOP50 清單中的 active 股票
  // 當成分股調整（例如某支退出台灣50），把它從 active 移除，
  // 這樣前端搜尋就不會再顯示它。
  // 不直接 DELETE，保留記錄（它可能還被舊的 orders/holdings 參照）。
  const top50CodeSet = new Set(TOP50.map((s) => s.code))
  const activeRows   = await pool.request()
    .query('SELECT code, name FROM dbo.stocks WHERE is_active = 1')
  const toDeactivate = activeRows.recordset.filter((r) => !top50CodeSet.has(r.code))

  if (toDeactivate.length > 0) {
    console.log(`[seed] 下架 ${toDeactivate.length} 支已不在 TOP50 的股票：`)
    for (const r of toDeactivate) {
      await pool.request()
        .input('code', sql.VarChar(10), r.code)
        .query('UPDATE dbo.stocks SET is_active = 0 WHERE code = @code')
      console.log(`  - ${r.code} ${r.name}`)
    }
  }

  console.log()
  console.log(`[seed] --sync-stocks 完成`)
  console.log(`  股票主檔 upsert：${stockUpserts} 支`)
  console.log(`  已有真實K線（略過）：${barsSkipped} 支`)
  console.log(`  本次新抓取：${barsFetched} 支`)
  console.log(`  自動下架非成分股：${toDeactivate.length} 支`)
  if (failed.length > 0) {
    console.log(`  失敗：${failed.length} 支`)
    failed.forEach((f) => console.log(`    - ${f}`))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 啟動
// ════════════════════════════════════════════════════════════════════════════

main()
  .catch((err) => {
    console.error('[seed] 失敗：', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
