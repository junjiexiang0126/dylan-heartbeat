import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('upgrade',Path(__file__).parents[1]/'preflight_upgrade.py');upgrade=importlib.util.module_from_spec(spec);spec.loader.exec_module(upgrade)

class UpgradeTests(unittest.TestCase):
    def test_reviewed_image_hash_matches_the_shipped_gate(self):
        # setUp patches NEW_SHA for the temporary upgrade fixture; read the actual source constant.
        import ast
        module = ast.parse((Path(__file__).parents[1] / 'preflight_upgrade.py').read_text())
        declared = next(ast.literal_eval(node.value) for node in module.body
                        if isinstance(node, ast.Assign)
                        and any(isinstance(target, ast.Name) and target.id == 'NEW_SHA' for target in node.targets))
        gate = Path(__file__).parents[1] / 'autonomy_gate.py'
        self.assertEqual(declared, upgrade.digest(gate.read_bytes()))
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.home=Path(self.temp.name);(self.home/'scripts').mkdir();self.old=b'print("old")\n';self.new=b'print("new")\n';self.source=self.home/'image.py';self.source.write_bytes(self.new);self.target=self.home/'scripts/autonomy_gate.py';self.target.write_bytes(self.old);self.target.chmod(0o444)
        for p in [patch.object(upgrade,'ROOT_UID',os.getuid()),patch.object(upgrade,'OLD_SHA',upgrade.digest(self.old)),patch.object(upgrade,'NEW_SHA',upgrade.digest(self.new)),patch.dict(os.environ,{'ZIWEI_PREFLIGHT_UPGRADE_SHA256':upgrade.digest(self.new)})]:p.start();self.addCleanup(p.stop)
    def test_selected_atomic_upgrade_backup_receipt_and_idempotency(self):
        state=self.home/'autonomy_gate_state.json';state.write_text('{"wakes":4}');self.assertEqual(upgrade.upgrade(self.home,self.source)['state'],'updated');self.assertEqual(self.target.read_bytes(),self.new);self.assertEqual(self.target.stat().st_mode&0o777,0o444);self.assertEqual(state.read_text(),'{"wakes":4}');self.assertEqual(upgrade.upgrade(self.home,self.source)['state'],'already_current');backup=self.home/'scripts'/('autonomy_gate.before-'+upgrade.digest(self.old)+'.py');self.assertEqual(backup.read_bytes(),self.old)
    def test_unselected_is_a_noop(self):
        with patch.dict(os.environ,{'ZIWEI_PREFLIGHT_UPGRADE_SHA256':''}):self.assertEqual(upgrade.upgrade(self.home,self.source)['state'],'not_requested')
        self.assertEqual(self.target.read_bytes(),self.old)
    def test_previous_reviewed_version_is_backed_up(self):
        with patch.object(upgrade,'OLD_SHA','different-original'), patch.object(upgrade,'PREVIOUS_SHA',upgrade.digest(self.old)):
            receipt=upgrade.upgrade(self.home,self.source)
        self.assertEqual(receipt['old_sha256'],upgrade.digest(self.old))
        self.assertEqual(self.target.read_bytes(),self.new)
        self.assertEqual((self.home/'scripts'/('autonomy_gate.before-'+upgrade.digest(self.old)+'.py')).read_bytes(),self.old)
    def test_previous_reviewed_image_can_upgrade_with_backup(self):
        # The previously shipped NEW_SHA must remain a recognized source version.
        with patch.object(upgrade, 'OLD_SHA', 'unrelated-original'), \
             patch.object(upgrade, 'PREVIOUS_SHA', 'unrelated-previous'), \
             patch.object(upgrade, 'PREVIOUS_IMAGE_SHA', 'unrelated-image'), \
             patch.object(upgrade, 'PREVIOUS_REVIEWED_SHA', upgrade.digest(self.old)):
            receipt = upgrade.upgrade(self.home, self.source)
        self.assertEqual(receipt['state'], 'updated')
        self.assertEqual(self.target.read_bytes(), self.new)
        backup = self.home / 'scripts' / ('autonomy_gate.before-' + upgrade.digest(self.old) + '.py')
        self.assertEqual(backup.read_bytes(), self.old)

    def test_selecting_previous_version_does_not_authorize_new_upgrade(self):
        with patch.dict(os.environ, {'ZIWEI_PREFLIGHT_UPGRADE_SHA256': upgrade.PREVIOUS_REVIEWED_SHA}):
            with self.assertRaisesRegex(RuntimeError, 'not_authorized'):
                upgrade.upgrade(self.home, self.source)
        self.assertEqual(self.target.read_bytes(), self.old)

    def test_unknown_previous_hash_and_wrong_image_refused(self):
        self.target.chmod(0o644);self.target.write_bytes(b'unknown');self.target.chmod(0o444)
        with self.assertRaisesRegex(RuntimeError,'unknown_previous_hash'):upgrade.upgrade(self.home,self.source)
        self.source.write_bytes(b'bad image')
        with self.assertRaisesRegex(RuntimeError,'image_hash'):upgrade.upgrade(self.home,self.source)
    def test_symlink_cannot_overwrite_another_file(self):
        self.target.unlink();self.target.symlink_to(self.source)
        with self.assertRaises(OSError):upgrade.upgrade(self.home,self.source)
        self.assertEqual(self.source.read_bytes(),self.new)
    def test_post_drop_wrapper_only_verifies_and_never_increments_state(self):
        upgrade.upgrade(self.home,self.source)
        with patch.object(upgrade.os,'geteuid',return_value=123456):
            self.assertEqual(upgrade.upgrade(self.home,self.source)['state'],'already_current')
        self.target.chmod(0o644);self.target.write_bytes(self.old);self.target.chmod(0o444)
        with patch.object(upgrade.os,'geteuid',return_value=123456):
            with self.assertRaisesRegex(RuntimeError,'requires_root'):upgrade.upgrade(self.home,self.source)
