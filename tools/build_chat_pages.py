#!/usr/bin/env python3
from pathlib import Path
from render_preview import build_snapshot, ROOT

OUT = ROOT / 'chat-preview'
OUT.mkdir(exist_ok=True)

pages = sorted(p for p in ROOT.glob('*.html') if p.is_file())
for page in pages:
    snapshot = build_snapshot(page, interactive=False)
    # Mark as chat preview and keep page-to-page relative links working.
    snapshot = snapshot.replace('</head>', '<meta name="robots" content="noindex"><!-- generated chat preview --></head>', 1)
    target = OUT / page.name
    target.write_text(snapshot, encoding='utf-8')
    print(f'{page.name} -> {target.relative_to(ROOT)}')
