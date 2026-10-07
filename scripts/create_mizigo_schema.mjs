import { Client } from "pg";
const c = new Client({ connectionString: process.env.SUPA_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("CREATE SCHEMA IF NOT EXISTS mizigo");
console.log("schema mizigo ready");
await c.end();
