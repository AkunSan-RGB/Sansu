import { BRAND, LEGAL_UPDATED_LABEL } from '@sansu/shared';
import { Button, Card, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';

type Section = { title: string; body: string[] };

const TERMS: Section[] = [
  {
    title: '1. Tentang layanan',
    body: [
      `${BRAND.name} adalah aplikasi sistem bisnis berbasis web (akuntansi, penjualan, pembelian, stok, kasir, penggajian, dan modul terkait) yang disediakan oleh ${BRAND.company} ("Kami"). Dengan mendaftar atau memakai layanan ini, perusahaan Anda ("Pelanggan") menyetujui syarat berikut.`,
    ],
  },
  {
    title: '2. Akun dan keamanan',
    body: [
      'Pendaftar menyatakan berwenang mewakili perusahaan. Pelanggan bertanggung jawab atas kerahasiaan kata sandi dan semua kegiatan di bawah akunnya, termasuk hak akses yang diberikan kepada pengguna lain.',
      'Aktifkan verifikasi 2 langkah dan beri tiap pengguna hak akses sesuai tugasnya. Segera hubungi Kami bila ada akses tanpa izin.',
    ],
  },
  {
    title: '3. Data Pelanggan',
    body: [
      'Seluruh data yang Pelanggan masukkan (transaksi, laporan, data karyawan, pelanggan, dan pemasok) tetap menjadi milik Pelanggan. Kami hanya memprosesnya untuk menjalankan layanan sesuai Kebijakan Privasi.',
      'Pelanggan bertanggung jawab atas kebenaran data, kelengkapan dokumen pendukung, dan kewajiban pembukuan serta perpajakannya sendiri. Laporan yang dihasilkan sistem membantu pencatatan dan tidak menggantikan pertimbangan akuntan atau konsultan pajak.',
    ],
  },
  {
    title: '4. Uji coba, langganan, dan pembayaran',
    body: [
      'Layanan dapat diberikan lebih dulu sebagai masa uji coba. Setelah itu, pemakaian mengikuti paket dan harga yang berlaku pada saat penagihan. Tagihan dikirim sebelum masa berlaku berakhir; pembayaran dilakukan lewat metode yang tersedia.',
      'Bila langganan berakhir, akun beralih ke mode baca saja setelah masa tenggang, sehingga data tetap dapat dilihat dan diunduh. Kami tidak menghapus data Pelanggan hanya karena langganan berakhir.',
    ],
  },
  {
    title: '5. Penggunaan yang dilarang',
    body: [
      'Pelanggan tidak boleh memakai layanan untuk kegiatan melanggar hukum, mencoba menembus keamanan atau data perusahaan lain, membebani sistem secara tidak wajar, atau menjual kembali layanan tanpa izin tertulis.',
    ],
  },
  {
    title: '6. Ketersediaan dan pencadangan',
    body: [
      'Kami berupaya menjaga layanan tetap tersedia dan mencadangkan data secara berkala, namun tidak menjamin layanan bebas gangguan. Pemeliharaan terjadwal diumumkan bila memungkinkan. Pelanggan dianjurkan rutin mengekspor laporan penting.',
    ],
  },
  {
    title: '7. Batasan tanggung jawab',
    body: [
      'Sejauh diizinkan hukum, tanggung jawab Kami terbatas pada biaya langganan yang telah dibayar Pelanggan dalam 3 bulan terakhir. Kami tidak bertanggung jawab atas kerugian tidak langsung, kehilangan keuntungan, atau akibat data yang salah dimasukkan pengguna.',
    ],
  },
  {
    title: '8. Penghentian',
    body: [
      'Pelanggan dapat berhenti kapan saja. Kami dapat menangguhkan akun yang melanggar syarat ini setelah pemberitahuan wajar. Pelanggan dapat meminta salinan datanya sebelum akun ditutup.',
    ],
  },
  {
    title: '9. Perubahan syarat dan hukum yang berlaku',
    body: [
      'Syarat ini dapat diperbarui; perubahan penting diberitahukan lewat aplikasi atau email. Pemakaian setelah perubahan berarti Pelanggan menyetujuinya. Syarat ini tunduk pada hukum Republik Indonesia.',
    ],
  },
  {
    title: '10. Kontak',
    body: ['Pertanyaan tentang syarat ini dapat disampaikan lewat Pusat Bantuan di dalam aplikasi atau kontak dukungan yang tercantum di invoice langganan.'],
  },
];

const PRIVACY: Section[] = [
  {
    title: '1. Siapa Kami',
    body: [`${BRAND.company} ("Kami") adalah penyedia aplikasi ${BRAND.name}. Kebijakan ini menjelaskan bagaimana Kami memproses data pribadi sesuai Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi.`],
  },
  {
    title: '2. Data yang Kami proses',
    body: [
      'Data akun: nama, email, kata sandi (disimpan dalam bentuk acak/hash), peran, dan catatan masuk.',
      'Data perusahaan: nama, NPWP, alamat, dan pengaturan.',
      'Data yang Pelanggan masukkan sendiri: transaksi, laporan, serta data pelanggan, pemasok, dan karyawan (termasuk data penggajian). Untuk data pihak ketiga ini, Pelanggan bertindak sebagai pengendali data dan Kami sebagai pemroses.',
      'Data teknis: alamat IP, jenis peramban, dan catatan galat untuk keamanan dan perbaikan layanan.',
    ],
  },
  {
    title: '3. Tujuan pemakaian',
    body: [
      'Menyediakan dan mengamankan layanan, menagih langganan, mengirim email sistem (verifikasi, reset sandi, tagihan, pengingat), memberi dukungan, serta memperbaiki layanan. Kami tidak menjual data pribadi dan tidak memakai data transaksi Pelanggan untuk iklan.',
    ],
  },
  {
    title: '4. Pihak ketiga yang membantu layanan',
    body: [
      'Penyedia hosting dan basis data, penyedia email, penyedia pembayaran, serta layanan notifikasi hanya menerima data seperlunya untuk menjalankan fungsinya dan terikat kewajiban kerahasiaan. Data dapat diproses di server di luar Indonesia sepanjang pelindungannya setara sesuai ketentuan yang berlaku.',
    ],
  },
  {
    title: '5. Keamanan',
    body: [
      'Kami memakai koneksi terenkripsi, pembatasan hak akses per peran, pemisahan data antar perusahaan, jejak audit, verifikasi 2 langkah, dan pencadangan. Bila terjadi kegagalan pelindungan data pribadi, Kami memberitahu pihak terdampak dan pihak berwenang sesuai ketentuan.',
    ],
  },
  {
    title: '6. Penyimpanan',
    body: [
      'Data disimpan selama akun aktif dan selama diperlukan untuk kewajiban hukum, termasuk kewajiban penyimpanan dokumen keuangan. Setelah akun ditutup atas permintaan, data dihapus atau dianonimkan dalam jangka waktu wajar, kecuali yang wajib disimpan menurut hukum.',
    ],
  },
  {
    title: '7. Hak Anda',
    body: [
      'Anda berhak mengakses, memperbaiki, meminta salinan, membatasi, menarik persetujuan, dan meminta penghapusan data pribadi Anda sesuai hukum. Ajukan lewat Pusat Bantuan atau kontak dukungan; Kami menanggapi dalam waktu wajar.',
    ],
  },
  {
    title: '8. Perubahan kebijakan',
    body: ['Kebijakan ini dapat diperbarui. Tanggal pembaruan tercantum di bagian atas halaman, dan perubahan penting diberitahukan lewat aplikasi atau email.'],
  },
];

function LegalPage({ title, sections, other }: { title: string; sections: Section[]; other: { to: string; label: string } }) {
  const navigate = useNavigate();
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 16px 48px' }}>
      <Button type="link" style={{ paddingLeft: 0 }} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/login'))}>
        ← Kembali
      </Button>
      <Card>
        <Typography.Title level={2} style={{ marginTop: 0 }}>
          {title}
        </Typography.Title>
        <Typography.Text type="secondary">
          {BRAND.company} · Berlaku sejak {LEGAL_UPDATED_LABEL}
        </Typography.Text>
        {sections.map((s) => (
          <section key={s.title} style={{ marginTop: 20 }}>
            <Typography.Title level={4} style={{ marginBottom: 8 }}>
              {s.title}
            </Typography.Title>
            {s.body.map((p, i) => (
              <Typography.Paragraph key={i} style={{ marginBottom: 8 }}>
                {p}
              </Typography.Paragraph>
            ))}
          </section>
        ))}
        <Typography.Paragraph style={{ marginTop: 24 }}>
          Lihat juga: <Link to={other.to}>{other.label}</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}

export const TermsPage = () => <LegalPage title="Syarat Layanan" sections={TERMS} other={{ to: '/kebijakan-privasi', label: 'Kebijakan Privasi' }} />;
export const PrivacyPage = () => <LegalPage title="Kebijakan Privasi" sections={PRIVACY} other={{ to: '/syarat-layanan', label: 'Syarat Layanan' }} />;
