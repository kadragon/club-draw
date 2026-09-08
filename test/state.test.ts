import { describe, expect, it } from "vitest";
import { canDeleteParticipant } from "../src/state.js";
import type { Participant, Prize } from "../src/types.js";

const p = (id: string, over: Partial<Participant> = {}): Participant => ({
  id,
  name: id,
  cumulativeWins: 0,
  excluded: false,
  ...over,
});

describe("canDeleteParticipant", () => {
  it("allows deleting a participant who has not won this session", () => {
    const participants = [p("a"), p("b")];
    const prizes: Prize[] = [{ id: "z1", name: "gift" }];
    expect(canDeleteParticipant({ participants, prizes }, "a")).toBe(true);
  });

  it("blocks a participant flagged excluded (session winner)", () => {
    const participants = [p("a", { excluded: true })];
    expect(canDeleteParticipant({ participants, prizes: [] }, "a")).toBe(false);
  });

  it("blocks a participant referenced by a drawn prize even if excluded was cleared", () => {
    const participants = [p("a")];
    const prizes: Prize[] = [{ id: "z1", name: "gift", drawn: true, winnerId: "a" }];
    expect(canDeleteParticipant({ participants, prizes }, "a")).toBe(false);
  });

  it("does not block a bystander when someone else won", () => {
    const participants = [p("a", { excluded: true }), p("b")];
    const prizes: Prize[] = [{ id: "z1", name: "gift", drawn: true, winnerId: "a" }];
    expect(canDeleteParticipant({ participants, prizes }, "b")).toBe(true);
  });

  it("allows deleting an unknown id (already gone — nothing to protect)", () => {
    expect(canDeleteParticipant({ participants: [], prizes: [] }, "ghost")).toBe(true);
  });
});
