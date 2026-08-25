#!/usr/bin/env python3
"""Strict DXF validation for the export tests.

Parses the file with ezdxf exactly the way a CAD consumer would: a strict
readfile (raises on a malformed file), a full audit (fails on any error the
auditor cannot silently fix), and a check that every INSERT resolves to a
defined block. Run: python3 validate-dxf.py <file.dxf>
"""
import sys

try:
    import ezdxf
except ImportError:
    print("MISSING_EZDXF: install with `pip install ezdxf` — the DXF export "
          "test cannot pass without real parser validation.", file=sys.stderr)
    sys.exit(3)

path = sys.argv[1]
try:
    doc = ezdxf.readfile(path)
except Exception as exc:  # noqa: BLE001 — any parse failure is a test failure
    print(f"PARSE_FAILED: {exc}", file=sys.stderr)
    sys.exit(2)

auditor = doc.audit()
if auditor.errors:
    print("AUDIT_ERRORS:", file=sys.stderr)
    for err in auditor.errors:
        print(f"  {err}", file=sys.stderr)
    sys.exit(2)

msp = doc.modelspace()
inserts = msp.query("INSERT")
for ent in inserts:
    if ent.dxf.name not in doc.blocks:
        print(f"ORPHAN_INSERT: {ent.dxf.name}", file=sys.stderr)
        sys.exit(2)

print(f"OK layers={len(doc.layers)} entities={len(msp)} inserts={len(inserts)}")
