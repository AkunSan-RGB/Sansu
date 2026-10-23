/**
 * Penjaga kirim ganda: klik ganda atau jaringan lambat tidak boleh mengirim transaksi yang sama dua kali.
 * `enter` memberi true hanya untuk pemanggil pertama; yang berikutnya ditolak sampai `leave` dipanggil.
 */
export interface FlightState {
  busy: boolean;
}
export function enter(state: FlightState): boolean {
  if (state.busy) return false;
  state.busy = true;
  return true;
}
export function leave(state: FlightState): void {
  state.busy = false;
}
