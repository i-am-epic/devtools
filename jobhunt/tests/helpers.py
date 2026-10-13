import os
import shutil
import tempfile
import unittest
from pathlib import Path

from jobhunt import config, db, http

from .fixtures import FakeTransport

SEED = """
company = [
  { name = "Acme Data", domain = "acmedata.io", tier = "A", category = "Data", why = "Streaming analytics" },
  { name = "Zenith", domain = "zenith.finance", tier = "B", category = "Fintech" },
  { name = "Nimbus", domain = "nimbus.ai", tier = "A", category = "AI" },
  { name = "Orbitpay", domain = "orbitpay.com", tier = "B" },
  { name = "Quanta", domain = "quanta.dev" },
  { name = "Lumen", domain = "lumen.io" },
  { name = "Megacorp", domain = "megacorp.com", tier = "A", ats = "workday", slug = "megacorp/wd5/External" },
]
"""


class Isolated(unittest.TestCase):
    """Fresh JOBHUNT_HOME, example profile, small seed list, fake network, no LLM."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="jobhunt-test-"))
        seed = self.tmp / "companies.toml"
        seed.write_text(SEED)
        self._env = {k: os.environ.get(k) for k in
                     ("JOBHUNT_HOME", "JOBHUNT_PROFILE", "JOBHUNT_NO_LLM", "JOBHUNT_COMPANIES")}
        os.environ.update(JOBHUNT_HOME=str(self.tmp / "home"), JOBHUNT_PROFILE=str(self.tmp / "none.toml"),
                          JOBHUNT_NO_LLM="1", JOBHUNT_COMPANIES=str(seed))
        self.transport = FakeTransport()
        http.set_transport(self.transport)
        self.profile = config.load_profile()
        self.conn = db.connect()

    def tearDown(self):
        self.conn.close()
        http.set_transport(None)
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)
