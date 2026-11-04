"""Small transforms on the built HTML pages (used by build_site_pages.py and build_site_decks.py)."""
from __future__ import annotations

import re

_INLINE_SCRIPT = re.compile(r"(<script\b(?![^>]*\bsrc=)[^>]*>)(.*?)(</script>)", re.S | re.I)


def hide_img_from_preloader(html: str) -> str:
    """Write `<img` as `\\u003Cimg` inside inline scripts.

    The pages build their HTML in JavaScript strings (`<img src="${imgUrl(c)}">`). Chrome's preload scanner sometimes
    reads those strings inside the big inline scripts as real tags and requests `/perfil/${imgUrl(c)}` (a 404 on about
    half the page loads of Feed, Perfil, Decks, Comunidades, Preços and Começar). `\\u003C` is `<` to JavaScript (in
    strings, template literals and regular expressions) and to JSON, so the code does exactly the same; the scanner
    just no longer sees a tag.
    """
    return _INLINE_SCRIPT.sub(lambda m: m.group(1) + m.group(2).replace("<img", "\\u003Cimg") + m.group(3), html)
