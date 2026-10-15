import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Play, Square as StopIcon } from 'lucide-react';
import { Engine, type Info, type Profile, type Status } from './engine';

const THEMES: Record<string, [string, string]> = {
  'Classic Green': ['#eeeed2', '#769656'], 'Tournament Brown': ['#f0d9b5', '#b58863'], 'Ocean Blue': ['#dee3e6', '#4b7399'],
  'Slate Gray': ['#d9dde2', '#6b7686'], 'Purple Night': ['#c9b8e8', '#6d4aa0'], 'Emerald Dark': ['#a8d5ba', '#1f6f4a'],
  'Warm Wood': ['#e8c999', '#a0693b'], 'Minimal Cream': ['#f7f1e3', '#cdbf9f'],
};
// Move classification by centipawn loss for the side that moved (evals clamped to ±1000 cp).
const CLS = [[5, 'Best', '#96bc4b'], [20, 'Excellent', '#7fb069'], [50, 'Good', '#a3c585'], [100, 'Inaccuracy', '#f7c631'], [300, 'Mistake', '#e58f2a'], [Infinity, 'Blunder', '#ca3431']] as const;
const DEFAULT_FEN = new Chess().fen();

interface M { san: string; from: string; to: string; promotion?: string }

function useStore<T>(k: string, d: T) {
  const [v, s] = useState<T>(() => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : d; } catch { return d; } });
  useEffect(() => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }, [k, v]);
  return [v, s] as const;
}
const turn = (fen: string) => fen.split(' ')[1];
const toWhite = (i: Info, fen: string) => (turn(fen) === 'w' ? 1 : -1) * (i.mate !== undefined ? Math.sign(i.mate) * (10000 - Math.abs(i.mate)) : i.cp ?? 0);
const fmt = (i: Info, fen: string) => {
  const s = turn(fen) === 'w' ? 1 : -1;
  if (i.mate !== undefined) return `${i.mate * s > 0 ? '+' : '-'}M${Math.abs(i.mate)}`;
  const v = (i.cp ?? 0) * s / 100; return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
};
const sanLine = (fen: string, pv: string[]) => {
  const c = new Chess(fen); const out: string[] = [];
  for (const u of pv.slice(0, 8)) { try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; } }
  return out.join(' ');
};

function Btn(p: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  return <button aria-label={p.label} title={p.label} onClick={p.onClick} disabled={p.disabled}
    className={`min-h-11 min-w-11 px-3 rounded-lg border border-white/10 text-sm flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 ${p.active ? 'bg-[#7fb069] text-[#10140f] font-semibold' : 'bg-white/5 hover:bg-white/10'}`}>{p.children}</button>;
}
const Box = (p: { title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-white/10 bg-[#1e2123] p-4"><h2 className="text-sm font-semibold text-[#9fcf8a] mb-3">{p.title}</h2>{p.children}</section>
);
const sel = 'w-full min-h-11 rounded-lg bg-[#16181a] border border-white/10 px-2 text-sm';

export default function App() {
  const eng = useMemo(() => new Engine(), []);
  const [start, setStart] = useState(DEFAULT_FEN);
  const [moves, setMoves] = useState<M[]>([]);
  const [ply, setPly] = useState(0);
  const [flip, setFlip] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [theme, setTheme] = useStore('cl.theme', 'Classic Green');
  const [light, setLight] = useStore('cl.light', THEMES['Classic Green'][0]);
  const [dark, setDark] = useStore('cl.dark', THEMES['Classic Green'][1]);
  const [hl, setHl] = useStore('cl.hl', '#f7c631');
  const [coords, setCoords] = useStore('cl.coords', true);
  const [size, setSize] = useStore('cl.size', 520);
  const [arrows, setArrows] = useStore('cl.arrows', true);
  const [profile, setProfile] = useStore<Profile>('cl.profile', 'lite');
  const [movetime, setMovetime] = useStore('cl.movetime', 1000);
  const [multipv, setMultipv] = useStore('cl.multipv', 3);
  const [on, setOn] = useState(false);
  const [batch, setBatch] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [build, setBuild] = useState('');
  const [err, setErr] = useState('');
  const [lines, setLines] = useState<Info[]>([]);
  const [evals, setEvals] = useState<(number | null)[]>([]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  const fens = useMemo(() => {
    const c = new Chess(start); const f = [c.fen()];
    for (const m of moves) { c.move({ from: m.from, to: m.to, promotion: m.promotion }); f.push(c.fen()); }
    return f;
  }, [start, moves]);
  const fen = fens[ply];

  useEffect(() => { eng.onStatus = setStatus; return () => eng.terminate(); }, [eng]);

  // Live analysis: re-runs on position/profile/limit changes; a new search pre-empts the old one.
  useEffect(() => {
    if (!on || batch) { if (!batch) { eng.stop(); setLines([]); } return; }
    let dead = false;
    (async () => {
      try {
        setErr(''); await eng.load(profile); if (dead) return; setBuild(eng.build);
        await eng.analyze(fen, { movetime, multipv }, (l) => { if (!dead) setLines(l); });
      } catch (e) { if (!dead) { setErr(e instanceof Error ? e.message : String(e)); setOn(false); } }
    })();
    return () => { dead = true; };
  }, [on, batch, fen, profile, movetime, multipv, eng]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      if (e.key === 'ArrowRight') setPly((p) => Math.min(moves.length, p + 1));
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [moves.length]);

  const play = (from: string, to: string) => {
    const c = new Chess(fen); let m;
    try { m = c.move({ from, to, promotion: 'q' }); } catch { return false; }
    if (moves[ply]?.from === m.from && moves[ply]?.to === m.to && moves[ply]?.promotion === m.promotion) { setPly(ply + 1); return true; }
    setMoves([...moves.slice(0, ply), { san: m.san, from: m.from, to: m.to, promotion: m.promotion }]);
    setEvals([]); setPly(ply + 1); setPick(null); return true;
  };
  const click = (sq: string) => {
    if (pick && pick !== sq && play(pick, sq)) return;
    const p = new Chess(fen).get(sq as Square);
    setPick(p && p.color === turn(fen) ? sq : null);
  };
  const reset = (s = DEFAULT_FEN, m: M[] = []) => { setStart(s); setMoves(m); setPly(0); setEvals([]); setLines([]); setPick(null); };

  async function analyzeGame() {
    setErr(''); setOn(false); setBatch(true); setLines([]);
    const out: (number | null)[] = fens.map(() => null); setEvals(out.slice());
    try {
      await eng.load(profile); setBuild(eng.build);
      for (let i = 0; i < fens.length; i++) {
        const c = new Chess(fens[i]);
        if (c.isGameOver()) out[i] = c.isCheckmate() ? (c.turn() === 'w' ? -10000 : 10000) : 0;
        else {
          const r = await eng.analyze(fens[i], { movetime, multipv: 1 }, () => {});
          if (!r[0]) break; // stopped
          out[i] = toWhite(r[0], fens[i]);
        }
        setEvals(out.slice());
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBatch(false);
  }
  const stopAll = () => { setOn(false); eng.stop(); };

  const lossAt = (i: number) => {
    const a = evals[i], b = evals[i + 1]; if (a == null || b == null) return null;
    const cl = (x: number) => Math.max(-1000, Math.min(1000, x));
    return Math.max(0, (turn(fens[i]) === 'w' ? 1 : -1) * (cl(a) - cl(b)));
  };
  const cls = (i: number) => { const l = lossAt(i); return l == null ? null : CLS.find((c) => l <= c[0])!; };

  const importPgn = (t: string) => {
    try {
      const c = new Chess(); c.loadPgn(t);
      const h = c.history({ verbose: true });
      if (!h.length) throw new Error('No moves found in the PGN.');
      reset(c.getHeaders().FEN ?? DEFAULT_FEN, h.map((m) => ({ san: m.san, from: m.from, to: m.to, promotion: m.promotion })));
      setPly(h.length); setMsg(`Loaded ${h.length} moves.`);
    } catch (e) { setMsg(`Invalid PGN: ${e instanceof Error ? e.message : 'could not parse'}`); }
  };
  const importFen = (t: string) => {
    try { reset(new Chess(t.trim()).fen()); setMsg('Position loaded.'); }
    catch (e) { setMsg(`Invalid FEN: ${e instanceof Error ? e.message : 'could not parse'}`); }
  };
  const pgn = () => { const c = new Chess(start); moves.forEach((m) => c.move({ from: m.from, to: m.to, promotion: m.promotion })); return c.pgn(); };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([pgn()], { type: 'application/x-chess-pgn' })); a.download = 'game.pgn'; a.click(); URL.revokeObjectURL(a.href); };

  const styles: Record<string, CSSProperties> = {};
  const cur = new Chess(fen);
  if (ply > 0) { styles[moves[ply - 1].from] = { backgroundColor: hl + '99' }; styles[moves[ply - 1].to] = { backgroundColor: hl + '99' }; }
  if (cur.inCheck()) for (const row of cur.board()) for (const p of row) if (p && p.type === 'k' && p.color === cur.turn()) styles[p.square] = { background: 'radial-gradient(circle, #ff3b30cc 35%, transparent 75%)' };
  if (pick) { styles[pick] = { backgroundColor: hl }; for (const m of cur.moves({ square: pick as Square, verbose: true })) styles[m.to] = { background: 'radial-gradient(circle, rgba(0,0,0,.35) 22%, transparent 24%)' }; }
  const best = lines[0]?.pv[0];
  const shown = evals[ply] ?? (lines[0] ? toWhite(lines[0], fen) : null);
  const pct = shown == null ? 50 : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, shown)))) - 1);
  const running = status === 'running' || batch;
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gw = 600, gh = 90;
  const pts = evals.map((e, i) => e == null ? null : `${(i / Math.max(1, fens.length - 1)) * gw},${gh / 2 - (Math.max(-800, Math.min(800, e)) / 800) * (gh / 2 - 4)}`).filter(Boolean).join(' ');

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 px-4 h-14 border-b border-white/10 bg-[#1a1d1f]">
        <div className="size-8 rounded-lg bg-[#7fb069] text-[#10140f] grid place-items-center font-bold" aria-hidden>♞</div>
        <h1 className="font-semibold text-lg">ChessLab Pro</h1>
        <span className="ml-auto text-xs text-white/50 hidden sm:block">Stockfish 18 · WebAssembly · runs in your browser</span>
      </header>
      <main className="grid gap-4 p-3 lg:p-4 lg:grid-cols-[280px_minmax(0,1fr)_340px] max-w-[1500px] mx-auto">
        <div className="order-3 lg:order-1 space-y-4 min-w-0">
          <Box title="Board appearance">
            <div className="grid grid-cols-4 gap-2 mb-3">
              {Object.entries(THEMES).map(([n, [l, d]]) => (
                <button key={n} aria-label={n} title={n} onClick={() => { setTheme(n); setLight(l); setDark(d); }}
                  className={`aspect-square rounded-md overflow-hidden grid grid-cols-2 border-2 ${theme === n ? 'border-[#7fb069]' : 'border-transparent'}`}>
                  <i style={{ background: l }} /><i style={{ background: d }} /><i style={{ background: d }} /><i style={{ background: l }} />
                </button>))}
            </div>
            <p className="text-xs text-white/50 mb-2">{theme}</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {([['Light', light, setLight], ['Dark', dark, setDark], ['Highlight', hl, setHl]] as const).map(([n, v, s]) => (
                <label key={n} className="grid gap-1">{n}<input type="color" value={v} onChange={(e) => s(e.target.value)} className="w-full h-10 rounded bg-transparent" /></label>))}
            </div>
            <label className="grid gap-1 text-xs mt-3">Board size ({size}px)<input type="range" min={320} max={720} step={10} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
            <label className="flex items-center gap-2 text-sm mt-3 min-h-8"><input type="checkbox" checked={coords} onChange={(e) => setCoords(e.target.checked)} />Coordinates</label>
            <div className="mt-3"><Btn label="Reset appearance" onClick={() => { setTheme('Classic Green'); setLight(THEMES['Classic Green'][0]); setDark(THEMES['Classic Green'][1]); setHl('#f7c631'); setSize(520); setCoords(true); }}>Reset to default</Btn></div>
          </Box>
          <Box title="Import and export">
            <textarea aria-label="PGN or FEN" value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Paste a PGN or FEN"
              className="w-full rounded-lg bg-[#16181a] border border-white/10 p-2 text-xs font-mono" />
            <div className="flex flex-wrap gap-2 mt-2">
              <Btn label="Load PGN" onClick={() => importPgn(text)}>Load PGN</Btn>
              <Btn label="Load FEN" onClick={() => importFen(text)}>Load FEN</Btn>
              <Btn label="Start position" onClick={() => { reset(); setMsg(''); }}>Start position</Btn>
            </div>
            <label className="block mt-2 text-xs">Upload .pgn<input type="file" accept=".pgn,text/plain" className="block w-full mt-1"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const t = await f.text(); setText(t); importPgn(t); } }} /></label>
            <div className="flex flex-wrap gap-2 mt-2">
              <Btn label="Download PGN" onClick={download}>Download PGN</Btn>
              <Btn label="Copy PGN" onClick={() => navigator.clipboard.writeText(pgn())}>Copy PGN</Btn>
              <Btn label="Copy FEN" onClick={() => navigator.clipboard.writeText(fen)}>Copy FEN</Btn>
            </div>
            {msg && <p role="status" className={`text-xs mt-2 ${msg.startsWith('Invalid') ? 'text-red-400' : 'text-[#9fcf8a]'}`}>{msg}</p>}
          </Box>
        </div>

        <div className="order-1 lg:order-2 min-w-0 mx-auto w-full" style={{ maxWidth: size + 40 }}>
          <div className="flex gap-2">
            <div className="w-5 rounded bg-[#2b2f31] overflow-hidden flex flex-col" role="img" aria-label={`Evaluation ${shown == null ? 'unknown' : (shown / 100).toFixed(2)}`}>
              <div className="bg-[#26292b] transition-[height]" style={{ height: `${100 - pct}%` }} /><div className="bg-[#f1f1ea] flex-1" />
            </div>
            <div className="flex-1 min-w-0">
              <Chessboard id="main" position={fen} boardOrientation={flip ? 'black' : 'white'} onPieceDrop={(s, t) => { setPick(null); return play(s, t); }}
                onSquareClick={click} customDarkSquareStyle={{ backgroundColor: dark }} customLightSquareStyle={{ backgroundColor: light }}
                customSquareStyles={styles} showBoardNotation={coords} animationDuration={reduce ? 0 : 200}
                customArrows={arrows && best ? [[best.slice(0, 2) as Square, best.slice(2, 4) as Square, '#7fb069']] : []} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            <Btn label="First move" onClick={() => setPly(0)} disabled={ply === 0}><ChevronsLeft size={18} /></Btn>
            <Btn label="Previous move (undo)" onClick={() => setPly(ply - 1)} disabled={ply === 0}><ChevronLeft size={18} /></Btn>
            <Btn label="Next move (redo)" onClick={() => setPly(ply + 1)} disabled={ply >= moves.length}><ChevronRight size={18} /></Btn>
            <Btn label="Last move" onClick={() => setPly(moves.length)} disabled={ply >= moves.length}><ChevronsRight size={18} /></Btn>
            <Btn label="Flip board" onClick={() => setFlip(!flip)}><ArrowUpDown size={18} />Flip</Btn>
            <Btn label="Reset game" onClick={() => reset()}>Reset</Btn>
          </div>
        </div>

        <div className="order-2 lg:order-3 space-y-4 min-w-0">
          <Box title="Engine">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <label className="grid gap-1">Profile<select className={sel} value={profile} onChange={(e) => { setProfile(e.target.value as Profile); setLines([]); }}><option value="lite">Lite</option><option value="full">Full</option></select></label>
              <label className="grid gap-1">Time<select className={sel} value={movetime} onChange={(e) => setMovetime(+e.target.value)}>{[500, 1000, 2000, 5000, 10000].map((n) => <option key={n} value={n}>{n / 1000}s</option>)}</select></label>
              <label className="grid gap-1">Lines<select className={sel} value={multipv} onChange={(e) => setMultipv(+e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {on || running ? <Btn label="Stop analysis" onClick={stopAll}><StopIcon size={16} />Stop</Btn> : <Btn label="Start analysis" onClick={() => setOn(true)} active><Play size={16} />Analyze</Btn>}
              <Btn label="Analyze full game" onClick={analyzeGame} disabled={batch || moves.length === 0}>Analyze game</Btn>
              <Btn label="Toggle best-move arrow" onClick={() => setArrows(!arrows)} active={arrows}>Arrow</Btn>
            </div>
            <p className="text-xs mt-3 text-white/60" aria-live="polite">
              {status === 'loading' ? 'Loading engine… the Full build is large; the first load can take a while.' : status === 'error' ? 'Engine unavailable.' : status === 'running' ? 'Analyzing…' : status === 'ready' ? 'Engine ready.' : 'Engine not loaded (loads when you start analysis).'}
              {build && <> Build: <span className="font-mono">{build}</span></>}
            </p>
            {err && <p role="alert" className="text-xs mt-2 text-red-400">{err}</p>}
          </Box>
          <Box title="Best moves">
            {!lines.length ? <p className="text-sm text-white/50">{on ? 'Waiting for the engine…' : 'Press Analyze to see the evaluation, best moves and variations.'}</p> : (
              <>
                <p className="text-xs text-white/50 mb-2">Depth {lines[0].depth} · {lines[0].nodes.toLocaleString()} nodes</p>
                <ol className="space-y-2">{lines.map((l) => (
                  <li key={l.multipv} className="text-sm"><span className="font-mono font-semibold text-[#9fcf8a] mr-2">{fmt(l, fen)}</span><span className="font-mono text-white/80 break-words">{sanLine(fen, l.pv)}</span></li>))}
                </ol>
              </>)}
          </Box>
          <Box title="Moves">
            {!moves.length ? <p className="text-sm text-white/50">Play a move on the board or import a game.</p> : (
              <div className="flex flex-wrap gap-x-1 gap-y-1 text-sm max-h-60 overflow-auto">
                {moves.map((m, i) => { const c = cls(i); return (
                  <span key={i} className="inline-flex items-center">
                    {i % 2 === 0 && <span className="text-white/40 mr-1 ml-1">{i / 2 + 1}.</span>}
                    <button onClick={() => setPly(i + 1)} aria-current={ply === i + 1} title={c?.[1]}
                      className={`px-1.5 min-h-8 rounded font-mono ${ply === i + 1 ? 'bg-[#7fb069] text-[#10140f]' : 'hover:bg-white/10'}`}>
                      {m.san}{c && <i className="inline-block size-2 rounded-full ml-1" style={{ background: c[2] }} />}
                    </button>
                  </span>); })}
              </div>)}
            {evals.some((e) => e != null) && (
              <>
                <svg viewBox={`0 0 ${gw} ${gh}`} className="w-full mt-3 rounded bg-[#16181a] cursor-pointer" role="img" aria-label="Evaluation graph"
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPly(Math.round(((e.clientX - r.left) / r.width) * (fens.length - 1))); }}>
                  <line x1="0" x2={gw} y1={gh / 2} y2={gh / 2} stroke="#ffffff22" />
                  <polyline points={pts} fill="none" stroke="#7fb069" strokeWidth="2" />
                  <line x1={(ply / Math.max(1, fens.length - 1)) * gw} x2={(ply / Math.max(1, fens.length - 1)) * gw} y1="0" y2={gh} stroke="#f7c631" />
                </svg>
                <p className="text-[11px] text-white/50 mt-2">Dot colors by centipawn loss: {CLS.map((c) => `${c[1]} ≤${c[0] === Infinity ? '∞' : c[0]}`).join(', ')}.</p>
              </>)}
          </Box>
        </div>
      </main>
    </div>
  );
}
