"""备忘录存储测试：增删改查、搜索、上限与错误码。"""
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('memo_test', Path(__file__).parents[1] / 'memo_store.py')
memo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(memo)


class MemoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_add_list_edit_delete(self):
        first = memo.add(self.root, '  买牛奶  ')
        self.assertEqual(first['text'], '买牛奶')
        second = memo.add(self.root, '周三交教案')
        listed = memo.listing(self.root)
        self.assertEqual(listed['total'], 2)
        edited = memo.update(self.root, first['id'], '买牛奶和鸡蛋')
        self.assertEqual(edited['text'], '买牛奶和鸡蛋')
        self.assertNotEqual(edited['updatedAt'], '')
        memo.remove(self.root, second['id'])
        self.assertEqual(memo.listing(self.root)['total'], 1)
        self.assertEqual(memo.count(self.root), 1)

    def test_search_and_limit(self):
        memo.add(self.root, '考研报名 10 月 15 到 24 日')
        memo.add(self.root, '买菜')
        self.assertEqual(memo.listing(self.root, q='考研')['total'], 1)
        self.assertEqual(memo.listing(self.root, q='没有这个')['total'], 0)
        self.assertEqual(len(memo.listing(self.root, limit=1)['items']), 1)

    def test_errors(self):
        with self.assertRaises(memo.MemoError) as ctx:
            memo.add(self.root, '   ')
        self.assertEqual(ctx.exception.code, 'text_required')
        with self.assertRaises(memo.MemoError) as ctx:
            memo.add(self.root, '字' * (memo.TEXT_MAX + 1))
        self.assertEqual(ctx.exception.code, 'text_too_long')
        with self.assertRaises(memo.MemoError) as ctx:
            memo.update(self.root, 'nope', '内容')
        self.assertEqual(ctx.exception.code, 'memo_not_found')
        with self.assertRaises(memo.MemoError) as ctx:
            memo.remove(self.root, 'nope')
        self.assertEqual(ctx.exception.code, 'memo_not_found')

    def test_survives_reload_and_keeps_other_entries(self):
        a = memo.add(self.root, '第一条')
        memo.add(self.root, '第二条')
        again = memo.listing(self.root)
        self.assertEqual(again['total'], 2)
        memo.update(self.root, a['id'], '第一条改过')
        reloaded = {i['id']: i['text'] for i in memo.listing(self.root)['items']}
        self.assertEqual(reloaded[a['id']], '第一条改过')
        self.assertEqual(len(reloaded), 2)


if __name__ == '__main__':
    unittest.main()
