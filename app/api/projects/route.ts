import { NextResponse } from "next/server";
import { Pool } from "pg";

type ProjectStoreRow = {
  payload: unknown;
  updated_at: string | number;
};

const storeId = "default";
const legacyBackupStoreId = "default-legacy-before-namespaces";

declare global {
  var revealsProjectPool: Pool | undefined;
}

const getPool = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  globalThis.revealsProjectPool ??= new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });

  return globalThis.revealsProjectPool;
};

const ensureSchema = async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reveal_project_store (
      id text PRIMARY KEY,
      payload jsonb NOT NULL,
      updated_at bigint NOT NULL,
      saved_at timestamptz NOT NULL DEFAULT now()
    )
  `);
};

export async function GET() {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ configured: false, projects: null, updatedAt: 0 });
  }

  await ensureSchema(pool);
  const result = await pool.query<ProjectStoreRow>(
    "SELECT payload, updated_at FROM reveal_project_store WHERE id = $1",
    [storeId],
  );
  const row = result.rows[0];

  return NextResponse.json({
    configured: true,
    workspace: row && !Array.isArray(row.payload) && typeof row.payload === "object" ? row.payload : null,
    projects: row && Array.isArray(row.payload) ? row.payload : null,
    updatedAt: row ? Number(row.updated_at) : 0,
  });
}

export async function PUT(request: Request) {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ configured: false, saved: false });
  }

  const body = await request.json() as { projects?: unknown; workspace?: unknown; updatedAt?: unknown };
  const payload = body.workspace ?? body.projects;
  const isValidWorkspace =
    payload &&
    !Array.isArray(payload) &&
    typeof payload === "object" &&
    Array.isArray((payload as { namespaces?: unknown }).namespaces);
  const isValidLegacyProjects = Array.isArray(payload);
  if (!isValidWorkspace && !isValidLegacyProjects) {
    return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
  }

  const updatedAt = typeof body.updatedAt === "number" ? body.updatedAt : Date.now();
  await ensureSchema(pool);
  if (isValidWorkspace) {
    await pool.query(
      `
        INSERT INTO reveal_project_store (id, payload, updated_at, saved_at)
        SELECT $1, payload, updated_at, saved_at
        FROM reveal_project_store
        WHERE id = $2 AND jsonb_typeof(payload) = 'array'
        ON CONFLICT (id) DO NOTHING
      `,
      [legacyBackupStoreId, storeId],
    );
  }
  await pool.query(
    `
      INSERT INTO reveal_project_store (id, payload, updated_at, saved_at)
      VALUES ($1, $2::jsonb, $3, now())
      ON CONFLICT (id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at, saved_at = now()
    `,
    [storeId, JSON.stringify(payload), updatedAt],
  );

  return NextResponse.json({ configured: true, saved: true, updatedAt });
}
