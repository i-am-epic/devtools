#!/usr/bin/env python3
"""Tests for the upgrade-pilot chain.

Standard library only, so they run on a bare build agent:

    python -m unittest discover -s tests -v
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import apply as apply_mod          # noqa: E402
import inventory                   # noqa: E402
import report                      # noqa: E402
import scans                       # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


class TestEcosystem(unittest.TestCase):
    def test_os_packages_are_tagged_os(self):
        self.assertEqual(scans.ecosystem_of("os-pkgs", "debian"), "os")

    def test_scanner_names_map_to_our_vocabulary(self):
        for given, expected in [("npm", "npm"), ("yarn", "npm"), ("pip", "pypi"),
                                ("poetry", "pypi"), ("nuget", "nuget"),
                                ("dotnet-core", "nuget"), ("pubspec", "pub")]:
            self.assertEqual(scans.ecosystem_of("lang-pkgs", given), expected, given)

    def test_unknown_type_is_not_guessed(self):
        self.assertEqual(scans.ecosystem_of("lang-pkgs", "cargo"), "unknown")


class TestDedupe(unittest.TestCase):
    def _finding(self, **kw):
        base = {"source": "trivy", "kind": "vulnerability", "id": "CVE-1", "severity": "medium",
                "package": "left-pad", "installed": "1.0.0", "fixed": None, "title": "",
                "target": "", "class": "lang-pkgs", "ecosystem": "npm", "actionable": False,
                "refs": []}
        base.update(kw)
        return base

    def test_same_advisory_from_two_scanners_collapses(self):
        out = scans.dedupe([self._finding(), self._finding(source="metadefender")])
        self.assertEqual(len(out), 1)
        self.assertEqual(sorted(out[0]["sources"]), ["metadefender", "trivy"])

    def test_highest_severity_wins(self):
        out = scans.dedupe([self._finding(severity="medium"),
                            self._finding(source="metadefender", severity="critical")])
        self.assertEqual(out[0]["severity"], "critical")

    def test_the_record_that_knows_the_fix_wins(self):
        out = scans.dedupe([
            self._finding(source="metadefender", fixed=None, actionable=False),
            self._finding(fixed="1.3.0", actionable=True)])
        self.assertEqual(out[0]["fixed"], "1.3.0")
        self.assertTrue(out[0]["actionable"])

    def test_a_known_ecosystem_beats_unknown(self):
        out = scans.dedupe([self._finding(ecosystem="unknown"),
                            self._finding(source="metadefender", ecosystem="npm")])
        self.assertEqual(out[0]["ecosystem"], "npm")

    def test_different_packages_are_not_merged(self):
        out = scans.dedupe([self._finding(), self._finding(package="lodash")])
        self.assertEqual(len(out), 2)

    def test_findings_without_a_package_pass_through(self):
        gate = self._finding(id="quality_gate", package=None, kind="quality-gate")
        self.assertEqual(len(scans.dedupe([gate, gate])), 2)


class TestFixtures(unittest.TestCase):
    def test_every_fixture_loads(self):
        self.assertTrue(scans.load_trivy(FIXTURES / "trivy.json"))
        self.assertTrue(scans.load_sonar(FIXTURES / "sonar.json"))
        self.assertTrue(scans.load_metadefender(FIXTURES / "metadefender.json"))

    def test_trivy_os_finding_is_routed_away_from_npm(self):
        os_findings = [f for f in scans.load_trivy(FIXTURES / "trivy.json")
                       if f.get("ecosystem") == "os"]
        self.assertEqual([f["package"] for f in os_findings], ["glibc"])

    def test_a_vulnerability_without_a_fixed_version_is_not_actionable(self):
        by_id = {f["id"]: f for f in scans.load_trivy(FIXTURES / "trivy.json")}
        self.assertFalse(by_id["CVE-2026-90210"]["actionable"])


class TestExceptions(unittest.TestCase):
    def setUp(self):
        self.findings = [
            {"id": "CVE-9", "package": "reactflow", "severity": "high",
             "kind": "vulnerability", "source": "trivy", "actionable": False},
            {"id": "CVE-8", "package": "vite", "severity": "high",
             "kind": "vulnerability", "source": "trivy", "actionable": True, "fixed": "5.4.22"},
        ]
        self.exc = [{"advisory": "CVE-9", "package": "reactflow",
                     "reason": "labels are not user-controlled", "expires": "2030-01-01"}]

    def test_a_live_exception_suppresses(self):
        kept, suppressed, expired = report.apply_exceptions(
            self.findings, self.exc, "2026-09-22")
        self.assertEqual([f["id"] for f in kept], ["CVE-8"])
        self.assertEqual(len(suppressed), 1)
        self.assertEqual(expired, [])

    def test_an_expired_exception_does_not_suppress(self):
        stale = [{**self.exc[0], "expires": "2026-01-01"}]
        kept, suppressed, expired = report.apply_exceptions(
            self.findings, stale, "2026-09-22")
        self.assertEqual(len(kept), 2)
        self.assertEqual(suppressed, [])
        self.assertEqual(len(expired), 1)

    def test_package_must_match_when_given(self):
        wrong = [{**self.exc[0], "package": "somethingelse"}]
        kept, suppressed, _ = report.apply_exceptions(self.findings, wrong, "2026-09-22")
        self.assertEqual(len(kept), 2)
        self.assertEqual(suppressed, [])

    def test_entries_without_an_expiry_are_rejected(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"exceptions": [{"advisory": "CVE-9"}]}, fh)
        self.assertEqual(report.load_exceptions(fh.name), [])


class TestBranchPolicy(unittest.TestCase):
    def setUp(self):
        self.inventory = {"summary": {"total": 2}, "packages": [
            {"name": "vite", "ecosystem": "npm", "resolved": "5.4.21",
             "latest": "5.4.30", "gap": "minor", "changelog": []},
            {"name": "framer-motion", "ecosystem": "npm", "resolved": "13.4.0",
             "latest": "14.0.1", "gap": "major", "changelog": []},
            # Routine currency, no finding attached: mainline should take it,
            # a release branch should not. Without this the two policies
            # produce identical plans and the test proves nothing.
            {"name": "postcss", "ecosystem": "npm", "resolved": "8.5.6",
             "latest": "8.5.28", "gap": "minor", "changelog": []},
        ]}
        self.findings = [
            {"id": "CVE-A", "package": "vite", "severity": "high", "kind": "vulnerability",
             "source": "trivy", "actionable": True, "fixed": "5.4.22", "ecosystem": "npm"},
            {"id": "CVE-B", "package": "framer-motion", "severity": "critical",
             "kind": "vulnerability", "source": "trivy", "actionable": True,
             "fixed": "14.0.1", "ecosystem": "npm"},
            {"id": "quality_gate", "kind": "quality-gate", "severity": "info",
             "source": "sonar", "package": None, "measures": {"coverage": "80"}},
        ]

    def test_release_branch_is_a_subset_of_mainline(self):
        main = report.build(self.inventory, self.findings, "main", 60.0)
        rel = report.build(self.inventory, self.findings, "release/26.1", 60.0)
        self.assertEqual(rel["policy"]["name"], "release")
        self.assertLess(len(rel["auto"]), len(main["auto"]))
        self.assertTrue({p["package"] for p in rel["auto"]}
                        <= {p["package"] for p in main["auto"]})

    def test_release_branch_takes_no_routine_work(self):
        rel = report.build(self.inventory, self.findings, "release/26.1", 60.0)
        self.assertTrue(all(i["reason"] == "security" for i in rel["auto"]))
        self.assertNotIn("postcss", [i["package"] for i in rel["auto"]])

    def test_mainline_does_take_routine_work(self):
        main = report.build(self.inventory, self.findings, "main", 60.0)
        self.assertIn("postcss", [i["package"] for i in main["auto"]])

    def test_a_major_is_never_auto_applied(self):
        for branch in ("main", "release/26.1"):
            plan = report.build(self.inventory, self.findings, branch, 60.0)
            self.assertNotIn("framer-motion", [i["package"] for i in plan["auto"]], branch)

    def test_bare_version_branch_is_treated_as_a_release_branch(self):
        self.assertEqual(report.branch_policy("26.1")["name"], "release")

    def test_auto_items_carry_an_ecosystem(self):
        plan = report.build(self.inventory, self.findings, "main", 60.0)
        self.assertTrue(all(i.get("ecosystem") for i in plan["auto"]))


class TestAutoMergeGate(unittest.TestCase):
    def _gate(self, **measures):
        return [{"kind": "quality-gate", "severity": "info", "source": "sonar",
                 "measures": measures, "id": "quality_gate", "package": None}]

    def test_no_sonar_result_blocks_auto_merge(self):
        allowed, why = report.gate([], 60.0)
        self.assertFalse(allowed)
        self.assertIn("no Sonar result", why)

    def test_coverage_below_the_bar_blocks(self):
        allowed, _ = report.gate(self._gate(coverage="41.2"), 60.0)
        self.assertFalse(allowed)

    def test_coverage_above_the_bar_allows(self):
        allowed, _ = report.gate(self._gate(coverage="71.4"), 60.0)
        self.assertTrue(allowed)

    def test_a_failing_quality_gate_blocks_regardless_of_coverage(self):
        failing = self._gate(coverage="99")
        failing[0]["severity"] = "high"
        allowed, why = report.gate(failing, 60.0)
        self.assertFalse(allowed)
        self.assertIn("quality gate", why)


class TestVersionComparison(unittest.TestCase):
    def test_classification(self):
        for cur, latest, expected in [
            ("1.2.3", "2.0.0", "major"), ("1.2.3", "1.3.0", "minor"),
            ("1.2.3", "1.2.4", "patch"), ("1.2.3", "1.2.3", "current"),
            ("2.0.0", "1.9.9", "current"), (None, "1.0.0", "unpinned"),
            ("1.0.0", None, "unknown"),
        ]:
            self.assertEqual(inventory.classify(cur, latest), expected, f"{cur}->{latest}")

    def test_parse_tolerates_range_operators_and_suffixes(self):
        self.assertEqual(inventory.parse("1.2.3"), [1, 2, 3])
        self.assertEqual(inventory.parse("1.2"), [1, 2, 0])
        self.assertEqual(inventory.parse("6.1.5+1"), [6, 1, 5])


class TestApplyEcosystemResolution(unittest.TestCase):
    INV = {"packages": [{"name": "Serilog", "ecosystem": "nuget"}]}

    def test_declared_ecosystem_is_used(self):
        self.assertEqual(apply_mod.resolve_eco("anything", "pypi", None), "pypi")

    def test_falls_back_to_the_inventory(self):
        self.assertEqual(apply_mod.resolve_eco("Serilog", None, self.INV), "nuget")

    def test_unknown_is_not_guessed_as_npm(self):
        self.assertIsNone(apply_mod.resolve_eco("mystery", None, self.INV))
        self.assertIsNone(apply_mod.resolve_eco("mystery", "unknown", self.INV))

    def test_an_os_package_never_resolves_to_an_installer(self):
        self.assertIsNone(apply_mod.resolve_eco("glibc", "os", None))

    def test_install_command_is_per_ecosystem(self):
        self.assertIn("npm", apply_mod.install_cmd("npm", "left-pad", "1.3.0", False))
        self.assertIn("dotnet", apply_mod.install_cmd("nuget", "Serilog", "4.0.0", False))
        self.assertIsNone(apply_mod.install_cmd("os", "glibc", "2.36", False))


class TestManifestDiscovery(unittest.TestCase):
    """Looking only at the repository root reported a monorepo as having no
    dependencies at all - worse than reporting none, because it reads as clean."""

    def _repo(self, d: str) -> Path:
        root = Path(d)
        (root / "package.json").write_text('{"dependencies":{"react":"^19.0.0"}}')
        (root / "web").mkdir()
        (root / "web" / "package.json").write_text('{"dependencies":{"next":"16.0.0"}}')
        (root / "services" / "api").mkdir(parents=True)
        (root / "services" / "api" / "requirements.txt").write_text("flask==3.1.3\n")
        (root / "node_modules" / "left-pad").mkdir(parents=True)
        (root / "node_modules" / "left-pad" / "package.json").write_text(
            '{"dependencies":{"should-not-appear":"1.0.0"}}')
        return root

    def test_nested_manifests_are_found(self):
        with tempfile.TemporaryDirectory() as d:
            found = inventory.detect(self._repo(d))
            ecos = {eco for eco, _ in found}
            self.assertEqual(ecos, {"npm", "pypi"})
            self.assertEqual(len(found), 3)      # root, web/, services/api/

    def test_vendored_directories_are_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            paths = [str(where) for _eco, where in inventory.detect(self._repo(d))]
            self.assertFalse(any("node_modules" in p for p in paths))

    def test_depth_is_bounded(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            deep = root / "a" / "b" / "c" / "d" / "e"
            deep.mkdir(parents=True)
            (deep / "package.json").write_text("{}")
            self.assertEqual(inventory.detect(root, max_depth=3), [])

    def test_a_repo_with_no_manifest_returns_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "README.md").write_text("# docs only")
            self.assertEqual(inventory.detect(Path(d)), [])


class TestManifestReaders(unittest.TestCase):
    def test_lockfile_beats_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "package.json").write_text(json.dumps(
                {"dependencies": {"vite": "^5.3.1"}}))
            (root / "package-lock.json").write_text(json.dumps(
                {"packages": {"node_modules/vite": {"version": "5.4.21"}}}))
            rows = inventory.read_npm(root)
            vite = next(r for r in rows if r["name"] == "vite")
            self.assertEqual(vite["spec"], "^5.3.1")
            self.assertEqual(vite["resolved"], "5.4.21")

    def test_central_package_management_supplies_the_version(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "Directory.Packages.props").write_text(
                '<Project><ItemGroup>'
                '<PackageVersion Include="Serilog" Version="4.0.0" />'
                '</ItemGroup></Project>')
            (root / "app.csproj").write_text(
                '<Project><ItemGroup>'
                '<PackageReference Include="Serilog" />'
                '</ItemGroup></Project>')
            rows = inventory.read_nuget(root)
            serilog = next(r for r in rows if r["name"] == "Serilog")
            self.assertEqual(serilog["spec"], "4.0.0")

    def test_extras_marker_does_not_truncate_the_dependency_list(self):
        # A regex ending at the first "]" stopped inside uvicorn[standard] and
        # silently dropped every dependency after it. Found on a real repo.
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "pyproject.toml").write_text(
                '[project]\nname = "x"\ndependencies = [\n'
                '    "fastapi>=0.115.0",\n'
                '    "uvicorn[standard]>=0.32.0",\n'
                '    "pydantic>=2.0",\n'
                '    "numpy>=1.26",\n]\n'
                '[project.optional-dependencies]\ndev = ["pytest>=8.0"]\n')
            rows = {r["name"]: r for r in inventory.read_pypi(root)}
            self.assertEqual(sorted(rows),
                             ["fastapi", "numpy", "pydantic", "pytest", "uvicorn"])
            # The extras marker is not part of the version constraint.
            self.assertEqual(rows["uvicorn"]["spec"], ">=0.32.0")

    def test_poetry_dependencies_are_read(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "pyproject.toml").write_text(
                '[tool.poetry.dependencies]\npython = "^3.11"\nflask = "^3.1.0"\n')
            rows = {r["name"] for r in inventory.read_pypi(root)}
            self.assertEqual(rows, {"flask"})      # python itself is not a package

    def test_unpinned_python_requirement_is_flagged(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "requirements.txt").write_text("Flask\nopenai==3.17.0\n")
            rows = {r["name"]: r for r in inventory.read_pypi(root)}
            self.assertIsNone(rows["Flask"]["resolved"])
            self.assertEqual(inventory.classify(None, "3.1.3"), "unpinned")
            self.assertEqual(rows["openai"]["resolved"], "3.17.0")


if __name__ == "__main__":
    unittest.main()
