"""Generate expected hash/HMAC vectors with Python's hashlib.

These become the ground truth that scripts/verify-hashes.html checks the
browser implementation against.

    python scripts/gen_hash_vectors.py > scripts/hash-vectors.json
"""
import hashlib
import hmac as hmaclib
import json
import sys

SAMPLES = [
    "",
    "abc",
    "The quick brown fox jumps over the lazy dog",
    "a" * 1000,
    "\U0001f525 unicode - unicode test",
    "x" * 64,
    "y" * 128,
    "z" * 136,
]

HMAC_CASES = [
    {"key": "key", "msg": "The quick brown fox jumps over the lazy dog"},
    {"key": "", "msg": ""},
    {"key": "k" * 200, "msg": "long key gets hashed down first"},
    {"key": "short", "msg": "m" * 500},
]

# our id -> hashlib constructor name
ALGOS = {
    "md5": "md5",
    "sha1": "sha1",
    "sha224": "sha224",
    "sha256": "sha256",
    "sha384": "sha384",
    "sha512": "sha512",
    "sha3-224": "sha3_224",
    "sha3-256": "sha3_256",
    "sha3-384": "sha3_384",
    "sha3-512": "sha3_512",
    "ripemd160": "ripemd160",
}


def make(name):
    try:
        return hashlib.new(name)
    except Exception:
        return None


def main():
    digests = {}
    hmacs = {}
    unavailable = []

    for our_id, py_name in ALGOS.items():
        if make(py_name) is None:
            unavailable.append(our_id)
            continue
        digests[our_id] = [
            hashlib.new(py_name, s.encode("utf-8")).hexdigest() for s in SAMPLES
        ]
        hmacs[our_id] = [
            hmaclib.new(c["key"].encode("utf-8"), c["msg"].encode("utf-8"), py_name).hexdigest()
            for c in HMAC_CASES
        ]

    out = {
        "samples": SAMPLES,
        "hmacCases": HMAC_CASES,
        "digests": digests,
        "hmacs": hmacs,
        "unavailableInPython": unavailable,
    }
    json.dump(out, sys.stdout, indent=1)
    print()
    print(f"# generated with Python {sys.version.split()[0]}", file=sys.stderr)
    if unavailable:
        print(f"# not available in this Python/OpenSSL build: {unavailable}", file=sys.stderr)


if __name__ == "__main__":
    main()
