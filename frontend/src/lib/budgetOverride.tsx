import { Input } from 'antd';
import type { HookAPI } from 'antd/es/modal/useModal';
import { ApiError } from '@/api/client';

/**
 * Belanja melewati anggaran dan kebijakan "Blokir": Pemilik boleh melanjutkan dengan alasan (min. 10 karakter, tercatat di jejak audit).
 * `run(reason)` dipanggil dulu tanpa alasan; bila server menolak karena anggaran dan pengguna Pemilik, minta alasan lalu ulangi.
 */
export async function withBudgetOverride<T>(modal: HookAPI, role: string | undefined, run: (reason?: string) => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const code = e instanceof ApiError ? (e.data as { code?: string } | undefined)?.code : undefined;
    if (code !== 'BUDGET_EXCEEDED' || role !== 'OWNER') throw e;
    const reason = await new Promise<string | null>((resolve) => {
      let text = '';
      modal.confirm({
        title: 'Melebihi anggaran',
        width: 540,
        content: (
          <div>
            <p>{(e as Error).message}</p>
            <Input.TextArea rows={2} maxLength={300} placeholder="Alasan melanjutkan (min. 10 karakter)" onChange={(ev) => (text = ev.target.value)} />
          </div>
        ),
        okText: 'Tetap lanjutkan',
        cancelText: 'Batal',
        onOk: () => (text.trim().length >= 10 ? resolve(text.trim()) : Promise.reject(new Error('Alasan terlalu pendek'))),
        onCancel: () => resolve(null),
      });
    });
    if (!reason) throw e;
    return run(reason);
  }
}
