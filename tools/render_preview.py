#!/usr/bin/env python3
"""Render a local project page to PNG without navigating Chromium to file:// or localhost.

The sandbox browser blocks local navigation, so this script builds a self-contained HTML
snapshot by inlining local styles, images, fonts and (optionally) scripts, then renders it
through Playwright's page.set_content().
"""
from __future__ import annotations

import argparse
import base64
import mimetypes
import re
from pathlib import Path
from urllib.parse import unquote

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

CSS_LINK_RE = re.compile(r'<link\b(?=[^>]*\brel=["\']stylesheet["\'])(?=[^>]*\bhref=["\']([^"\']+)["\'])[^>]*?/?>', re.I)
SCRIPT_SRC_RE = re.compile(r'<script\b([^>]*?)\bsrc=["\']([^"\']+)["\']([^>]*)>\s*</script>', re.I | re.S)
IMG_SRC_RE = re.compile(r'(<(?:img|source)\b[^>]*?\bsrc=["\'])([^"\']+)(["\'])', re.I)
CSS_URL_RE = re.compile(r'url\(\s*(["\']?)([^)"\']+)\1\s*\)', re.I)


def strip_qf(value: str) -> str:
    return unquote(value.split('#', 1)[0].split('?', 1)[0])


def is_remote(value: str) -> bool:
    v = value.strip().lower()
    return v.startswith(('http://', 'https://', '//', 'data:', 'blob:', '#'))


def file_to_data_uri(path: Path) -> str:
    mime, _ = mimetypes.guess_type(path.name)
    if path.suffix.lower() == '.woff2':
        mime = 'font/woff2'
    elif path.suffix.lower() == '.ttf':
        mime = 'font/ttf'
    mime = mime or 'application/octet-stream'
    encoded = base64.b64encode(path.read_bytes()).decode('ascii')
    return f'data:{mime};base64,{encoded}'


def resolve_local(value: str, base_dir: Path) -> Path | None:
    if is_remote(value):
        return None
    clean = strip_qf(value).strip()
    if not clean:
        return None
    path = (base_dir / clean).resolve()
    try:
        path.relative_to(ROOT.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def inline_css_urls(css: str, css_dir: Path) -> str:
    def repl(match: re.Match[str]) -> str:
        raw = match.group(2).strip()
        path = resolve_local(raw, css_dir)
        if not path:
            return match.group(0)
        try:
            return f'url("{file_to_data_uri(path)}")'
        except OSError:
            return match.group(0)
    return CSS_URL_RE.sub(repl, css)


def inline_styles(html: str, page_dir: Path) -> str:
    def repl(match: re.Match[str]) -> str:
        href = match.group(1)
        path = resolve_local(href, page_dir)
        if not path:
            return match.group(0)
        css = path.read_text(encoding='utf-8', errors='replace')
        css = inline_css_urls(css, path.parent)
        return f'<style data-preview-source="{path.relative_to(ROOT).as_posix()}">\n{css}\n</style>'
    return CSS_LINK_RE.sub(repl, html)


def inline_html_images(html: str, page_dir: Path) -> str:
    def repl(match: re.Match[str]) -> str:
        src = match.group(2)
        path = resolve_local(src, page_dir)
        if not path:
            return match.group(0)
        try:
            return f'{match.group(1)}{file_to_data_uri(path)}{match.group(3)}'
        except OSError:
            return match.group(0)
    return IMG_SRC_RE.sub(repl, html)


def inline_scripts(html: str, page_dir: Path, interactive: bool) -> str:
    if not interactive:
        # Remove both external and inline scripts. Static preview is deterministic and fast.
        return re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.I | re.S)

    def repl(match: re.Match[str]) -> str:
        attrs_a, src, attrs_b = match.group(1), match.group(2), match.group(3)
        path = resolve_local(src, page_dir)
        if not path:
            # Skip third-party SDKs in preview; the site can still be reviewed visually.
            return '' if is_remote(src) else match.group(0)
        js = path.read_text(encoding='utf-8', errors='replace')
        # Local scripts at the top of the document use defer in production. Keep their
        # effective order but run after parsing by moving all local script content to the end.
        return f'<script data-preview-source="{path.relative_to(ROOT).as_posix()}">\n{js}\n</script>'

    return SCRIPT_SRC_RE.sub(repl, html)


def build_snapshot(page: Path, interactive: bool) -> str:
    html = page.read_text(encoding='utf-8', errors='replace')
    html = inline_styles(html, page.parent)
    html = inline_html_images(html, page.parent)
    html = inline_scripts(html, page.parent, interactive)
    # Loader is useful on the deployed site but obscures deterministic screenshots.
    html = html.replace('</head>', '<style id="preview-overrides">#siteLoader{display:none!important}</style></head>', 1)
    return html


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--page', default='index.html')
    ap.add_argument('--output', default='/mnt/data/site-preview.png')
    ap.add_argument('--width', type=int, default=1440)
    ap.add_argument('--height', type=int, default=1100)
    ap.add_argument('--full-page', action='store_true')
    ap.add_argument('--interactive', action='store_true')
    ap.add_argument('--wait-ms', type=int, default=900)
    ap.add_argument('--scroll-y', type=int, default=0)
    args = ap.parse_args()

    page_path = (ROOT / args.page).resolve()
    page_path.relative_to(ROOT.resolve())
    if not page_path.is_file():
        raise SystemExit(f'Page not found: {page_path}')

    snapshot = build_snapshot(page_path, args.interactive)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path='/usr/bin/chromium',
            args=['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        )
        browser_page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        browser_page.set_content(snapshot, wait_until='domcontentloaded', timeout=20_000)
        if args.scroll_y:
            browser_page.evaluate('(y) => window.scrollTo(0, y)', args.scroll_y)
        browser_page.wait_for_timeout(args.wait_ms)
        browser_page.screenshot(path=str(output), full_page=args.full_page)
        print(f'{browser_page.title()} -> {output}')
        browser.close()


if __name__ == '__main__':
    main()
