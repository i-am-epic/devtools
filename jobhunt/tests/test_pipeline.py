import io
import unittest
from contextlib import redirect_stdout

from jobhunt import cli, db, materials, pipeline, prep, report
from jobhunt.text import company_key

from .fixtures import GREENHOUSE_JOBS
from .helpers import Isolated


def quiet(*_):
    pass


class PipelineTests(Isolated):
    def discover(self):
        return pipeline.discover(self.conn, self.profile, log=quiet)

    def by_title(self, title):
        return self.conn.execute("SELECT * FROM jobs WHERE title = ?", (title,)).fetchone()

    def test_discover_end_to_end(self):
        stats = self.discover()
        self.assertEqual(stats["errors"], [])
        self.assertGreaterEqual(stats["seen"], 15)

        # Boards were resolved by probing, and remembered.
        boards = {r["name"]: (r["ats"], r["ats_slug"]) for r in db.companies(self.conn, "ats IS NOT NULL")}
        self.assertEqual(boards["Acme Data"], ("greenhouse", "acmedata"))
        self.assertEqual(boards["Nimbus"], ("ashby", "nimbus"))
        self.assertEqual(boards["Orbitpay"], ("smartrecruiters", "orbitpay"))

        streaming = self.by_title("Senior Backend Engineer, Streaming")
        self.assertTrue(streaming["eligible"])
        self.assertGreater(streaming["score"], 70)
        self.assertFalse(self.by_title("Engineering Manager, Platform")["eligible"])
        self.assertFalse(self.conn.execute(
            "SELECT eligible FROM jobs WHERE source='greenhouse' AND title='Backend Engineer'").fetchone()[0])

        # SmartRecruiters / Workday descriptions are fetched lazily for plausible jobs only.
        self.assertIn("idempotent", self.by_title("Backend Developer - Payments")["description"])
        self.assertIn("Flink", self.by_title("Senior Software Engineer - Data Streaming")["description"])
        self.assertFalse(self.by_title("Software Engineer")["description"])

        # Region-locked remote jobs are filtered out.
        self.assertFalse(self.conn.execute("SELECT eligible FROM jobs WHERE company='Statewide'").fetchone()[0])
        self.assertTrue(self.conn.execute("SELECT eligible FROM jobs WHERE company='Driftwood'").fetchone()[0])

        # Funding news reached the company and the score.
        nimbus = db.company(self.conn, company_key("Nimbus"))
        self.assertEqual(nimbus["funding_round"], "Series B")
        ai = self.by_title("AI Engineer (LLM Platform)")
        self.assertTrue(any("raised" in b["why"] for b in db.breakdown(ai)))

        top = db.top_jobs(self.conn, limit=10, per_company=1)
        self.assertGreater(len(top), 5)
        self.assertEqual([r["score"] for r in top], sorted([r["score"] for r in top], reverse=True))
        self.assertEqual(len({r["company_key"] for r in top}), len(top))

    def test_rerun_keeps_status_and_closes_vanished_postings(self):
        self.discover()
        streaming = self.by_title("Senior Backend Engineer, Streaming")
        ai = self.by_title("AI Engineer (LLM Platform)")
        db.set_status(self.conn, ai["n"], "applied")
        self.conn.commit()
        self.transport.overrides["https://boards-api.greenhouse.io/v1/boards/acmedata/jobs"] = {
            "jobs": GREENHOUSE_JOBS["jobs"][1:]}
        self.discover()
        self.assertEqual(db.job(self.conn, streaming["n"])["status"], "closed")
        self.assertEqual(db.job(self.conn, ai["n"])["status"], "applied")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM jobs WHERE id = ?", (ai["id"],)).fetchone()[0], 1)

    def test_status_never_moves_backwards(self):
        self.discover()
        n = self.by_title("AI Engineer (LLM Platform)")["n"]
        self.assertTrue(db.set_status(self.conn, n, "interview"))
        self.assertFalse(db.set_status(self.conn, n, "applied"))
        self.assertTrue(db.set_status(self.conn, n, "rejected"))
        self.assertFalse(db.set_status(self.conn, n, "interview"))
        self.assertTrue(db.set_status(self.conn, n, "interview", force=True))


class MaterialsTests(Isolated):
    def setUp(self):
        super().setUp()
        pipeline.discover(self.conn, self.profile, log=quiet)
        self.row = self.conn.execute("SELECT * FROM jobs WHERE title = 'AI Engineer (LLM Platform)'").fetchone()

    def test_kit_files(self):
        path = materials.write_kit(self.conn, self.profile, self.row)
        names = {p.name for p in path.iterdir()}
        self.assertEqual(names, {"README.md", "cover_letter.md", "answers.md", "referral.md", "job.md"})
        letter = (path / "cover_letter.md").read_text()
        self.assertIn("Dear Nimbus hiring team", letter)
        self.assertIn("retrieval-augmented assistant", letter)  # the RAG highlight leads for an LLM role
        self.assertIn(self.profile.name, letter)
        answers = (path / "answers.md").read_text()
        self.assertIn("Expected CTC:** 40 LPA", answers)  # posted band beats the profile's 30
        referral = (path / "referral.md").read_text()
        self.assertIn("linkedin.com/search/results/people", referral)
        self.assertIn(self.profile.me["college"], referral)

    def test_connection_note_fits_linkedin_limit(self):
        for row in db.jobs(self.conn):
            note = materials.referral_messages(self.profile, row)["LinkedIn connection note (<=300 chars)"]
            self.assertLessEqual(len(note.replace("{name}", "Alexandra")), 300, row["title"])

    def test_parse_board_url(self):
        cases = {
            "https://boards.greenhouse.io/stripe/jobs/123": ("greenhouse", "stripe"),
            "https://job-boards.greenhouse.io/gleanwork": ("greenhouse", "gleanwork"),
            "https://jobs.lever.co/cred/abc-123/apply": ("lever", "cred"),
            "https://jobs.ashbyhq.com/openai": ("ashby", "openai"),
            "https://apply.workable.com/hasura/j/ABC/": ("workable", "hasura"),
            "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x":
                ("workday", "nvidia/wd5/NVIDIAExternalCareerSite"),
        }
        for url, expected in cases.items():
            self.assertEqual(materials.parse_board_url(url), expected, url)
        self.assertIsNone(materials.parse_board_url("https://example.com/careers"))

    def test_prep_plan(self):
        plan = prep.build_plan(self.conn, self.profile, self.row)
        self.assertIn("RAG service", plan)          # domain-specific design prompt
        self.assertIn("**llm**", plan)                # JD topic
        self.assertIn("Your own system", plan)
        self.assertEqual(plan.count("- [ ] **"), 7)  # a week of days

    def test_report_and_campaign(self):
        html = report.build(self.conn, self.profile)
        self.assertIn("Nimbus", html)
        self.assertIn("Recently funded", html)
        out = io.StringIO()
        with redirect_stdout(out):
            cli.main(["campaign", "-n", "5", "--min-score", "40"])
        self.assertIn("campaign checklist", out.getvalue())
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM jobs WHERE status='shortlisted'").fetchone()[0], 5)


if __name__ == "__main__":
    unittest.main()
