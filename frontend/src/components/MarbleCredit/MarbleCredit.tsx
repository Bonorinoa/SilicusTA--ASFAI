/**
 * MarbleCredit — the ONE upstream credit line for Marble content (G1bV gap, PM 14 Nov). Every studio
 * surface that shows Marble content renders this component; nobody copies the line. The licence texts
 * are reachable from the shipped app: ODbL 1.0 and CC BY-SA 4.0 link to their official texts, and the
 * attribution notice (host/data/marble/MARBLE-ATTRIBUTION.md, with the pinned upstream commit) is
 * shipped as a static asset of the build.
 */
import attributionUrl from "../../../../host/data/marble/MARBLE-ATTRIBUTION.md?url";

export const ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/";
export const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
export const MARBLE_ATTRIBUTION_URL: string = attributionUrl;

const ext = { target: "_blank", rel: "noreferrer" } as const;

export function MarbleCredit({ className, as: Tag = "p" }: { className?: string; as?: "p" | "span" }) {
  return (
    <Tag className={className} data-marble-credit="true">
      Marble Skill Taxonomy (v1) · © Generative Spark, Inc. (Marble) ·{" "}
      <a href="https://withmarble.com" {...ext}>https://withmarble.com</a> · licensed under{" "}
      <a href={ODBL_URL} {...ext} data-licence="odbl">ODbL 1.0</a> (database) and{" "}
      <a href={CC_BY_SA_URL} {...ext} data-licence="cc-by-sa">CC BY-SA 4.0</a> (content) ·{" "}
      <a href={MARBLE_ATTRIBUTION_URL} {...ext} data-licence="attribution">attribution notice</a>.
    </Tag>
  );
}
