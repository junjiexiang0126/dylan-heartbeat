import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('bootstrap_test', Path(__file__).parents[1] / 'bootstrap.py')
boot = importlib.util.module_from_spec(spec); spec.loader.exec_module(boot)

class ReviewedRefresh(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.home = Path(self.tmp.name)
        for name in ('scripts', 'logs', 'workspace'):
            (self.home/name).mkdir()
        self.template = self.home/'template_autonomy_gate.py'; self.template.write_text('new body\n', encoding='utf-8')
        self.script = self.home/'scripts/autonomy_gate.py'
        self.old = 'old body\n'; self.script.write_text(self.old, encoding='utf-8')
        self.saved = boot.SHIPPED_AUTONOMY_GATE
        boot.SHIPPED_AUTONOMY_GATE = {hashlib.sha256(self.old.encode()).hexdigest()}
    def tearDown(self):
        boot.SHIPPED_AUTONOMY_GATE = self.saved; self.tmp.cleanup()
    def backups(self):
        return sorted((self.home/'workspace/backups').glob('autonomy_gate-before-refresh-*.py'))
    def test_reviewed_copy_is_replaced_and_backed_up(self):
        outcome = boot.refresh_reviewed_script(self.script, self.template, self.home)
        self.assertTrue(outcome.startswith('refreshed'), outcome)
        self.assertEqual(self.script.read_text(encoding='utf-8'), 'new body\n')
        self.assertEqual(len(self.backups()), 1)
        self.assertEqual(self.backups()[0].read_text(encoding='utf-8'), self.old)
        self.assertEqual(oct(self.script.stat().st_mode)[-3:], '444')
    def test_hand_edited_copy_is_kept_and_never_replaced(self):
        self.script.write_text('hand edited\n', encoding='utf-8')
        outcome = boot.refresh_reviewed_script(self.script, self.template, self.home)
        self.assertTrue(outcome.startswith('kept'), outcome)
        self.assertEqual(self.script.read_text(encoding='utf-8'), 'hand edited\n')
        self.assertEqual(self.backups(), [])
    def test_identical_copy_reports_already_current(self):
        self.script.write_text('new body\n', encoding='utf-8')
        self.assertEqual(boot.refresh_reviewed_script(self.script, self.template, self.home), 'already current')
    def test_seed_refreshes_a_reviewed_gate_and_logs_it(self):
        (self.home/'template.py').write_text('config: seeded\n', encoding='utf-8')
        (self.home/'autonomy_gate.py').write_text('new body\n', encoding='utf-8')
        (self.home/'self-update-skill.md').write_text('# skill\n', encoding='utf-8')
        boot.seed(self.home, self.home/'template.py')
        self.assertEqual(self.script.read_text(encoding='utf-8'), 'new body\n')
        log = (self.home/'logs/autonomy_gate_refresh.log').read_text(encoding='utf-8')
        self.assertIn('refreshed', log)
        self.assertEqual(len(self.backups()), 1)
    def test_seed_keeps_a_hand_edited_gate_and_says_so(self):
        (self.home/'template.py').write_text('config: seeded\n', encoding='utf-8')
        (self.home/'autonomy_gate.py').write_text('new body\n', encoding='utf-8')
        (self.home/'self-update-skill.md').write_text('# skill\n', encoding='utf-8')
        self.script.write_text('operator wrote this\n', encoding='utf-8')
        boot.seed(self.home, self.home/'template.py')
        self.assertEqual(self.script.read_text(encoding='utf-8'), 'operator wrote this\n')
        self.assertIn('kept', (self.home/'logs/autonomy_gate_refresh.log').read_text(encoding='utf-8'))

if __name__=='__main__':unittest.main()
