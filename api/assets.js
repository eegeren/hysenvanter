import { Pool } from "pg";
import { randomUUID } from "node:crypto";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      tur TEXT NOT NULL,
      model TEXT NOT NULL,
      seri TEXT NOT NULL,
      atanan TEXT,
      departman TEXT,
      durum TEXT,
      konum TEXT,
      tarih DATE,
      not TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function requireAdmin(req, res) {
  const pass = String(req.headers["x-admin-password"] || "").trim();
  if (!process.env.ADMIN_PASSWORD || pass !== process.env.ADMIN_PASSWORD) {
    send(res, 401, { error: "Yetkisiz işlem." });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  try {
    await ensureTable();

    if (req.method === "GET") {
      const { rows } = await pool.query(
        `SELECT * FROM assets
         ORDER BY (tarih IS NULL), tarih DESC, updated_at DESC`
      );
      return send(res, 200, rows);
    }

    let body = {};
    try {
      body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    } catch {}

    if (req.method === "POST") {
      if (!requireAdmin(req, res)) return;

      const id = (body.id || "").trim() || randomUUID();
      const tur = (body.tur || "").trim();
      const model = (body.model || "").trim();
      const seri = (body.seri || "").trim();
      if (!tur || !model || !seri) return send(res, 400, { error: "tur/model/seri zorunlu." });

      const atanan = (body.atanan || "").trim();
      const departman = (body.departman || "").trim();
      const durum = (body.durum || "").trim();
      const konum = (body.konum || "").trim();
      const tarih = body.tarih || null;
      const nott = (body.not || "").trim();

      const { rows } = await pool.query(
        `INSERT INTO assets (id,tur,model,seri,atanan,departman,durum,konum,tarih,not)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           tur=EXCLUDED.tur,
           model=EXCLUDED.model,
           seri=EXCLUDED.seri,
           atanan=EXCLUDED.atanan,
           departman=EXCLUDED.departman,
           durum=EXCLUDED.durum,
           konum=EXCLUDED.konum,
           tarih=EXCLUDED.tarih,
           not=EXCLUDED.not,
           updated_at=NOW()
         RETURNING *`,
        [id, tur, model, seri, atanan, departman, durum, konum, tarih, nott]
      );

      return send(res, 200, rows[0]);
    }

    if (req.method === "DELETE") {
      if (!requireAdmin(req, res)) return;

      const id = String(req.query?.id || body.id || "").trim();
      if (!id) return send(res, 400, { error: "id gerekli." });

      await pool.query(`DELETE FROM assets WHERE id=$1`, [id]);
      return send(res, 200, { ok: true });
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  } catch (e) {
    return send(res, 500, { error: "Server error", detail: String(e?.message || e) });
  }
}
