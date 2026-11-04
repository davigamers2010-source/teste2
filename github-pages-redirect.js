(() => {
  if (!/\.github\.io$/i.test(location.hostname)) return;

  const current = new URL(location.href);
  if (current.pathname.endsWith("/github-pages.html")) return;

  const backend = String(window.CENTRAL_BACKEND_URL || "").trim();
  if (backend) {
    try {
      const target = new URL(backend);
      if (target.protocol === "https:" && !target.username && !target.password &&
          target.pathname === "/" && !target.search && !target.hash &&
          target.hostname !== location.hostname) {
        location.replace(target.origin + "/");
        return;
      }
    } catch (_) {}
  }

  location.replace(new URL("github-pages.html", current).href);
})();
