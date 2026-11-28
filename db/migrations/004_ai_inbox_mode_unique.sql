-- AI Inbox 的请求哈希必须在演示/真实空间内各自幂等。
ALTER TABLE ai_tasks
  DROP CONSTRAINT IF EXISTS ai_tasks_request_hash_key;

DROP INDEX IF EXISTS ai_tasks_request_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS ai_tasks_request_hash_mode_key
  ON ai_tasks (request_hash, is_demo);

