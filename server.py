#!/usr/bin/env python3
"""Local dev server for DevTools.

Serves the static site and provides the /api/servicebus endpoint that the
Service Bus tools need. Azure Service Bus' REST API sends no CORS headers, so
a browser page cannot call it directly -- this process relays the call.

Zero dependencies: standard library only.

    python server.py [port]

The same endpoint is implemented for production deployment in
api/servicebus.js (Vercel Node function). Keep the two behaviours in sync.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MAX_BODY = 4 * 1024 * 1024  # 4 MB

# The relay must only ever talk to Azure Service Bus. Without this it is an
# open proxy that will fetch any host a caller names, including link-local
# metadata endpoints.
ALLOWED_HOST = re.compile(
    r"^[a-z0-9][a-z0-9-]*\.servicebus\."
    r"(windows\.net|chinacloudapi\.cn|usgovcloudapi\.net|cloudapi\.de)$",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------
# Service Bus helpers
# --------------------------------------------------------------------------

class SbError(Exception):
    """A problem we can report back to the browser as a clean message."""

    def __init__(self, message, status=400, detail=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.detail = detail


def parse_connection_string(cs: str) -> dict:
    """Pull the namespace host, key name and key out of a SB connection string."""
    if not cs or not cs.strip():
        raise SbError("Connection string is required")

    parts = {}
    for segment in cs.split(";"):
        segment = segment.strip()
        if not segment or "=" not in segment:
            continue
        key, value = segment.split("=", 1)  # the key itself is base64 and contains '='
        parts[key.strip().lower()] = value.strip()

    endpoint = parts.get("endpoint")
    key_name = parts.get("sharedaccesskeyname")
    key = parts.get("sharedaccesskey")

    missing = [
        name
        for name, value in (
            ("Endpoint", endpoint),
            ("SharedAccessKeyName", key_name),
            ("SharedAccessKey", key),
        )
        if not value
    ]
    if missing:
        raise SbError(
            "Connection string is missing " + ", ".join(missing)
            + ". Expected: Endpoint=sb://<namespace>.servicebus.windows.net/;"
              "SharedAccessKeyName=<name>;SharedAccessKey=<key>"
        )

    host = endpoint.replace("sb://", "").replace("https://", "").strip("/")
    if not host:
        raise SbError("Could not read the namespace host from the Endpoint value")
    if not ALLOWED_HOST.match(host):
        raise SbError(
            "The Endpoint must be an Azure Service Bus namespace, e.g. "
            "sb://<namespace>.servicebus.windows.net/"
        )

    return {
        "host": host,
        "key_name": key_name,
        "key": key,
        "entity_path": parts.get("entitypath"),
    }


def make_sas_token(uri: str, key_name: str, key: str, ttl_seconds: int = 3600) -> str:
    """Build a SharedAccessSignature token for the given resource URI."""
    encoded_uri = urllib.parse.quote(uri, safe="")
    expiry = int(time.time()) + ttl_seconds
    to_sign = f"{encoded_uri}\n{expiry}".encode("utf-8")
    signature = base64.b64encode(
        hmac.new(key.encode("utf-8"), to_sign, hashlib.sha256).digest()
    ).decode("utf-8")
    return (
        "SharedAccessSignature "
        f"sr={encoded_uri}"
        f"&sig={urllib.parse.quote(signature, safe='')}"
        f"&se={expiry}"
        f"&skn={urllib.parse.quote(key_name, safe='')}"
    )


def entity_url(host: str, entity: str) -> str:
    entity = (entity or "").strip().strip("/")
    if not entity:
        raise SbError("Queue or topic/subscription name is required")
    return f"https://{host}/{urllib.parse.quote(entity, safe='/')}"


def azure_request(method: str, url: str, token: str, body: bytes = None,
                  extra_headers: dict = None, timeout: int = 70):
    """Call the Service Bus REST API and normalise the response."""
    headers = {"Authorization": token}
    if extra_headers:
        headers.update(extra_headers)

    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return {
                "status": response.status,
                "headers": {k.lower(): v for k, v in response.headers.items()},
                "body": response.read(),
            }
    except urllib.error.HTTPError as err:
        detail = ""
        try:
            detail = err.read().decode("utf-8", "replace")[:2000]
        except Exception:
            pass
        return {
            "status": err.code,
            "headers": {k.lower(): v for k, v in (err.headers or {}).items()},
            "body": b"",
            "error_detail": detail,
        }
    except urllib.error.URLError as err:
        raise SbError(
            f"Could not reach {urllib.parse.urlparse(url).hostname}: {err.reason}",
            status=502,
        )
    except TimeoutError:
        raise SbError("The request to Azure Service Bus timed out", status=504)


def describe_http_error(result: dict, context: str) -> str:
    status = result["status"]
    hints = {
        401: "Authentication failed - check SharedAccessKeyName and SharedAccessKey.",
        403: "Authorisation failed - the SAS policy may lack the required Send/Listen claim.",
        404: "Not found - check the queue, topic or subscription name.",
        410: "The entity is gone or the lock has already expired.",
    }
    hint = hints.get(status, "")
    detail = (result.get("error_detail") or "").strip()
    return " ".join(filter(None, [f"{context} failed with HTTP {status}.", hint, detail]))


def sb_send(payload: dict) -> dict:
    conn = parse_connection_string(payload.get("connectionString", ""))
    entity = payload.get("entity") or conn["entity_path"]
    url = entity_url(conn["host"], entity)
    token = make_sas_token(url, conn["key_name"], conn["key"])

    body = (payload.get("body") or "").encode("utf-8")
    headers = {"Content-Type": payload.get("contentType") or "application/json"}

    broker_properties = payload.get("brokerProperties") or {}
    if not isinstance(broker_properties, dict):
        raise SbError("brokerProperties must be a JSON object")
    broker_properties = {k: v for k, v in broker_properties.items() if v not in (None, "")}
    if broker_properties:
        headers["BrokerProperties"] = json.dumps(broker_properties)

    # Custom application properties travel as individual headers holding JSON values.
    custom = payload.get("properties") or {}
    if not isinstance(custom, dict):
        raise SbError("Custom properties must be a JSON object")
    for name, value in custom.items():
        if not name or not str(name).strip():
            continue
        headers[str(name)] = json.dumps(value)

    result = azure_request("POST", f"{url}/messages?timeout=60", token, body, headers)
    if result["status"] not in (200, 201):
        raise SbError(describe_http_error(result, "Send"), status=502)

    return {
        "ok": True,
        "action": "send",
        "entity": entity,
        "namespace": conn["host"],
        "bytesSent": len(body),
        "brokerProperties": broker_properties,
        "properties": custom,
    }


def _decode_message(result: dict) -> dict:
    raw = result["body"]
    headers = result["headers"]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = base64.b64encode(raw).decode("ascii")

    broker = {}
    if headers.get("brokerproperties"):
        try:
            broker = json.loads(headers["brokerproperties"])
        except json.JSONDecodeError:
            broker = {"_raw": headers["brokerproperties"]}

    # Anything that is not a standard HTTP/Service Bus header is an app property.
    reserved = {
        "brokerproperties", "content-type", "content-length", "date", "server",
        "location", "transfer-encoding", "strict-transport-security",
        "connection", "cache-control", "expires", "pragma",
    }
    custom = {}
    for name, value in headers.items():
        if name in reserved:
            continue
        try:
            custom[name] = json.loads(value)
        except (json.JSONDecodeError, ValueError):
            custom[name] = value

    return {
        "body": text,
        "size": len(raw),
        "contentType": headers.get("content-type", ""),
        "brokerProperties": broker,
        "properties": custom,
        "lockLocation": headers.get("location", ""),
        "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def sb_receive(payload: dict) -> dict:
    """Peek-lock (leaves the message locked) or destructive receive."""
    conn = parse_connection_string(payload.get("connectionString", ""))
    entity = payload.get("entity") or conn["entity_path"]
    url = entity_url(conn["host"], entity)
    token = make_sas_token(url, conn["key_name"], conn["key"])

    mode = payload.get("mode", "peek-lock")
    try:
        wait = max(0, min(int(payload.get("waitSeconds", 5)), 55))
    except (TypeError, ValueError):
        wait = 5

    target = f"{url}/messages/head?timeout={wait}"
    method = "DELETE" if mode == "receive-delete" else "POST"

    result = azure_request(method, target, token, timeout=wait + 15)

    if result["status"] == 204:
        return {"ok": True, "action": "receive", "empty": True, "entity": entity,
                "message": None, "mode": mode}
    if result["status"] not in (200, 201):
        raise SbError(describe_http_error(result, "Receive"), status=502)

    message = _decode_message(result)
    message["mode"] = mode
    return {"ok": True, "action": "receive", "empty": False, "entity": entity,
            "message": message, "mode": mode}


def sb_settle(payload: dict) -> dict:
    """Complete (DELETE), abandon (PUT) or renew (POST) a peek-locked message."""
    conn = parse_connection_string(payload.get("connectionString", ""))
    lock_location = (payload.get("lockLocation") or "").strip()
    if not lock_location:
        raise SbError("This message has no lock URI - it was read in receive-and-delete mode")
    if not lock_location.startswith(f"https://{conn['host']}/"):
        raise SbError("The lock URI does not belong to this namespace")

    action = payload.get("action")
    method = {"complete": "DELETE", "abandon": "PUT", "renew": "POST"}[action]

    token = make_sas_token(lock_location, conn["key_name"], conn["key"])
    result = azure_request(method, lock_location, token, body=b"" if method == "PUT" else None)

    if result["status"] not in (200, 204):
        raise SbError(describe_http_error(result, action.capitalize()), status=502)
    return {"ok": True, "action": action}


def sb_test(payload: dict) -> dict:
    """Prove the credentials work by asking for a message with a zero-second wait."""
    conn = parse_connection_string(payload.get("connectionString", ""))
    entity = payload.get("entity") or conn["entity_path"]
    url = entity_url(conn["host"], entity)
    token = make_sas_token(url, conn["key_name"], conn["key"])

    result = azure_request("POST", f"{url}/messages/head?timeout=0", token, timeout=25)

    if result["status"] in (200, 201):
        # We locked a message just to prove access -- release it straight away.
        location = result["headers"].get("location")
        if location:
            azure_request("PUT", location,
                          make_sas_token(location, conn["key_name"], conn["key"]), body=b"")
        return {"ok": True, "action": "test", "namespace": conn["host"], "entity": entity,
                "detail": "Connected. The entity has at least one message waiting."}
    if result["status"] == 204:
        return {"ok": True, "action": "test", "namespace": conn["host"], "entity": entity,
                "detail": "Connected. The entity is currently empty."}

    raise SbError(describe_http_error(result, "Connection test"), status=502)


ACTIONS = {
    "send": sb_send,
    "receive": sb_receive,
    "complete": sb_settle,
    "abandon": sb_settle,
    "renew": sb_settle,
    "test": sb_test,
}


def handle_servicebus(payload: dict) -> dict:
    action = payload.get("action")
    if action not in ACTIONS:
        raise SbError(f"Unknown action '{action}'. Expected one of: {', '.join(ACTIONS)}")
    return ACTIONS[action](payload)


# --------------------------------------------------------------------------
# HTTP plumbing
# --------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            self._json(200, {"ok": True, "service": "devtools", "servicebus": True})
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path not in ("/api/servicebus", "/api/sas-debug", "/api/dev/manifest"):
            self._json(404, {"ok": False, "error": f"No endpoint at {path}"})
            return

        # Development-only endpoints. /api/sas-debug signs a caller-supplied key
        # so the JS and Python relays can be compared; /api/dev/manifest lets the
        # browser hand the tool catalogue to the SEO build script, since Python
        # cannot execute the JS registry. Neither exists in a normal run.
        if path in ("/api/sas-debug", "/api/dev/manifest") \
                and os.environ.get("DEVTOOLS_TEST_ENDPOINTS") != "1":
            self._json(404, {"ok": False, "error": "Not enabled"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._json(400, {"ok": False, "error": "Request body is empty"})
            return
        if length > MAX_BODY:
            self._json(413, {"ok": False, "error": "Request body too large"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as err:
            self._json(400, {"ok": False, "error": f"Request body is not valid JSON: {err}"})
            return

        if path == "/api/dev/manifest":
            try:
                if not isinstance(payload.get("tools"), list) or not payload["tools"]:
                    raise ValueError("expected a non-empty 'tools' array")
                target = os.path.join(ROOT, "tools-manifest.json")
                with open(target, "w", encoding="utf-8", newline="\n") as handle:
                    json.dump(payload, handle, indent=1, ensure_ascii=False)
                    handle.write("\n")
                self._json(200, {"ok": True, "written": len(payload["tools"]), "path": "tools-manifest.json"})
            except Exception as err:  # noqa: BLE001
                self._json(400, {"ok": False, "error": str(err)})
            return

        if path == "/api/sas-debug":
            try:
                expiry = int(payload["expiry"])
                encoded = urllib.parse.quote(payload["uri"], safe="")
                signature = base64.b64encode(
                    hmac.new(payload["key"].encode("utf-8"),
                             f"{encoded}\n{expiry}".encode("utf-8"), hashlib.sha256).digest()
                ).decode("utf-8")
                token = (
                    "SharedAccessSignature "
                    f"sr={encoded}"
                    f"&sig={urllib.parse.quote(signature, safe='')}"
                    f"&se={expiry}"
                    f"&skn={urllib.parse.quote(payload['keyName'], safe='')}"
                )
                self._json(200, {"ok": True, "token": token})
            except Exception as err:  # noqa: BLE001
                self._json(400, {"ok": False, "error": str(err)})
            return

        try:
            self._json(200, handle_servicebus(payload))
        except SbError as err:
            self._json(err.status, {"ok": False, "error": err.message, "detail": err.detail})
        except Exception as err:  # noqa: BLE001 - surface anything unexpected cleanly
            self._json(500, {"ok": False, "error": f"{type(err).__name__}: {err}"})

    def end_headers(self):
        # Never cache during development -- ES modules in particular are sticky,
        # and a stale module is a confusing way to lose half an hour.
        if self.path.split("?")[0].endswith((".js", ".json", ".html", ".css")):
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console readable: only log API calls and errors.
        if "/api/" in self.path or (args and str(args[1]).startswith(("4", "5"))):
            sys.stderr.write(f"{self.address_string()} - {fmt % args}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

    # Localhost by default. The relay forwards whatever connection string it is
    # given to Azure, so binding to every interface would let anyone who can
    # reach this port use it. Opt in explicitly (the container image does).
    host = os.environ.get("DEVTOOLS_HOST", "127.0.0.1")

    server = ThreadingHTTPServer((host, port), Handler)
    display = "127.0.0.1" if host in ("0.0.0.0", "") else host
    print(f"DevTools running at http://{display}:{port}")
    print("Service Bus relay active at POST /api/servicebus")
    if host == "0.0.0.0":
        print("WARNING: listening on all interfaces - anyone who can reach this "
              "port can use the Service Bus relay.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
        server.shutdown()


if __name__ == "__main__":
    main()
