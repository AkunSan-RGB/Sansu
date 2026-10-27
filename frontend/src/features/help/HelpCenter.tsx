import {
  ArrowLeftOutlined,
  BookOutlined,
  MailOutlined,
  QuestionCircleOutlined,
  RocketOutlined,
  SearchOutlined,
  WhatsAppOutlined,
} from '@ant-design/icons';
import { BRAND, BUSINESS_MODEL_BY_KEY } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Drawer, Empty, Input, List, Row, Space, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { articlesFor, articlesVisibleTo, HELP_CATEGORIES, searchArticles, type HelpArticle } from './articles';

interface Support {
  whatsapp: string;
  email: string;
  company: string;
}
const useSupport = () =>
  useQuery({ queryKey: ['support'], queryFn: () => get<Support>('/billing/support'), staleTime: 10 * 60_000 });
const waLink = (num: string, text: string) =>
  `https://wa.me/${num.replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(text)}`;

/** Isi satu artikel */
function Article({ a }: { a: HelpArticle }) {
  return (
    <div>
      <Tag color="blue" style={{ marginBottom: 8 }}>
        {a.category}
      </Tag>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {a.title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{a.summary}</Typography.Paragraph>
      {a.steps && (
        <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          {a.steps.map((s, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              {s}
            </li>
          ))}
        </ol>
      )}
      {a.tips?.map((t, i) => (
        <Alert key={i} type="info" showIcon message={t} style={{ marginBottom: 8 }} />
      ))}
      {a.link && (
        <Link to={a.link.to}>
          <Button type="primary" style={{ marginTop: 8 }}>
            {a.link.label}
          </Button>
        </Link>
      )}
    </div>
  );
}

/** Kartu hubungi dukungan (WhatsApp / email) */
function ContactCard({ compact }: { compact?: boolean }) {
  const { me } = useAuth();
  const { data } = useSupport();
  const loc = useLocation();
  if (!data || (!data.whatsapp && !data.email)) return null;
  const text = `Halo SANSU, saya ${me?.name ?? ''} dari ${me?.tenantName ?? ''}. Saya butuh bantuan di halaman ${loc.pathname}: `;
  return (
    <Card size="small" style={{ background: BRAND.colors.primarySoft, border: 'none' }}>
      <Typography.Text strong>Masih butuh bantuan?</Typography.Text>
      {!compact && (
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px' }}>
          Tim dukungan {data.company} siap membantu pada jam kerja.
        </Typography.Paragraph>
      )}
      <Space wrap style={{ marginTop: compact ? 8 : 0 }}>
        {data.whatsapp && (
          <Button
            icon={<WhatsAppOutlined />}
            href={waLink(data.whatsapp, text)}
            target="_blank"
            rel="noreferrer"
            style={{ background: '#25D366', color: '#fff', borderColor: '#25D366' }}
          >
            Chat WhatsApp
          </Button>
        )}
        {data.email && (
          <Button
            icon={<MailOutlined />}
            href={`mailto:${data.email}?subject=${encodeURIComponent('Bantuan SANSU')}&body=${encodeURIComponent(text)}`}
          >
            Email
          </Button>
        )}
      </Space>
    </Card>
  );
}

/** Halaman Pusat Bantuan */
export default function HelpCenterPage() {
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState('');
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const id = params.get('a');
  const visible = useMemo(() => articlesVisibleTo(me?.businessModel), [me?.businessModel]);
  const article = visible.find((a) => a.id === id);
  const results = useMemo(() => searchArticles(term, me?.businessModel), [term, me?.businessModel]);
  const guide = me?.businessModel ? visible.find((a) => a.id === `panduan-${me.businessModel!.toLowerCase()}`) : undefined;
  const isAdmin = me?.role === 'OWNER' || me?.role === 'ADMIN';

  const showOnboarding = async () => {
    await post('/onboarding/dismiss', { dismissed: false });
    await qc.invalidateQueries({ queryKey: ['onboarding'] });
    navigate('/');
  };

  return (
    <div style={{ maxWidth: 1000 }}>
      <PageHeader
        title="Pusat Bantuan"
        extra={
          isAdmin && (
            <Button icon={<RocketOutlined />} onClick={() => void showOnboarding()}>
              Tampilkan panduan mulai
            </Button>
          )
        }
      />
      {article ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Card>
              <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                style={{ padding: 0, marginBottom: 12 }}
                onClick={() => setParams({})}
              >
                Semua artikel
              </Button>
              <Article a={article} />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Card size="small" title="Artikel lain di kategori ini">
                <List
                  size="small"
                  dataSource={visible.filter((a) => a.category === article.category && a.id !== article.id)}
                  locale={{ emptyText: '—' }}
                  renderItem={(a) => (
                    <List.Item style={{ cursor: 'pointer' }} onClick={() => setParams({ a: a.id })}>
                      {a.title}
                    </List.Item>
                  )}
                />
              </Card>
              <ContactCard />
            </Space>
          </Col>
        </Row>
      ) : (
        <>
          <Input
            size="large"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Cari bantuan, mis. retur, stok opname, transfer, pajak…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            style={{ marginBottom: 16 }}
            autoFocus
          />
          {!term && guide && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Bantuan ini disesuaikan untuk jenis usaha Anda: ${BUSINESS_MODEL_BY_KEY[me!.businessModel!].name}`}
              description="Artikel yang tidak berlaku untuk jenis usaha Anda disembunyikan. Mulai dari panduan di bawah, lalu lihat daftar pengaturan untuk jenis usaha Anda."
              action={
                <Space direction="vertical">
                  <Button size="small" type="primary" onClick={() => setParams({ a: guide.id })}>
                    Buka panduan
                  </Button>
                  <Link to="/settings/company?tab=usaha">
                    <Button size="small">Pengaturan usaha</Button>
                  </Link>
                </Space>
              }
            />
          )}
          {term ? (
            <Card>
              <List
                dataSource={results}
                locale={{ emptyText: <Empty description="Tidak ditemukan. Coba kata lain atau hubungi dukungan." /> }}
                renderItem={(a) => (
                  <List.Item style={{ cursor: 'pointer' }} onClick={() => setParams({ a: a.id })}>
                    <List.Item.Meta title={a.title} description={`${a.category} · ${a.summary}`} />
                  </List.Item>
                )}
              />
            </Card>
          ) : (
            <Row gutter={[16, 16]}>
              {HELP_CATEGORIES.filter((c) => visible.some((a) => a.category === c)).map((c) => (
                <Col key={c} xs={24} md={12}>
                  <Card size="small" title={c} style={{ height: '100%' }}>
                    {visible.filter((a) => a.category === c).map((a) => (
                      <div key={a.id} style={{ padding: '6px 0' }}>
                        <a onClick={() => setParams({ a: a.id })}>
                          <BookOutlined style={{ marginRight: 8, color: '#94a3b8' }} />
                          {a.title}
                        </a>
                      </div>
                    ))}
                  </Card>
                </Col>
              ))}
            </Row>
          )}
          <div style={{ marginTop: 16 }}>
            <ContactCard />
          </div>
        </>
      )}
    </div>
  );
}

/** Tombol "?" di header: bantuan sesuai halaman yang sedang dibuka */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<HelpArticle | null>(null);
  const { pathname } = useLocation();
  const { me } = useAuth();
  const related = articlesFor(pathname, me?.businessModel);
  return (
    <>
      <Tooltip title="Bantuan">
        <Button shape="circle" icon={<QuestionCircleOutlined />} onClick={() => setOpen(true)} aria-label="Bantuan" />
      </Tooltip>
      <Drawer
        title={current ? 'Bantuan' : 'Bantuan untuk halaman ini'}
        open={open}
        onClose={() => {
          setOpen(false);
          setCurrent(null);
        }}
        width={460}
        extra={
          <Link to="/help" onClick={() => setOpen(false)}>
            Pusat Bantuan
          </Link>
        }
        destroyOnHidden
      >
        {current ? (
          <>
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              style={{ padding: 0, marginBottom: 12 }}
              onClick={() => setCurrent(null)}
            >
              Kembali
            </Button>
            <Article a={current} />
          </>
        ) : (
          <>
            <List
              dataSource={related.length ? related : articlesVisibleTo(me?.businessModel).filter((a) => a.category === 'Memulai' || a.id === `panduan-${me?.businessModel?.toLowerCase()}`)}
              header={
                !related.length && (
                  <Typography.Text type="secondary">
                    Belum ada artikel khusus untuk halaman ini. Mungkin ini membantu:
                  </Typography.Text>
                )
              }
              renderItem={(a) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => setCurrent(a)}>
                  <List.Item.Meta title={a.title} description={a.summary} />
                </List.Item>
              )}
            />
            <div style={{ marginTop: 16 }}>
              <ContactCard compact />
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}
