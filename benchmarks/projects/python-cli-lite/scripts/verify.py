from pathlib import Path
source = Path(__file__).resolve().parent.parent / 'app.py'
docs = Path(__file__).resolve().parent.parent / 'docs' / 'usage.md'
source_text = source.read_text()
docs_text = docs.read_text()
if 'format_summary' not in source_text:
    raise SystemExit('format_summary missing')
if 'summary command' not in docs_text.lower():
    raise SystemExit('summary docs missing')
print('python-cli-lite verification passed')
