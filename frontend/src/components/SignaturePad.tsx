import { Button, Space } from 'antd';
import { useEffect, useRef } from 'react';

interface Props {
  /** Dipanggil setiap goresan selesai: data URL PNG, atau undefined bila kosong/dihapus */
  onChange: (dataUrl: string | undefined) => void;
  width?: number;
  height?: number;
}

/** Kotak tanda tangan (mouse, sentuh, atau pena) */
export default function SignaturePad({ onChange, width = 480, height = 160 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * width) / r.width, y: ((e.clientY - r.top) * height) / r.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current!.getContext('2d')!;
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(dirty.current ? ref.current!.toDataURL('image/png') : undefined);
  };
  const clear = () => {
    ref.current!.getContext('2d')!.clearRect(0, 0, width, height);
    dirty.current = false;
    onChange(undefined);
  };

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <canvas
        ref={ref}
        width={width}
        height={height}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        style={{ width: '100%', maxWidth: width, height: 'auto', aspectRatio: `${width} / ${height}`, border: '1px dashed #94a3b8', borderRadius: 8, background: '#fff', touchAction: 'none' }}
        aria-label="Kotak tanda tangan"
      />
      <Button size="small" onClick={clear}>Hapus tanda tangan</Button>
    </Space>
  );
}
