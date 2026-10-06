-- Jurnal yang sudah diposting tidak boleh diubah atau dihapus (jejak audit): koreksi hanya lewat jurnal balik.
-- Aplikasi memang tidak pernah mengubah/menghapus jurnal; ini pengaman di tingkat database terhadap
-- perubahan langsung lewat SQL atau kesalahan kode di masa depan.
-- Pengecualian: reset data demo (seed) menyalakan sansu.allow_journal_delete untuk transaksinya saja.
CREATE OR REPLACE FUNCTION forbid_journal_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('sansu.allow_journal_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Jurnal yang sudah diposting tidak boleh diubah atau dihapus; koreksi dengan jurnal balik'
    USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION forbid_journal_change();--> statement-breakpoint
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION forbid_journal_change();
