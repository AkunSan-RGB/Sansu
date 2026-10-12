import {
  ENTITY_SIZE_LABELS,
  type EntityProfileApplyResult,
  type EntityProfileInput,
  type EntityProfileState,
  LEGAL_FORM_LABELS,
  type LegalForm,
  REPORTING_FRAMEWORK_LABELS,
  type ReportingFramework,
  recommendProfile,
  simplificationsFor,
  TAX_SCHEME_LABELS,
  type TaxScheme,
  toOptions,
} from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Form, InputNumber, List, Modal, Radio, Select, Space, Steps, Switch, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { fmtMoney, rupiahInput } from '@/lib/format';
import { t } from '@/lib/terms';

const SIZE_COLOR = { MICRO: 'green', SMALL: 'cyan', MEDIUM: 'blue', LARGE: 'purple' } as const;

interface Draft extends EntityProfileInput {
  taxRegisteredYear: number | null;
  framework?: ReportingFramework;
  taxScheme?: TaxScheme;
  pkp?: boolean;
}

/**
 * Wizard standar akuntansi & pajak: 1) profil usaha, 2) ukuran usaha (diisi dari pembukuan),
 * 3) rekomendasi SAK EMKM / SAK EP + skema PPh + PKP, lalu diterapkan sekaligus.
 */
export default function EntityProfileWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useAuth();
  const canPkp = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const state = useQuery({ queryKey: ['entity-profile'], queryFn: () => get<EntityProfileState>('/accounting/entity-profile'), enabled: open });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<EntityProfileApplyResult | null>(null);

  // Isi awal dari pengaturan & pembukuan; dijalankan sekali tiap wizard dibuka
  useEffect(() => {
    if (open && state.data && !draft) {
      const s = state.data;
      setDraft({
        publicAccountability: s.answers.publicAccountability,
        legalForm: s.current.legalForm,
        assets: s.measured.assets,
        revenue: s.measured.revenue,
        taxRegisteredYear: s.current.taxRegisteredYear,
      });
    }
    if (!open) {
      setStep(0);
      setDraft(null);
      setResult(null);
    }
  }, [open, state.data, draft]);

  const rec = draft ? recommendProfile(draft) : null;
  /** Pilihan pengguna dipakai hanya bila masih sah untuk angka terbaru; selain itu jatuh ke rekomendasi */
  const resolve = (d: Draft) => {
    const r = recommendProfile(d);
    const framework = d.framework && [r.framework, ...r.frameworkAlternatives].includes(d.framework) ? d.framework : r.framework;
    const taxScheme = d.taxScheme === 'FINAL_UMKM' && !r.finalTaxEligible ? r.taxScheme : (d.taxScheme ?? r.taxScheme);
    const pkp = r.pkpRequired ? true : (d.pkp ?? state.data?.current.pkp ?? true);
    return { framework, taxScheme, pkp };
  };
  const chosen = draft ? resolve(draft) : null;

  const apply = useAction(
    (d: Draft) =>
      post<EntityProfileApplyResult>('/accounting/entity-profile/apply', {
        publicAccountability: d.publicAccountability,
        legalForm: d.legalForm,
        assets: d.assets,
        revenue: d.revenue,
        taxRegisteredYear: d.taxRegisteredYear ?? undefined,
        framework: resolve(d).framework,
        taxScheme: resolve(d).taxScheme,
        // status PKP hanya dikirim bila pengguna berhak mengubahnya dan ada yang perlu diubah
        pkp: canPkp && (d.pkp !== undefined || recommendProfile(d).pkpRequired) ? resolve(d).pkp : undefined,
      }),
    {
      success: 'Standar akuntansi & pajak diterapkan',
      invalidate: ['company', 'me', 'framework', 'statements', 'notes', 'appendix', 'fiscal', 'entity-profile', 'onboarding', 'health', 'tax-thresholds'],
      onSuccess: setResult,
    },
  );

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const measured = state.data?.measured;

  const body = () => {
    if (!draft || !rec || !state.data) return <Typography.Text type="secondary">Memuat…</Typography.Text>;
    if (result) {
      return (
        <>
          <Alert
            type="success"
            showIcon
            message={`${REPORTING_FRAMEWORK_LABELS[result.applied.framework]} · ${TAX_SCHEME_LABELS[result.applied.taxScheme]}`}
            description="Pengaturan pelaporan sudah diperbarui. Laporan keuangan, CALK, dan rekonsiliasi fiskal langsung mengikuti pilihan ini."
          />
          {result.warnings.map((w) => (
            <Alert key={w} type="warning" showIcon style={{ marginTop: 12 }} message={w} />
          ))}
          <Typography.Title level={5} style={{ marginTop: 16 }}>
            Yang berubah otomatis
          </Typography.Title>
          <List size="small" dataSource={result.simplifications} renderItem={(t) => <List.Item>{t}</List.Item>} />
        </>
      );
    }
    if (step === 0) {
      return (
        <Form layout="vertical">
          <Form.Item label="Bentuk badan usaha">
            <Select value={draft.legalForm} onChange={(v: LegalForm) => set({ legalForm: v })} options={toOptions(LEGAL_FORM_LABELS)} />
          </Form.Item>
          <Form.Item
            label="Apakah entitas memiliki akuntabilitas publik?"
            extra="Ya bila tercatat di bursa efek, atau menghimpun dana masyarakat sebagai usaha utama (bank, asuransi, sekuritas, dan sejenisnya). Hampir semua UMKM menjawab Tidak."
          >
            <Radio.Group
              value={draft.publicAccountability}
              onChange={(e) => set({ publicAccountability: e.target.value })}
              options={[
                { value: false, label: 'Tidak' },
                { value: true, label: 'Ya' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Tahun terdaftar sebagai wajib pajak (opsional)" extra="Dicatat untuk memantau jangka waktu PPh final.">
            <InputNumber
              min={1980}
              max={2100}
              style={{ width: '100%' }}
              value={draft.taxRegisteredYear}
              onChange={(v) => set({ taxRegisteredYear: v == null ? null : Number(v) })}
            />
          </Form.Item>
        </Form>
      );
    }
    if (step === 1) {
      return (
        <Form layout="vertical">
          {measured && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Angka diisi otomatis dari pembukuan"
              description={
                <>
                  Peredaran bruto 12 bulan terakhir ({measured.from} s/d {measured.to}): <b>{fmtMoney(measured.revenue)}</b>. Total aset di luar tanah dan bangunan:{' '}
                  <b>{fmtMoney(measured.assets)}</b>. Ubah bila perkiraan Anda berbeda, misalnya untuk usaha yang baru berjalan.
                </>
              }
              action={
                <Button size="small" onClick={() => set({ revenue: measured.revenue, assets: measured.assets })}>
                  Pakai angka pembukuan
                </Button>
              }
            />
          )}
          <Form.Item label="Peredaran bruto setahun" extra={t('Seluruh penjualan dan pendapatan usaha dalam satu tahun, sebelum dikurangi biaya.')}>
            <InputNumber {...rupiahInput} min={0} style={{ width: '100%' }} prefix="Rp" value={draft.revenue} onChange={(v) => set({ revenue: Number(v ?? 0) })} />
          </Form.Item>
          <Form.Item label="Total aset di luar tanah dan bangunan" extra={t('Pendekatan modal usaha menurut kriteria UMKM (kas, piutang, persediaan, peralatan, kendaraan, dan lainnya).')}>
            <InputNumber {...rupiahInput} min={0} style={{ width: '100%' }} prefix="Rp" value={draft.assets} onChange={(v) => set({ assets: Number(v ?? 0) })} />
          </Form.Item>
          <Space>
            <Typography.Text>Ukuran usaha:</Typography.Text>
            <Tag color={SIZE_COLOR[rec.size]}>{ENTITY_SIZE_LABELS[rec.size]}</Tag>
          </Space>
        </Form>
      );
    }
    // step 2: rekomendasi
    const { framework: fw, taxScheme: ts, pkp } = chosen!;
    return (
      <>
        {rec.outOfScope && rec.warnings.map((w) => <Alert key={w} type="warning" showIcon message={w} style={{ marginBottom: 12 }} />)}
        {(
          <>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Ukuran usaha">
                <Tag color={SIZE_COLOR[rec.size]}>{ENTITY_SIZE_LABELS[rec.size]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Rekomendasi">
                {REPORTING_FRAMEWORK_LABELS[rec.framework]} · {TAX_SCHEME_LABELS[rec.taxScheme]}
              </Descriptions.Item>
            </Descriptions>
            <List size="small" style={{ margin: '8px 0' }} dataSource={rec.reasons} renderItem={(t) => <List.Item>{t}</List.Item>} />
            {rec.warnings.map((w) => (
              <Alert key={w} type="warning" showIcon style={{ marginBottom: 8 }} message={w} />
            ))}
            <Form layout="vertical" style={{ marginTop: 12 }}>
              <Form.Item label="Standar akuntansi">
                <Radio.Group
                  value={fw}
                  onChange={(e) => set({ framework: e.target.value })}
                  options={[rec.framework, ...rec.frameworkAlternatives].map((f) => ({
                    value: f,
                    label: f === rec.framework ? `${REPORTING_FRAMEWORK_LABELS[f]} (disarankan)` : REPORTING_FRAMEWORK_LABELS[f],
                  }))}
                />
              </Form.Item>
              <Form.Item label="Skema PPh Badan">
                <Radio.Group
                  value={ts}
                  onChange={(e) => set({ taxScheme: e.target.value })}
                  options={[
                    { value: 'GENERAL', label: TAX_SCHEME_LABELS.GENERAL },
                    { value: 'FINAL_UMKM', label: TAX_SCHEME_LABELS.FINAL_UMKM, disabled: !rec.finalTaxEligible },
                  ]}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                />
              </Form.Item>
              {canPkp && (
                <Form.Item
                  label="Pengusaha Kena Pajak (PKP)"
                  extra={rec.pkpRequired ? 'Peredaran bruto melewati Rp4,8 miliar: wajib dikukuhkan sebagai PKP.' : 'Boleh PKP secara sukarela. Status ini memengaruhi PPN penjualan dan pembelian.'}
                >
                  <Switch
                    checked={pkp}
                    disabled={rec.pkpRequired}
                    onChange={(v) => set({ pkp: v })}
                    checkedChildren="PKP"
                    unCheckedChildren="Non-PKP"
                  />
                </Form.Item>
              )}
            </Form>
            <Typography.Title level={5}>Yang akan disederhanakan otomatis</Typography.Title>
            <List size="small" dataSource={simplificationsFor(fw, ts)} renderItem={(t) => <List.Item>{t}</List.Item>} />
          </>
        )}
      </>
    );
  };

  const last = step === 2;
  return (
    <Modal
      title="Wizard standar akuntansi & pajak"
      open={open}
      width={720}
      onCancel={onClose}
      destroyOnHidden
      footer={
        result ? (
          <Button type="primary" onClick={onClose}>
            Selesai
          </Button>
        ) : (
          <Space>
            {step > 0 && <Button onClick={() => setStep(step - 1)}>Kembali</Button>}
            {!last && (
              <Button type="primary" onClick={() => setStep(step + 1)} disabled={!draft}>
                Lanjut
              </Button>
            )}
            {last && (
              <Button type="primary" loading={apply.isPending} disabled={!draft} onClick={() => draft && apply.mutate(draft)}>
                Terapkan
              </Button>
            )}
          </Space>
        )
      }
    >
      {!result && <Steps size="small" current={step} style={{ marginBottom: 20 }} items={[{ title: 'Profil usaha' }, { title: 'Ukuran usaha' }, { title: 'Rekomendasi' }]} />}
      {body()}
    </Modal>
  );
}
