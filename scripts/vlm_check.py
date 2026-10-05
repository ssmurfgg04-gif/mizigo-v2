#!/usr/bin/env python3
"""VLM verification: screenshot + z-ai vision analysis with feature checklist."""
import subprocess, sys, argparse

p = argparse.ArgumentParser()
p.add_argument("--shot", required=True, help="path to screenshot (already taken)")
p.add_argument("--prompt", required=True, help="verification prompt")
p.add_argument("--extra", action="append", default=[], help="extra image paths")
args = p.parse_args()

cmd = ["z-ai", "vision", "-p", args.prompt, "-i", args.shot]
for e in args.extra:
    cmd += ["-i", e]

try:
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
    print(out.stdout)
    if out.returncode != 0:
        print("STDERR:", out.stderr[:2000], file=sys.stderr)
        sys.exit(1)
except subprocess.TimeoutExpired:
    print("VLM timeout", file=sys.stderr)
    sys.exit(1)
