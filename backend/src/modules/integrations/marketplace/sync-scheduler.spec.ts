import { MarketplaceScheduler } from './sync.service';

describe('MarketplaceScheduler: galat sinkronisasi tidak menjadi unhandled rejection', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env.NODE_ENV = env;
  });

  it('syncAll yang gagal dicatat dan penjadwal tetap hidup untuk putaran berikutnya', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const syncAll = jest.fn().mockRejectedValue(new Error('database tak terjangkau'));
    const sched = new MarketplaceScheduler({ syncAll } as never);
    const err = jest.spyOn(sched['logger'], 'error').mockImplementation(() => undefined);
    sched.onModuleInit();
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    await new Promise((r) => setImmediate(r));
    expect(syncAll).toHaveBeenCalledTimes(2); // busy dilepas setelah gagal, putaran kedua tetap jalan
    expect(err).toHaveBeenCalledWith(expect.stringContaining('database tak terjangkau'));
    expect(unhandled).not.toHaveBeenCalled();
    sched.onModuleDestroy();
    process.off('unhandledRejection', unhandled);
  });
});
