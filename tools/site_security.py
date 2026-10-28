"""Security tags every built page gets in its <head> (used by build_site_pages.py and build_site_decks.py)."""

# Every page says where it may load code and send data from (Content-Security-Policy). GitHub Pages can't send
# headers, so it goes in a <meta>. Inline scripts stay allowed (the pages are built that way); what this stops is
# code from anywhere else and data going anywhere else. Keep in step with the services the pages really use.
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",   # cdn: the scanner's OCR (tesseract.js)
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: mediastream:",
    "connect-src 'self' https://sorefaetiaebmjploanp.supabase.co wss://sorefaetiaebmjploanp.supabase.co"
    " https://nominatim.openstreetmap.org https://viacep.com.br https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
    "frame-src 'self' https://duels.ink",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])
# A page opened inside someone else's site (to trick clicks) shows nothing and opens on its own instead.
# Inkwell's own pages may frame each other (Jogos shows the Contador).
FRAME_GUARD = ("<script>(function(){if(window.top===window.self)return;var s=false;try{s=window.top.location.origin===location.origin}catch(e){}"
               "if(!s){document.documentElement.style.display='none';try{window.top.location=location.href}catch(e){}}})();</script>")
HEAD_SECURITY = (f'<meta http-equiv="Content-Security-Policy" content="{CSP}">\n'
                 '<meta name="referrer" content="strict-origin-when-cross-origin">\n' + FRAME_GUARD)




def add_head(html: str, name: str) -> str:
    if '<meta charset="utf-8">' not in html:
        raise SystemExit(f"{name}: no <meta charset> to put the security tags after")
    return html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + HEAD_SECURITY, 1)
