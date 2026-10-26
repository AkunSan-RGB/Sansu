-- Fitur rincian per akun, pembekuan laporan, dan kontrak pembiayaan dihapus; tabelnya beserta pengaman tak-dapat-diubahnya ikut dibuang.
DROP TABLE IF EXISTS "report_snapshots";--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_snapshot_change();--> statement-breakpoint
DROP TABLE IF EXISTS "financing_contracts";
