CREATE UNIQUE INDEX IF NOT EXISTS "employees_user_uq" ON "employees" ("tenant_id", "user_id") WHERE "user_id" IS NOT NULL;
