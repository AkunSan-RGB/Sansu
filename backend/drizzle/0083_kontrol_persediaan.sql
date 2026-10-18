-- Kontrol persediaan: pencatat jumlah fisik opname (pemisahan penghitung dan pemosting selisih)
ALTER TABLE "stock_counts" ADD COLUMN IF NOT EXISTS "counted_by_id" uuid;
