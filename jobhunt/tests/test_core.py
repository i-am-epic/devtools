import unittest
from datetime import date

from jobhunt import config
from jobhunt.comp import parse_salary, salary_from_description, structured_to_lpa
from jobhunt.scoring import score_job, years_asked
from jobhunt.sources.funding import parse_headline
from jobhunt.text import company_key, find_emails, html_to_text, keyword_in, slug_candidates

FX = {"INR": 1.0, "USD": 88.0, "EUR": 95.0, "GBP": 112.0}.get


class TextTests(unittest.TestCase):
    def test_html_to_text_handles_double_escaped_greenhouse_content(self):
        text = html_to_text("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Kafka&lt;/li&gt;&lt;/ul&gt;")
        self.assertIn("Hello & welcome", text)
        self.assertIn("- Kafka", text)

    def test_company_key_ignores_suffixes(self):
        self.assertEqual(company_key("Razorpay Software Pvt Ltd"), company_key("Razorpay"))
        self.assertEqual(company_key("Hevo Data Inc."), "hevodata")

    def test_slug_candidates(self):
        self.assertEqual(slug_candidates("Hevo Data", "hevodata.com")[:3], ["hevodata", "hevo-data", "hevo"])
        self.assertIn("gleanwork", slug_candidates("Glean", "gleanwork.com"))

    def test_find_emails_deobfuscates(self):
        self.assertEqual(find_emails("mail jobs [at] ferrite [dot] dev or hi@x.io."), ["jobs@ferrite.dev", "hi@x.io"])

    def test_keyword_boundaries(self):
        self.assertTrue(keyword_in("we use c# and .net core", "c#"))
        self.assertTrue(keyword_in("we use c# and .net core", ".net"))
        self.assertFalse(keyword_in("golang and gopher", "go"))
        self.assertTrue(keyword_in("highly scalable systems", "scalab*"))
        self.assertFalse(keyword_in("internal tools", "intern"))


class CompTests(unittest.TestCase):
    def test_formats(self):
        cases = {
            "₹30L – ₹45L": (30, 45), "INR 25-40 LPA": (25, 40), "₹3M – ₹4.5M": (30, 45),
            "$120k - $160k": (105.6, 140.8), "Rs. 25,00,000 - 35,00,000": (25, 35), "30 LPA": (30, 30),
            "3-5 years": (None, None), "processing 10M events": (None, None),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_salary(text, FX), expected)

    def test_description_ignores_funding_amounts(self):
        text = "We raised $50M Series B last year.\nCompensation: ₹35L - ₹50L + ESOPs"
        self.assertEqual(salary_from_description(text, FX), (35, 50))

    def test_structured(self):
        self.assertEqual(structured_to_lpa(4000000, 6000000, "INR", FX, "1 YEAR"), (40, 60))
        self.assertEqual(structured_to_lpa(50, None, "USD", FX, "per hour"), (91.5, 91.5))


class FundingHeadlineTests(unittest.TestCase):
    def test_parses_common_shapes(self):
        cases = {
            "Bengaluru-based AI startup Sarvam raises $41 Mn in Series A - Inc42 Media": ("Sarvam", "Series A"),
            "Exclusive: Composio raises $25M Series A led by Lightspeed - TechCrunch": ("Composio", "Series A"),
            "Fintech startup Jar bags Rs 250 Cr in Series C funding - Entrackr": ("Jar", "Series C"),
            "Agentic AI platform Atomicwork secures $25 million - YourStory": ("Atomicwork", ""),
        }
        for headline, (company, rnd) in cases.items():
            with self.subTest(headline=headline):
                parsed = parse_headline(headline)
                self.assertEqual((parsed["company"], parsed["round"]), (company, rnd))

    def test_rejects_non_funding(self):
        for headline in ("Why founders should raise less money", "Meesho, Swiggy and Zomato get approval for IPO",
                         "Stripe announces new product for India"):
            self.assertIsNone(parse_headline(headline), headline)

    def test_converts_crore_to_usd(self):
        self.assertAlmostEqual(parse_headline("Jar bags Rs 250 Cr in Series C")["amount_usd_m"], 28.41, places=1)


class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.profile = config.load_profile(config.EXAMPLE_PROFILE)

    def score(self, **job):
        return score_job(job, self.profile, company=job.pop("company_row", None), today=date(2026, 10, 13))

    def test_strong_bengaluru_match(self):
        s = self.score(title="Senior Backend Engineer", location="Bengaluru, India", posted_at="2026-10-10",
                       description="3-6 years of experience. Python, Kafka, Kubernetes, distributed systems, Go.",
                       salary_min_lpa=35, salary_max_lpa=50)
        self.assertTrue(s.eligible)
        self.assertGreater(s.total, 85)
        self.assertIn("go", s.gaps)

    def test_excluded_titles(self):
        for title in ("Engineering Manager", "Senior Frontend Engineer", "Software Engineering Intern",
                      "Principal Engineer", "Android Developer"):
            self.assertFalse(self.score(title=title, location="Bengaluru").eligible, title)
        self.assertTrue(self.score(title="Software Engineer, Internal Tools", location="Bengaluru").eligible)

    def test_remote_regions(self):
        self.assertTrue(self.score(title="Backend Engineer", location="Remote (Worldwide)", remote=True).eligible)
        self.assertTrue(self.score(title="Backend Engineer", location="Remote - India", remote=True).eligible)
        self.assertFalse(self.score(title="Backend Engineer", location="Remote (USA)", remote=True).eligible)
        self.assertFalse(self.score(title="Backend Engineer", location="Remote", remote=True,
                                    description="You must be located in the US.").eligible)

    def test_other_india_cities_need_opt_in(self):
        self.assertFalse(self.score(title="Backend Engineer", location="Hyderabad, India").eligible)
        self.profile.data["target"]["accept_other_india_cities"] = True
        self.assertTrue(self.score(title="Backend Engineer", location="Hyderabad, India").eligible)

    def test_low_band_is_penalised(self):
        high = self.score(title="Backend Engineer", location="Bengaluru", salary_min_lpa=30, salary_max_lpa=40)
        low = self.score(title="Backend Engineer", location="Bengaluru", salary_min_lpa=10, salary_max_lpa=15)
        self.assertGreater(high.total - low.total, 25)

    def test_years_asked(self):
        self.assertEqual(years_asked("You have 8+ years of experience"), (8, None))
        self.assertEqual(years_asked("3-6 years of relevant experience"), (3, 6))
        self.assertIsNone(years_asked("Founded 10 years ago"))
        s = self.score(title="Backend Engineer", location="Bengaluru", description="10+ years of experience required")
        self.assertTrue(any(p == "seniority" and pts < -10 for p, pts, _ in s.reasons))

    def test_company_tier_used_when_no_band(self):
        a = self.score(title="Backend Engineer", location="Bengaluru", company_row={"tier": "A"})
        none = self.score(title="Backend Engineer", location="Bengaluru")
        self.assertGreater(a.total, none.total)


if __name__ == "__main__":
    unittest.main()
