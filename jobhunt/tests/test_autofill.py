import os
import unittest

from jobhunt import autofill, config

from .fixtures import APPLY_FORM
from .helpers import Isolated

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


def field(i, label="", name="", type_="text", required=False, value="", tag="input"):
    return {"i": i, "tag": tag, "type": type_, "name": name, "id": "", "placeholder": "", "aria": "",
            "label": label, "value": value, "visible": True, "required": required}


class PlanTests(unittest.TestCase):
    def test_classify(self):
        self.assertEqual(autofill.classify_field(field(0, "First Name *")), "first_name")
        self.assertEqual(autofill.classify_field(field(0, name="urls[LinkedIn]")), "linkedin")
        self.assertEqual(autofill.classify_field(field(0, "Full name")), "full_name")
        self.assertIsNone(autofill.classify_field(field(0, "Name of the person who referred you")))
        self.assertIsNone(autofill.classify_field(field(0, "University name")))

    def test_plan_reports_required_unknowns(self):
        fields = [field(0, "Email", required=True), field(1, "Why us?", tag="textarea", required=True),
                  field(2, "Resume", type_="file"), field(3, "Email again", value="already@set.com")]
        values = {"email": "me@x.com"}
        actions, pending = autofill.plan_fill(fields, values, resume=config.ROOT / "README.md", letter_file=None)
        self.assertIn((0, "fill", "me@x.com"), actions)
        self.assertTrue(any(kind == "file" for _, kind, _ in actions))
        self.assertNotIn(3, [i for i, _, _ in actions])
        self.assertEqual(pending, ["Why us?"])


@unittest.skipIf(sync_playwright is None, "playwright not installed")
class BrowserTests(Isolated):
    def test_fills_a_greenhouse_style_form(self):
        form = self.tmp / "form.html"
        form.write_text(APPLY_FORM)
        resume = self.tmp / "resume.pdf"
        resume.write_bytes(b"%PDF-1.4 test")
        letter = self.tmp / "cover_letter.txt"
        letter.write_text("Dear team")
        self.profile.data["me"]["email"] = "me@example.com"
        values = autofill.values_for(self.profile, {"Expected CTC": "40 LPA (negotiable)"}, "Dear team")
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=os.environ.get("JOBHUNT_CHROMIUM") or None)
                page = browser.new_page()
                page.goto(form.as_uri())
                filled, pending = autofill.fill_page(page, values, resume, letter)
                got = {n: page.locator(f"[name='{n}']").input_value() for n in (
                    "job_application[first_name]", "job_application[last_name]", "job_application[email]",
                    "urls[LinkedIn]", "urls[GitHub]", "urls[Portfolio]", "org", "q1", "q2", "q3", "cover_letter")}
                uploaded = page.evaluate("document.querySelector('#resume').files[0].name")
                browser.close()
        except Exception as exc:  # no browser available in this environment
            self.skipTest(f"chromium unavailable: {exc}")
        self.assertEqual(got["job_application[first_name]"], "Your")
        self.assertEqual(got["job_application[last_name]"], "Name")
        self.assertEqual(got["job_application[email]"], "me@example.com")
        self.assertEqual(got["urls[LinkedIn]"], self.profile.me["linkedin"])
        self.assertEqual(got["urls[GitHub]"], self.profile.me["github"])
        self.assertEqual(got["urls[Portfolio]"], "")
        self.assertEqual(got["org"], "Current Co")
        self.assertEqual(got["q1"], self.profile.me["notice_period"])
        self.assertEqual(got["q2"], "40")
        self.assertEqual(got["q3"], "")  # referrer name is never guessed
        self.assertEqual(got["cover_letter"], "Dear team")
        self.assertEqual(uploaded, "resume.pdf")
        self.assertEqual(pending, ["Why do you want to join us? *"])
        self.assertGreaterEqual(filled, 11)
