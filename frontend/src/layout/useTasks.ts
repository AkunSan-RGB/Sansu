import { useQuery } from '@tanstack/react-query';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

export interface TaskItem {
  key: string;
  title: string;
  detail: string;
  link: string;
  count: number;
  oldestDays: number;
}

/** Proses yang menunggu tindakan pengguna ini (disaring pemisahan fungsi oleh server) */
export function useTasks() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ['tasks', 'mine'],
    queryFn: () => get<TaskItem[]>('/tasks/mine'),
    enabled: !!me,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Jumlah tugas menurut alamat menu (tanpa query string) */
export function taskCountByPath(tasks: TaskItem[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tasks ?? []) {
    const path = t.link.split('?')[0];
    m.set(path, (m.get(path) ?? 0) + t.count);
  }
  return m;
}
