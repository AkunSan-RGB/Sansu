import { Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { fmtDate, today } from './format';

/** Jatuh tempo yang mudah dibaca: "Lewat 5 hari" (merah), "3 hari lagi" (kuning), atau tanggalnya */
export function DueLabel({ dueDate, paid }: { dueDate: string; paid?: boolean }) {
  if (paid) return <Typography.Text type="secondary">{fmtDate(dueDate)}</Typography.Text>;
  const days = dayjs(dueDate).diff(dayjs(today()), 'day');
  if (days < 0) return <Tag color="red">Lewat {-days} hari</Tag>;
  if (days === 0) return <Tag color="orange">Hari ini</Tag>;
  if (days <= 7) return <Tag color="gold">{days} hari lagi</Tag>;
  return <span>{fmtDate(dueDate)}</span>;
}
