from datetime import date, timedelta

from jobhunt import db, inbox, pipeline, prep

from .helpers import Isolated

RAW = b"""From: Priya from Nimbus <priya@nimbus.ai>
To: you@example.com
Subject: Nimbus - next steps for AI Engineer
Date: Mon, 12 Oct 2026 10:00:00 +0530
Message-ID: <abc123@nimbus.ai>
Content-Type: text/plain; charset=utf-8

Hi, thanks for applying! We'd love to schedule a 30 minute call. Please share your availability.
"""


def mail(subject, body, sender="recruiting@nimbus.ai", mid=None):
    domain = sender.rsplit("@", 1)[-1]
    return inbox.Mail(message_id=mid or f"<{subject}>", received_at="2026-10-12T10:00:00+05:30",
                      sender=sender, sender_domain=domain, subject=subject, body=body)


class ClassifyTests(Isolated):
    def test_rules(self):
        cases = {
            ("Your application", "Unfortunately we have decided to move forward with other candidates."): "rejection",
            ("Interview invitation", "Please book a time on my calendly"): "interview",
            ("Coding assessment", "Please complete the HackerRank test, next steps after that"): "assessment",
            ("Application received", "Thank you for applying to Nimbus"): "ack",
            ("Offer", "We are pleased to extend an offer"): "offer",
            ("Thanks for your application", "Unfortunately the position has been filled"): "rejection",
        }
        for (subject, body), label in cases.items():
            self.assertEqual(inbox.classify(subject, body), label, subject)

    def test_parse_raw(self):
        m = inbox.parse(RAW)
        self.assertEqual(m.sender_domain, "nimbus.ai")
        self.assertEqual(m.message_id, "<abc123@nimbus.ai>")
        self.assertIn("availability", m.body)


class ProcessTests(Isolated):
    def setUp(self):
        super().setUp()
        pipeline.discover(self.conn, self.profile, log=lambda *_: None)
        self.ai = self.conn.execute("SELECT * FROM jobs WHERE title = 'AI Engineer (LLM Platform)'").fetchone()
        self.streaming = self.conn.execute(
            "SELECT * FROM jobs WHERE title = 'Senior Backend Engineer, Streaming'").fetchone()
        db.set_status(self.conn, self.ai["n"], "applied")
        db.set_status(self.conn, self.streaming["n"], "applied")
        self.conn.commit()
        self.preps = []

    def run_process(self, mails):
        writer = lambda row: self.preps.append(prep.write_plan(self.conn, self.profile, db.job(self.conn, row["n"])))
        return inbox.process(self.conn, self.profile, mails, prep_writer=writer)

    def test_interview_moves_status_and_writes_prep(self):
        results = self.run_process([inbox.parse(RAW)])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["job"]["n"], self.ai["n"])
        self.assertEqual(db.job(self.conn, self.ai["n"])["status"], "interview")
        self.assertTrue(self.preps and self.preps[0].exists())
        # Idempotent: the same message is not processed twice.
        self.assertEqual(self.run_process([inbox.parse(RAW)]), [])

    def test_ats_rejection_matched_by_company_name(self):
        m = mail("Your application to Acme Data", "Unfortunately, we will not be moving forward.",
                 sender="no-reply@greenhouse-mail.io")
        (result,) = self.run_process([m])
        self.assertEqual(result["job"]["n"], self.streaming["n"])
        self.assertEqual(db.job(self.conn, self.streaming["n"])["status"], "rejected")

    def test_unmatched_outreach_kept_and_alerts_dropped(self):
        outreach = mail("Exciting backend opportunity at Hooli", "Came across your profile...",
                        sender="jane@hooli.com")
        alert = mail("25 new jobs for backend engineer", "Hooli is hiring", sender="jobalerts-noreply@linkedin.com")
        results = self.run_process([outreach, alert])
        self.assertEqual([r["label"] for r in results], ["unmatched:outreach"])

    def test_followups(self):
        old = (date.today() - timedelta(days=9)).isoformat()
        older = (date.today() - timedelta(days=40)).isoformat()
        self.conn.execute("UPDATE jobs SET applied_at = ? WHERE n = ?", (old, self.ai["n"]))
        self.conn.execute("UPDATE jobs SET applied_at = ? WHERE n = ?", (older, self.streaming["n"]))
        fu = inbox.followups(self.conn)
        self.assertEqual([r["n"] for r, _, _ in fu["due"]], [self.ai["n"]])
        self.assertEqual([r["n"] for r, _ in fu["ghosted"]], [self.streaming["n"]])
        db.log(self.conn, self.ai["n"], "followup")
        self.assertEqual(inbox.followups(self.conn)["due"], [])
