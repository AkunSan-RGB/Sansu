-- Cabang terhubung ke karyawan, aset tetap, rekening kas/bank, dan pembatasan pengguna per cabang
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "branch_ids" uuid[];--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");
