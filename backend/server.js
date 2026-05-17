/**
 * 簡單版 backend HTTP server。
 *
 * 這個檔案只做三件事：
 * 1. 接收前端或測試工具送來的 HTTP request。
 * 2. 呼叫 twseClient.js 去抓 TWSE 官方資料。
 * 3. 統一回傳 JSON，並處理 CORS / 錯誤格式。
 *
 * 為什麼不用一開始就上 Express：
 * - 你現在的需求是「先能跑、能懂、能維護」。
 * - 內建 http 模組就夠了，不需要先多裝一堆套件。
 * - 這樣也比較容易看懂 request / response 的基本流程。
 */

// ⚠️ 這一行必須是「最上面第一個 import」：
// 它的副作用會把 backend/.env 讀進 process.env，
// 後面 twseClient / db 才讀得到設定。
import './loadEnv.js'

import http from 'node:http'
import {
  fetchMarketIndex,
  fetchRawTwsePath,
  fetchStockDayAll,
  fetchStockDayAverageAll,
  fetchTwseSwagger,
  TWSE_SAMPLE_ENDPOINTS,
} from './twseClient.js'
import { mapStockDayAll } from './twseMapper.js'
import { pingDb, closePool } from './db.js'
import { verifyToken } from './auth.js'
import {
  registerUser,
  loginUser,
  getInvestorProfile,
  saveInvestorProfile,
  setupPortfolio,
  resetPortfolio,
  getPortfolio,
  buyStock,
  sellStock,
  getStockBars,
  getQuote,
} from './dao.js'
import { answerStockQuestion } from './assistant.js'
import { buildAssistantScreeningDiagnostics } from './assistantData.js'

const PORT = Number(process.env.PORT || 3001)

/**
 * 把任何值安全地轉成 JSON。
 * 主要是讓回傳格式穩定，不要因為某些欄位 undefined 而讓前端不好處理。
 */
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  })

  res.end(JSON.stringify(payload, null, 2))
}

/**
 * 統一把錯誤變成前端看得懂的 JSON。
 * 這裡故意保留 error.message，因為你在開發階段需要知道到底壞在哪。
 */
function sendError(res, statusCode, message, detail = null) {
  sendJson(res, statusCode, {
    ok: false,
    error: message,
    detail,
  })
}

/**
 * 從陣列中找指定股票代號。
 * code 一律轉成字串比對，避免前端傳入數字時比對失敗。
 */
function filterRowsByStockCode(rows, code) {
  const targetCode = String(code || '').trim()

  if (!targetCode) {
    return rows
  }

  return rows.filter((row) => String(row?.Code || '').trim() === targetCode)
}

/**
 * 讀取並解析 request 的 JSON body（POST 用）。
 * 限制最大 1MB，避免有人灌爆記憶體。
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body.'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 從 Authorization: Bearer <token> 取出登入者 userId。
 * 沒帶或無效就回 null，由各路由決定要不要擋。
 */
function getAuthUserId(req) {
  const header = req.headers['authorization'] || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const payload = verifyToken(match[1])
  return payload?.userId ?? null
}

/**
 * 把 dao 丟出的錯誤轉成 HTTP 回應。
 * dao 的錯誤帶 statusCode（400/401/404/409），沒帶就當 500。
 */
function sendDaoError(res, error) {
  const status = error?.statusCode || 500
  sendError(res, status, error?.message || 'Internal error.')
}

/**
 * 這裡處理所有 request。
 * 路由設計很簡單，避免初學者一次看太多抽象層。
 */
const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendError(res, 400, 'Missing request URL.')
      return
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    /**
     * CORS preflight。
     * 前端如果是不同 port 發 request，瀏覽器會先送 OPTIONS。
     */
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      })
      res.end()
      return
    }

    /**
     * ───────────────────────────────────────────────────────
     * 應用 API（會讀寫 ncu_db 資料庫）
     * 這些路由在「只接受 GET」防線之前處理，因為含 POST。
     * ───────────────────────────────────────────────────────
     */
    const path = requestUrl.pathname

    if (path === '/api/assistant/diagnostics' && req.method === 'GET') {
      try {
        const etfCode = requestUrl.searchParams.get('etf') || '0050'
        const diagnostics = await buildAssistantScreeningDiagnostics(etfCode)
        sendJson(res, 200, { ok: true, ...diagnostics })
      } catch (error) {
        sendDaoError(res, error)
      }
      return
    }

    // 註冊：POST /api/auth/register
    if (path === '/api/auth/register' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req)
        const result = await registerUser(body)
        sendJson(res, 201, { ok: true, ...result })
      } catch (error) {
        sendDaoError(res, error)
      }
      return
    }

    // 登入：POST /api/auth/login
    if (path === '/api/auth/login' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req)
        const result = await loginUser(body)
        sendJson(res, 200, { ok: true, ...result })
      } catch (error) {
        sendDaoError(res, error)
      }
      return
    }

    // 以下路由都需要登入：先驗 token
    const isAppApi =
      path === '/api/investor-profile' ||
      path === '/api/portfolio' ||
      path === '/api/portfolio/setup' ||
      path === '/api/portfolio/reset' ||
      path === '/api/orders/buy' ||
      path === '/api/orders/sell' ||
      path === '/api/assistant/chat'

    if (isAppApi) {
      const userId = getAuthUserId(req)
      if (!userId) {
        sendError(res, 401, '未登入或 token 無效，請重新登入。')
        return
      }

      try {
        // 投資人偏好：GET 讀 / POST 存
        if (path === '/api/investor-profile' && req.method === 'GET') {
          const profile = await getInvestorProfile(userId)
          sendJson(res, 200, { ok: true, profile })
          return
        }
        if (path === '/api/investor-profile' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const profile = await saveInvestorProfile(userId, body)
          sendJson(res, 200, { ok: true, profile })
          return
        }

        // 取得完整投資組合（portfolio + 持股 + 委託）
        if (path === '/api/portfolio' && req.method === 'GET') {
          const data = await getPortfolio(userId)
          sendJson(res, 200, { ok: true, ...data })
          return
        }

        // 設定初始資產
        if (path === '/api/portfolio/setup' && req.method === 'POST') {
          const body = await readJsonBody(req)
          await setupPortfolio(userId, body.capital)
          sendJson(res, 200, { ok: true })
          return
        }

        // 重置帳戶（清持股/委託，回到未設定）
        if (path === '/api/portfolio/reset' && req.method === 'POST') {
          await resetPortfolio(userId)
          sendJson(res, 200, { ok: true })
          return
        }

        // 買入（含資料庫交易）
        if (path === '/api/orders/buy' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const result = await buyStock(userId, body.code, body.shares, body.price)
          sendJson(res, 200, result)
          return
        }

        // 賣出（含資料庫交易）
        if (path === '/api/orders/sell' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const result = await sellStock(userId, body.code, body.shares, body.price)
          sendJson(res, 200, result)
          return
        }

        if (path === '/api/assistant/chat' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const result = await answerStockQuestion(body.message)
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        // 路徑對但方法不對
        sendError(res, 405, `Method ${req.method} not allowed for ${path}.`)
      } catch (error) {
        sendDaoError(res, error)
      }
      return
    }

    /**
     * 只接受 GET。
     * 剩下的 TWSE 相關路由都是資料查詢，不接受寫入。
     */
    if (req.method !== 'GET') {
      sendError(res, 405, 'Only GET is supported for TWSE routes.')
      return
    }

    /**
     * 從「資料庫」讀某檔股票的日 K 線（給首頁 K 線圖用）。
     * 例：/api/market/db-bars/2330
     * 這是公開 GET（行情資料，不需登入），與其他 /api/market/* 一致。
     */
    if (requestUrl.pathname.startsWith('/api/market/db-bars/')) {
      const code = decodeURIComponent(
        requestUrl.pathname.replace('/api/market/db-bars/', ''),
      )
      const refresh = requestUrl.searchParams.get('refresh') === '1'
      const quick = requestUrl.searchParams.get('quick') === '1'
      const before = requestUrl.searchParams.get('before') || undefined
      const months = requestUrl.searchParams.get('months') || undefined
      try {
        const result = await getStockBars(code, { refresh, quick, before, months })
        sendJson(res, 200, {
          ok: true,
          source: result.source,
          historyStatus: result.historyStatus,
          hasMoreBefore: result.hasMoreBefore,
          code,
          count: result.bars.length,
          data: result.bars,
        })
      } catch (error) {
        sendDaoError(res, error)
      }
      return
    }

    /**
     * 單一檔「準即時」報價（TWSE MIS，後端有 20 秒快取）。
     * 例：/api/quote/2330  公開 GET，不需登入。
     */
    if (requestUrl.pathname.startsWith('/api/quote/')) {
      const code = decodeURIComponent(
        requestUrl.pathname.replace('/api/quote/', ''),
      )
      try {
        const quote = await getQuote(code)
        sendJson(res, 200, { ok: true, data: quote })
      } catch (error) {
        sendDaoError(res, error)
      }
      return
    }

    /**
     * 健康檢查。
     * 讓你可以先確認 backend 有沒有活著。
     */
    if (requestUrl.pathname === '/api/health') {
      // 順手測一下資料庫；連不上不讓整個健康檢查掛掉，只回報 db:false
      let dbOk = false
      let dbError = null
      try {
        dbOk = await pingDb()
      } catch (error) {
        dbError = error instanceof Error ? error.message : String(error)
      }

      sendJson(res, 200, {
        ok: true,
        service: 'database-final-project-backend',
        message: 'Backend is running.',
        twseBaseUrl: process.env.TWSE_API_BASE_URL || 'https://openapi.twse.com.tw/v1',
        db: {
          connected: dbOk,
          name: process.env.DB_NAME || 'ncu_db',
          error: dbError,
        },
      })
      return
    }

    /**
     * 直接把 TWSE Swagger 轉出來。
     * 這個是確認官方 API 文件最直接的方法。
     */
    if (requestUrl.pathname === '/api/twse/swagger') {
      const data = await fetchTwseSwagger()
      sendJson(res, 200, {
        ok: true,
        source: 'TWSE OpenAPI Swagger',
        data,
      })
      return
    }

    /**
     * 常見的市場總覽資料。
     * 這是最適合先接前端的範例，因為它是「整體市場」而不是單一個股。
     */
    if (requestUrl.pathname === '/api/twse/market-index') {
      const data = await fetchMarketIndex()
      sendJson(res, 200, {
        ok: true,
        endpoint: TWSE_SAMPLE_ENDPOINTS.marketIndex,
        data,
      })
      return
    }

    /**
     * 取得可對應 stocks 表的資料。
     * 來源是 STOCK_DAY_ALL，因為它同時有 Code、Name、ClosingPrice。
     */
    if (requestUrl.pathname === '/api/market/stocks') {
      const rows = await fetchStockDayAll()
      const mapped = mapStockDayAll(rows)

      sendJson(res, 200, {
        ok: true,
        source: TWSE_SAMPLE_ENDPOINTS.stockDayAll,
        count: mapped.stocks.length,
        data: mapped.stocks,
      })
      return
    }

    /**
     * 取得單一股票的基本資料。
     * 例如：/api/market/stocks/2330
     */
    if (requestUrl.pathname.startsWith('/api/market/stocks/')) {
      const code = decodeURIComponent(requestUrl.pathname.replace('/api/market/stocks/', ''))
      const rows = await fetchStockDayAll()
      const mapped = mapStockDayAll(filterRowsByStockCode(rows, code))
      const stock = mapped.stocks[0] || null

      if (!stock) {
        sendError(res, 404, `Stock ${code} was not found in TWSE latest daily data.`)
        return
      }

      sendJson(res, 200, {
        ok: true,
        source: TWSE_SAMPLE_ENDPOINTS.stockDayAll,
        data: stock,
      })
      return
    }

    /**
     * 取得可對應 stock_daily_bars 表的資料。
     * 這裡回傳的是最新交易日的全部上市商品日 K 資料。
     */
    if (requestUrl.pathname === '/api/market/daily-bars') {
      const rows = await fetchStockDayAll()
      const code = requestUrl.searchParams.get('code')
      const mapped = mapStockDayAll(filterRowsByStockCode(rows, code))

      sendJson(res, 200, {
        ok: true,
        source: TWSE_SAMPLE_ENDPOINTS.stockDayAll,
        count: mapped.stock_daily_bars.length,
        data: mapped.stock_daily_bars,
      })
      return
    }

    /**
     * 取得單一股票最新交易日的日 K 資料。
     * 例如：/api/market/daily-bars/2330
     */
    if (requestUrl.pathname.startsWith('/api/market/daily-bars/')) {
      const code = decodeURIComponent(requestUrl.pathname.replace('/api/market/daily-bars/', ''))
      const rows = await fetchStockDayAll()
      const mapped = mapStockDayAll(filterRowsByStockCode(rows, code))
      const bar = mapped.stock_daily_bars[0] || null

      if (!bar) {
        sendError(res, 404, `Daily bar for stock ${code} was not found in TWSE latest daily data.`)
        return
      }

      sendJson(res, 200, {
        ok: true,
        source: TWSE_SAMPLE_ENDPOINTS.stockDayAll,
        data: bar,
      })
      return
    }

    /**
     * 匯入預覽。
     * 這個路由把 TWSE 資料整理成接近資料庫三張表的格式：
     * sectors、stocks、stock_daily_bars。
     */
    if (requestUrl.pathname === '/api/market/import-preview') {
      const rows = await fetchStockDayAll()
      const mapped = mapStockDayAll(rows)

      sendJson(res, 200, {
        ok: true,
        source: TWSE_SAMPLE_ENDPOINTS.stockDayAll,
        counts: {
          sectors: mapped.sectors.length,
          stocks: mapped.stocks.length,
          stock_daily_bars: mapped.stock_daily_bars.length,
        },
        data: mapped,
      })
      return
    }

    /**
     * 保留 TWSE 日收盤價與月均價原始資料。
     * 這份資料適合之後做分析，但不足以建立完整 K 棒。
     */
    if (requestUrl.pathname === '/api/twse/stock-day-average-all') {
      const data = await fetchStockDayAverageAll()
      sendJson(res, 200, {
        ok: true,
        endpoint: TWSE_SAMPLE_ENDPOINTS.stockDayAverageAll,
        data,
      })
      return
    }

    /**
     * 通用代理(proxy)。
     * 用法：
     * /api/twse/raw?path=/exchangeReport/MI_INDEX
     * /api/twse/raw?path=/swagger.json
     *
     * 這個設計的優點：
     * - 不必每次 TWSE 多一個資料表就重寫 backend。
     * - 前端可以先用這個打通流程，再慢慢拆專屬 API。
     */
    if (requestUrl.pathname === '/api/twse/raw') {
      const upstreamPath = requestUrl.searchParams.get('path')

      if (!upstreamPath) {
        sendError(res, 400, 'Query parameter "path" is required.')
        return
      }

      /**
       * 把除了 path 以外的 query 全部轉發給 TWSE。
       * 這樣可以支援像 date、stockNo 之類的參數。
       */
      const forwardQuery = {}
      for (const [key, value] of requestUrl.searchParams.entries()) {
        if (key === 'path') continue
        forwardQuery[key] = value
      }

      const data = await fetchRawTwsePath(upstreamPath, forwardQuery)
      sendJson(res, 200, {
        ok: true,
        upstreamPath,
        query: forwardQuery,
        data,
      })
      return
    }

    /**
     * 路由不存在時，回 404。
     */
    sendError(res, 404, 'Route not found.')
  } catch (error) {
    sendError(res, 502, 'Failed to fetch TWSE data.', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * 啟動 server。
 * 這裡順便做一個簡單的 console log，讓你知道埠號跟 base URL。
 */
server.listen(PORT, () => {
  console.log(`Backend is running at http://localhost:${PORT}`)
  console.log(`TWSE base URL: ${process.env.TWSE_API_BASE_URL || 'https://openapi.twse.com.tw/v1'}`)
  console.log('Health check: /api/health')
  console.log('Swagger proxy: /api/twse/swagger')
  console.log('Market index: /api/twse/market-index')
  console.log('Mapped stocks: /api/market/stocks')
  console.log('Mapped daily bars: /api/market/daily-bars')
  console.log('Import preview: /api/market/import-preview')
  console.log('Raw proxy: /api/twse/raw?path=/exchangeReport/MI_INDEX')
})

/**
 * 讓程序結束時能正常關閉。
 * 這在你之後按 Ctrl+C 停止 backend 時比較乾淨。
 */
process.on('SIGINT', () => {
  server.close(async () => {
    await closePool() // 一併關閉資料庫連線池，乾淨退出
    console.log('Backend stopped.')
    process.exit(0)
  })
})
