import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('storage_backup',Path(__file__).with_name('backup.py'))
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_cold_bundle_roundtrip_and_corruption_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);state=root/'state';(state/'data/filer').mkdir(parents=True)
            (state/'data/filer/metadata').write_bytes(b'metadata')
            (state/'data/volume').mkdir();(state/'data/volume/chunks').write_bytes(b'ciphertext')
            sources={}
            for name,data in {'sql.bak':b'sql','openbao.snap':b'bao','deletions.json':b'{"userIds":[4]}','inventory.json':b'{"verified":true}'}.items():
                path=root/name;path.write_bytes(data);sources[name]=path
            with patch.object(backup.subprocess,'run') as run, patch.object(backup.subprocess,'check_output',return_value='0'*40):
                manifest=backup.pack(state,root/'bundle',sources)
                self.assertEqual(run.call_args.args[0][-1],'stop')
            backup.unpack(root/'bundle',root/'restored')
            self.assertEqual((root/'restored/data/filer/metadata').read_bytes(),b'metadata')
            self.assertEqual((root/'restored/data/volume/chunks').read_bytes(),b'ciphertext')
            with self.assertRaises(ValueError):backup.unpack(root/'bundle',root/'restored')
            (root/'bundle/sql.bak').write_bytes(b'broken')
            with self.assertRaises(ValueError):backup.validate(root/'bundle')
            self.assertTrue(manifest['backupSet'])

    def test_rejects_path_traversal_before_extracting_any_member(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bundle=root/'bundle';bundle.mkdir()
            for name in backup.PAYLOADS:(bundle/name).write_bytes(b'fixture')
            with tarfile.open(bundle/'seaweed.tar','w') as archive:
                member=tarfile.TarInfo('../escape');member.size=4;archive.addfile(member,io.BytesIO(b'evil'))
            (bundle/'manifest.json').write_text(json.dumps({'seaweedImage':backup.IMAGE,'files':{name:backup.checksum(bundle/name) for name in backup.PAYLOADS}}))
            with self.assertRaises(ValueError):backup.unpack(bundle,root/'restored')
            self.assertFalse((root/'escape').exists())

    def test_rejects_existing_linked_parent_even_when_archive_omits_directory_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bundle=root/'bundle';bundle.mkdir();state=root/'state';state.mkdir();outside=root/'outside';outside.mkdir()
            (state/'data').symlink_to(outside,target_is_directory=True)
            for name in backup.PAYLOADS:(bundle/name).write_bytes(b'fixture')
            with tarfile.open(bundle/'seaweed.tar','w') as archive:
                member=tarfile.TarInfo('data/escape');member.size=4;archive.addfile(member,io.BytesIO(b'evil'))
            (bundle/'manifest.json').write_text(json.dumps({'seaweedImage':backup.IMAGE,'files':{name:backup.checksum(bundle/name) for name in backup.PAYLOADS}}))
            with self.assertRaises(ValueError):backup.unpack(bundle,state)
            self.assertFalse((outside/'escape').exists())

if __name__=='__main__':unittest.main()
