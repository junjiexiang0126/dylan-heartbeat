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

    def test_reading_body_keeps_markdown_and_full_original_is_separate(self):
        text = '心情：安静\n一句：留下一个小片段\n可见：共享\n\n## 窗边的一页\n\n**今天**记住了一句话。\n\n### 后来想到\n\n> 她昨天说的话。\n\n- 第一件事\n- 第二件事\n\n```python\n# 心情：这是一行代码\nprint("hello")\n```\n'
        path=self.dir/'2026-10-21.md';path.write_text(text,encoding='utf-8')
        row=bridge.diary_page()['data'][0]
        self.assertNotIn('content',row);self.assertNotIn('originalContent',row)
        doc=bridge.diary_document(row['id'])
        self.assertEqual(doc['originalContent'],text)
        self.assertEqual(path.read_text(),text)
        self.assertNotIn('## 窗边的一页',doc['content'])
        self.assertNotIn('可见：共享',doc['content'])
        self.assertIn('**今天**',doc['content']);self.assertIn('### 后来想到',doc['content'])
        self.assertIn('# 心情：这是一行代码',doc['content'])

    def test_metadata_like_lines_inside_body_remain_literal(self):
        text='## 一页\n\n我记住了这句话：\n心情：不是元数据，而是引用。\n'
        (self.dir/'2026-10-21.md').write_text(text,encoding='utf-8')
        doc=bridge.diary_document(bridge.diary_page()['data'][0]['id'])
        self.assertIn('心情：不是元数据，而是引用。',doc['content'])

    def test_private_still_404(self):
        (self.dir / '2026-10-16-memo.md').write_text('心情：低\n\n## 只给自己\n\n夜里。\n', encoding='utf-8')
        with self.assertRaises(bridge.MemoryError) as caught:
            bridge.diary_document(bridge._diary_id('workspace/diary/2026-10-16-memo.md'))
        self.assertEqual(caught.exception.code, 'diary_not_found')


if __name__ == '__main__':
    unittest.main()
