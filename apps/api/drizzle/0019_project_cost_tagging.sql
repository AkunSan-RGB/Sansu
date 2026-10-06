ALTER TABLE "cash_transaction_lines" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "project_id" uuid;