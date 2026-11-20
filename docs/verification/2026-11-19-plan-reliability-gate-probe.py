#!/usr/bin/env python3
"""Reproduce the PRV clean-archive gate and destructive mutations.

Default mode is deterministic. Pass --live to repeat the four paid calls; the
credential path is forwarded to the repository's launcher and is never opened
by this probe.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

CANDIDATE = "9c861270143ebf1e886612344bc2d2b741d0cedf"
NODE = Path("/Users/bonorinoa/.local/bin/node")
SELECTED = (
    "stage-4-wide",
    "many-sources-stage-2",
    "fifty-objectives-stage-3",
    "stage-3-boundary",
)


def checked_replace(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"expected one mutation target in {path}")
    path.write_text(text.replace(old, new))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", default=CANDIDATE)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--env-file", default=str(Path.home() / ".silicus" / "worker.env"))
    parser.add_argument("--keep", action="store_true", help="keep scratch tree and logs")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    scratch_root = Path.home() / ".hermes" / "profiles" / "verifier" / "cache" / "scratch"
    scratch_root.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix="prv-plan-reliability-", dir=scratch_root))
    logs = scratch / "logs"
    logs.mkdir()
    results: dict[str, int | str | dict] = {"candidate": args.candidate, "scratch": str(scratch)}

    def run(name: str, command: list[str], cwd: Path, expected: int = 0, env: dict[str, str] | None = None) -> int:
        with (logs / f"{name}.log").open("w") as out:
            completed = subprocess.run(command, cwd=cwd, env=env, stdout=out, stderr=subprocess.STDOUT, check=False)
        results[name] = completed.returncode
        print(f"{name} exit={completed.returncode} expected={expected}")
        if completed.returncode != expected:
            raise RuntimeError(f"{name}: exit {completed.returncode}, expected {expected}; see {logs / (name + '.log')}")
        return completed.returncode

    def export(name: str) -> Path:
        tree = scratch / name
        tree.mkdir()
        run(f"archive-{name}", ["git", "archive", "--format=tar", "-o", str(scratch / f"{name}.tar"), args.candidate], root)
        run(f"extract-{name}", ["tar", "-xf", str(scratch / f"{name}.tar"), "-C", str(tree)], root)
        return tree

    try:
        tree = export("tree")
        run("npm-ci", ["npm", "ci"], tree / "frontend")
        suites = (
            ("confirm-gate", [str(NODE), "--test"], tree / "confirm-gate"),
            ("api", [str(NODE), "--test", "api/test/"], tree),
            ("host", [str(NODE), "--test"], tree / "host"),
            ("host-e2e", [str(NODE), "scripts/e2e-restart.mjs"], tree / "host"),
            ("frontend", ["npm", "test"], tree / "frontend"),
            ("frontend-build", ["npm", "run", "build"], tree / "frontend"),
            ("browser-mode-smoke", [str(NODE), "frontend/scripts/browser-mode-smoke.mjs"], tree),
            ("studio-smoke", [str(NODE), "frontend/scripts/studio-smoke.mjs"], tree),
            ("live-host-smoke", [str(NODE), "frontend/scripts/live-host-smoke.mjs"], tree),
            ("narrow-shell", [str(NODE), "frontend/scripts/narrow-shell.mjs"], tree),
            ("plan-reliability", [str(NODE), "--test", "eval/plan-reliability/run.test.mjs"], tree),
        )
        for name, command, cwd in suites:
            run(name, command, cwd)

        reasoning = export("reasoning-low")
        checked_replace(
            reasoning / "host/worker-config.mjs",
            'answer_adult: "low", plan: "off"',
            'answer_adult: "low", plan: "low"',
        )
        run("mutation-reasoning-host", [str(NODE), "--test", "test/worker.test.mjs", "test/n1-waits.test.mjs"], reasoning / "host", expected=1)
        run("mutation-reasoning-api", [str(NODE), "--test", "api/test/worker.test.mjs"], reasoning, expected=1)

        age = export("age-from-plan")
        (age / "frontend/node_modules").symlink_to(tree / "frontend/node_modules", target_is_directory=True)
        checked_replace(
            age / "frontend/src/components/PlanCard/PlanCard.tsx",
            '{courseAges ? <><span>{AUDIENCE_BAND_LABEL} {courseAges.min}–{courseAges.max}</span><span className={styles.metaDot}> · </span></> : null}',
            '{plan.audience?.ageRangeStart !== undefined ? <><span>{AUDIENCE_BAND_LABEL} {plan.audience.ageRangeStart}{plan.audience.ageRangeEnd !== undefined ? `–${plan.audience.ageRangeEnd}` : `+`}</span><span className={styles.metaDot}> · </span></> : null}',
        )
        checked_replace(
            age / "frontend/src/live/handout.ts",
            'const ages = courseAges\n    ? `<p class="meta">Ages ${esc(courseAges.min)}–${esc(courseAges.max)}</p>` : "";',
            'const audience = version.lessonPlan?.audience;\n  const ages = audience?.ageRangeStart !== undefined\n    ? `<p class="meta">Ages ${esc(audience.ageRangeStart)}${audience.ageRangeEnd !== undefined ? `–${esc(audience.ageRangeEnd)}` : `+`}</p>` : "";',
        )
        run(
            "mutation-age",
            ["npm", "test", "--", "src/components/PlanCard/PlanCard.test.tsx", "src/live/handout.test.ts"],
            age / "frontend",
            expected=1,
        )

        truncation = export("always-truncated")
        checked_replace(
            truncation / "eval/plan-reliability/run.mjs",
            'if (fixture.id === "short-stage-1" && calls === 1) throw RETRYABLE("WORKER_TRUNCATED");',
            'if (fixture.id === "short-stage-1") throw RETRYABLE("WORKER_TRUNCATED");',
        )
        run("mutation-truncation", [str(NODE), "--test", "eval/plan-reliability/run.test.mjs"], truncation, expected=1)

        if args.live:
            env_file = Path(args.env_file)
            if not env_file.is_file():
                raise RuntimeError(f"credential file is absent: {env_file}")
            live_script = tree / "eval/plan-reliability/run-four-verifier.mjs"
            source = (tree / "eval/plan-reliability/run.mjs").read_text()
            selected = json.dumps(list(SELECTED))
            source = source.replace(
                'const RETRYABLE = (code) => Object.assign(new Error(`scripted ${code}`), { code });',
                'const RETRYABLE = (code) => Object.assign(new Error(`scripted ${code}`), { code });\n'
                f"const LIVE_FIXTURES = FIXTURES.filter((f) => new Set({selected}).has(f.id));",
            )
            source = source.replace(
                "for (const fixture of FIXTURES) fixtures.push(await liveFixture(origin, fixture));",
                "for (const fixture of LIVE_FIXTURES) fixtures.push(await liveFixture(origin, fixture));",
            )
            source = source.replace("total: FIXTURES.length, finished, fixtures,\n      p50Ms", "total: LIVE_FIXTURES.length, finished, fixtures,\n      p50Ms")
            source = source.replace(
                "budgetUsd: 0.30,\n      target: { finish: finished === FIXTURES.length, p95Under75s: times.length === FIXTURES.length",
                "budgetUsd: 0.15,\n      target: { finish: finished === LIVE_FIXTURES.length, p95Under75s: times.length === LIVE_FIXTURES.length",
            )
            if "LIVE_FIXTURES.length" not in source or "budgetUsd: 0.15" not in source:
                raise RuntimeError("live runner mutation did not land")
            live_script.write_text(source)
            env = os.environ.copy()
            env["SILICUS_WORKER_ENV_FILE"] = str(env_file)
            run("live-four", [str(NODE), str(live_script), "--live", "--out", str(logs / "live-four.json")], tree, env=env)

        (logs / "summary.json").write_text(json.dumps(results, indent=2) + "\n")
        print(f"PASS logs={logs}")
        return 0
    finally:
        if not args.keep:
            shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
