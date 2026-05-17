-- ============================================================
-- setup-login.sql
-- 用途：開啟混合驗證模式、建立 skyfire 登入帳號、授權 ncu_db
-- 執行方式：用 Windows 驗證連進 SSMS，開新查詢，整段貼上 F5 執行
-- ============================================================

-- Step 1：開啟 SQL Server + Windows 混合驗證模式
USE [master];
EXEC xp_instance_regwrite
    N'HKEY_LOCAL_MACHINE',
    N'Software\Microsoft\MSSQLServer\MSSQLServer',
    N'LoginMode',
    REG_DWORD,
    2;   -- 2 = 混合模式；1 = 僅 Windows 驗證
GO

-- Step 2：建立 SQL Server 登入帳號 skyfire
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'skyfire')
BEGIN
    CREATE LOGIN skyfire WITH PASSWORD = N'Demo1234!',
        DEFAULT_DATABASE = ncu_db,
        CHECK_EXPIRATION = OFF,
        CHECK_POLICY = OFF;
    PRINT 'skyfire 登入帳號已建立';
END
ELSE
BEGIN
    PRINT 'skyfire 登入帳號已存在，跳過建立';
END
GO

-- Step 3：在 ncu_db 建立對應使用者並授與 db_owner 權限
USE ncu_db;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'skyfire')
BEGIN
    CREATE USER skyfire FOR LOGIN skyfire;
    PRINT 'skyfire 使用者已建立於 ncu_db';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.database_role_members drm
    JOIN sys.database_principals r ON r.principal_id = drm.role_principal_id
    JOIN sys.database_principals u ON u.principal_id = drm.member_principal_id
    WHERE r.name = 'db_owner' AND u.name = 'skyfire'
)
BEGIN
    EXEC sp_addrolemember 'db_owner', 'skyfire';
    PRINT 'skyfire 已加入 db_owner 角色';
END
GO

-- Step 4：提示需要重啟 SQL Server 服務讓混合模式生效
PRINT '========================================';
PRINT '完成！請重新啟動 SQL Server 服務：';
PRINT '右鍵點 SSMS 物件總管最上層 localhost → 重新啟動';
PRINT '========================================';
