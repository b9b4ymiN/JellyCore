import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import {
  applySqlitePragmaPolicy,
  SQLITE_PRAGMA_POLICY,
} from "../db/sqlite-policy";

const TEST_DIR = join(homedir(), ".oracle-v2");
const TEST_DB_PATH = join(TEST_DIR, "test-sqlite-policy.db");
const TEST_DB_WAL_PATH = `${TEST_DB_PATH}-wal`;
const TEST_DB_SHM_PATH = `${TEST_DB_PATH}-shm`;

let sqlite: Database;

function safeRemove(filePath: string): void {
  if (!existsSync(filePath)) return;
  try {
    rmSync(filePath, { force: true });
  } catch {
    // Windows can keep sqlite files locked briefly; test assertions already ran.
  }
}

describe("SQLite pragma policy", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    safeRemove(TEST_DB_SHM_PATH);
    safeRemove(TEST_DB_WAL_PATH);
    safeRemove(TEST_DB_PATH);
    sqlite = new Database(TEST_DB_PATH);
  });

  afterEach(() => {
    try {
      sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // best effort
    }
    sqlite.close();
    safeRemove(TEST_DB_SHM_PATH);
    safeRemove(TEST_DB_WAL_PATH);
    safeRemove(TEST_DB_PATH);
  });

  test("applies consistent pragma policy", () => {
    const snapshot = applySqlitePragmaPolicy(sqlite, "integration-test");

    expect(snapshot.journalMode).toBe(SQLITE_PRAGMA_POLICY.journalMode);
    expect(snapshot.busyTimeoutMs).toBe(SQLITE_PRAGMA_POLICY.busyTimeoutMs);
    expect(snapshot.synchronous).toBe(SQLITE_PRAGMA_POLICY.synchronous);
    expect(snapshot.cacheSize).toBe(SQLITE_PRAGMA_POLICY.cacheSize);
  });
});
