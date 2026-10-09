import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("bootstrap", Path(__file__).parents[1] / "bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class SeedTests(unittest.TestCase):
    def test_existing_private_config_and_reviewed_script_survive_seed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); home=root/'profile'; source=root/'template'; source.mkdir()
            (source/'config.yaml').write_text('new default')
            (source/'autonomy_gate.py').write_text('new script')
            bootstrap.seed(home,source/'config.yaml')
            (home/'config.yaml').write_text('private persistent config')
            (home/'scripts/autonomy_gate.py').write_text('reviewed persistent script')
            bootstrap.seed(home,source/'config.yaml')
            self.assertEqual((home/'config.yaml').read_text(),'private persistent config')
            self.assertEqual((home/'scripts/autonomy_gate.py').read_text(),'reviewed persistent script')

    def test_symlinked_script_directory_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); home=root/'profile'; home.mkdir(); source=root/'config.yaml'
            source.write_text('template'); outside=root/'outside'; outside.mkdir()
            (home/'scripts').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(RuntimeError):
                bootstrap.seed(home,source)
            self.assertFalse((outside/'autonomy_gate.py').exists())
