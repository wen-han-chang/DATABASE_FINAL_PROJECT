/**
 * test-api.mjs — 後端一鍵測試腳本
 *
 * 這支做什麼：
 *   自動跑一遍「註冊 → 登入 → 存問卷 → 設資金 → 買 → 賣 → 查組合 → 重置」，
 *   每一步自動判斷成功或失敗，最後印出總結。不需要 Postman / curl。
 *
 * 怎麼用：
 *   1) 先確定後端有開著（另一個終端跑 npm run dev，看到
 *      "Backend is running" 且 "[db] Connected to SQL Server"）。
 *   2) 在 backend 資料夾開「新的」終端，執行：
 *        node test-api.mjs
 *   3) 看輸出：全部出現 ✅ PASS 就代表後端沒問題；
 *      出現 ❌ FAIL 會印出原因。
 *
 * 注意：
 *   - 每次執行會用「不重複的 email」註冊一個新測試帳號，
 *     所以可以重複跑，不會互相干擾。
 *   - 這支不會動到你的 demo@invest.ai 帳號。
 */

// 後端網址（npm run dev 預設就是這個）
const BASE = 'http://localhost:3001'

// 小工具：印出每一步結果並計分
let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`✅ PASS  ${name}`)
  } else {
    fail++
    console.log(`❌ FAIL  ${name}  ${detail}`)
  }
}

// 小工具：發 JSON 請求；auth=true 會自動帶登入 token
let token = ''
async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function main() {
  console.log('===== 後端測試開始 =====\n')

  // 0) 健康檢查：後端有沒有活著、資料庫連得上嗎
  try {
    const h = await call('GET', '/api/health')
    check('健康檢查 /api/health', h.data.ok === true, JSON.stringify(h.data))
    check('資料庫有連上 (db.connected)', h.data?.db?.connected === true,
      `實際: ${JSON.stringify(h.data?.db)}`)
  } catch (e) {
    check('健康檢查 /api/health', false,
      `連不到後端，請確認有先 npm run dev。錯誤: ${e.message}`)
    console.log('\n後端沒開，後面測試略過。')
    return summary()
  }

  // 1) 註冊（用時間戳當不重複 email）
  const email = `test_${Date.now()}@ncu.edu`
  const reg = await call('POST', '/api/auth/register', {
    email, password: 'pass1234', name: '自動測試帳號', avatar: '🧪',
  })
  check('註冊 /api/auth/register', reg.status === 201 && reg.data.ok === true,
    JSON.stringify(reg.data))
  check('註冊有回傳 token', typeof reg.data.token === 'string' && reg.data.token.length > 10)
  check('中文姓名沒亂碼', reg.data?.user?.name === '自動測試帳號',
    `實際: ${reg.data?.user?.name}`)

  // 2) 登入（用剛註冊的帳號）
  const login = await call('POST', '/api/auth/login', { email, password: 'pass1234' })
  check('登入 /api/auth/login', login.data.ok === true, JSON.stringify(login.data))
  token = login.data.token || '' // 之後的請求都用這個 token

  // 2b) 故意用錯密碼，應該要被擋
  const badLogin = await call('POST', '/api/auth/login', { email, password: 'wrong' })
  check('錯密碼應被拒 (401)', badLogin.status === 401,
    `實際狀態碼: ${badLogin.status}`)

  // 3) 沒帶 token 不能查組合，應回 401
  const savedToken = token
  token = ''
  const noAuth = await call('GET', '/api/portfolio')
  check('未登入存取應被拒 (401)', noAuth.status === 401, `實際: ${noAuth.status}`)
  token = savedToken

  // 4) 存投資問卷
  const prof = await call('POST', '/api/investor-profile', {
    capitalRange: '10-50萬', riskLevel: 4, period: 'mid',
  })
  check('存問卷 /api/investor-profile', prof.data.ok === true, JSON.stringify(prof.data))
  check('問卷中文有正確存入', prof.data?.profile?.capitalRange === '10-50萬',
    `實際: ${prof.data?.profile?.capitalRange}`)

  // 5) 設定初始資金 100 萬
  const setup = await call('POST', '/api/portfolio/setup', { capital: 1000000 })
  check('設定資金 /api/portfolio/setup', setup.data.ok === true, JSON.stringify(setup.data))

  // 6) 買 1 張台積電 @ 600（面額 600000 + 手續費 855 = 600855）
  const buy = await call('POST', '/api/orders/buy', { code: '2330', lots: 1, price: 600 })
  check('買入 /api/orders/buy', buy.data.ok === true, JSON.stringify(buy.data))

  // 7) 查組合，驗證現金、持股、委託是否正確
  const pf1 = await call('GET', '/api/portfolio')
  const cashAfterBuy = pf1.data.cash
  check('買入後現金 = 1,000,000 − 600,855 = 399,145',
    Math.round(cashAfterBuy) === 399145, `實際現金: ${cashAfterBuy}`)
  check('買入後持股有 1 筆台積電',
    pf1.data.holdings?.length === 1 && pf1.data.holdings[0].code === '2330',
    JSON.stringify(pf1.data.holdings))
  check('委託紀錄有 1 筆 buy',
    pf1.data.orders?.length === 1 && pf1.data.orders[0].type === 'buy',
    JSON.stringify(pf1.data.orders))

  // 8) 賣 1 張 @ 650（面額650000 − 手續費926.25 − 證交稅1950 = 647123.75）
  const sell = await call('POST', '/api/orders/sell', { code: '2330', lots: 1, price: 650 })
  check('賣出 /api/orders/sell', sell.data.ok === true, JSON.stringify(sell.data))

  const pf2 = await call('GET', '/api/portfolio')
  check('賣光後持股應為空', (pf2.data.holdings?.length || 0) === 0,
    JSON.stringify(pf2.data.holdings))
  check('賣出後現金 = 399,145 + 647,123.75 = 1,046,268.75',
    Math.abs(pf2.data.cash - 1046268.75) < 0.01, `實際現金: ${pf2.data.cash}`)

  // 9) 賣超過持有量，應被擋（測試交易邏輯）
  const overSell = await call('POST', '/api/orders/sell', { code: '2330', lots: 99, price: 650 })
  check('賣超過持股應被拒', overSell.data.ok === false || overSell.status >= 400,
    JSON.stringify(overSell.data))

  // 10) 重置帳戶
  const reset = await call('POST', '/api/portfolio/reset')
  check('重置 /api/portfolio/reset', reset.data.ok === true, JSON.stringify(reset.data))
  const pf3 = await call('GET', '/api/portfolio')
  check('重置後回到未設定狀態', pf3.data.isReady === false, JSON.stringify(pf3.data))

  summary()
}

function summary() {
  console.log(`\n===== 測試結束：${pass} 通過 / ${fail} 失敗 =====`)
  if (fail === 0) {
    console.log('🎉 全部通過，後端沒問題！')
  } else {
    console.log('⚠️ 有失敗項目，請看上面 ❌ FAIL 的原因。常見原因見 README/說明文件。')
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.log('\n測試腳本本身出錯：', e.message)
  process.exitCode = 1
})
