/**
 * clear-stock-data.js — 清除資料庫的「股票資料」（需手動輸入 yes 才執行）
 *
 * 會刪除的（只動股票行情/快取資料，不碰帳號與交易）：
 *   - dbo.stock_daily_bars  （所有日 K 線：seed 模擬 + 已抓的 TWSE 真實）
 *   - dbo.stock_sync        （每檔的同步狀態）
 *
 * 不會刪除：
 *   - users / investor_profiles / portfolios / holdings / orders（帳號與交易）
 *   - stocks / sectors（股票與產業「目錄」，刪了會破壞外鍵且要重 seed）
 *
 * 刪除後：下次在前端看某檔股票時，後端會重新去 TWSE 抓真實歷史並重建。
 * 若也想把 stocks/sectors 重來，請改跑 `node seed.js --force`（另一支）。
 *
 * 用法：對專案根目錄的 clear-stock-data.bat 點兩下，依提示輸入 yes。
 */

import './loadEnv.js'
import readline from 'node:readline'
import { getPool, closePool } from './db.js'

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function main() {
  const pool = await getPool()

  // 先顯示目前筆數，讓使用者知道會刪掉多少
  const before = await pool.request().query(
    `SELECT (SELECT COUNT(*) FROM dbo.stock_daily_bars) AS bars,
            (SELECT COUNT(*) FROM dbo.stock_sync)       AS sync`,
  )
  const b = before.recordset[0]

  console.log('============================================================')
  console.log(' ⚠️  即將清除「股票資料」（此動作無法復原）')
  console.log('     - stock_daily_bars 目前 ' + b.bars + ' 筆 → 會全部刪除')
  console.log('     - stock_sync       目前 ' + b.sync + ' 筆 → 會全部刪除')
  console.log('     （帳號、問卷、投資組合、買賣紀錄、股票目錄 不受影響）')
  console.log('============================================================')

  const answer = await ask('確定要刪除嗎？請輸入 yes 再按 Enter（其他任何輸入皆取消）: ')

  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('\n已取消，沒有刪除任何資料。')
    return
  }

  // FK 安全：stock_daily_bars / stock_sync 都是被 stocks 參考的「子表」，
  // 沒有其他表參考它們，可直接刪。
  await pool.request().query('DELETE FROM dbo.stock_daily_bars')
  await pool.request().query('DELETE FROM dbo.stock_sync')

  const after = await pool.request().query(
    `SELECT (SELECT COUNT(*) FROM dbo.stock_daily_bars) AS bars,
            (SELECT COUNT(*) FROM dbo.stock_sync)       AS sync`,
  )
  const a = after.recordset[0]
  console.log('\n✅ 已清除。目前 stock_daily_bars=' + a.bars + '、stock_sync=' + a.sync)
  console.log('   下次在前端查看某檔股票時，後端會重新去 TWSE 抓真實歷史。')
}

main()
  .catch((err) => {
    console.error('\n❌ 清除失敗：', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
