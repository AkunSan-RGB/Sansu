/**
 * Cetak dokumen (.print-doc: faktur, surat jalan, PO, penawaran, slip gaji); pilih "Simpan sebagai PDF" untuk berkas.
 * Dokumen disalin ke wadah cetak di bawah <body> sehingga selalu mulai di atas halaman 1,
 * tidak terdorong oleh menu/tata letak aplikasi yang disembunyikan.
 */
export function printDoc(title: string) {
  const docs = document.querySelectorAll<HTMLElement>('.print-doc');
  if (!docs.length) return window.print();
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  docs.forEach((d) => root.appendChild(d.cloneNode(true)));
  document.body.appendChild(root);
  const prev = document.title;
  document.title = title;
  document.body.classList.add('printing-doc');
  const cleanup = () => {
    root.remove();
    document.body.classList.remove('printing-doc');
    document.title = prev;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
