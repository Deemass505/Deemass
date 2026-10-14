// Vercel Serverless Function: GET /api/prices
// Mengambil harga penutupan bulanan (disesuaikan dividen/split) dari Yahoo Finance,
// lalu mengembalikannya dalam format yang dibaca dashboard: {d:[tanggal], k:[kode], p:[[harga]]}
const TICKERS = "ACES ADMR ADRO AKRA AMRT ANTM ARTO ASII BBCA BBNI BBRI BBTN BDMN BMRI BNGA BRIS BRPT BSDE BUKA CPIN CTRA EMTK ERAA EXCL GGRM GOTO HEAL HMSP HRUM ICBP INCO INDF INKP INTP ISAT ITMG JPFA JSMR KLBF MAPI MDKA MEDC MIKA MTEL MYOR PGAS PTBA PWON SIDO SMGR SMRA TBIG TINS TKIM TLKM TOWR TPIA UNTR UNVR".split(" ");
const UA = "Mozilla/5.0 (compatible; Kompas100Dashboard/1.0)";
const START = Math.floor(Date.UTC(2014, 0, 1) / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);

async function one(t) {
  const end = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${t}.JK?period1=${START}&period2=${end}&interval=1mo&includeAdjustedClose=true`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429) { await sleep(700 * (a + 1)); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      const res = j.chart && j.chart.result && j.chart.result[0];
      if (!res) return null;
      const ts = res.timestamp || [];
      const q = (res.indicators.quote[0] || {}).close || [];
      const adj = (res.indicators.adjclose && res.indicators.adjclose[0].adjclose) || q;
      const m = {};
      ts.forEach((s, i) => {
        const v = adj[i] != null ? adj[i] : q[i];
        if (v != null) m[new Date(s * 1000).toISOString().slice(0, 7)] = v;
      });
      const live = res.meta && res.meta.regularMarketPrice;
      if (live) m[wib()] = live; // bar bulan berjalan = harga terbaru
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
    const maps = await pool(TICKERS, 6, one);
    const ok = TICKERS.filter((_, i) => maps[i]);
    if (ok.length < TICKERS.length * 0.5) {
      res.status(502).json({ error: "Yahoo Finance tidak merespons", berhasil: ok.length });
      return;
    }
    const keys = [...new Set(maps.filter(Boolean).flatMap((m) => Object.keys(m)))].sort();
    const eom = (k) => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
    const data = {
      d: keys.map(eom),
      k: ok,
      p: ok.map((t) => { const m = maps[TICKERS.indexOf(t)]; return keys.map((k) => (m[k] != null ? Math.round(m[k] * 100) / 100 : null)); }),
      updated: new Date().toISOString(),
      source: "yahoo",
    };
    // Cache di edge Vercel: 15 menit segar, lalu 1 jam boleh dipakai sambil diperbarui di belakang layar
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
