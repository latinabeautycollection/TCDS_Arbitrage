#!/usr/bin/env python3
# Domain 10 Supabase/PG17 residual fixes applied to the package .sql files:
#  1. pgcrypto digest() lives in schema `extensions` on Supabase, but functions use
#     SET search_path=operations,pg_temp -> qualify to extensions.digest(
#  2. E.164 regex '^\\+[1-9][0-9]{7,14}$' only works with standard_conforming_strings=off;
#     on modern PG it needs a single backslash.
import sys, re, os, glob
root = sys.argv[1]; n = 0
for f in glob.glob(root + '/**/*.sql', recursive=True):
    try: s = open(f, encoding='utf-8').read()
    except Exception: continue
    o = s
    s = re.sub(r'(?<![\w.])digest\(', 'extensions.digest(', s)
    s = s.replace(r"'^\\+[1-9][0-9]{7,14}$'", r"'^\+[1-9][0-9]{7,14}$'")
    if s != o:
        open(f,'w',encoding='utf-8').write(s); n += 1; print('fixed', os.path.relpath(f, root))
print('d10_fix: %d files' % n)
