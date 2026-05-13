import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "..", ".local-data");
const dataFile = path.join(dataDir, "assets.json");
const hasDatabase = Boolean(process.env.POSTGRES_URL);
const pool = hasDatabase ? new Pool({ connectionString: process.env.POSTGRES_URL }) : null;

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function ensureTable() {
  if (!pool) return;

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
      "not" TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function readLocalAssets() {
  try {
    const raw = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLocalAssets(items) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(items, null, 2), "utf8");
}

function sortAssets(items) {
  return [...items].sort((a, b) => {
    const aDate = a.tarih || "";
    const bDate = b.tarih || "";

    if (!aDate && bDate) return 1;
    if (aDate && !bDate) return -1;
    if (aDate !== bDate) return bDate.localeCompare(aDate);

    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
}

function requireAdmin(req, res) {
  const pass = decodeURIComponent(String(req.headers["x-admin-password"] || "")).trim();
  const expected = String(process.env.ADMIN_PASSWORD || "admin").trim();

  if (!expected || pass !== expected) {
    send(res, 401, { error: "Yetkisiz islem." });
    return false;
  }

  return true;
}

function normalizeAsset(item) {
  const normalized = {
    id: (item.id || "").trim() || randomUUID(),
    tur: (item.tur || "").trim(),
    model: (item.model || "").trim(),
    seri: (item.seri || "").trim(),
    atanan: (item.atanan || "").trim(),
    departman: (item.departman || "").trim(),
    durum: (item.durum || "").trim(),
    konum: (item.konum || "").trim(),
    tarih: item.tarih || null,
    not: (item.not || "").trim(),
    updated_at: new Date().toISOString()
  };

  if (!normalized.tur || !normalized.model || !normalized.seri) {
    throw new Error("tur/model/seri zorunlu.");
  }

  return normalized;
}

export default async function handler(req, res) {
  try {
    await ensureTable();

    if (req.method === "GET") {
      if (!pool) {
        return send(res, 200, sortAssets(await readLocalAssets()));
      }

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

      const items = Array.isArray(body) ? body : [body];
      const normalizedItems = items.map(normalizeAsset);

      if (!pool) {
        const existing = await readLocalAssets();
        const merged = new Map(existing.map((item) => [item.id, item]));

        for (const item of normalizedItems) {
          merged.set(item.id, { ...merged.get(item.id), ...item });
        }

        const saved = sortAssets([...merged.values()]);
        await writeLocalAssets(saved);
        return send(res, 200, Array.isArray(body) ? saved : normalizedItems[0]);
      }

      let lastRow = null;
      for (const item of normalizedItems) {
        const { rows } = await pool.query(
          `INSERT INTO assets (id,tur,model,seri,atanan,departman,durum,konum,tarih,"not")
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
             "not"=EXCLUDED."not",
             updated_at=NOW()
           RETURNING *`,
          [
            item.id,
            item.tur,
            item.model,
            item.seri,
            item.atanan,
            item.departman,
            item.durum,
            item.konum,
            item.tarih,
            item.not
          ]
        );

        lastRow = rows[0];
      }

      return send(res, 200, Array.isArray(body) ? { ok: true } : lastRow);
    }

    if (req.method === "DELETE") {
      if (!requireAdmin(req, res)) return;

      const bulkIds = Array.isArray(body.ids)
        ? [...new Set(body.ids.map((x) => String(x || "").trim()).filter(Boolean))]
        : [];

      if (bulkIds.length > 0) {
        if (!pool) {
          const existing = await readLocalAssets();
          const remove = new Set(bulkIds);
          await writeLocalAssets(existing.filter((item) => !remove.has(item.id)));
          return send(res, 200, { ok: true, deleted: bulkIds.length });
        }

        await pool.query(`DELETE FROM assets WHERE id = ANY($1::text[])`, [bulkIds]);
        return send(res, 200, { ok: true, deleted: bulkIds.length });
      }

      const id = String(req.query?.id || body.id || "").trim();

      if (!pool) {
        if (!id) {
          await writeLocalAssets([]);
          return send(res, 200, { ok: true });
        }

        const existing = await readLocalAssets();
        await writeLocalAssets(existing.filter((item) => item.id !== id));
        return send(res, 200, { ok: true });
      }

      if (!id) {
        await pool.query(`DELETE FROM assets`);
        return send(res, 200, { ok: true });
      }

      await pool.query(`DELETE FROM assets WHERE id=$1`, [id]);
      return send(res, 200, { ok: true });
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  } catch (e) {
    return send(res, 500, { error: "Server error", detail: String(e?.message || e) });
  }
}
