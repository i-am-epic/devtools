"""Tests for the Service Bus relay in server.py.

Covers connection-string parsing, SAS token generation (against an
independently computed reference) and the error paths. Does not contact Azure.

    python scripts/test_servicebus.py
"""
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import SbError, make_sas_token, parse_connection_string, entity_url  # noqa: E402

passed = 0
failed = 0


def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"ok   {label}")
    else:
        failed += 1
        print(f"FAIL {label} {detail}")


def expect_error(label, fn, fragment):
    global passed, failed
    try:
        fn()
    except SbError as err:
        if fragment.lower() in str(err).lower():
            passed += 1
            print(f"ok   {label}")
        else:
            failed += 1
            print(f"FAIL {label} -- wrong message: {err}")
        return
    except Exception as err:  # noqa: BLE001
        failed += 1
        print(f"FAIL {label} -- unexpected {type(err).__name__}: {err}")
        return
    failed += 1
    print(f"FAIL {label} -- no error raised")


print("--- connection string parsing ---")

# A real SharedAccessKey is base64 and routinely ends with '=' padding.
KEY = "abcdEFGH1234567890abcdEFGH1234567890abcdEFG="
CS = f"Endpoint=sb://demo-ns.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey={KEY}"

parsed = parse_connection_string(CS)
check("host extracted", parsed["host"] == "demo-ns.servicebus.windows.net", parsed["host"])
check("key name extracted", parsed["key_name"] == "RootManageSharedAccessKey", parsed["key_name"])
check("base64 key with '=' survives intact", parsed["key"] == KEY, parsed["key"])
check("entity path is None when absent", parsed["entity_path"] is None)

with_entity = parse_connection_string(CS + ";EntityPath=orders")
check("EntityPath extracted", with_entity["entity_path"] == "orders")

check(
    "https:// endpoint accepted",
    parse_connection_string(CS.replace("sb://", "https://"))["host"] == "demo-ns.servicebus.windows.net",
)

expect_error("empty connection string rejected", lambda: parse_connection_string(""), "required")
expect_error(
    "missing SharedAccessKey rejected",
    lambda: parse_connection_string("Endpoint=sb://x.servicebus.windows.net/;SharedAccessKeyName=n"),
    "SharedAccessKey",
)
expect_error(
    "missing Endpoint rejected",
    lambda: parse_connection_string("SharedAccessKeyName=n;SharedAccessKey=k"),
    "Endpoint",
)

print("\n--- entity urls ---")
check(
    "queue url",
    entity_url("demo-ns.servicebus.windows.net", "orders") == "https://demo-ns.servicebus.windows.net/orders",
)
check(
    "subscription path preserved",
    entity_url("demo-ns.servicebus.windows.net", "events/subscriptions/audit")
    == "https://demo-ns.servicebus.windows.net/events/subscriptions/audit",
)
check(
    "surrounding slashes trimmed",
    entity_url("demo-ns.servicebus.windows.net", "/orders/") == "https://demo-ns.servicebus.windows.net/orders",
)
expect_error("empty entity rejected", lambda: entity_url("h", ""), "required")

print("\n--- SAS token ---")
uri = "https://demo-ns.servicebus.windows.net/orders"
token = make_sas_token(uri, "RootManageSharedAccessKey", KEY, ttl_seconds=3600)

parts = dict(
    piece.split("=", 1)
    for piece in token.replace("SharedAccessSignature ", "").split("&")
)

check("token has the SharedAccessSignature prefix", token.startswith("SharedAccessSignature "))
check("token carries sr, sig, se and skn", set(parts) == {"sr", "sig", "se", "skn"}, str(set(parts)))
check("sr is the url-encoded resource uri", urllib.parse.unquote(parts["sr"]) == uri)
check("skn is the policy name", urllib.parse.unquote(parts["skn"]) == "RootManageSharedAccessKey")

expiry = int(parts["se"])
check("expiry is ~1 hour ahead", 3500 < expiry - int(time.time()) < 3700, f"delta {expiry - int(time.time())}")

# Independently recompute the signature per the documented algorithm.
encoded = urllib.parse.quote(uri, safe="")
reference = base64.b64encode(
    hmac.new(KEY.encode("utf-8"), f"{encoded}\n{expiry}".encode("utf-8"), hashlib.sha256).digest()
).decode()
check("signature matches an independent HMAC-SHA256", urllib.parse.unquote(parts["sig"]) == reference)

# The signature must actually depend on its inputs.
other_uri = make_sas_token("https://demo-ns.servicebus.windows.net/other", "RootManageSharedAccessKey", KEY)
check("different entity yields a different signature",
      dict(p.split("=", 1) for p in other_uri.replace("SharedAccessSignature ", "").split("&"))["sig"] != parts["sig"])

other_key = make_sas_token(uri, "RootManageSharedAccessKey", "ZZZZ" + KEY[4:])
check("different key yields a different signature",
      dict(p.split("=", 1) for p in other_key.replace("SharedAccessSignature ", "").split("&"))["sig"] != parts["sig"])

print("\n--- live endpoint (requires server.py on :8000) ---")


def post(payload, timeout=25):
    request = urllib.request.Request(
        "http://127.0.0.1:8000/api/servicebus",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())


try:
    with urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=5) as response:
        health = json.loads(response.read())
    check("health endpoint reports the relay", health.get("servicebus") is True, str(health))

    status, body = post({"action": "send"})
    check("missing connection string returns a clean error",
          status == 400 and body["ok"] is False and "required" in body["error"].lower(), str(body))

    status, body = post({"action": "nonsense", "connectionString": CS})
    check("unknown action rejected",
          status == 400 and "unknown action" in body["error"].lower(), str(body))

    status, body = post({"action": "send", "connectionString": "garbage"})
    check("malformed connection string rejected",
          status == 400 and "missing" in body["error"].lower(), str(body))

    status, body = post({"action": "send", "connectionString": CS, "entity": ""})
    check("missing entity rejected",
          status == 400 and "required" in body["error"].lower(), str(body))

    status, body = post({
        "action": "send", "connectionString": CS, "entity": "orders",
        "body": "{}", "properties": "not-an-object",
    })
    check("non-object custom properties rejected",
          status == 400 and "json object" in body["error"].lower(), str(body))

    status, body = post({
        "action": "complete", "connectionString": CS,
        "lockLocation": "https://evil.example.com/steal",
    })
    check("lock URI from another host rejected",
          status == 400 and "namespace" in body["error"].lower(), str(body))

    status, body = post({"action": "complete", "connectionString": CS, "lockLocation": ""})
    check("missing lock URI rejected", status == 400 and "lock uri" in body["error"].lower(), str(body))

    # A syntactically valid but non-existent namespace should surface as a clean
    # network error rather than a stack trace.
    fake = ("Endpoint=sb://this-namespace-does-not-exist-97531.servicebus.windows.net/;"
            f"SharedAccessKeyName=n;SharedAccessKey={KEY}")
    status, body = post({"action": "test", "connectionString": fake, "entity": "q"}, timeout=40)
    check("unreachable namespace reported cleanly",
          status in (502, 504) and body["ok"] is False and "could not reach" in body["error"].lower(),
          f"status={status} body={body}")

except urllib.error.URLError as err:
    print(f"SKIP live endpoint tests -- server not reachable ({err})")

print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
