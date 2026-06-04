import { describe, expect, it } from "vitest";
import { type BackupData, backupFilename, decodeBackup, encodeBackup } from "../src/csv.js";

// Minimal AppState-like input for encodeBackup (only needs participants + prizes)
const SAMPLE_STATE = {
  participants: [
    { id: "id-1", name: "홍길동", cumulativeWins: 2, excluded: false },
    { id: "id-2", name: "=formula", cumulativeWins: 0, excluded: true },
    { id: "id-3", name: "Kim", cumulativeWins: 5, excluded: false },
  ],
  prizes: [
    { id: "z-1", name: "1등 상품", drawn: true, winnerId: "id-1" },
    { id: "z-2", name: "2등 상품" },
  ],
};

describe("encodeBackup / decodeBackup round-trip", () => {
  it("round-trips participants and prizes (Korean names)", () => {
    const token = encodeBackup(SAMPLE_STATE);
    const data = decodeBackup(token);
    expect(data.participants).toEqual([
      { name: "홍길동", cumulativeWins: 2 },
      { name: "=formula", cumulativeWins: 0 },
      { name: "Kim", cumulativeWins: 5 },
    ]);
    expect(data.prizes).toEqual([{ name: "1등 상품" }, { name: "2등 상품" }]);
  });

  it("encodeBackup strips id, excluded, drawn, winnerId", () => {
    const token = encodeBackup(SAMPLE_STATE);
    // Peek inside the token without going through decodeBackup's validation
    const raw = new TextDecoder().decode(Uint8Array.from(atob(token), (c) => c.charCodeAt(0)));
    const parsed = JSON.parse(raw) as BackupData & {
      participants: Array<Record<string, unknown>>;
      prizes: Array<Record<string, unknown>>;
    };
    for (const p of parsed.participants) {
      expect("id" in p).toBe(false);
      expect("excluded" in p).toBe(false);
    }
    for (const z of parsed.prizes) {
      expect("id" in z).toBe(false);
      expect("drawn" in z).toBe(false);
      expect("winnerId" in z).toBe(false);
    }
  });

  it("produces a single-line opaque token (no newlines)", () => {
    const token = encodeBackup(SAMPLE_STATE);
    expect(token).not.toContain("\n");
    expect(token).not.toContain("\r");
  });
});

describe("decodeBackup — cumulativeWins clamping", () => {
  function makeToken(participants: unknown[], prizes: unknown[] = []): string {
    const json = JSON.stringify({ participants, prizes });
    const bytes = new TextEncoder().encode(json);
    let latin1 = "";
    for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]!);
    return btoa(latin1);
  }

  it("clamps negative cumulativeWins to 0", () => {
    const token = makeToken([{ name: "홍길동", cumulativeWins: -3 }]);
    const { participants } = decodeBackup(token);
    expect(participants[0]?.cumulativeWins).toBe(0);
  });

  it("floors fractional cumulativeWins", () => {
    const token = makeToken([{ name: "A", cumulativeWins: 2.9 }]);
    const { participants } = decodeBackup(token);
    expect(participants[0]?.cumulativeWins).toBe(2);
  });

  it("defaults missing/NaN cumulativeWins to 0", () => {
    const token = makeToken([{ name: "A" }, { name: "B", cumulativeWins: "bad" }]);
    const { participants } = decodeBackup(token);
    expect(participants[0]?.cumulativeWins).toBe(0);
    expect(participants[1]?.cumulativeWins).toBe(0);
  });
});

describe("decodeBackup — filtering blank names", () => {
  function makeToken(participants: unknown[], prizes: unknown[] = []): string {
    const json = JSON.stringify({ participants, prizes });
    const bytes = new TextEncoder().encode(json);
    let latin1 = "";
    for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]!);
    return btoa(latin1);
  }

  it("filters participants with blank or whitespace-only names", () => {
    const token = makeToken([
      { name: "", cumulativeWins: 0 },
      { name: "   ", cumulativeWins: 0 },
      { name: "Valid", cumulativeWins: 0 },
    ]);
    const { participants } = decodeBackup(token);
    expect(participants).toHaveLength(1);
    expect(participants[0]?.name).toBe("Valid");
  });

  it("filters prizes with blank or whitespace-only names", () => {
    const token = makeToken([], [{ name: "" }, { name: "  " }, { name: "Gift" }]);
    const { prizes } = decodeBackup(token);
    expect(prizes).toHaveLength(1);
    expect(prizes[0]?.name).toBe("Gift");
  });
});

describe("decodeBackup — whitespace tolerance (paste gotcha)", () => {
  it("tolerates leading/trailing whitespace around the token", () => {
    const token = encodeBackup(SAMPLE_STATE);
    expect(() => decodeBackup(`  ${token}  `)).not.toThrow();
    expect(() => decodeBackup(`\n${token}\n`)).not.toThrow();
  });
});

describe("decodeBackup — malformed input throws", () => {
  it("throws on non-base64 string", () => {
    expect(() => decodeBackup("not-base64!!!")).toThrow();
  });

  it("throws on base64-of-non-JSON", () => {
    const bytes = new TextEncoder().encode("hello world");
    let latin1 = "";
    for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]!);
    expect(() => decodeBackup(btoa(latin1))).toThrow();
  });

  it("throws on base64-of-JSON-array (not object)", () => {
    const bytes = new TextEncoder().encode("[1,2,3]");
    let latin1 = "";
    for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]!);
    expect(() => decodeBackup(btoa(latin1))).toThrow();
  });

  it("throws on base64-of-null", () => {
    const bytes = new TextEncoder().encode("null");
    let latin1 = "";
    for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]!);
    expect(() => decodeBackup(btoa(latin1))).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => decodeBackup("")).toThrow();
  });
});

describe("backupFilename", () => {
  it("produces YYYY-MM-DD filename from a fixed date", () => {
    const d = new Date(2026, 5, 4); // June 4, 2026 (local time)
    expect(backupFilename(d)).toBe("club-draw-backup-2026-06-04.txt");
  });

  it("zero-pads month and day", () => {
    const d = new Date(2025, 0, 9); // Jan 9, 2025
    expect(backupFilename(d)).toBe("club-draw-backup-2025-01-09.txt");
  });
});
