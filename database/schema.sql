/* ============================================================================
   檔名：schema.sql
   用途：投智 AI 投資練習系統 — SQL Server (T-SQL) 完整建表腳本
   目標資料庫系統：Microsoft SQL Server（用 SSMS 連線）
   來源：將 MySQL 版資料表參考文件改寫為正確 T-SQL 語法

   ─────────────────────────────────────────────────────────────────────────
   為什麼需要這份檔案：
   原始 schema 是 MySQL 語法（BIGINT UNSIGNED / AUTO_INCREMENT / ENUM /
   ON UPDATE CURRENT_TIMESTAMP），在 SQL Server 完全無法執行。本檔做了以下
   對應轉換：
     1. AUTO_INCREMENT          → IDENTITY(1,1)
     2. ... UNSIGNED            → 移除（SQL Server 無 unsigned，改用足夠大的型別）
     3. ENUM('a','b')           → NVARCHAR + CHECK (col IN (N'a', N'b'))
     4. BOOLEAN / TRUE / FALSE  → BIT / 1 / 0
     5. DATETIME DEFAULT
        CURRENT_TIMESTAMP       → DATETIME2(0) DEFAULT SYSDATETIME()
     6. ON UPDATE
        CURRENT_TIMESTAMP       → SQL Server 無此語法，改用 AFTER UPDATE 觸發器
     7. 含中文的欄位             → 一律改 NVARCHAR，字面值加 N'' 前綴
     8. 表內 INDEX / UNIQUE KEY → 拆成獨立的 CONSTRAINT / CREATE INDEX

   ─────────────────────────────────────────────────────────────────────────
   如何執行：
     1. 開啟 SSMS，用 SQL Server 驗證登入（帳號 skyfire）。
     2. 確認上方資料庫已選到 ncu_db（或讓本腳本的 Section 0 自動建立並切換）。
     3. 直接整份貼上 → 按「執行 (F5)」。
     4. 看訊息視窗最後的驗證結果（Section 5）確認核心表與延伸表都建立成功。

   如何驗證：
     腳本最後（Section 5）會自動列出所有資料表名稱與資料筆數，
     正常應看到核心資料表、同步表與 AI 延伸表都列在結果中；全新安裝時筆數多半為 0。

   常見錯誤與排除：
     - 「資料庫 'ncu_db' 不存在」：Section 0 會自動建立，若仍失敗代表登入
       帳號沒有 CREATE DATABASE 權限，請改用 sa 或請管理員先建好 ncu_db。
     - 「物件名稱 'dbo.xxx' 已存在」：本腳本每張表都有 IF ... IS NULL 保護，
       重複執行不會出錯也不會刪資料；要全部重建請看 Section 1 的重置區塊。
     - 中文變問號（????）：代表欄位不是 NVARCHAR 或字面值漏了 N'' 前綴；
       本腳本已全部處理，若你自行新增欄位請注意。

   ⚠️ 危險操作警告：
     Section 1 是「整庫重置」區塊（DROP 所有資料表），預設整段註解掉。
     只有在你「確定要清空重建」且「已備份」時，才手動解除註解執行。
     正式 demo 前誤跑會清光所有資料，務必小心。
   ============================================================================ */


/* ============================================================================
   Section 0：確保資料庫存在並切換進去
   ----------------------------------------------------------------------------
   說明：若 ncu_db 尚未建立則自動建立；接著 USE 切換。
   注意：CREATE DATABASE 必須單獨一個批次，所以後面用 GO 分隔。
   ============================================================================ */
IF DB_ID(N'ncu_db') IS NULL
BEGIN
    CREATE DATABASE ncu_db;
END;
GO

USE ncu_db;
GO


/* ============================================================================
   Section 1：⚠️【整庫重置區塊 — 預設停用】⚠️
   ----------------------------------------------------------------------------
   下面整段被 /* */ 包起來而停用。
   只有在「要把所有資料表全部刪掉重建」且「已備份」時，才手動把這段的
   外層 /* 與 */ 拿掉再執行。DROP 順序刻意「先子表後父表」以免外鍵擋住。
   ============================================================================ */
/*  ←←← 要重置時，刪掉這一行開頭的斜線星號

DROP TABLE IF EXISTS dbo.knowledge_related_tags;
DROP TABLE IF EXISTS dbo.knowledge_sentences;
DROP TABLE IF EXISTS dbo.knowledge_base;
DROP TABLE IF EXISTS dbo.assistant_recommendation_items;
DROP TABLE IF EXISTS dbo.assistant_recommendation_runs;
DROP TABLE IF EXISTS dbo.watchlists;
DROP TABLE IF EXISTS dbo.decision_card_tags;
DROP TABLE IF EXISTS dbo.decision_cards;
DROP TABLE IF EXISTS dbo.orders;
DROP TABLE IF EXISTS dbo.holdings;
DROP TABLE IF EXISTS dbo.portfolios;
DROP TABLE IF EXISTS dbo.stock_daily_bars;
DROP TABLE IF EXISTS dbo.stock_sync;
DROP TABLE IF EXISTS dbo.stocks;
DROP TABLE IF EXISTS dbo.sectors;
DROP TABLE IF EXISTS dbo.investor_profiles;
DROP TABLE IF EXISTS dbo.users;

←←← 要重置時，刪掉下一行結尾的星號斜線  */


/* ============================================================================
   Section 2：建立資料表（依外鍵相依順序：先父表後子表）
   ============================================================================ */

/* ─────────────────────────────────────────────────────────────────────────
   1. users — 使用者帳號
   ─────────────────────────────────────────────────────────────────────────
   - id：原 BIGINT UNSIGNED AUTO_INCREMENT → BIGINT IDENTITY(1,1)
   - email / password 為 ASCII，用 VARCHAR 即可（節省空間）
   - name / avatar 可能含中文或 emoji → 用 NVARCHAR
   - created_at / updated_at 預設用 SYSDATETIME()（本機時間，目前專案範圍已足夠）
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id          BIGINT          IDENTITY(1,1) NOT NULL,
        email       VARCHAR(255)    NOT NULL,
        password    VARCHAR(255)    NOT NULL,                 -- 存 bcrypt hash，不存明碼
        name        NVARCHAR(100)   NOT NULL,
        avatar      NVARCHAR(10)    NULL,                      -- emoji 或頭像代碼
        created_at  DATETIME2(0)    NOT NULL CONSTRAINT df_users_created DEFAULT SYSDATETIME(),
        updated_at  DATETIME2(0)    NOT NULL CONSTRAINT df_users_updated DEFAULT SYSDATETIME(),
        CONSTRAINT pk_users      PRIMARY KEY (id),
        CONSTRAINT uq_users_email UNIQUE (email)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   2. investor_profiles — 投資人偏好（與 users 1:1）
   ─────────────────────────────────────────────────────────────────────────
   - capital_range 原為 ENUM 且值是中文 → NVARCHAR + CHECK，字面值加 N''
   - risk_level 原 TINYINT UNSIGNED 1~5 → SQL Server 的 TINYINT 本身即 0~255，
     再用 CHECK 限制 1~5
   - period 原 ENUM('short','mid','long') → VARCHAR + CHECK（純英文不需 N''）
   - user_id 加 UNIQUE 以維持 1:1 關係
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.investor_profiles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.investor_profiles (
        id            BIGINT        IDENTITY(1,1) NOT NULL,
        user_id       BIGINT        NOT NULL,
        capital_range NVARCHAR(20)  NOT NULL,
        risk_level    TINYINT       NOT NULL,                 -- 1(極度保守) ~ 5(激進冒險)
        period        VARCHAR(10)   NOT NULL,                 -- short / mid / long
        created_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ip_created DEFAULT SYSDATETIME(),
        updated_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ip_updated DEFAULT SYSDATETIME(),
        CONSTRAINT pk_investor_profiles PRIMARY KEY (id),
        CONSTRAINT uq_ip_user           UNIQUE (user_id),
        CONSTRAINT fk_ip_user           FOREIGN KEY (user_id)
                                        REFERENCES dbo.users(id) ON DELETE CASCADE,
        CONSTRAINT chk_capital_range    CHECK (capital_range IN
                                        (N'10萬以下', N'10-50萬', N'50-200萬', N'200萬以上')),
        CONSTRAINT chk_risk_level       CHECK (risk_level BETWEEN 1 AND 5),
        CONSTRAINT chk_period           CHECK (period IN ('short', 'mid', 'long'))
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   3. sectors — 股票類別（lookup 表）
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sectors', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.sectors (
        id    SMALLINT      IDENTITY(1,1) NOT NULL,
        name  NVARCHAR(50)  NOT NULL,                          -- '半導體' / '金融' / 'ETF' …
        CONSTRAINT pk_sectors      PRIMARY KEY (id),
        CONSTRAINT uq_sectors_name UNIQUE (name)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   4. stocks — 股票基本資料
   ─────────────────────────────────────────────────────────────────────────
   - code 原 CHAR(6)：CHAR 會補空白造成比對麻煩，改用 VARCHAR(10)
     （台股代碼長度不一，ETF / 權證可能超過 4 碼，VARCHAR 較安全）
   - is_etf / is_active 原 BOOLEAN → BIT，DEFAULT 0/1
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.stocks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stocks (
        id          SMALLINT       IDENTITY(1,1) NOT NULL,
        code        VARCHAR(10)    NOT NULL,                   -- '2330' / '0050' …
        name        NVARCHAR(50)   NOT NULL,
        sector_id   SMALLINT       NOT NULL,
        base_price  DECIMAL(10,2)  NOT NULL,                   -- 參考基礎股價
        volatility  DECIMAL(6,4)   NOT NULL,                   -- PRNG 波動係數
        is_etf      BIT            NOT NULL CONSTRAINT df_stocks_isetf    DEFAULT 0,
        is_active   BIT            NOT NULL CONSTRAINT df_stocks_isactive DEFAULT 1,
        CONSTRAINT pk_stocks       PRIMARY KEY (id),
        CONSTRAINT uq_stocks_code  UNIQUE (code),
        CONSTRAINT fk_stock_sector FOREIGN KEY (sector_id) REFERENCES dbo.sectors(id)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   5. stock_daily_bars — 日 K 線資料
   ─────────────────────────────────────────────────────────────────────────
   - volume 原 BIGINT UNSIGNED → BIGINT（有號上限 9.2e18，成交量綽綽有餘）
   - 唯一鍵 (stock_id, trade_date) 防止同股同日重複匯入
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.stock_daily_bars', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stock_daily_bars (
        id          BIGINT         IDENTITY(1,1) NOT NULL,
        stock_id    SMALLINT       NOT NULL,
        trade_date  DATE           NOT NULL,
        [open]      DECIMAL(10,2)  NOT NULL,                   -- open 是保留字，用 [] 包住
        high        DECIMAL(10,2)  NOT NULL,
        low         DECIMAL(10,2)  NOT NULL,
        [close]     DECIMAL(10,2)  NOT NULL,                   -- close 同理用 [] 包住
        volume      BIGINT         NOT NULL,
        CONSTRAINT pk_stock_daily_bars PRIMARY KEY (id),
        CONSTRAINT uq_bar              UNIQUE (stock_id, trade_date),
        CONSTRAINT fk_bar_stock        FOREIGN KEY (stock_id)
                                       REFERENCES dbo.stocks(id) ON DELETE CASCADE
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   5-1. assistant_stock_industries — AI 助理使用的官方產業分類快取
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.assistant_stock_industries', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.assistant_stock_industries (
        stock_code     VARCHAR(10)    NOT NULL,
        stock_name     NVARCHAR(100)  NULL,
        industry_name  NVARCHAR(100)  NOT NULL,
        source_url     NVARCHAR(500)  NOT NULL,
        fetched_at     DATETIME2(0)   NOT NULL CONSTRAINT df_assistant_stock_industries_fetched DEFAULT SYSDATETIME(),
        CONSTRAINT pk_assistant_stock_industries PRIMARY KEY (stock_code)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   5-2. assistant_topics — AI 助理使用的題材字典
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.assistant_topics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.assistant_topics (
        topic_code    VARCHAR(50)    NOT NULL,
        topic_name    NVARCHAR(100)  NOT NULL,
        description   NVARCHAR(300)  NULL,
        CONSTRAINT pk_assistant_topics PRIMARY KEY (topic_code)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   5-3. assistant_stock_topics — 股票與題材的對照表
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.assistant_stock_topics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.assistant_stock_topics (
        topic_code    VARCHAR(50)    NOT NULL,
        stock_code    VARCHAR(10)    NOT NULL,
        note          NVARCHAR(300)  NULL,
        source_type   NVARCHAR(50)   NOT NULL,
        updated_at    DATETIME2(0)   NOT NULL CONSTRAINT df_assistant_stock_topics_updated DEFAULT SYSDATETIME(),
        CONSTRAINT pk_assistant_stock_topics PRIMARY KEY (topic_code, stock_code),
        CONSTRAINT fk_assistant_stock_topics_topic FOREIGN KEY (topic_code)
          REFERENCES dbo.assistant_topics(topic_code) ON DELETE CASCADE
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   6. portfolios — 投資練習組合（與 users 1:1）
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.portfolios', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.portfolios (
        id          BIGINT         IDENTITY(1,1) NOT NULL,
        user_id     BIGINT         NOT NULL,
        capital     DECIMAL(15,2)  NOT NULL,                   -- 起始本金
        cash        DECIMAL(15,2)  NOT NULL,                   -- 可用現金餘額
        is_ready    BIT            NOT NULL CONSTRAINT df_portfolio_ready DEFAULT 0,
        created_at  DATETIME2(0)   NOT NULL CONSTRAINT df_portfolio_created DEFAULT SYSDATETIME(),
        updated_at  DATETIME2(0)   NOT NULL CONSTRAINT df_portfolio_updated DEFAULT SYSDATETIME(),
        CONSTRAINT pk_portfolios       PRIMARY KEY (id),
        CONSTRAINT uq_portfolio_user   UNIQUE (user_id),
        CONSTRAINT fk_portfolio_user   FOREIGN KEY (user_id)
                                       REFERENCES dbo.users(id) ON DELETE CASCADE
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   7. holdings — 持倉（N:1 portfolios、N:1 stocks）
   ─────────────────────────────────────────────────────────────────────────
   - lots 原 INT UNSIGNED + CHECK(lots>0) → INT + CHECK(lots>0)
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.holdings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.holdings (
        id            BIGINT         IDENTITY(1,1) NOT NULL,
        portfolio_id  BIGINT         NOT NULL,
        stock_id      SMALLINT       NOT NULL,
        lots          INT            NOT NULL,                 -- 張數（1 張 = 1000 股）
        avg_cost      DECIMAL(10,4)  NOT NULL,                 -- 平均每股成本
        updated_at    DATETIME2(0)   NOT NULL CONSTRAINT df_holding_updated DEFAULT SYSDATETIME(),
        CONSTRAINT pk_holdings           PRIMARY KEY (id),
        CONSTRAINT uq_holding            UNIQUE (portfolio_id, stock_id),
        CONSTRAINT fk_holding_portfolio  FOREIGN KEY (portfolio_id)
                                         REFERENCES dbo.portfolios(id) ON DELETE CASCADE,
        CONSTRAINT fk_holding_stock      FOREIGN KEY (stock_id)
                                         REFERENCES dbo.stocks(id),
        CONSTRAINT chk_lots              CHECK (lots > 0)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   8. orders — 委託/成交紀錄（交易歷史）
   ─────────────────────────────────────────────────────────────────────────
   - order_type 原 ENUM('buy','sell') → VARCHAR + CHECK
   - tax 賣出才有，DEFAULT 0
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.orders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.orders (
        id            BIGINT         IDENTITY(1,1) NOT NULL,
        portfolio_id  BIGINT         NOT NULL,
        stock_id      SMALLINT       NOT NULL,
        order_type    VARCHAR(4)     NOT NULL,                 -- 'buy' / 'sell'
        lots          INT            NOT NULL,
        price         DECIMAL(10,4)  NOT NULL,                 -- 成交每股價格
        face_amount   DECIMAL(15,2)  NOT NULL,                 -- lots × 1000 × price
        fee           DECIMAL(10,2)  NOT NULL,                 -- 手續費 0.1425%，最低 20
        tax           DECIMAL(10,2)  NOT NULL CONSTRAINT df_order_tax DEFAULT 0,  -- 證交稅（賣出才有）
        total_amount  DECIMAL(15,2)  NOT NULL,                 -- 買入=實付；賣出=實收
        executed_at   DATETIME2(0)   NOT NULL CONSTRAINT df_order_exec DEFAULT SYSDATETIME(),
        CONSTRAINT pk_orders            PRIMARY KEY (id),
        CONSTRAINT fk_order_portfolio   FOREIGN KEY (portfolio_id)
                                        REFERENCES dbo.portfolios(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_stock       FOREIGN KEY (stock_id)
                                        REFERENCES dbo.stocks(id),
        CONSTRAINT chk_order_type       CHECK (order_type IN ('buy', 'sell'))
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   9. decision_cards — AI 決策卡（BUY / WATCH / ALERT）
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.decision_cards', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.decision_cards (
        id          INT            IDENTITY(1,1) NOT NULL,
        stock_id    SMALLINT       NOT NULL,
        action      VARCHAR(5)     NOT NULL,                   -- 'BUY' / 'WATCH' / 'ALERT'
        confidence  TINYINT        NOT NULL,                   -- 0 ~ 100
        price       DECIMAL(10,2)  NOT NULL,
        change_pct  DECIMAL(6,2)   NOT NULL,                   -- 漲跌幅 %
        reason      NVARCHAR(MAX)  NOT NULL,                    -- 原 TEXT，含中文 → NVARCHAR(MAX)
        is_active   BIT            NOT NULL CONSTRAINT df_dc_active DEFAULT 1,
        created_at  DATETIME2(0)   NOT NULL CONSTRAINT df_dc_created DEFAULT SYSDATETIME(),
        CONSTRAINT pk_decision_cards PRIMARY KEY (id),
        CONSTRAINT fk_dc_stock       FOREIGN KEY (stock_id) REFERENCES dbo.stocks(id),
        CONSTRAINT chk_dc_action     CHECK (action IN ('BUY', 'WATCH', 'ALERT')),
        CONSTRAINT chk_confidence    CHECK (confidence BETWEEN 0 AND 100)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   10. decision_card_tags — 決策卡標籤
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.decision_card_tags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.decision_card_tags (
        id               INT          IDENTITY(1,1) NOT NULL,
        decision_card_id INT          NOT NULL,
        tag              NVARCHAR(50) NOT NULL,                -- '#站上MA240' …（含中文）
        CONSTRAINT pk_decision_card_tags PRIMARY KEY (id),
        CONSTRAINT fk_dct_card           FOREIGN KEY (decision_card_id)
                                         REFERENCES dbo.decision_cards(id) ON DELETE CASCADE
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   11. knowledge_base — 投資知識庫（術語卡片）
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.knowledge_base', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.knowledge_base (
        id         INT           IDENTITY(1,1) NOT NULL,
        tag        NVARCHAR(50)  NOT NULL,                     -- '#站上MA240'
        title      NVARCHAR(100) NOT NULL,
        icon       NVARCHAR(10)  NULL,                          -- emoji
        category   NVARCHAR(50)  NULL,
        created_at DATETIME2(0)  NOT NULL CONSTRAINT df_kb_created DEFAULT SYSDATETIME(),
        CONSTRAINT pk_knowledge_base PRIMARY KEY (id),
        CONSTRAINT uq_kb_tag         UNIQUE (tag)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   12. knowledge_sentences — 每個術語的說明句子（最多 3 句）
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.knowledge_sentences', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.knowledge_sentences (
        id           INT           IDENTITY(1,1) NOT NULL,
        knowledge_id INT           NOT NULL,
        sort_order   TINYINT       NOT NULL,                   -- 1, 2, 3
        sentence     NVARCHAR(MAX) NOT NULL,                    -- 原 TEXT，含中文
        CONSTRAINT pk_knowledge_sentences PRIMARY KEY (id),
        CONSTRAINT uq_ks                  UNIQUE (knowledge_id, sort_order),
        CONSTRAINT fk_ks_kb               FOREIGN KEY (knowledge_id)
                                          REFERENCES dbo.knowledge_base(id) ON DELETE CASCADE
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   13. knowledge_related_tags — 相關術語連結
   ─────────────────────────────────────────────────────────────────────────
   - 原設計用複合主鍵 (knowledge_id, related_tag)，無 IDENTITY
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.knowledge_related_tags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.knowledge_related_tags (
        knowledge_id INT          NOT NULL,
        related_tag  NVARCHAR(50) NOT NULL,
        CONSTRAINT pk_knowledge_related_tags PRIMARY KEY (knowledge_id, related_tag),
        CONSTRAINT fk_krt_kb FOREIGN KEY (knowledge_id)
                             REFERENCES dbo.knowledge_base(id) ON DELETE CASCADE
    );
END;
GO


/* ─────────────────────────────────────────────────────────────────────────
   14. stock_sync — 股票歷史「同步狀態」中繼表（原始設計沒有，後來新增）
   ─────────────────────────────────────────────────────────────────────────
   用途：記錄每檔股票的歷史日線「上次同步的時間與來源」，讓後端判斷
         要不要重新抓真實歷史（seed 測試資料 → twse / finmind 真實資料 的切換依據）。
   - source: 'seed'（初始測試資料）/ 'twse' / 'finmind'（完整真實歷史就緒）
   - 後端 db.js 啟動時也會自動補建這張表（程式端 ensureSchema），
     所以就算忘了在 SSMS 跑這段，後端開起來也會自動建立；此處列出是為了
     讓手動建表 / 技術交接時看得到完整結構。
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.stock_sync', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stock_sync (
        stock_id    SMALLINT      NOT NULL,
        source      NVARCHAR(20)  NOT NULL CONSTRAINT df_stock_sync_src DEFAULT N'seed',
        last_synced DATETIME2(0)  NOT NULL CONSTRAINT df_stock_sync_at  DEFAULT SYSDATETIME(),
        CONSTRAINT pk_stock_sync   PRIMARY KEY (stock_id),
        CONSTRAINT fk_stock_sync_s FOREIGN KEY (stock_id)
                                   REFERENCES dbo.stocks(id) ON DELETE CASCADE
    );
END;
GO

IF OBJECT_ID(N'dbo.assistant_etf_holdings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.assistant_etf_holdings (
        id          BIGINT         IDENTITY(1,1) NOT NULL,
        etf_code    VARCHAR(10)    NOT NULL,
        trade_date  DATE           NOT NULL,
        stock_code  VARCHAR(10)    NOT NULL,
        stock_name  NVARCHAR(100)  NOT NULL,
        quantity    BIGINT         NULL,
        weight      DECIMAL(8,4)   NULL,
        source_url  NVARCHAR(500)  NOT NULL,
        fetched_at  DATETIME2(0)   NOT NULL CONSTRAINT df_assistant_etf_holdings_fetched DEFAULT SYSDATETIME(),
        CONSTRAINT pk_assistant_etf_holdings PRIMARY KEY (id),
        CONSTRAINT uq_assistant_etf_holdings UNIQUE (etf_code, trade_date, stock_code)
    );
END;
GO

IF OBJECT_ID(N'dbo.assistant_fundamentals', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.assistant_fundamentals (
        id               BIGINT         IDENTITY(1,1) NOT NULL,
        trade_date       DATE           NOT NULL,
        stock_code       VARCHAR(10)    NOT NULL,
        stock_name       NVARCHAR(100)  NOT NULL,
        close_price      DECIMAL(10,2)  NULL,
        dividend_yield   DECIMAL(8,4)   NULL,
        dividend_year    NVARCHAR(20)   NULL,
        pe_ratio         DECIMAL(12,4)  NULL,
        pb_ratio         DECIMAL(12,4)  NULL,
        financial_period NVARCHAR(30)   NULL,
        source_url       NVARCHAR(500)  NOT NULL,
        fetched_at       DATETIME2(0)   NOT NULL CONSTRAINT df_assistant_fundamentals_fetched DEFAULT SYSDATETIME(),
        CONSTRAINT pk_assistant_fundamentals PRIMARY KEY (id),
        CONSTRAINT uq_assistant_fundamentals UNIQUE (trade_date, stock_code)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   15. watchlists — 使用者自選清單
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.watchlists', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.watchlists (
        id          BIGINT        IDENTITY(1,1) NOT NULL,
        user_id     BIGINT        NOT NULL,
        stock_id    SMALLINT      NOT NULL,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_watchlists_created DEFAULT SYSDATETIME(),
        CONSTRAINT pk_watchlists PRIMARY KEY (id),
        CONSTRAINT uq_watchlists_user_stock UNIQUE (user_id, stock_id),
        CONSTRAINT fk_watchlists_user FOREIGN KEY (user_id)
          REFERENCES dbo.users(id) ON DELETE CASCADE,
        CONSTRAINT fk_watchlists_stock FOREIGN KEY (stock_id)
          REFERENCES dbo.stocks(id)
    );
END;
GO

/* ─────────────────────────────────────────────────────────────────────────
   16. assistant_recommendation_runs — 股票建議快照
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.assistant_recommendation_runs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.assistant_recommendation_runs (
        id              BIGINT         IDENTITY(1,1) NOT NULL,
        user_id         BIGINT         NOT NULL,
        slot_date       DATE           NOT NULL,
        slot_label      VARCHAR(10)    NOT NULL,      -- '0830' / '1350' / 'ondemand'
        generated_at    DATETIME2(0)   NOT NULL CONSTRAINT df_assistant_rec_runs_generated DEFAULT SYSDATETIME(),
        summary_json    NVARCHAR(MAX)  NOT NULL,
        CONSTRAINT pk_assistant_recommendation_runs PRIMARY KEY (id),
        CONSTRAINT uq_assistant_recommendation_runs UNIQUE (user_id, slot_date, slot_label),
        CONSTRAINT fk_assistant_recommendation_runs_user FOREIGN KEY (user_id)
          REFERENCES dbo.users(id) ON DELETE CASCADE,
        CONSTRAINT chk_assistant_recommendation_runs_slot CHECK (slot_label IN ('0830', '1350', 'ondemand'))
    );
END;
GO

IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'chk_assistant_recommendation_runs_slot'
      AND parent_object_id = OBJECT_ID(N'dbo.assistant_recommendation_runs')
)
BEGIN
    ALTER TABLE dbo.assistant_recommendation_runs
      DROP CONSTRAINT chk_assistant_recommendation_runs_slot;
END;
GO

ALTER TABLE dbo.assistant_recommendation_runs
  ADD CONSTRAINT chk_assistant_recommendation_runs_slot
  CHECK (slot_label IN ('0830', '1350', 'ondemand'));
GO

/* ─────────────────────────────────────────────────────────────────────────
   17. assistant_recommendation_items — 單次建議快照中的個股建議
   ───────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.assistant_recommendation_items', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.assistant_recommendation_items (
        id              BIGINT         IDENTITY(1,1) NOT NULL,
        run_id          BIGINT         NOT NULL,
        category        VARCHAR(20)    NOT NULL,      -- holding / watchlist
        stock_code      VARCHAR(10)    NOT NULL,
        stock_name      NVARCHAR(100)  NOT NULL,
        action_code     VARCHAR(30)    NOT NULL,
        action_label    NVARCHAR(30)   NOT NULL,
        score           DECIMAL(8,4)   NULL,
        price           DECIMAL(10,2)  NULL,
        avg_cost        DECIMAL(10,4)  NULL,
        shares          INT            NULL,
        pnl             DECIMAL(15,2)  NULL,
        pnl_pct         DECIMAL(10,4)  NULL,
        reason          NVARCHAR(MAX)  NOT NULL,
        snapshot_json   NVARCHAR(MAX)  NOT NULL,
        CONSTRAINT pk_assistant_recommendation_items PRIMARY KEY (id),
        CONSTRAINT fk_assistant_recommendation_items_run FOREIGN KEY (run_id)
          REFERENCES dbo.assistant_recommendation_runs(id) ON DELETE CASCADE,
        CONSTRAINT chk_assistant_recommendation_items_category CHECK (category IN ('holding', 'watchlist'))
    );
END;
GO


/* ============================================================================
   Section 3：額外索引（對應原 schema 的「重要索引建議」）
   ----------------------------------------------------------------------------
   說明：原 schema 把 INDEX 寫在 CREATE TABLE 內，SQL Server 慣例是拆出來。
   每個都先檢查不存在才建，重複執行不會出錯。
   ============================================================================ */

-- 快速查詢用戶的交易歷史（含 executed_at 由新到舊）
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_orders_time' AND object_id = OBJECT_ID(N'dbo.orders'))
    CREATE INDEX idx_orders_time ON dbo.orders (portfolio_id, executed_at DESC);
GO

-- 快速查某日所有股票 K 線（首頁行情看板）
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_bars_date' AND object_id = OBJECT_ID(N'dbo.stock_daily_bars'))
    CREATE INDEX idx_bars_date ON dbo.stock_daily_bars (trade_date, stock_id);
GO

-- 決策卡標籤反查
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_dct_card' AND object_id = OBJECT_ID(N'dbo.decision_card_tags'))
    CREATE INDEX idx_dct_card ON dbo.decision_card_tags (decision_card_id);
GO

-- 股票名稱搜尋（code 已有 UNIQUE 自帶索引，不必重複建）
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_stock_name' AND object_id = OBJECT_ID(N'dbo.stocks'))
    CREATE INDEX idx_stock_name ON dbo.stocks (name);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_watchlists_user' AND object_id = OBJECT_ID(N'dbo.watchlists'))
    CREATE INDEX idx_watchlists_user ON dbo.watchlists (user_id, created_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_assistant_rec_runs_user_time' AND object_id = OBJECT_ID(N'dbo.assistant_recommendation_runs'))
    CREATE INDEX idx_assistant_rec_runs_user_time
    ON dbo.assistant_recommendation_runs (user_id, slot_date DESC, slot_label DESC);
GO


/* ============================================================================
   Section 4：updated_at 自動更新觸發器
   ----------------------------------------------------------------------------
   說明：MySQL 的 ON UPDATE CURRENT_TIMESTAMP 在 SQL Server 沒有對應語法，
   只能用 AFTER UPDATE 觸發器補上。每次 UPDATE 後，把被改到的列的
   updated_at 設為現在時間。CREATE TRIGGER 必須是批次中第一個敘述，故用 GO。
   套用對象：users / investor_profiles / portfolios / holdings 四張有 updated_at 的表。
   ============================================================================ */

IF OBJECT_ID(N'dbo.trg_users_updated', N'TR') IS NOT NULL DROP TRIGGER dbo.trg_users_updated;
GO
CREATE TRIGGER dbo.trg_users_updated ON dbo.users
AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE u SET updated_at = SYSDATETIME()
    FROM dbo.users u
    INNER JOIN inserted i ON u.id = i.id;
END;
GO

IF OBJECT_ID(N'dbo.trg_ip_updated', N'TR') IS NOT NULL DROP TRIGGER dbo.trg_ip_updated;
GO
CREATE TRIGGER dbo.trg_ip_updated ON dbo.investor_profiles
AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE p SET updated_at = SYSDATETIME()
    FROM dbo.investor_profiles p
    INNER JOIN inserted i ON p.id = i.id;
END;
GO

IF OBJECT_ID(N'dbo.trg_portfolio_updated', N'TR') IS NOT NULL DROP TRIGGER dbo.trg_portfolio_updated;
GO
CREATE TRIGGER dbo.trg_portfolio_updated ON dbo.portfolios
AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE p SET updated_at = SYSDATETIME()
    FROM dbo.portfolios p
    INNER JOIN inserted i ON p.id = i.id;
END;
GO

IF OBJECT_ID(N'dbo.trg_holding_updated', N'TR') IS NOT NULL DROP TRIGGER dbo.trg_holding_updated;
GO
CREATE TRIGGER dbo.trg_holding_updated ON dbo.holdings
AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE h SET updated_at = SYSDATETIME()
    FROM dbo.holdings h
    INNER JOIN inserted i ON h.id = i.id;
END;
GO


/* ============================================================================
   Section 5：驗證 — 列出所有資料表與目前筆數
   ----------------------------------------------------------------------------
   執行後在「結果」視窗應看到核心資料表、同步表與 AI 延伸表。
   全新安裝時 row_count 多半為 0；若已被使用過，stock_daily_bars / stock_sync
   可能已有真實資料，屬正常。
   ============================================================================ */
SELECT
    t.name                                   AS table_name,
    SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS row_count
FROM sys.tables t
INNER JOIN sys.partitions p ON t.object_id = p.object_id
WHERE t.name IN (
    'users','investor_profiles','sectors','stocks','stock_daily_bars',
    'portfolios','holdings','orders','decision_cards','decision_card_tags',
    'knowledge_base','knowledge_sentences','knowledge_related_tags',
    'stock_sync','assistant_etf_holdings','assistant_fundamentals',
    'assistant_stock_industries','assistant_topics','assistant_stock_topics',
    'watchlists','assistant_recommendation_runs','assistant_recommendation_items'
)
GROUP BY t.name
ORDER BY t.name;
GO
