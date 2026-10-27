import { OPS_ALERT_GAP_MS, opsAlert, resetOpsAlertState } from './ops-alert';

describe('opsAlert', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => {
    resetOpsAlertState();
    process.env.NODE_ENV = 'production';
    delete process.env.TELEGRAM_BOT_TOKEN;
  });
  afterAll(() => {
    process.env.NODE_ENV = env;
  });

  it('mengirim peringatan pertama, menahan yang berulang dalam jeda, lalu mengirim lagi sesudahnya', () => {
    expect(opsAlert('db', 'putus', 1_000)).toBe(true);
    expect(opsAlert('db', 'putus', 2_000)).toBe(false);
    expect(opsAlert('db', 'putus', 1_000 + OPS_ALERT_GAP_MS)).toBe(true);
  });

  it('kunci berbeda tidak saling menahan', () => {
    expect(opsAlert('a', 'x', 1)).toBe(true);
    expect(opsAlert('b', 'y', 2)).toBe(true);
  });

  it('mati saat NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    expect(opsAlert('t', 'x', 1)).toBe(false);
  });
});
