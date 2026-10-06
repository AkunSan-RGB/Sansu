import { REPORTING_FRAMEWORK_LABELS } from '@sansu/shared';
import { Typography } from 'antd';
import type { FinancialAppendix } from '@/api/types';
import { NoteTableView } from './NotesView';

/** Lampiran laporan keuangan — daftar rincian pendukung yang selalu mengikuti buku besar */
export default function AppendixView({ d }: { d: FinancialAppendix }) {
  return (
    <div className="calk" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Typography.Paragraph type="secondary" className="no-print">
        Lampiran rincian pendukung {REPORTING_FRAMEWORK_LABELS[d.framework]} untuk tahun {d.year}, posisi {d.period.to}. Angka dihitung ulang dari pembukuan setiap dibuka.
      </Typography.Paragraph>
      {d.sections.map((s) => (
        <section key={s.key} style={{ marginBottom: 28, breakInside: 'avoid-page' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {s.number}. {s.title}
          </Typography.Title>
          {s.paragraphs.map((p, i) => (
            <Typography.Paragraph key={i} type="secondary" style={{ margin: '4px 0' }}>
              {p}
            </Typography.Paragraph>
          ))}
          {s.tables.map((t, i) => (
            <NoteTableView key={i} t={t} />
          ))}
        </section>
      ))}
    </div>
  );
}
