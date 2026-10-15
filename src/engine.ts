export type Profile = 'lite' | 'full';
export type Status = 'idle' | 'loading' | 'ready' | 'running' | 'error';
export interface Info { depth: number; nodes: number; multipv: number; cp?: number; mate?: number; pv: string[] }
interface Job { fen: string; movetime: number; multipv: number; onInfo: (l: Info[]) => void; res: (l: Info[]) => void; infos: Info[] }

const BASE = import.meta.env.BASE_URL;
// Engine files you place in public/engines/ (each .js needs its matching .wasm next to it).
const FILES: Record<Profile, string> = { lite: 'stockfish-18-lite-single.js', full: 'stockfish-18-single.js' };

/** One real Stockfish WASM worker at a time. Lite and Full are different official builds. */
export class Engine {
  build = '';
  onStatus: (s: Status) => void = () => {};
  private w: Worker | null = null;
  private profile: Profile | null = null;
  private job: Job | null = null;
  private next: Job | null = null;

  async load(p: Profile) {
    if (this.w && this.profile === p) return;
    this.terminate();
    this.onStatus('loading');
    const file = FILES[p];
    const url = `${BASE}engines/${file}`;
    // A missing file is answered with index.html by the SPA fallback, so check the content type too.
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!head || !head.ok || /html/.test(head.headers.get('content-type') ?? '')) {
      throw this.fail(`${file} was not found. Put it and its .wasm file in public/engines/.`);
    }
    const w = new Worker(url);
    await new Promise<void>((ok, bad) => {
      const t = setTimeout(() => { w.terminate(); bad(this.fail(`Engine ${file} did not start within 90 s.`)); }, 90000);
      w.onerror = (e) => { clearTimeout(t); w.terminate(); bad(this.fail(`Could not start ${file}: ${e.message || 'worker failed to load'}`)); };
      w.onmessage = (e) => { if (String(e.data).trim() === 'uciok') { clearTimeout(t); ok(); } };
      w.postMessage('uci');
    });
    w.onmessage = (e) => this.line(String(e.data));
    w.postMessage('setoption name Hash value 32');
    this.w = w; this.profile = p; this.build = file;
    this.onStatus('ready');
  }

  private fail(msg: string) { this.onStatus('error'); return new Error(msg); }

  analyze(fen: string, o: { movetime: number; multipv: number }, onInfo: (l: Info[]) => void): Promise<Info[]> {
    return new Promise((res) => {
      if (!this.w) return res([]);
      const j: Job = { fen, ...o, onInfo, res, infos: [] };
      if (this.job) { this.next?.res([]); this.next = j; this.w.postMessage('stop'); } else this.start(j);
    });
  }

  private start(j: Job) {
    this.job = j; this.onStatus('running');
    this.w!.postMessage(`setoption name MultiPV value ${j.multipv}`);
    this.w!.postMessage(`position fen ${j.fen}`);
    this.w!.postMessage(`go movetime ${j.movetime}`);
  }

  stop() { this.next?.res([]); this.next = null; if (this.job) this.w?.postMessage('stop'); }

  terminate() {
    this.w?.terminate(); this.w = null; this.profile = null;
    this.job?.res([]); this.next?.res([]); this.job = null; this.next = null;
  }

  private line(l: string) {
    if (l.startsWith('bestmove')) {
      const j = this.job; this.job = null;
      j?.res(j.infos.filter(Boolean));
      if (this.next) { const n = this.next; this.next = null; this.start(n); } else this.onStatus('ready');
      return;
    }
    if (!this.job || this.next || !l.startsWith('info') || !l.includes(' pv ') || /lowerbound|upperbound/.test(l)) return;
    const t = l.split(' ');
    const num = (k: string) => { const i = t.indexOf(k); return i < 0 ? undefined : Number(t[i + 1]); };
    const si = t.indexOf('score');
    if (si < 0) return;
    const info: Info = {
      depth: num('depth') ?? 0, nodes: num('nodes') ?? 0, multipv: num('multipv') ?? 1,
      pv: t.slice(t.indexOf('pv') + 1),
      ...(t[si + 1] === 'mate' ? { mate: Number(t[si + 2]) } : { cp: Number(t[si + 2]) }),
    };
    const infos = this.job.infos;
    infos[info.multipv - 1] = info;
    this.job.onInfo(infos.filter(Boolean));
  }
}
