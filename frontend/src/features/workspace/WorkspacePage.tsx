import { ArrowRightOutlined, CheckCircleFilled, ClockCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { MODEL_WORKSPACE, canViewFinancials } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Progress, Skeleton } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import type { Dashboard } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { pathVisible, type VisibilityCtx } from '@/layout/menuData';
import { useApps } from '@/lib/apps';
import { fmtMoney } from '@/lib/format';

interface Setup {
  items: { key: string; title: string; done: boolean; link?: string }[];
  done: number;
  total: number;
}

/** Ruang kerja jenis usaha: alur kerja khas usaha ini dari awal sampai laporan, dengan tautan langsung ke tiap langkah */
export default function WorkspacePage() {
  const { me } = useAuth();
  const { can } = useApps();
  const navigate = useNavigate();
  const finance = canViewFinancials(me?.role);
  const setup = useQuery({ queryKey: ['onboarding', 'setup'], queryFn: () => get<Setup>('/onboarding/setup') });
  const summary = useQuery({ queryKey: ['dashboard', 'summary', undefined], queryFn: () => get<Dashboard>('/dashboard'), enabled: finance });
  if (!me) return null;
  const def = MODEL_WORKSPACE[me.businessModel];
  const ctx: VisibilityCtx = { role: me.role, model: me.businessModel, framework: me.framework, multiBranch: me.multiBranch, hasBudget: me.hasBudget, subscriptionEnabled: me.subscription?.enabled, taxFeatures: me.taxFeatures as unknown as VisibilityCtx['taxFeatures'], profiles: me.serviceProfiles, can };
  const stages = def.stages
    .map((s) => ({ ...s, links: s.links.filter((l) => pathVisible(l.to, ctx)) }))
    .filter((s) => s.links.length > 0);
  const pct = setup.data?.total ? Math.round((setup.data.done / setup.data.total) * 100) : 0;
  const todo = setup.data?.items.filter((i) => !i.done).slice(0, 3) ?? [];
  const d = summary.data;
  const figures = [
    { label: 'Penjualan bulan ini', v: d?.salesMonth, to: '/invoices' },
    { label: 'Piutang beredar', v: d?.arOutstanding, to: '/invoices' },
    { label: 'Saldo kas & bank', v: d?.cashBalance, to: '/cash' },
  ].filter((f) => f.v !== null && f.v !== undefined);

  return (
    <div className="ws">
      <section className="ws-hero">
        <div className="ws-hero-text">
          <span className="ws-eyebrow">Ruang kerja</span>
          <h1>{def.title}</h1>
          <p>{def.tagline}</p>
          <div className="ws-hero-actions">
            <Link to={`/help?a=panduan-${me.businessModel.toLowerCase()}`}>
              <Button icon={<QuestionCircleOutlined />} ghost>Panduan alur kerja</Button>
            </Link>
          </div>
        </div>
        {figures.length > 0 && (
          <div className="ws-figures">
            {figures.map((f) => (
              <button key={f.label} type="button" onClick={() => navigate(f.to)}>
                <span>{f.label}</span>
                <b>{fmtMoney(f.v)}</b>
              </button>
            ))}
          </div>
        )}
      </section>

          {(setup.isLoading || setup.data) && (
        <section className="ws-setup">
          {setup.isLoading ? (
            <Skeleton active paragraph={{ rows: 1 }} />
          ) : (
            <>
              <div className="ws-setup-head">
                <div>
                  <strong>Kesiapan pengaturan {def.title}</strong>
                  <span>{setup.data?.done} dari {setup.data?.total} pengaturan sudah terisi</span>
                </div>
                <Progress percent={pct} showInfo={false} strokeColor="#111" trailColor="#E5E5E5" style={{ maxWidth: 260 }} />
              </div>
              {todo.length > 0 ? (
                <ul>
                  {todo.map((i) => (
                    <li key={i.key}>
                      <ClockCircleOutlined />
                      <span>{i.title}</span>
                      {i.link && <Link to={i.link}>Atur <ArrowRightOutlined /></Link>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ws-ok"><CheckCircleFilled /> Semua pengaturan penting sudah terisi.</p>
              )}
            </>
          )}
        </section>
      )}

      <ol className="ws-stages">
        {stages.map((s, i) => (
          <li key={s.title} className="ws-stage">
            <div className="ws-stage-no">{i + 1}</div>
            <div className="ws-stage-body">
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              <div className="ws-links">
                {s.links.map((l) => (
                  <Link key={l.to} to={l.to}>
                    {l.label}
                    <ArrowRightOutlined />
                  </Link>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
