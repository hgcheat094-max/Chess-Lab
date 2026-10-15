# ChessLab Pro

Chess analysis in the browser: real Stockfish 18 (WebAssembly in a Web Worker), chess.js rules, react-chessboard.

## 1. Add the engine files (manual)
Copy these four files into `public/engines/`:
- `stockfish-18-lite-single.js` + `stockfish-18-lite-single.wasm` (Lite, ~7 MB)
- `stockfish-18-single.js` + `stockfish-18-single.wasm` (Full, ~113 MB)

Both are single-threaded builds from Stockfish.js 18 (Chess.com), so no special browser headers are needed.
Nothing is downloaded or copied automatically. The "Build:" line in the Engine panel shows which file is running.

## 2. Run
```bash
npm install
npm run dev       # development
npm run build     # type-check + production build into dist/
npm run preview   # test the production build
```

## 3. Deploy to Netlify
Build command `npm run build`, publish directory `dist` (already in `netlify.toml`). Add your domain under Domain management, then set the DNS records Netlify shows; HTTPS is automatic.

Size warning: `stockfish-18-single.wasm` is ~113 MB. GitHub rejects files over 100 MB, and Netlify may have its own per-file limit, so check before deploying. To ship Lite only, delete the two `stockfish-18-single.*` files. The Full option will then show a clear "not found" error.

## Move classification (centipawn loss for the mover, evals clamped to +/-10 pawns)
Best <=5, Excellent <=20, Good <=50, Inaccuracy <=100, Mistake <=300, Blunder >300.
