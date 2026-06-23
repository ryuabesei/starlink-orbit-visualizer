from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle"
CACHE_FILE = Path(".tle-cache/starlink.tle")


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/starlink-tle"):
            self.send_tle()
            return

        super().do_GET()

    def send_tle(self):
        try:
            text = fetch_tle()
            CACHE_FILE.parent.mkdir(exist_ok=True)
            CACHE_FILE.write_text(text, encoding="utf-8")
            self.respond(200, text, "text/plain; charset=utf-8")
        except (HTTPError, URLError, TimeoutError) as error:
            if CACHE_FILE.exists():
                self.respond(200, CACHE_FILE.read_text(encoding="utf-8"), "text/plain; charset=utf-8")
                return

            self.respond(502, f"Failed to fetch CelesTrak TLE: {error}", "text/plain; charset=utf-8")

    def respond(self, status, body, content_type):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def fetch_tle():
    request = Request(
        TLE_URL,
        headers={
            "Accept": "text/plain,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 StarlinkOrbitVisualizer/1.0",
        },
    )
    with urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5174), Handler)
    print("Serving Starlink Orbit Visualizer at http://127.0.0.1:5174")
    server.serve_forever()
