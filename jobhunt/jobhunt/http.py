"""Minimal HTTP client on the standard library.

Polite by default: a per-host minimum interval, a descriptive User-Agent,
bounded retries on 429/5xx. Tests swap the transport with ``set_transport``.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable

USER_AGENT = "jobhunt/1.0 (personal job search assistant; https://github.com/i-am-epic/devtools)"
MIN_INTERVAL = 0.35  # seconds between requests to the same host


class HTTPError(Exception):
    def __init__(self, status: int, url: str, body: bytes = b""):
        super().__init__(f"HTTP {status} for {url}")
        self.status = status
        self.url = url
        self.body = body


class NotFound(HTTPError):
    pass


Transport = Callable[[str, str, bytes | None, dict], tuple[int, bytes]]


def _urllib_transport(method: str, url: str, body: bytes | None, headers: dict) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read() if exc.fp else b""


_transport: Transport = _urllib_transport
_last_hit: dict[str, float] = {}
_lock = threading.Lock()


def set_transport(transport: Transport | None) -> None:
    """Replace the network layer (tests); ``None`` restores urllib."""
    global _transport
    _transport = transport or _urllib_transport


def _throttle(url: str) -> None:
    host = urllib.parse.urlsplit(url).netloc
    with _lock:
        wait = _last_hit.get(host, 0) + MIN_INTERVAL - time.monotonic()
        _last_hit[host] = max(time.monotonic(), _last_hit.get(host, 0) + MIN_INTERVAL)
    if wait > 0 and _transport is _urllib_transport:
        time.sleep(wait)


def request(method: str, url: str, *, params: dict | None = None, body: bytes | None = None,
            headers: dict | None = None, retries: int = 2) -> bytes:
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json, application/xml;q=0.9, */*;q=0.5"}
    hdrs.update(headers or {})
    attempt = 0
    while True:
        _throttle(url)
        try:
            status, data = _transport(method, url, body, hdrs)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            if attempt >= retries:
                raise HTTPError(0, url, str(exc).encode()) from exc
            status, data = 0, b""
        if 200 <= status < 300:
            return data
        if status == 404:
            raise NotFound(status, url, data)
        if status and status not in (408, 425, 429) and status < 500:
            raise HTTPError(status, url, data)
        if attempt >= retries:
            raise HTTPError(status, url, data)
        attempt += 1
        if _transport is _urllib_transport:
            time.sleep(1.5 * 2 ** attempt)


def get(url: str, **kw) -> bytes:
    return request("GET", url, **kw)


def get_json(url: str, **kw):
    return json.loads(get(url, **kw) or b"null")


def post_json(url: str, payload, **kw):
    headers = {"Content-Type": "application/json", **kw.pop("headers", {})}
    data = request("POST", url, body=json.dumps(payload).encode(), headers=headers, **kw)
    return json.loads(data or b"null")
