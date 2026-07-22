-- The application and its database pool can safely execute only one GBox
-- synchronization at a time. Protect against concurrent requests from other
-- tabs, sessions, or application instances.
CREATE UNIQUE INDEX "sync_runs_one_running_source_key"
ON "sync_runs" ("source")
WHERE "status" = 'RUNNING';
