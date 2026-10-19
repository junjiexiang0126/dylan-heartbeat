"""Pokes route: real-format records -> page() output (previously从未用真实数据走过)."""
import json, os, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import web_bridge  # noqa: E402
import web_poke  # noqa: E402

REAL = [
    {"id": "8f2a5c31-4d6e-4b90-9a17-2c5e8d3f4b06", "at": "2026-10-16T18:37:48.261453+00:00", "author": "ziwei", "target": "user"},
    {"id": "c4b91d7e-5a2f-4c83-9e16-7d0b3a58f2c9", "at": "2026-10-16T19:12:16.984687+00:00", "author": "ziwei", "target": "user"},
    {"id": "e7c2f4a9-1b6d-4e08-9c53-2a8f6d1b4e70", "at": "2026-10-16T19:20:59.705428+00:00", "author": "ziwei", "target": "user"},
]


class PokePageRealData(unittest.TestCase):
    def run_page(self, records, cursor=None):
        root = Path(tempfile.mkdtemp())
        (root / "workspace").mkdir()
        (root / "workspace" / "web-pokes.json").write_text(json.dumps({"records": records}))
        old = web_bridge.home
        web_bridge.home = lambda: root
        try:
            return web_poke.page(web_bridge, cursor)
        finally:
            web_bridge.home = old

    def test_real_records_roundtrip(self):
        out = self.run_page(REAL)
        self.assertEqual(len(out["data"]), 3)
        self.assertFalse(out["has_more"])
        self.assertIsNone(out["next_cursor"])
        self.assertEqual([r["id"] for r in out["data"]], [r["id"] for r in REAL])
        self.assertEqual(set(out["data"][0]), {"id", "at", "author", "target"})

    def test_missing_file_is_empty_not_error(self):
        out = self.run_page([])  # empty file writes [] -> still valid json
        self.assertEqual(out["data"], [])

    def test_cursor_paging_over_100(self):
        many = [{"id": "00000000-0000-4000-8000-%012d" % i,
                 "at": "2026-10-16T%02d:%02d:00+00:00" % (i // 60, i % 60),
                 "author": "ziwei", "target": "user"} for i in range(101)]
        first = self.run_page(many)
        self.assertEqual(len(first["data"]), 100)
        self.assertTrue(first["has_more"])
        second = self.run_page(many, first["next_cursor"])
        self.assertEqual(len(second["data"]), 1)
        self.assertFalse(second["has_more"])


if __name__ == "__main__":
    unittest.main()
