-- Perubahan metode penyusutan berlaku ke depan: riwayat perubahan per aset [{from:'YYYY-MM', method, prevMethod, accumulatedAt}]
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "method_changes" jsonb NOT NULL DEFAULT '[]'::jsonb;
