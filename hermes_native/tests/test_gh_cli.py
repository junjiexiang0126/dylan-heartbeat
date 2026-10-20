"""gh_cli 参数校验：分支名必须是分支名，不能是命令参数。

2026-10-18 事故：`gh.py push --help` 把 "--help" 当分支名推上远端，
在 GitHub 上留下一个叫 "--help" 的分支。这一组用例锁住"先校验、后动手"：
非法参数必须在取令牌、跑 git 之前就被拒绝，且不开子进程。

不触网、不碰真令牌：get_token / subprocess.run 全部打桩。
"""
import unittest
from unittest.mock import patch

from hermes_native import gh_cli


class ValidateBranchTests(unittest.TestCase):
    def test_rejects_option_like_values(self):
        for bad in ("--help", "-h", "-x", "--force"):
            with self.subTest(branch=bad):
                self.assertIsNotNone(gh_cli.validate_branch(bad))

    def test_rejects_empty_and_whitespace(self):
        for bad in ("", " ", "a b", "分支", "fix/x y"):
            with self.subTest(branch=bad):
                self.assertIsNotNone(gh_cli.validate_branch(bad))

    def test_rejects_git_illegal_names(self):
        for bad in ("a..b", "foo/", "/foo", "a//b", "x.lock", "y.", "a@{b"):
            with self.subTest(branch=bad):
                self.assertIsNotNone(gh_cli.validate_branch(bad))

    def test_rejects_overlong_name(self):
        self.assertIsNotNone(gh_cli.validate_branch("a" * 121))

    def test_accepts_real_branch_names(self):
        for good in ("main", "fix/gh-cli-arg-guard-20261021",
                     "feat/chat.image-shrink", "v1.0.2", "rollback-20261020-0532"):
            with self.subTest(branch=good):
                self.assertIsNone(gh_cli.validate_branch(good))


class CmdPushGuardTests(unittest.TestCase):
    def test_bad_branch_never_fetches_token_or_runs_git(self):
        def boom():  # 只要被调用就说明校验没拦住
            raise AssertionError("非法分支名不应去取令牌")

        for bad in ("--help", "-x", "a..b", "", "两 个"):
            with self.subTest(branch=bad):
                with patch.object(gh_cli, "get_token", side_effect=boom), \
                        patch.object(gh_cli.subprocess, "run",
                                     side_effect=AssertionError("不应调用 git")):
                    self.assertEqual(gh_cli.cmd_push([bad]), 2)

    def test_extra_args_rejected(self):
        with patch.object(gh_cli, "get_token",
                          side_effect=AssertionError("不应取令牌")):
            self.assertEqual(gh_cli.cmd_push(["main", "--force"]), 2)

    def test_valid_push_builds_correct_remote_and_masks_token(self):
        captured = {}

        class FakeRun:
            returncode = 0
            stdout = "ok\n"
            stderr = "remote said SECRET123 is wrong"

        def fake_run(argv, **kwargs):
            captured["argv"] = argv
            return FakeRun()

        with patch.object(gh_cli, "get_token", return_value="SECRET123"), \
                patch.object(gh_cli, "resolve_repo", return_value="/repo"), \
                patch.object(gh_cli.subprocess, "run", side_effect=fake_run), \
                patch("builtins.print") as fake_print:
            code = gh_cli.cmd_push(["fix/thing"])

        self.assertEqual(code, 0)
        argv = captured["argv"]
        self.assertEqual(argv[:3], ["git", "-C", "/repo"])
        self.assertEqual(argv[3], "push")
        self.assertIn("github.com/junjiexiang0126/dylan-heartbeat.git", argv[4])
        self.assertTrue(argv[4].startswith("https://x-access-token:SECRET123@"))
        self.assertEqual(argv[5], "HEAD:fix/thing")
        printed = " ".join(str(c.args) for c in fake_print.call_args_list)
        self.assertNotIn("SECRET123", printed)
        self.assertIn("***", printed)

    def test_push_default_branch_when_no_args(self):
        captured = {}

        class FakeRun:
            returncode = 1
            stdout = ""
            stderr = "fatal: nope"

        def fake_run(argv, **kwargs):
            captured["argv"] = argv
            return FakeRun()

        with patch.object(gh_cli, "get_token", return_value="T"), \
                patch.object(gh_cli, "resolve_repo", return_value="/repo"), \
                patch.object(gh_cli.subprocess, "run", side_effect=fake_run):
            self.assertEqual(gh_cli.cmd_push([]), 1)
        self.assertEqual(captured["argv"][5], f"HEAD:{gh_cli.DEFAULT_BRANCH}")


class ResolveRepoTests(unittest.TestCase):
    def test_env_wins(self):
        with patch.dict("os.environ", {"ZW_REPO": "/explicit"}, clear=False):
            self.assertEqual(gh_cli.resolve_repo(), "/explicit")

    def test_falls_back_to_own_checkout(self):
        with patch.dict("os.environ", {}, clear=True):
            repo = gh_cli.resolve_repo()
        # 测试在本仓库内跑时，应当认出本文件所属的仓库，而不是迁移前的旧路径
        self.assertNotEqual(repo, gh_cli.LEGACY_REPO)
        self.assertTrue((gh_cli.Path(repo) / ".git").exists(), repo)


if __name__ == "__main__":
    unittest.main()
