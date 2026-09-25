#!/usr/bin/env python3
"""Tests for the fleet discovery graph logic.

The transport layer is deliberately thin and untested here; everything below is
a pure function of plain data, so the first run against a live organisation only
has to prove authentication and endpoints, not the algorithms.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import discover                      # noqa: E402
import inventory as inv              # noqa: E402

FLEET = json.loads((Path(__file__).resolve().parent.parent / "fixtures" / "fleet.json").read_text())


class TestRegistryMetadataShapes(unittest.TestCase):
    """npm permits more than one shape for the same field; a crash on an
    unexpected one aborted an entire inventory run on a real repository."""

    def test_repository_shorthand_string_is_handled(self):
        self.assertEqual(inv.changelog_sources({"repo_url": "github:vercel/next.js"}),
                         inv.changelog_sources({"repo_url": "github:vercel/next.js"}))

    def test_changelog_sources_survives_a_missing_repository(self):
        self.assertEqual(inv.changelog_sources({}), [])

    def test_changelog_sources_derives_paths_from_a_git_url(self):
        got = inv.changelog_sources({"repo_url": "git+https://github.com/eslint/eslint.git"})
        self.assertTrue(any("eslint/eslint/main/CHANGELOG.md" in u for u in got))

    def test_a_monorepo_directory_is_included_in_the_path(self):
        got = inv.changelog_sources({"repo_url": "https://github.com/vitejs/vite",
                                     "repo_dir": "packages/vite"})
        self.assertTrue(any("packages/vite/CHANGELOG.md" in u for u in got))


class TestReferencedPipelines(unittest.TestCase):
    def test_finds_a_declared_upstream(self):
        yaml = "resources:\n  pipelines:\n    - pipeline: lib\n      source: contoso-http-ci\n"
        self.assertEqual(discover.referenced_pipelines(yaml), ["contoso-http-ci"])

    def test_ignores_repository_resources(self):
        yaml = ("resources:\n  repositories:\n    - repository: templates\n"
                "      source: some-repo\n")
        self.assertEqual(discover.referenced_pipelines(yaml), [])

    def test_ignores_a_source_outside_the_resources_block(self):
        yaml = "steps:\n  - script: echo source: not-a-pipeline\n"
        self.assertEqual(discover.referenced_pipelines(yaml), [])

    def test_handles_several_upstreams(self):
        yaml = ("resources:\n  pipelines:\n"
                "    - pipeline: a\n      source: alpha-ci\n"
                "    - pipeline: b\n      source: beta-ci\n")
        self.assertEqual(discover.referenced_pipelines(yaml), ["alpha-ci", "beta-ci"])

    def test_tolerates_quotes_and_comments(self):
        yaml = "resources:\n  pipelines:\n    - pipeline: a\n      source: 'alpha-ci'  # upstream\n"
        self.assertEqual(discover.referenced_pipelines(yaml), ["alpha-ci"])

    def test_empty_yaml_is_not_an_error(self):
        self.assertEqual(discover.referenced_pipelines(""), [])


class TestBuildTree(unittest.TestCase):
    def setUp(self):
        self.tree = discover.build_tree(FLEET["pipelines"])

    def test_every_pipeline_is_a_node(self):
        self.assertEqual(len(self.tree["nodes"]), 4)

    def test_edges_follow_the_declared_chain(self):
        self.assertEqual(sorted((e["from"], e["to"]) for e in self.tree["edges"]),
                         [(1, 2), (2, 3)])

    def test_a_pipeline_with_no_upstream_has_no_inbound_edge(self):
        self.assertNotIn(4, [e["to"] for e in self.tree["edges"]])

    def test_a_reference_to_an_unknown_pipeline_is_dropped(self):
        tree = discover.build_tree([
            {"id": 9, "name": "solo", "project": "P",
             "yaml": "resources:\n  pipelines:\n    - pipeline: x\n      source: does-not-exist\n"}])
        self.assertEqual(tree["edges"], [])

    def test_a_pipeline_cannot_depend_on_itself(self):
        tree = discover.build_tree([
            {"id": 1, "name": "loop", "project": "P",
             "yaml": "resources:\n  pipelines:\n    - pipeline: me\n      source: loop\n"}])
        self.assertEqual(tree["edges"], [])


class TestPackageGraph(unittest.TestCase):
    def setUp(self):
        self.graph = discover.package_graph(FLEET["repos"])

    def test_publisher_to_consumer_edges(self):
        edges = {(e["from"].split("/")[1], e["to"].split("/")[1], e["package"])
                 for e in self.graph["edges"]}
        self.assertEqual(edges, {
            ("contoso-http", "contoso-auth", "Contoso.Http"),
            ("contoso-http", "payments-api", "Contoso.Http"),
            ("contoso-auth", "onboarding-web", "Contoso.Auth.Tokens"),
        })

    def test_third_party_packages_create_no_edges(self):
        self.assertNotIn("Newtonsoft.Json", [e["package"] for e in self.graph["edges"]])

    def test_a_repo_consuming_its_own_package_is_not_an_edge(self):
        graph = discover.package_graph([
            {"key": "P/self", "publishes": ["Contoso.Http"],
             "packages": [{"name": "Contoso.Http", "resolved": "1.0.0"}]}])
        self.assertEqual(graph["edges"], [])


class TestWaves(unittest.TestCase):
    def setUp(self):
        self.graph = discover.package_graph(FLEET["repos"])

    def test_direct_consumers_come_first(self):
        w = discover.waves(self.graph, "Payments/contoso-http")
        self.assertEqual(sorted(w[0]), ["Payments/contoso-auth", "Payments/payments-api"])

    def test_a_consumer_waits_for_its_own_input(self):
        # onboarding-web consumes Contoso.Auth.Tokens, published by contoso-auth,
        # which is itself in wave 1. It must not be scheduled alongside it.
        w = discover.waves(self.graph, "Payments/contoso-http")
        self.assertEqual(w[1], ["Payments/onboarding-web"])

    def test_a_leaf_library_has_one_wave(self):
        w = discover.waves(self.graph, "Payments/contoso-auth")
        self.assertEqual(w, [["Payments/onboarding-web"]])

    def test_a_package_nobody_consumes_has_no_waves(self):
        self.assertEqual(discover.waves(self.graph, "Payments/onboarding-web"), [])

    def test_a_cycle_terminates_rather_than_hanging(self):
        graph = {"edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}]}
        self.assertIsInstance(discover.waves(graph, "a"), list)


class TestCycles(unittest.TestCase):
    def test_the_fixture_estate_is_acyclic(self):
        self.assertEqual(discover.cycles(discover.package_graph(FLEET["repos"])), [])

    def test_a_cycle_is_reported_not_raised(self):
        graph = {"edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}]}
        self.assertTrue(discover.cycles(graph))


class TestReleaseTrainDiff(unittest.TestCase):
    def test_reports_only_what_mainline_is_ahead_on(self):
        main = [{"name": "Contoso.Http", "resolved": "4.2.1"},
                {"name": "Newtonsoft.Json", "resolved": "13.0.3"}]
        release = [{"name": "Contoso.Http", "resolved": "4.0.2"},
                   {"name": "Newtonsoft.Json", "resolved": "13.0.3"}]
        diff = discover.release_train_diff(main, release)
        self.assertEqual([d["package"] for d in diff], ["Contoso.Http"])
        self.assertEqual(diff[0]["jump"], "minor")

    def test_a_release_branch_ahead_of_main_is_not_reported(self):
        self.assertEqual(discover.release_train_diff(
            [{"name": "X", "resolved": "1.0.0"}], [{"name": "X", "resolved": "2.0.0"}]), [])

    def test_a_package_absent_from_mainline_is_skipped(self):
        self.assertEqual(discover.release_train_diff(
            [], [{"name": "OnlyOnRelease", "resolved": "1.0.0"}]), [])


class TestDrift(unittest.TestCase):
    def setUp(self):
        self.drift = {d["name"]: d for d in discover.drift(FLEET["repos"])}

    def test_only_shared_packages_are_reported(self):
        # Contoso.Auth.Tokens has a single consumer, so it is not drift.
        self.assertNotIn("Contoso.Auth.Tokens", self.drift)

    def test_counts_every_consumer(self):
        self.assertEqual(self.drift["Newtonsoft.Json"]["consumers"], 4)

    def test_a_split_major_is_flagged(self):
        self.assertTrue(self.drift["Newtonsoft.Json"]["split_major"])
        self.assertFalse(self.drift["Contoso.Http"]["split_major"])

    def test_majors_and_minors_are_reported_separately(self):
        # Collapsing them into one figure produces a number nobody can read.
        n = self.drift["Newtonsoft.Json"]
        self.assertEqual(n["max_majors_behind"], 1)
        self.assertEqual(n["median_minors_behind"], 0.0)
        c = self.drift["Contoso.Http"]
        self.assertEqual(c["max_majors_behind"], 0)
        self.assertEqual(c["median_minors_behind"], 1.5)

    def test_worst_major_drift_sorts_first(self):
        self.assertEqual(discover.drift(FLEET["repos"])[0]["name"], "Newtonsoft.Json")


class TestConvergence(unittest.TestCase):
    def setUp(self):
        self.conv = discover.convergence(FLEET["repos"])

    def test_repos_sharing_a_package_are_linked(self):
        pairs = {(e["a"].split("/")[1], e["b"].split("/")[1]) for e in self.conv["edges"]}
        # Every fixture repo depends on Newtonsoft.Json, so all pairs link.
        self.assertEqual(len(pairs), 6)

    def test_edge_weight_is_the_shared_package_count(self):
        heaviest = self.conv["edges"][0]
        self.assertGreaterEqual(heaviest["n"], 1)
        self.assertEqual(heaviest["n"], len(set(heaviest["packages"])))

    def test_a_repo_with_no_packages_is_not_a_node(self):
        conv = discover.convergence([{"key": "a/empty", "repo": "empty", "packages": []}])
        self.assertEqual(conv["nodes"], [])

    def test_edges_are_sorted_heaviest_first(self):
        counts = [e["n"] for e in self.conv["edges"]]
        self.assertEqual(counts, sorted(counts, reverse=True))


class TestAssemble(unittest.TestCase):
    def setUp(self):
        self.fleet = discover.assemble(FLEET, "https://dev.azure.com/contoso")

    def test_counts_are_reported(self):
        self.assertEqual(self.fleet["counts"],
                         {"repos": 4, "pipelines": 4, "packages": 7, "release_branches": 2})

    def test_internal_packages_are_identified_from_the_graph(self):
        self.assertEqual(self.fleet["internal_packages"],
                         ["Contoso.Auth.Tokens", "Contoso.Http"])

    def test_a_cascade_is_produced_for_each_internal_package(self):
        self.assertEqual(sorted(self.fleet["cascades"]),
                         ["Contoso.Auth.Tokens", "Contoso.Http"])
        self.assertEqual(len(self.fleet["cascades"]["Contoso.Http"]), 2)

    def test_output_is_json_serialisable(self):
        json.dumps(self.fleet)


if __name__ == "__main__":
    unittest.main()
