"""Generate Parquet test fixtures covering the cases the viewer must handle.

The fixtures are gitignored; regenerate them when you need to run
scripts/parquet-test.html. pyarrow is only needed for this script, not for
running the site:

    python -m venv .venv
    .venv/Scripts/python -m pip install pyarrow      # or .venv/bin/python on unix
    .venv/Scripts/python scripts/make_parquet_fixtures.py

Covers: multiple row groups, snappy/gzip/zstd/uncompressed codecs, nulls,
decimals, timestamps, dates, nested lists and structs, and a file whose schema
deliberately disagrees with the others.
"""
import datetime as dt
from decimal import Decimal
import os
import random

import pyarrow as pa
import pyarrow.parquet as pq

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(OUT, exist_ok=True)

random.seed(7)

CITIES = ["London", "Berlin", "Tokyo", "New York", "Sydney", None]

# ---------------------------------------------------------------- file 1 ---
# Wide type coverage, nulls, multiple row groups, snappy.
n = 5000
table1 = pa.table({
    "id": pa.array(range(1, n + 1), type=pa.int64()),
    "name": pa.array([f"user_{i:05d}" for i in range(1, n + 1)], type=pa.string()),
    "age": pa.array([random.randint(18, 90) if i % 17 else None for i in range(n)], type=pa.int32()),
    "score": pa.array([round(random.uniform(0, 100), 3) for _ in range(n)], type=pa.float64()),
    "active": pa.array([random.choice([True, False, None]) for _ in range(n)], type=pa.bool_()),
    "city": pa.array([random.choice(CITIES) for _ in range(n)], type=pa.string()),
    "balance": pa.array([Decimal(f'{random.uniform(-500, 9999):.2f}') for _ in range(n)], type=pa.decimal128(12, 2)),
    "created_at": pa.array(
        [dt.datetime(2024, 1, 1) + dt.timedelta(minutes=i * 7) for i in range(n)],
        type=pa.timestamp("ms"),
    ),
    "birth_date": pa.array(
        [dt.date(1960, 1, 1) + dt.timedelta(days=random.randint(0, 20000)) for _ in range(n)],
        type=pa.date32(),
    ),
})
pq.write_table(table1, os.path.join(OUT, "users_snappy.parquet"),
               compression="snappy", row_group_size=1500)

# ---------------------------------------------------------------- file 2 ---
# Same schema, different data -> stacking should work cleanly.
m = 2000
table2 = pa.table({
    "id": pa.array(range(10001, 10001 + m), type=pa.int64()),
    "name": pa.array([f"user_{i:05d}" for i in range(10001, 10001 + m)], type=pa.string()),
    "age": pa.array([random.randint(18, 90) for _ in range(m)], type=pa.int32()),
    "score": pa.array([round(random.uniform(0, 100), 3) for _ in range(m)], type=pa.float64()),
    "active": pa.array([random.choice([True, False]) for _ in range(m)], type=pa.bool_()),
    "city": pa.array([random.choice(CITIES) for _ in range(m)], type=pa.string()),
    "balance": pa.array([Decimal(f'{random.uniform(-500, 9999):.2f}') for _ in range(m)], type=pa.decimal128(12, 2)),
    "created_at": pa.array(
        [dt.datetime(2025, 6, 1) + dt.timedelta(minutes=i * 3) for i in range(m)],
        type=pa.timestamp("ms"),
    ),
    "birth_date": pa.array(
        [dt.date(1960, 1, 1) + dt.timedelta(days=random.randint(0, 20000)) for _ in range(m)],
        type=pa.date32(),
    ),
})
pq.write_table(table2, os.path.join(OUT, "users_part2.parquet"), compression="snappy")

# ---------------------------------------------------------------- file 3 ---
# Different schema -> the compare view should flag the mismatches.
table3 = pa.table({
    "id": pa.array(range(1, 101), type=pa.int64()),
    "name": pa.array([f"other_{i}" for i in range(1, 101)], type=pa.string()),
    "age": pa.array([str(random.randint(18, 90)) for _ in range(100)], type=pa.string()),  # type differs
    "department": pa.array([random.choice(["eng", "sales", "ops"]) for _ in range(100)], type=pa.string()),
})
pq.write_table(table3, os.path.join(OUT, "employees_gzip.parquet"), compression="gzip")

# ---------------------------------------------------------------- file 4 ---
# Uncompressed, nested struct and list -> exercises the flattening paths.
table4 = pa.table({
    "id": pa.array([1, 2, 3], type=pa.int64()),
    "tags": pa.array([["a", "b"], ["c"], []], type=pa.list_(pa.string())),
    "meta": pa.array(
        [{"k": "x", "n": 1}, {"k": "y", "n": 2}, {"k": "z", "n": 3}],
        type=pa.struct([("k", pa.string()), ("n", pa.int32())]),
    ),
})
pq.write_table(table4, os.path.join(OUT, "nested_plain.parquet"), compression="none")

# ---------------------------------------------------------------- file 5 ---
# Zstd, to check the compressors bundle loads.
pq.write_table(table2, os.path.join(OUT, "users_zstd.parquet"), compression="zstd")

for name in sorted(os.listdir(OUT)):
    path = os.path.join(OUT, name)
    meta = pq.ParquetFile(path).metadata
    print(f"{name:26} {meta.num_rows:>6} rows  {meta.num_columns} cols  "
          f"{meta.num_row_groups} groups  {os.path.getsize(path):>8} bytes")
