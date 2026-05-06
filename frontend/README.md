# 投智 AI — 模擬投資輔助系統

> 以引導式問卷了解投資偏好，搭配 AI 盤勢解讀、個股技術分析、與模擬下單功能，幫助投資新手建立正確的投資思維。

---

## 功能總覽

| 功能 | 說明 |
|------|------|
| 登入系統 | 帳號驗證，未登入無法進入任何頁面 |
| 投資偏好問卷 | 三步驟引導（資金規模 → 風險承受 → 投資週期），產生個人投資畫像 |
| 首頁總覽 | AI 盤勢摘要、決策卡片、投資知識抽屜 |
| 個股查詢 | 輸入股票代碼或名稱，顯示 K 線圖（日/週/月）與 AI 技術分析 |
| 模擬下單 | 設定虛擬資金，進行買賣模擬，即時計算手續費與證交稅 |

---

## 技術架構

- **框架**：Vue 3 Composition API（`<script setup>`）
- **建構工具**：Vite 5
- **狀態管理**：Pinia
- **路由**：Vue Router 4
- **圖表**：ECharts 5（K 線 + 均線 + 成交量）
- **樣式**：Tailwind CSS 3
- **圖示**：Lucide Vue Next

---

## 專案結構

```
db-course-final/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.js
    ├── App.vue                        # 主佈局（側邊欄 + RouterView）
    ├── router/
    │   └── index.js                   # 路由定義與 Navigation Guard
    ├── stores/
    │   ├── auth.js                    # 登入狀態管理
    │   ├── investor.js                # 投資偏好 Store
    │   └── portfolio.js               # 模擬投資組合 Store（含 localStorage 持久化）
    ├── data/
    │   ├── twStocks.js                # 台股資料庫（65+ 檔）與模擬價格演算法
    │   └── knowledgeBase.js           # 投資術語知識庫
    ├── components/
    │   ├── layout/
    │   │   └── SideNav.vue            # 左側導航欄
    │   ├── Login.vue                  # 登入表單
    │   ├── Onboarding.vue             # 投資偏好問卷精靈
    │   ├── StockChart.vue             # ECharts K 線圖組件
    │   ├── MarketAIView.vue           # AI 盤勢解讀卡片
    │   ├── DecisionSandbox.vue        # 投資決策卡片
    │   └── KnowledgeDrawer.vue        # 右側知識抽屜
    └── views/
        ├── LoginView.vue
        ├── OnboardingView.vue
        ├── HomeView.vue               # 首頁（AI 摘要 + 決策沙盒）
        ├── StockSearchView.vue        # 個股查詢頁
        └── TradingView.vue            # 模擬下單頁
```

---

## 快速開始

### 環境需求

- [Node.js](https://nodejs.org/) v18 以上

### 安裝與啟動

```bash
# 1. 進入專案目錄
cd db-course-final

# 2. 安裝相依套件
npm install

# 3. 啟動開發伺服器
npm run dev
```

開啟瀏覽器至 `http://localhost:5173`

### 其他指令

```bash
npm run build    # 打包正式版（輸出至 dist/）
npm run preview  # 預覽打包結果
```

---

## 測試帳號

| Email | 密碼 |
|-------|------|
| `demo@invest.ai` | `demo123` |
| `user@example.com` | `password` |

---

## 核心設計說明

### 模擬股價演算法

使用 **Mulberry32 PRNG**（以股票代碼為 seed）搭配 **Box-Muller 轉換**，模擬幾何布朗運動（GBM）產生 300 根日 K 資料。每支股票有唯一且穩定的價格曲線，重新整理頁面結果不變。

### 手續費計算規則

| 項目 | 費率 | 收取時機 |
|------|------|----------|
| 手續費 | 0.1425%（最低 20 元） | 買入 + 賣出 |
| 證交稅 | 0.3%（ETF 為 0.1%） | 賣出時 |

### Navigation Guard 流程

```
未登入 → /login
已登入，未完成問卷 → /onboarding
已登入，已完成問卷 → 正常進入各頁面
```

### 資料持久化

模擬投資組合（資金、持股、交易紀錄）使用 `localStorage` 儲存，重新整理或關閉瀏覽器後資料不遺失。

---

## 畫面預覽

| 頁面 | 說明 |
|------|------|
| 登入頁 | 帳號密碼驗證，錯誤提示 |
| 問卷精靈 | 三步驟卡片式選擇，完成後顯示投資畫像 |
| 首頁 | AI 盤勢解讀、決策卡片（買入/觀望/警示）、知識抽屜 |
| 個股查詢 | 即時搜尋、日/週/月 K 線、MA5～MA240 均線切換 |
| 模擬下單 | 資金設定、下單表單、費用明細、持股與交易紀錄 |
