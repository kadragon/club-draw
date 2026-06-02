import { describe, expect, it } from "vitest";
import { mergeSessionWins, parseRoster, participantsToCSV, recordsToCSV } from "../src/csv.js";
import type { DrawRecord, Participant } from "../src/types.js";

describe("parseRoster", () => {
  it("parses name-only and name,cumulative lines", () => {
    expect(parseRoster("Alice\nBob,2\nCarol, 3")).toEqual([
      { name: "Alice", cumulativeWins: 0 },
      { name: "Bob", cumulativeWins: 2 },
      { name: "Carol", cumulativeWins: 3 },
    ]);
  });

  it("skips blank lines and trims whitespace", () => {
    expect(parseRoster("  Alice  \n\n   \n Bob , 1 ")).toEqual([
      { name: "Alice", cumulativeWins: 0 },
      { name: "Bob", cumulativeWins: 1 },
    ]);
  });

  it("ignores a leading header row", () => {
    expect(parseRoster("name,cumulativeWins\nAlice,1")).toEqual([
      { name: "Alice", cumulativeWins: 1 },
    ]);
  });

  it("defaults non-numeric or negative cumulative to 0", () => {
    expect(parseRoster("Alice,foo\nBob,-4")).toEqual([
      { name: "Alice", cumulativeWins: 0 },
      { name: "Bob", cumulativeWins: 0 },
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseRoster("Alice,1\r\nBob,2")).toEqual([
      { name: "Alice", cumulativeWins: 1 },
      { name: "Bob", cumulativeWins: 2 },
    ]);
  });
});

describe("CSV roundtrip", () => {
  const participants: Participant[] = [
    { id: "1", name: "Alice", cumulativeWins: 0 },
    { id: "2", name: "Bob, Jr.", cumulativeWins: 3 }, // comma forces quoting
    { id: "3", name: 'Eve "the win"', cumulativeWins: 1 }, // quote escaping
  ];

  it("participantsToCSV -> parseRoster preserves name and cumulative", () => {
    const csv = participantsToCSV(participants);
    const back = parseRoster(csv);
    expect(back).toEqual(
      participants.map((p) => ({ name: p.name, cumulativeWins: p.cumulativeWins })),
    );
  });

  it("quotes fields containing commas", () => {
    const csv = participantsToCSV(participants);
    expect(csv).toContain('"Bob, Jr.",3');
  });

  it("roundtrips a name containing an embedded newline", () => {
    const ps: Participant[] = [{ id: "1", name: "Alice\nBob", cumulativeWins: 2 }];
    expect(parseRoster(participantsToCSV(ps))).toEqual([{ name: "Alice\nBob", cumulativeWins: 2 }]);
  });
});

describe("CSV formula injection (export hardening)", () => {
  it("prefixes a guard apostrophe on export and reverses it on import", () => {
    const ps: Participant[] = [{ id: "1", name: "=SUM(A1)", cumulativeWins: 0 }];
    const csv = participantsToCSV(ps);
    expect(csv).toContain("'=SUM(A1)");
    expect(parseRoster(csv)).toEqual([{ name: "=SUM(A1)", cumulativeWins: 0 }]);
  });

  it("guards record export fields starting with = + - @", () => {
    const csv = recordsToCSV([{ prize: "@cmd", winner: "-2+3", at: "2026-01-01" }]);
    expect(csv.split("\n")[1]).toBe("'@cmd,'-2+3,2026-01-01");
  });

  it("leaves a legitimate apostrophe name untouched", () => {
    const ps: Participant[] = [{ id: "1", name: "'tis Bob", cumulativeWins: 0 }];
    expect(parseRoster(participantsToCSV(ps))).toEqual([{ name: "'tis Bob", cumulativeWins: 0 }]);
  });
});

describe("recordsToCSV", () => {
  it("emits a header and one row per record", () => {
    const records: DrawRecord[] = [
      { prize: "1st", winner: "Alice", at: "2026-06-02T00:00:00.000Z" },
      { prize: "2nd, special", winner: "Bob", at: "2026-06-02T00:01:00.000Z" },
    ];
    const csv = recordsToCSV(records);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("prize,winner,at");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('"2nd, special",Bob,2026-06-02T00:01:00.000Z');
  });
});

describe("mergeSessionWins", () => {
  const participants: Participant[] = [
    { id: "1", name: "Alice", cumulativeWins: 2 },
    { id: "2", name: "Bob", cumulativeWins: 0 },
    { id: "3", name: "Carol", cumulativeWins: 1 },
  ];
  const rec = (winner: string): DrawRecord => ({ prize: "p", winner, at: "2026-06-02" });

  it("adds session wins to matching participant by name", () => {
    const merged = mergeSessionWins(participants, [rec("Alice")]);
    expect(merged.find((p) => p.name === "Alice")?.cumulativeWins).toBe(3);
  });

  it("accumulates multiple wins for the same person", () => {
    const merged = mergeSessionWins(participants, [rec("Bob"), rec("Bob"), rec("Bob")]);
    expect(merged.find((p) => p.name === "Bob")?.cumulativeWins).toBe(3);
  });

  it("keeps existing cumulative for participants with no session wins", () => {
    const merged = mergeSessionWins(participants, [rec("Alice")]);
    expect(merged.find((p) => p.name === "Carol")?.cumulativeWins).toBe(1);
  });

  it("does not mutate the input participants", () => {
    mergeSessionWins(participants, [rec("Alice"), rec("Bob")]);
    expect(participants.map((p) => p.cumulativeWins)).toEqual([2, 0, 1]);
  });

  it("ignores records whose winner matches no participant", () => {
    const merged = mergeSessionWins(participants, [rec("Unknown")]);
    expect(merged.map((p) => p.cumulativeWins)).toEqual([2, 0, 1]);
  });

  it("credits only the winning participant when names collide (by winnerId)", () => {
    const dupes: Participant[] = [
      { id: "a", name: "Bob", cumulativeWins: 0 },
      { id: "b", name: "Bob", cumulativeWins: 0 },
    ];
    const recId = (winnerId: string, winner: string): DrawRecord => ({
      prize: "p",
      winner,
      winnerId,
      at: "2026-06-02",
    });
    const merged = mergeSessionWins(dupes, [recId("a", "Bob")]);
    expect(merged.find((p) => p.id === "a")?.cumulativeWins).toBe(1);
    expect(merged.find((p) => p.id === "b")?.cumulativeWins).toBe(0);
  });
});
