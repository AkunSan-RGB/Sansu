-- Peran baru Pembelian: memesan (permintaan beli → pesanan), tidak menerima barang, tidak membayar/menagihkan
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'PURCHASING';
