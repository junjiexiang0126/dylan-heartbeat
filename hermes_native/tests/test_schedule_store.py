"""日程存储测试：手动条目 + 只读合并 cron 的下一班次。"""
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

BANGKOK = timezone(timedelta(hours=7))
spec = importlib.util.spec_from_file_location('sched_test', Path(__file__).parents[1] / 'schedule_store.py')
sched = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sched)


class ScheduleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'workspace'
        self.cron = Path(self.tmp.name) / 'cron'
        self.cron.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        self.tmp.cleanup()

    def _cron(self, jobs):
        (self.cron / 'jobs.json').write_text(json.dumps({'jobs': jobs}, ensure_ascii=False), encoding='utf-8')

    def test_manual_add_group_and_toggle(self):
        today = datetime.now(BANGKOK).date().isoformat()
        item = sched.add(self.root, day=today, time='09:30', text='  上课  ')
        self.assertEqual(item['text'], '上课')
        listed = sched.listing(self.root, self.cron)
        self.assertEqual(listed['days'][0]['date'], today)
        self.assertEqual(listed['days'][0]['items'][0]['time'], '09:30')
        sched.set_done(self.root, item['id'], True)
        again = sched.listing(self.root, self.cron)
        self.assertTrue(again['days'][0]['items'][0]['done'])
        sched.remove(self.root, item['id'])
        self.assertEqual(sched.listing(self.root, self.cron)['manual'], [])

    def test_cron_next_run_shows_up_but_is_read_only(self):
        soon = (datetime.now(BANGKOK) + timedelta(hours=3)).isoformat(timespec='seconds')
        self._cron([{'job_id': 'j1', 'name': '课前提醒', 'schedule': 'every day at 9am',
                     'next_run_at': soon, 'enabled': True},
                    {'job_id': 'j2', 'name': '停用的', 'next_run_at': soon, 'enabled': False}])
        listed = sched.listing(self.root, self.cron)
        names = [c['name'] for c in listed['cron']]
        self.assertEqual(names, ['课前提醒'])
        self.assertEqual(listed['days'][0]['items'][0]['source'], 'cron')
        # 只读：cron 文件不该被我们改
        before = (self.cron / 'jobs.json').read_text(encoding='utf-8')
        sched.listing(self.root, self.cron)
        self.assertEqual(before, (self.cron / 'jobs.json').read_text(encoding='utf-8'))

    def test_window_filters_far_future(self):
        today = datetime.now(BANGKOK).date()
        far = (today + timedelta(days=30)).isoformat()
        sched.add(self.root, day=far, time='10:00', text='很远的事')
        self.assertEqual(sched.listing(self.root, self.cron, days=7)['days'], [])
        self.assertEqual(len(sched.listing(self.root, self.cron, days=60)['days']), 1)

    def test_validation_errors(self):
        for kwargs, code in (
            ({'day': '2026/10/18', 'time': '09:00', 'text': 'x'}, 'invalid_date'),
            ({'day': '2026-10-18', 'time': '9:00', 'text': 'x'}, 'invalid_time'),
            ({'day': '2026-10-18', 'time': '09:00', 'text': '  '}, 'text_required'),
        ):
            with self.assertRaises(sched.ScheduleError) as ctx:
                sched.add(self.root, **kwargs)
            self.assertEqual(ctx.exception.code, code)
        with self.assertRaises(sched.ScheduleError):
            sched.listing(self.root, self.cron, days=0)


if __name__ == '__main__':
    unittest.main()
