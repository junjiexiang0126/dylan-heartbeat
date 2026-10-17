import sys, unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock
sys.path.insert(0, '/data/hermes_native/workspace/dev/diary-meta')
import web_bridge as bridge


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
