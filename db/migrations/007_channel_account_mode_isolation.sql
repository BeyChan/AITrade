-- 007_channel_account_mode_isolation.sql
-- 渠道店铺是内容工作流的基础主数据；演示与真实空间应各自拥有独立账号。

ALTER TABLE channel_accounts
  DROP CONSTRAINT IF EXISTS channel_accounts_platform_code_market_code_name_key;

DROP INDEX IF EXISTS channel_accounts_platform_code_market_code_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS channel_accounts_platform_market_name_mode_key
  ON channel_accounts(platform_code, market_code, name, is_demo);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_mode_platform_market
  ON channel_accounts(is_demo, platform_code, market_code);
