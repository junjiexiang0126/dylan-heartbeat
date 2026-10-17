import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

# 用绝对路径加载被测模块：CI 里 discover 的搜索路径不含 hermes_native，
# 也不能依赖任何本机绝对路径（曾经写死 /data/... 导致 CI 找不到 web_bridge）。
_BRIDGE = Path(__file__).resolve().parents[1] / "web_bridge.py"
_spec = importlib.util.spec_from_file_location("web_bridge_under_test", _BRIDGE)
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)  # type: ignore[union-attr]


class DiaryDocumentMetaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.dir = self.root / 'workspace' / 'diary'
        self.dir.mkdir(parents=True)
        self.patch = mock.patch.object(bridge, 'home', return_value=self.root)
        self.patch.start()

    def tearDown(self):
        self.patch.stop(); self.tmp.cleanup()

    def test_document_carries_meta(self):
        (self.dir / '2026-10-16.md').write_text(
            '心情：安静\n一句：把接口补齐\n标签：日记, 接口\n\n## 补齐日记接口\n\n正文一段。\n', encoding='utf-8')
        first = bridge.diary_page()['data'][0]
        d = bridge.diary_document(first['id'])
        self.assertEqual(d['title'], '补齐日记接口')
        self.assertEqual(d['date'], '2026-10-16')
        self.assertEqual(d['mood'], '安静')
        self.assertEqual(d['summary'], '把接口补齐')
        self.assertEqual(d['tags'], ['日记', '接口'])
        self.assertEqual(d['visibility'], 'shared')
        self.assertIn('正文一段', d['content'])

    def test_private_still_404(self):
        (self.dir / '2026-10-16-memo.md').write_text('心情：低\n\n## 只给自己\n\n夜里。\n', encoding='utf-8')
        with self.assertRaises(bridge.MemoryError) as caught:
            bridge.diary_document(bridge._diary_id('workspace/diary/2026-10-16-memo.md'))
        self.assertEqual(caught.exception.code, 'diary_not_found')


if __name__ == '__main__':
    unittest.main()
