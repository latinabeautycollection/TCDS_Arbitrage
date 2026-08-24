from pathlib import Path
import re, sys

root=Path(__file__).resolve().parents[1]
slices=[root/x for x in ("10A","10B","10C","10D","10E","10F")]

sql="\n".join(p.read_text(errors="ignore") for s in slices for p in s.rglob("*.sql"))
ts="\n".join(p.read_text(errors="ignore") for s in slices for p in s.rglob("*.ts"))

created_tables=re.findall(
    r"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+operations\.([A-Za-z0-9_]+)",
    sql,re.I
)
dupe_tables=sorted({x for x in created_tables if created_tables.count(x)>1})
if dupe_tables:
    raise SystemExit("FAIL duplicate table ownership: "+",".join(dupe_tables))

# severity helper is a required upstream semantic dependency.
if not re.search(r"FUNCTION\s+operations\.severity_rank\s*\(",sql,re.I):
    raise SystemExit("FAIL severity_rank missing")

for forbidden in (
    "microsoftGraphEmailProvider",
    "telnyxSmsProvider",
):
    # 10C adapters may name the Graph provider structurally in test/docs, but
    # 10D-10F may not own providers.
    later="\n".join(
        p.read_text(errors="ignore")
        for s in (root/"10D",root/"10E",root/"10F")
        for p in (s/"src").rglob("*.ts")
    )
    if forbidden in later:
        raise SystemExit(f"FAIL later slice provider ownership: {forbidden}")

print("PASS: cross-slice static ownership prerequisites")
