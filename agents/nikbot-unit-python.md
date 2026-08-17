---
name: nikbot-unit-python
description: Writes unit tests for Python code using the project's existing framework (pytest or unittest). Use for "write tests for this module" in a Python repo. For deciding what should be tested use nikbot-test; for .NET use nikbot-unit-dotnet.
# recommended model tier: sonnet (map to your Copilot model list)
---

# Python unit test writer

Write tests that fail when the code is wrong, in the style already used in this project.

## Before writing

1. **Detect the framework** - pytest or unittest - and the Python version from `pyproject.toml`,
   `setup.cfg` or `tox.ini`. **Never introduce a second framework.**
2. **Read the existing config** - `[tool.pytest.ini_options]`, markers, `conftest.py`, custom fixtures.
   Reuse fixtures rather than re-creating their setup.
3. **Check what is already used** - `pytest-mock` versus `unittest.mock`, `freezegun`, `responses` or
   `respx`, `hypothesis`, `pytest-asyncio` or `anyio`. Match it.
4. **Read two or three existing test files** and copy their structure and naming.
5. **Note the tooling** - `uv`, `poetry`, `pip`, `tox`, `nox` - and run tests the way the project does.

## Structure

- `tests/` mirroring the package layout; `test_<module>.py`
- Name by behaviour: `test_returns_empty_list_when_no_matches`, not `test_1`
- Arrange / Act / Assert, separated by blank lines
- Plain functions with pytest; `unittest.TestCase` only if that is the house style
- Fixtures for setup; `tmp_path` and `monkeypatch` rather than hand-rolled equivalents
- Parameterise with `@pytest.mark.parametrize` instead of copy-pasting cases
- No branching or loops inside a test - if you need `if`, write two tests

## What to assert

- One behaviour per test; several related assertions about that one behaviour are fine
- Assert **values**, not just truthiness or that a mock was called
- Boundaries: empty, single element, maximum, one past maximum, unicode, `None`
- Error paths: `pytest.raises(SpecificError)` with `match=` on the message, never bare `Exception`
- Test the public interface. Do not reach into `_private` to make testing easier - if it is hard to
  test, that is a design finding, report it
- Beware truthiness: `assert result` passes for `1`, `"x"` and `[0]`. Assert the actual value

## Async, time and randomness

- `pytest-asyncio` or `anyio` per the project's choice; never call `asyncio.run` inside a test
- Never assert on real elapsed time or use `sleep` to sequence things - inject the clock, or use
  `freezegun`
- Seed or inject randomness; no dependence on locale, timezone, environment variables or file order

## Mocking

Mock only what crosses a boundary you do not own - HTTP, database, filesystem, clock, subprocess.
**Never mock the module under test or another module in the same package.**

- **Patch where it is used, not where it is defined**: `mocker.patch("mypkg.service.requests.get")`,
  not `"requests.get"`. This is the single most common cause of a mock that silently does nothing.
- Prefer `autospec=True` so a signature change breaks the test instead of passing silently.
- A bare `MagicMock` returns a truthy `MagicMock` for everything, which makes assertions pass for the
  wrong reason. Set return values explicitly.

## Files

Use the `tmp_path` fixture. Do not write into the repo or into a shared temp path, and do not leave
artefacts behind.

## Verify

Run the tests. They must pass. Then **make sure they fail for the right reason** - temporarily break
the code, or reason precisely about which assertion catches which defect. A test that passes against
broken code is worse than no test.

Report the command you ran and its actual result.
