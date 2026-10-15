-- Jenis usaha "Produksi" diganti "FMCG". Perusahaan lama bermodel PRODUKSI memang mengolah bahan baku (resep, perintah produksi),
-- jadi dipindah ke "Manufaktur" yang mempertahankan seluruh fitur produksinya; jenis FMCG adalah model baru untuk distribusi barang konsumen.
UPDATE "tenants" SET "settings" = jsonb_set("settings", '{business,model}', '"MANUFAKTUR"') WHERE "settings" #>> '{business,model}' = 'PRODUKSI';
