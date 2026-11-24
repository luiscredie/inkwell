// Shown by Capacitor (server.errorPath) when https://inkwell.com.br can't be loaded. Retry goes back to the site.
document.getElementById("again").addEventListener("click", () => { location.href = "https://inkwell.com.br/feed/"; });
window.addEventListener("online", () => { location.href = "https://inkwell.com.br/feed/"; });
