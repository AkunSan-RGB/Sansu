import { CameraOutlined } from '@ant-design/icons';
import { Alert, Button, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';

interface Detector { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type DetectorCtor = new (o?: { formats?: string[] }) => Detector;

/**
 * Pindai kode lewat kamera (HP/laptop): memakai BarcodeDetector bawaan peramban bila ada (QR dan barcode barang),
 * selain itu jsQR (hanya QR). Alat pemindai USB/Bluetooth tidak perlu ini: ia mengetik ke kolom seperti keyboard.
 */
export function CameraScanner({ open, onClose, onScan, title = 'Pindai kode' }: { open: boolean; onClose: () => void; onScan: (text: string) => void; title?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    setError(null);
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Peramban ini tidak mendukung kamera (atau halaman tidak memakai HTTPS)');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
        const Native = (window as Window & { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
        const detector = Native ? new Native({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a'] }) : null;
        const jsqr = detector ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const tick = async () => {
          if (stop) return;
          try {
            let text: string | undefined;
            if (detector) text = (await detector.detect(el))[0]?.rawValue;
            else if (jsqr && el.videoWidth) {
              canvas.width = el.videoWidth;
              canvas.height = el.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
              ctx.drawImage(el, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsqr(img.data, img.width, img.height)?.data;
            }
            if (text) {
              stop = true;
              onScan(text);
              return;
            }
          } catch {
            /* bingkai gagal dibaca: coba lagi */
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch (e) {
        setError((e as Error).message || 'Kamera tidak dapat dipakai');
      }
    })();
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onCancel={onClose} title={title} footer={null} destroyOnHidden width={420}>
      {error ? (
        <Alert type="warning" showIcon message="Kamera tidak bisa dipakai" description={`${error}. Izinkan akses kamera di peramban, atau ketik / pakai alat pemindai.`} />
      ) : (
        <>
          <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 8, background: '#000' }} />
          <div style={{ textAlign: 'center', marginTop: 8, color: '#667085' }}>Arahkan kamera ke kode QR/barcode</div>
        </>
      )}
    </Modal>
  );
}

/** Tombol kamera kecil untuk ditaruh di samping kolom isian pindai */
export function ScanButton({ onScan, title }: { onScan: (text: string) => void; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<CameraOutlined />} onClick={() => setOpen(true)} aria-label="Pindai dengan kamera" />
      <CameraScanner open={open} title={title} onClose={() => setOpen(false)} onScan={(t) => { setOpen(false); onScan(t); }} />
    </>
  );
}
