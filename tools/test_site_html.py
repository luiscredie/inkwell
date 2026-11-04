"""site_html.hide_img_from_preloader, and the built pages (no `<img` left inside inline scripts)."""
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import site_html  # noqa: E402


class HideImg(unittest.TestCase):
    def test_only_inside_inline_scripts(self):
        html = '<p><img src="a.png"></p><script>const t = `<img src="${u}">`; const r = /<img/;</script><script src="x.js"></script>'
        out = site_html.hide_img_from_preloader(html)
        self.assertIn('<p><img src="a.png"></p>', out)
        self.assertIn('`\\u003Cimg src="${u}">`', out)
        self.assertIn('/\\u003Cimg/', out)

    def test_same_meaning_in_javascript(self):
        src = 'const u = "x"; const t = `<img src="${u}">`; const s = "<img a>"; console.log(JSON.stringify([t, s, /<img/.test("<img")]));'
        out = site_html.hide_img_from_preloader(f"<script>{src}</script>")[len("<script>"):-len("</script>")]
        run = lambda code: subprocess.run(["node", "-e", code], capture_output=True, text=True, check=True).stdout
        self.assertNotIn("<img", out)
        self.assertEqual(run(src), run(out))

    def test_same_meaning_in_json(self):
        out = site_html.hide_img_from_preloader('<script>{"a": "<img b>"}</script>')[len("<script>"):-len("</script>")]
        self.assertEqual(json.loads(out), {"a": "<img b>"})

    def test_built_pages_have_no_img_in_inline_scripts(self):
        for page in sorted((ROOT / "site").glob("*/index.html")):
            html = page.read_text(encoding="utf-8")
            for m in re.finditer(r"<script\b(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S | re.I):
                self.assertNotIn("<img", m.group(1), f"{page.relative_to(ROOT)}: run python tools/build_site_pages.py")


if __name__ == "__main__":
    unittest.main()
