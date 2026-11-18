/** The 5–12 demo anchor's neighbourhood, shaped like the host route (G2c tests only). */
import type { MarbleNeighbourhood } from "../../gate/transport";

const node = (id: string, name: string, extra: Partial<MarbleNeighbourhood["anchor"]> = {}) => ({
  id, name, subject: "Computing", domain: "Artificial Intelligence", ageRangeStart: 5, ageRangeEnd: 8, evidence: [`${name} evidence`], ...extra,
});
// Ids and strengths from the pinned snapshot's real neighbourhood shape (ids from the pinned snapshot).
export const AI_DAILY: MarbleNeighbourhood = {
  anchor: node("mt_AzTrT5ySCx", "AI in Daily Life", { ageRangeEnd: 12, evidence: ["Identify at least five examples of AI in their daily life", "Explain that these technologies use patterns and data, not magic or real thinking"] }),
  prerequisites: [
    node("mt_WRRv1ABECC", "Smart Versus Not-Smart Devices", { strength: "hard", hops: 1, reason: "smart first" }),
    node("mt_u6SYiVx7FX", "Voice Assistants and How They Work", { strength: "soft", hops: 1, reason: "a familiar example" }),
    node("mt_XbGfVhfiUz", "Computers in Everyday Life", { strength: "hard", hops: 2 }),
    node("mt__p5n8z5soJ", "Step-by-Step Instructions", { strength: "soft", hops: 2 }),
  ],
  dependents: [node("mt_kH1DzOPsXG", "Data and Information for Computers", { strength: "soft", hops: 1, ageRangeEnd: 10 })],
  edges: [
    { from: "mt_WRRv1ABECC", to: "mt_AzTrT5ySCx", strength: "hard" },
    { from: "mt_u6SYiVx7FX", to: "mt_AzTrT5ySCx", strength: "soft" },
    { from: "mt_XbGfVhfiUz", to: "mt_WRRv1ABECC", strength: "hard" },
    { from: "mt_WRRv1ABECC", to: "mt_u6SYiVx7FX", strength: "hard" },
    { from: "mt__p5n8z5soJ", to: "mt_u6SYiVx7FX", strength: "soft" },
    { from: "mt_AzTrT5ySCx", to: "mt_kH1DzOPsXG", strength: "soft" },
  ],
};

