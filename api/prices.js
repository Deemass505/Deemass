// Vercel Serverless Function
//   GET /api/prices          -> harga penutupan bulanan sejak 2014: {d,k,p,updated}
//   GET /api/prices?tf=d     -> harga harian 3 tahun terakhir (close, high, low): {d,k,p,h,l,updated}
// Harga disesuaikan dividen dan stock split. Sumber: Yahoo Finance (tidak resmi).
const TICKERS = "ACES ADMR ADRO AKRA AMRT ANTM ARTO ASII BBCA BBNI BBRI BBTN BDMN BMRI BNGA BRIS BRPT BSDE BUKA CPIN CTRA EMTK ERAA EXCL GGRM GOTO HEAL HMSP HRUM ICBP INCO INDF INKP INTP ISAT ITMG JPFA JSMR KLBF MAPI MDKA MEDC MIKA MTEL MYOR PGAS PTBA PWON SIDO SMGR SMRA TBIG TINS TKIM TLKM TOWR TPIA UNTR UNVR".split(" ");
const UA = "Mozilla/5.0 (compatible; Kompas100Dashboard/1.0)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
const r2 = (v) => Math.round(v * 100) / 100;

async function one(t, daily) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = daily ? now - 3 * 365 * 86400 : Math.floor(Date.UTC(2014, 0, 1) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${t}.JK?period1=${p1}&period2=${now + 86400}&interval=${daily ? "1d" : "1mo"}&includeAdjustedClose=true`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429) { await sleep(700 * (a + 1)); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      const res = j.chart && j.chart.result && j.chart.result[0];
      if (!res) return null;
      const ts = res.timestamp || [];
      const qt = res.indicators.quote[0] || {};
      const q = qt.close || [], hi = qt.high || [], lo = qt.low || [];
      const adj = (res.indicators.adjclose && res.indicators.adjclose[0].adjclose) || q;
      const m = {};
      ts.forEach((s, i) => {
        const v = adj[i] != null ? adj[i] : q[i];
        if (v == null) return;
        const key = new Date(s * 1000).toISOString().slice(0, daily ? 10 : 7);
        if (daily) {
          const f = q[i] ? v / q[i] : 1; // skala penyesuaian untuk high/low
          m[key] = [v, (hi[i] != null ? hi[i] : q[i]) * f, (lo[i] != null ? lo[i] : q[i]) * f];
        } else m[key] = v;
      });
      if (!daily) {
        const live = res.meta && res.meta.regularMarketPrice;
        if (live) m[wib()] = live; // bar bulan berjalan = harga terbaru
      }
      return m;
    } catch (e) { await sleep(400); }
  }
  return null;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

module.exports = async (req, res) => {
  try {
    const daily = (req.query && req.query.tf) === "d";
    const maps = await pool(TICKERS, 6, (t) => one(t, daily));
    const ok = TICKERS.filter((_, i) => maps[i]);
    if (ok.length < TICKERS.length * 0.5) {
      res.status(502).json({ error: "Yahoo Finance tidak merespons", berhasil: ok.length });
      return;
    }
    const keys = [...new Set(maps.filter(Boolean).flatMap((m) => Object.keys(m)))].sort();
    const data = { updated: new Date().toISOString(), source: "yahoo", k: ok };
    if (daily) {
      // hari tanpa data (libur/suspensi) diisi harga penutupan terakhir agar EMA dan ATR tidak bolong
      const cols = ok.map((t) => {
        const m = maps[TICKERS.indexOf(t)];
        let last = null;
        return keys.map((k) => {
          const e = m[k];
          if (e) { last = e; return e; }
          return last ? [last[0], last[0], last[0]] : null;
        });
      });
      data.d = keys;
      data.p = cols.map((c) => c.map((e) => (e ? r2(e[0]) : null)));
      data.h = cols.map((c) => c.map((e) => (e ? r2(e[1]) : null)));
      data.l = cols.map((c) => c.map((e) => (e ? r2(e[2]) : null)));
    } else {
      const eom = (k) => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
      data.d = keys.map(eom);
      data.p = ok.map((t) => { const m = maps[TICKERS.indexOf(t)]; return keys.map((k) => (m[k] != null ? r2(m[k]) : null)); });
    }
    // Cache di edge Vercel: harian 5 menit, bulanan 15 menit
    res.setHeader("Cache-Control", `s-maxage=${daily ? 300 : 900}, stale-while-revalidate=3600`);
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
