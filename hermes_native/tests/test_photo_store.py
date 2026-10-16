"""照片墙（原生侧）的单元测试。

覆盖她 2026-10-16 亲口定的四条规则：
  1. 照片删除：她能删任何一张；我（ziwei）只能删自己上传的
  2. 标注：各自只能改删自己的（越权 not_owner，路由层给 403）
  3. 来源：user | ziwei，我的上传要标出来
  4. 单张详情带全部标注（按时间正序）+ 同一天的其他照片（向下滑连续看）
"""
import json
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PNG_1PX = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082')


class PhotoStoreTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        os.environ['HERMES_HOME'] = self.root.name
        (Path(self.root.name) / 'workspace').mkdir(parents=True, exist_ok=True)
        for module in ('photo_store',):
            sys.modules.pop(module, None)
        import photo_store
        self.ps = photo_store

    def tearDown(self):
        self.root.cleanup()

    def _uuid(self):
        return str(uuid.uuid4())

    def test_add_photo_writes_file_and_index(self):
        pid = self._uuid()
        rec = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=pid, name='a.png')
        self.assertEqual(rec['id'], pid)
        self.assertEqual(rec['source'], 'user')
        path = Path(self.root.name) / 'workspace' / 'photos' / rec['date'] / rec['file']
        self.assertTrue(path.exists())
        self.assertEqual(path.read_bytes(), PNG_1PX)
        self.assertEqual(rec['sha256'], __import__('hashlib').sha256(PNG_1PX).hexdigest())
        listed = self.ps.photos_page()
        self.assertEqual([r['id'] for r in listed['data']], [pid])

    def test_same_id_is_not_stored_twice(self):
        pid = self._uuid()
        first = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=pid)
        again = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=pid)
        self.assertEqual(first['id'], again['id'])
        self.assertEqual(self.ps.summary()['photos'], 1)

    def test_size_and_type_are_enforced(self):
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.add_photo(b'', suffix='.png', author=self.ps.USER, photo_id=self._uuid())
        self.assertEqual(ctx.exception.code, 'empty_photo')
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.add_photo(PNG_1PX, suffix='.exe', author=self.ps.USER, photo_id=self._uuid())
        self.assertEqual(ctx.exception.code, 'unsupported_type')
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.add_photo(b'x' * (self.ps.PHOTO_MAX_BYTES + 1), suffix='.png',
                              author=self.ps.USER, photo_id=self._uuid())
        self.assertEqual(ctx.exception.code, 'photo_too_large')
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.add_photo(PNG_1PX, suffix='.png', author='stranger', photo_id=self._uuid())
        self.assertEqual(ctx.exception.code, 'invalid_author')

    def test_days_only_lists_days_with_photos(self):
        self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid(), at='2026-10-14T10:00:00+07:00')
        self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid(), at='2026-10-16T09:00:00+07:00')
        self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.ZIWEI, photo_id=self._uuid(), at='2026-10-16T20:00:00+07:00')
        days = self.ps.photo_days()
        self.assertEqual(days, [{'date': '2026-10-16', 'count': 2}, {'date': '2026-10-14', 'count': 1}])
        self.assertEqual(self.ps.photo_days(start='2026-10-15'), [{'date': '2026-10-16', 'count': 2}])

    def test_annotation_rules(self):
        photo = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid())
        hers = self.ps.add_annotation(photo['id'], '很可爱', author=self.ps.USER, note_id=self._uuid())
        mine = self.ps.add_annotation(photo['id'], '这张是我挑的', author=self.ps.ZIWEI, note_id=self._uuid())
        detail = self.ps.photo_detail(photo['id'])
        self.assertEqual([n['id'] for n in detail['annotations']], [hers['id'], mine['id']])
        self.assertEqual({n['author'] for n in detail['annotations']}, {'user', 'ziwei'})
        # 我改她的 → 403 那一类
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.edit_annotation(hers['id'], '改成我的', author=self.ps.ZIWEI)
        self.assertEqual(ctx.exception.code, 'not_owner')
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.delete_annotation(mine['id'], author=self.ps.USER)
        self.assertEqual(ctx.exception.code, 'not_owner')
        # 自己的可以改
        edited = self.ps.edit_annotation(mine['id'], '换一句', author=self.ps.ZIWEI)
        self.assertEqual(edited['text'], '换一句')
        self.assertIsNotNone(edited['edited_at'])
        self.ps.delete_annotation(hers['id'], author=self.ps.USER)
        self.assertEqual(len(self.ps.photo_detail(photo['id'])['annotations']), 1)

    def test_annotation_bounds(self):
        photo = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid())
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.add_annotation(photo['id'], '   ', author=self.ps.USER, note_id=self._uuid())
        self.assertEqual(ctx.exception.code, 'empty_text')
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.add_annotation(photo['id'], '字' * (self.ps.PHOTO_ANNOT_MAX + 1),
                                   author=self.ps.USER, note_id=self._uuid())
        self.assertEqual(ctx.exception.code, 'text_too_long')
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.add_annotation(self._uuid(), '在不存在照片下写', author=self.ps.USER, note_id=self._uuid())
        self.assertEqual(ctx.exception.code, 'photo_not_found')

    def test_delete_rules(self):
        hers = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid())
        mine = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.ZIWEI, photo_id=self._uuid())
        # 我不能删她的
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.delete_photo(hers['id'], author=self.ps.ZIWEI)
        self.assertEqual(ctx.exception.code, 'not_owner')
        # 我能删自己的
        self.ps.delete_photo(mine['id'], author=self.ps.ZIWEI)
        # 她能删任何一张
        self.ps.delete_photo(hers['id'], author=self.ps.USER)
        self.assertEqual(self.ps.summary()['photos'], 0)
        self.assertEqual(self.ps.summary()['deleted'], 2)
        with self.assertRaises(self.ps.PhotoError) as ctx:
            self.ps.photo_detail(hers['id'])
        self.assertEqual(ctx.exception.code, 'photo_not_found')

    def test_deleted_photo_disappears_but_file_stays(self):
        photo = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid())
        path = Path(self.root.name) / 'workspace' / 'photos' / photo['date'] / photo['file']
        self.ps.delete_photo(photo['id'], author=self.ps.USER)
        self.assertEqual(self.ps.photos_page()['data'], [])
        self.assertTrue(path.exists(), '软删不物理删，删除要可回溯')
        self.assertEqual(self.ps.photo_days(), [])

    def test_same_day_list_for_swiping(self):
        day = '2026-10-16T10:00:00+07:00'
        first = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid(), at=day)
        second = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid(), at='2026-10-16T18:00:00+07:00')
        other = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid(), at='2026-10-15T18:00:00+07:00')
        detail = self.ps.photo_detail(first['id'])
        self.assertEqual([r['id'] for r in detail['same_day']], [second['id']])
        self.assertNotIn(other['id'], [r['id'] for r in detail['same_day']])

    def test_cursor_pagination(self):
        for index in range(5):
            self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid(),
                              at='2026-10-16T1%d:00:00+07:00' % index)
        page = self.ps.photos_page(limit=2)
        self.assertEqual(len(page['data']), 2)
        self.assertTrue(page['next_cursor'])
        rest = self.ps.photos_page(limit=2, cursor=page['next_cursor'])
        self.assertEqual(len(rest['data']), 2)
        self.assertFalse({r['id'] for r in page['data']} & {r['id'] for r in rest['data']})

    def test_public_view_hides_local_paths(self):
        photo = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid())
        view = self.ps.public_photo(photo)
        self.assertEqual(view['file'], '/ziwei/web/photos/%s/file' % photo['id'])
        self.assertNotIn(self.root.name, json.dumps(view, ensure_ascii=False))

    def test_photo_bytes_round_trip(self):
        photo = self.ps.add_photo(PNG_1PX, suffix='.png', author=self.ps.USER, photo_id=self._uuid())
        data, mime = self.ps.photo_bytes(photo['id'])
        self.assertEqual(data, PNG_1PX)
        self.assertEqual(mime, 'image/png')
        with self.assertRaises(self.ps.PhotoError):
            self.ps.photo_bytes(self._uuid())


if __name__ == '__main__':
    unittest.main()
