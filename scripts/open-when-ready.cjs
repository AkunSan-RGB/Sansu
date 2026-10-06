/**
 * Buka browser hanya setelah API dan tampilan web benar-benar siap,
 * supaya halaman pertama tidak kosong karena server masih menyala.
 */
const http = require('node:http');
const { exec } = require('node:child_process');

const ok = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });

(async () => {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    if ((await ok('http://localhost:3000/api/health')) && (await ok('http://localhost:5173/'))) {
      console.log('\n  SANSU siap — membuka browser: http://localhost:5173\n');
      const cmd = process.platform === 'win32' ? 'start "" http://localhost:5173' : process.platform === 'darwin' ? 'open http://localhost:5173' : 'xdg-open http://localhost:5173';
      exec(cmd);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('\n  Server belum siap setelah 10 menit. Buka http://localhost:5173 secara manual.\n');
})();
