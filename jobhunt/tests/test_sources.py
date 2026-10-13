import unittest

from jobhunt import http
from jobhunt.sources import ats, boards, companies, funding, hn

from .fixtures import FakeTransport

FX = {"INR": 1.0, "USD": 88.0, "EUR": 95.0, "GBP": 112.0}.get


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.transport = FakeTransport()
        http.set_transport(self.transport)

    def tearDown(self):
        http.set_transport(None)

    def test_greenhouse(self):
        jobs = ats.fetch_greenhouse("acmedata", "Acme Data", FX)
        self.assertEqual(len(jobs), 3)
        job = jobs[0]
        self.assertEqual(job.id, "greenhouse:acmedata:4001")
        self.assertEqual(job.location, "Bengaluru, India")
        self.assertIn("Kafka", job.description)
        self.assertIn("₹35L", job.description)
        self.assertIsNotNone(job.posted_at)

    def test_lever(self):
        (job,) = ats.fetch_lever("zenith", "Zenith", FX)
        self.assertTrue(job.remote)
        self.assertEqual((job.salary_min_lpa, job.salary_max_lpa), (30, 42))
        self.assertIn("Airflow", job.description)
        self.assertTrue(job.apply_url.endswith("/apply"))

    def test_ashby_skips_unlisted_and_reads_comp(self):
        jobs = ats.fetch_ashby("nimbus", "Nimbus", FX)
        self.assertEqual([j.title for j in jobs], ["AI Engineer (LLM Platform)"])
        self.assertEqual((jobs[0].salary_min_lpa, jobs[0].salary_max_lpa), (40, 60))
        self.assertIn("Remote (India)", jobs[0].location)

    def test_smartrecruiters_detail(self):
        (job,) = ats.fetch_smartrecruiters("orbitpay", "Orbitpay", FX)
        self.assertEqual(job.description, "")
        ats.DETAILS["smartrecruiters"](job)
        self.assertIn("idempotent", job.description)
        self.assertIn("/apply", job.apply_url)

    def test_workable_and_recruitee(self):
        (w,) = ats.fetch_workable("quanta", "Quanta", FX)
        self.assertIn("Bengaluru", w.location)
        self.assertTrue(w.remote)
        (r,) = ats.fetch_recruitee("lumen", "Lumen", FX)
        self.assertIn("ClickHouse", r.description)

    def test_workday_list_and_detail(self):
        jobs = ats.fetch_workday("megacorp/wd5/External", "Megacorp", FX)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(jobs[0].location, "India, Bengaluru")
        ats.DETAILS["workday"](jobs[0])
        self.assertIn("Flink", jobs[0].description)
        self.assertTrue(jobs[0].url.startswith("https://megacorp.wd5.myworkdayjobs.com/"))

    def test_resolve_probes_boards(self):
        self.assertEqual(ats.resolve("Acme Data", "acmedata.io"), ("greenhouse", "acmedata"))
        self.assertEqual(ats.resolve("Zenith"), ("lever", "zenith"))
        self.assertEqual(ats.resolve("Nimbus"), ("ashby", "nimbus"))
        self.assertEqual(ats.resolve("Orbitpay"), ("smartrecruiters", "orbitpay"))
        self.assertEqual(ats.resolve("Quanta"), ("workable", "quanta"))
        self.assertEqual(ats.resolve("Lumen"), ("recruitee", "lumen"))
        self.assertEqual(ats.resolve("Megacorp", hint=("workday", "megacorp/wd5/External")),
                         ("workday", "megacorp/wd5/External"))
        self.assertIsNone(ats.resolve("Nobody Here"))

    def test_smartrecruiters_probe_rejects_other_company(self):
        self.transport.overrides["https://api.smartrecruiters.com/v1/companies/zzz/postings"] = {
            "totalFound": 3, "content": [{"company": {"name": "Somebody Else"}}]}
        self.assertFalse(ats.probe_smartrecruiters("zzz", "Zzz"))

    def test_remote_boards(self):
        ok = boards.remoteok(FX)
        self.assertEqual([j.company for j in ok], ["Driftwood", "Statewide"])
        self.assertEqual(ok[0].location, "Remote (Worldwide)")
        self.assertAlmostEqual(ok[0].salary_min_lpa, 79.2)
        remotive = boards.remotive(FX)
        self.assertEqual(remotive[0].salary_min_lpa, 70.4)
        self.assertEqual(boards.himalayas(FX)[0].location, "Remote (India, Singapore)")
        self.assertEqual(boards.jobicy(FX)[0].location, "Remote (APAC)")
        wwr = boards.weworkremotely(FX)
        self.assertEqual((wwr[0].company, wwr[0].title), ("Northwind", "Senior Backend Engineer"))
        (amz,) = boards.amazon(FX)
        self.assertIn("3+ years", amz.description)
        self.assertIsNotNone(amz.posted_at)

    def test_hn(self):
        jobs = hn.who_is_hiring(FX)
        self.assertEqual(len(jobs), 2)
        ferrite = jobs[0]
        self.assertEqual(ferrite.company, "Ferrite")
        self.assertEqual(ferrite.title, "Senior Backend Engineer")
        self.assertIn("Bangalore", ferrite.location)
        self.assertEqual(ferrite.contact_email, "jobs@ferrite.dev")
        self.assertTrue(ferrite.remote)

    def test_yc_filters_to_india_or_remote(self):
        found = companies.yc_hiring()
        self.assertEqual([c["name"] for c in found], ["Ferrite"])
        self.assertEqual(found[0]["domain"], "ferrite.dev")

    def test_funding_scan_skips_old_and_irrelevant(self):
        found = funding.scan(["startup raises"], ["https://feeds.example/missing"], days=45)
        self.assertEqual([f.company for f in found], ["Nimbus"])
        self.assertEqual(found[0].round, "Series B")


if __name__ == "__main__":
    unittest.main()
