-- 009_config_and_health_mode_isolation.sql
-- 运行配置、模型档案与连接健康检查也必须归属单一运行模式，避免演示模式读取或覆盖真实配置。

-- 旧健康检查无法确定来源，保守归入真实空间。
ALTER TABLE connector_health_checks ADD COLUMN IF NOT EXISTS is_demo BOOLEAN;
UPDATE connector_health_checks SET is_demo = FALSE WHERE is_demo IS NULL;
ALTER TABLE connector_health_checks ALTER COLUMN is_demo SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_health_checks_mode_source
  ON connector_health_checks(is_demo, source_code, checked_at DESC);

-- app_settings 历史上只有 key 主键；旧配置保守归入真实空间，演示空间重新生成。
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS is_demo BOOLEAN;
UPDATE app_settings SET is_demo = FALSE WHERE is_demo IS NULL;
ALTER TABLE app_settings ALTER COLUMN is_demo SET NOT NULL;
ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_key_mode
  ON app_settings(key, is_demo);

-- 模型档案同样按模式隔离；旧档案归入真实空间。
ALTER TABLE model_provider_profiles ADD COLUMN IF NOT EXISTS is_demo BOOLEAN;
UPDATE model_provider_profiles SET is_demo = FALSE WHERE is_demo IS NULL;
ALTER TABLE model_provider_profiles ALTER COLUMN is_demo SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_model_provider_profiles_mode_service
  ON model_provider_profiles(is_demo, service_type, is_default, updated_at DESC);
