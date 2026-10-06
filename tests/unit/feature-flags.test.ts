// feature-flags unit tests — DEMO_AUTO_PROGRESS default + override logic
// (task 10-E). Defaults: sandbox (SQLite / no URL) ON, Postgres production OFF;
// explicit env always wins.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isDemoAutoProgress, dbIsPostgres, featureFlags } from "../../src/lib/feature-flags";

const ENV_KEYS = ["DATABASE_URL", "DEMO_AUTO_PROGRESS"] as const;

describe("feature flags", () => {
  const original: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  describe("dbIsPostgres", () => {
    it("detects postgres:// and postgresql:// URLs", () => {
      process.env.DATABASE_URL = "postgres://user:pw@host:5432/db";
      expect(dbIsPostgres()).toBe(true);
      process.env.DATABASE_URL = "postgresql://user:pw@host/db";
      expect(dbIsPostgres()).toBe(true);
    });

    it("treats sqlite/none as sandbox", () => {
      process.env.DATABASE_URL = "file:/tmp/mizigo.db";
      expect(dbIsPostgres()).toBe(false);
      delete process.env.DATABASE_URL;
      expect(dbIsPostgres()).toBe(false);
    });
  });

  describe("isDemoAutoProgress", () => {
    it("defaults ON in the SQLite sandbox (live demo unchanged)", () => {
      process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";
      delete process.env.DEMO_AUTO_PROGRESS;
      expect(isDemoAutoProgress()).toBe(true);
    });

    it("defaults ON when DATABASE_URL is unset (serverless sandbox shim)", () => {
      delete process.env.DATABASE_URL;
      delete process.env.DEMO_AUTO_PROGRESS;
      expect(isDemoAutoProgress()).toBe(true);
    });

    it("defaults OFF in Postgres production mode", () => {
      process.env.DATABASE_URL = "postgresql://user:pw@host/db";
      delete process.env.DEMO_AUTO_PROGRESS;
      expect(isDemoAutoProgress()).toBe(false);
    });

    it("explicit env override wins in BOTH modes", () => {
      process.env.DATABASE_URL = "file:/tmp/mizigo.db";
      process.env.DEMO_AUTO_PROGRESS = "false";
      expect(isDemoAutoProgress()).toBe(false);

      process.env.DATABASE_URL = "postgresql://host/db";
      process.env.DEMO_AUTO_PROGRESS = "true";
      expect(isDemoAutoProgress()).toBe(true);
    });

    it("accepts 0/off and 1/on spellings", () => {
      process.env.DATABASE_URL = "file:/tmp/x.db";
      for (const off of ["false", "0", "off", "FALSE", " Off "]) {
        process.env.DEMO_AUTO_PROGRESS = off;
        expect(isDemoAutoProgress()).toBe(false);
      }
      process.env.DATABASE_URL = "postgresql://host/db";
      for (const on of ["true", "1", "on", "TRUE"]) {
        process.env.DEMO_AUTO_PROGRESS = on;
        expect(isDemoAutoProgress()).toBe(true);
      }
    });
  });

  it("featureFlags() exposes the flag", () => {
    process.env.DATABASE_URL = "file:/tmp/x.db";
    delete process.env.DEMO_AUTO_PROGRESS;
    expect(featureFlags()).toEqual({ demoAutoProgress: true });
  });
});
