import { Client } from "pg";
const url = process.env.SUPA_URL;
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const t = await c.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename");
console.log("TABLES:", t.rows.map(r => r.tablename).join(", ") || "(none)");
const counts = await c.query("SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname");
console.log("ROW ESTIMATES:", counts.rows.map(r => `${r.relname}=${r.n_live_tup}`).join(" ") || "(none)");
await c.end();
