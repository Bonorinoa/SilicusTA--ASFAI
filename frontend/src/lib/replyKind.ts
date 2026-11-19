/**
 * replyKind.ts — K3: which kind of reply the student helper gave. A pure helper kept out of gate/transport so
 * the many tests that mock the transport module do not have to re-export it.
 */
import type { StudentAnswer, StudentReplyKind } from "../gate/transport";

/** The reply kind, reading a pre-K3 host's answer from `grounded` and `refusal`. */
export const replyKindOf = (a: Pick<StudentAnswer, "kind" | "grounded" | "refusal">): StudentReplyKind =>
  a.kind ?? (a.grounded ? "answer" : a.refusal === "assessment" ? "assessment" : "off_topic");
