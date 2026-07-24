#!/usr/bin/env python3
"""
Convert AgriSense_Verified_1000.csv → src/lib/kb/verified_facts.ts

Each CSV row becomes one retrievable chunk with:
- id, crop, category, factName, value, unit, context
- sourceInstitution, sourceTitle, sourceUrl
- searchableText (the text the TF-IDF retriever indexes)

Output: a TypeScript file exporting `VERIFIED_FACTS: VerifiedFact[]`.
"""

import csv
import json
import re
import sys
from pathlib import Path

CSV_PATH = "/home/z/my-project/upload/AgriSense_Verified_1000.csv"
OUT_PATH = "/home/z/my-project/src/lib/kb/verified_facts.ts"


def clean(s: str) -> str:
    if s is None:
        return ""
    return s.strip()


def build_searchable_text(row: dict) -> str:
    """Compose a single text blob that the retriever will index.
    We repeat important tokens (crop, category) to boost their weight in TF-IDF.
    """
    parts = []
    crop = clean(row.get("crop", ""))
    category = clean(row.get("category", ""))
    fact_name = clean(row.get("fact_name", ""))
    value = clean(row.get("value", ""))
    unit = clean(row.get("unit", ""))
    context = clean(row.get("context", ""))
    source_inst = clean(row.get("source_institution", ""))
    source_title = clean(row.get("source_title", ""))

    # Crop + category repeated to boost weight
    parts.append(f"Crop: {crop}. {crop} {category}.")
    parts.append(f"Category: {category}.")
    parts.append(f"Fact: {fact_name}.")
    if value:
        parts.append(f"Value: {value} {unit}.".strip())
    if context:
        parts.append(f"Context: {context}.")
    parts.append(f"Source: {source_inst} — {source_title}.")

    return " ".join(parts)


def main():
    rows = []
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(r)

    print(f"Loaded {len(rows)} rows from CSV", file=sys.stderr)

    facts = []
    for r in rows:
        fact = {
            "id": clean(r.get("id", "")),
            "crop": clean(r.get("crop", "")),
            "category": clean(r.get("category", "")),
            "factName": clean(r.get("fact_name", "")),
            "value": clean(r.get("value", "")),
            "unit": clean(r.get("unit", "")),
            "valueType": clean(r.get("value_type", "")),
            "context": clean(r.get("context", "")),
            "sourceInstitution": clean(r.get("source_institution", "")),
            "sourceTitle": clean(r.get("source_title", "")),
            "sourceUrl": clean(r.get("source_url", "")),
            "sourceLocator": clean(r.get("source_locator", "")),
            "sourceMedium": clean(r.get("source_medium", "")),
            "verificationStatus": clean(r.get("verification_status", "")),
            "notes": clean(r.get("notes", "")),
            "searchableText": build_searchable_text(r),
        }
        facts.append(fact)

    # Emit as TypeScript
    out = []
    out.append("// AUTO-GENERATED from AgriSense_Verified_1000.csv — DO NOT EDIT BY HAND.")
    out.append("// Regenerate with: python3 scripts/build_verified_facts.py")
    out.append("//")
    out.append("// 1000 verified agronomic facts from BARI, BWMRI, BRRI, and FAO.")
    out.append("// Each fact is one retrievable chunk for the RAG system.")
    out.append("")
    out.append("export interface VerifiedFact {")
    out.append("  id: string;")
    out.append("  crop: string;")
    out.append("  category: string;")
    out.append("  factName: string;")
    out.append("  value: string;")
    out.append("  unit: string;")
    out.append("  valueType: string;")
    out.append("  context: string;")
    out.append("  sourceInstitution: string;")
    out.append("  sourceTitle: string;")
    out.append("  sourceUrl: string;")
    out.append("  sourceLocator: string;")
    out.append("  sourceMedium: string;")
    out.append("  verificationStatus: string;")
    out.append("  notes: string;")
    out.append("  searchableText: string;")
    out.append("}")
    out.append("")
    out.append(f"export const VERIFIED_FACTS: VerifiedFact[] = {json.dumps(facts, indent=2, ensure_ascii=False)};")
    out.append("")

    Path(OUT_PATH).write_text("\n".join(out), encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(facts)} facts)", file=sys.stderr)
    print(f"File size: {Path(OUT_PATH).stat().st_size:,} bytes", file=sys.stderr)

    # Print summary
    from collections import Counter
    crops = Counter(f["crop"] for f in facts)
    cats = Counter(f["category"] for f in facts)
    insts = Counter(f["sourceInstitution"] for f in facts)

    print(f"\nUnique crops: {len(crops)}", file=sys.stderr)
    print(f"Unique categories: {len(cats)}", file=sys.stderr)
    print(f"Unique sources: {len(insts)}", file=sys.stderr)


if __name__ == "__main__":
    main()
