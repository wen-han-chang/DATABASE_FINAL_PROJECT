-- ============================================================
-- add-margin-positions.sql
-- 用途：新增槓桿部位資料表（融券/融資），支援先賣後買與違約交割模擬
-- 執行方式：用 SSMS 連進 ncu_db，整段貼上 F5 執行
-- ============================================================

USE ncu_db;
GO

IF OBJECT_ID(N'dbo.short_positions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.short_positions (
        id           BIGINT        IDENTITY(1,1) NOT NULL,
        portfolio_id BIGINT        NOT NULL,
        stock_id     SMALLINT      NOT NULL,
        margin_type  VARCHAR(10)   NOT NULL,           -- 'short'(融券) | 'margin'(融資)
        shares       INT           NOT NULL,            -- 股數
        entry_price  DECIMAL(10,4) NOT NULL,            -- 開倉每股價格
        face_amount  DECIMAL(15,2) NOT NULL,            -- 面額
        fee          DECIMAL(10,2) NOT NULL,            -- 手續費
        tax          DECIMAL(10,2) NOT NULL CONSTRAINT df_sp_tax DEFAULT 0,
        cash_flow    DECIMAL(15,2) NOT NULL,            -- 融券:+到帳 / 融資:-借款
        status       VARCHAR(10)   NOT NULL CONSTRAINT df_sp_status DEFAULT 'open',
        opened_at    DATETIME2(0)  NOT NULL CONSTRAINT df_sp_opened DEFAULT SYSDATETIME(),
        CONSTRAINT pk_short_positions PRIMARY KEY (id),
        CONSTRAINT fk_sp_portfolio FOREIGN KEY (portfolio_id)
            REFERENCES dbo.portfolios(id) ON DELETE CASCADE,
        CONSTRAINT fk_sp_stock FOREIGN KEY (stock_id)
            REFERENCES dbo.stocks(id),
        CONSTRAINT chk_sp_margin_type CHECK (margin_type IN ('short', 'margin')),
        CONSTRAINT chk_sp_status      CHECK (status IN ('open', 'covered', 'defaulted'))
    );

    CREATE INDEX idx_sp_portfolio_status
        ON dbo.short_positions (portfolio_id, status, opened_at DESC);

    PRINT 'short_positions 資料表建立完成';
END
ELSE
BEGIN
    PRINT 'short_positions 已存在，略過';
END
GO
