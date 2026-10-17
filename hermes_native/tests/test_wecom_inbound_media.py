import asyncio
import base64
import importlib.util
import unittest
from pathlib import Path

import sys
import types

# 这个补丁文件在正式构建时覆盖到官方 Hermes 插件目录，运行时能拿到 agent / gateway 包。
# 单测环境里没有官方包，只测混入类逻辑，所以注入最小的替身；真实环境存在时不覆盖。
def _install_stubs():
    if "agent.i18n" not in sys.modules:
        agent = sys.modules.setdefault("agent", types.ModuleType("agent"))
        i18n = types.ModuleType("agent.i18n")
        i18n.t = lambda key, **kw: (key.format(**kw) if kw else key)
        sys.modules["agent.i18n"] = i18n
        setattr(agent, "i18n", i18n)
    if "gateway.platforms.base" not in sys.modules:
        gateway = sys.modules.setdefault("gateway", types.ModuleType("gateway"))
        platforms = sys.modules.setdefault("gateway.platforms", types.ModuleType("gateway.platforms"))
        base = types.ModuleType("gateway.platforms.base")

        class SendResult:  # 与官方同名的轻量替身，只保留测试用到的字段
            def __init__(self, success=True, message_id=None, error=None, raw_response=None, **kw):
                self.success = success
                self.message_id = message_id
                self.error = error
                self.raw_response = raw_response
                for k, v in kw.items():
                    setattr(self, k, v)

        async def cache_document_from_bytes_async(raw, filename):
            return f"/tmp/{filename}"

        async def cache_image_from_bytes_async(raw, ext):
            return f"/tmp/image{ext}"

        base.SendResult = SendResult
        base.cache_document_from_bytes_async = cache_document_from_bytes_async
        base.cache_image_from_bytes_async = cache_image_from_bytes_async
        sys.modules["gateway.platforms.base"] = base
        setattr(gateway, "platforms", platforms)
        setattr(platforms, "base", base)


_install_stubs()

spec = importlib.util.spec_from_file_location(
    'wecom_media_patched', Path(__file__).parents[1] / 'patches/plugins/platforms/wecom/media.py')
media = importlib.util.module_from_spec(spec); spec.loader.exec_module(media)


class Fake(media.WeComMediaMixin):
    """Minimal stand-in: records what the mixin tried to fetch, no network, no disk."""
    name = 'Wecom'

    def __init__(self, raw=b'%PDF-1.4 fixture', content_type='application/pdf', fail=False):
        self.raw = raw
        self.content_type = content_type
        self.fail = fail
        self.urls = []
        self.decrypted_with = []
        self.stored = None

    async def _download_remote_bytes(self, url, max_bytes):
        self.urls.append(url)
        if self.fail:
            raise RuntimeError('boom')
        return self.raw, {'content-type': self.content_type}

    def _decrypt_file_bytes(self, data, key):
        self.decrypted_with.append(key)
        return b'DEC' + data

    async def _store_media(self, kind, raw, ext, image_mime, filename, doc_mime, origin):
        self.stored = {'kind': kind, 'raw': raw, 'filename': filename, 'mime': doc_mime}
        return ('/tmp/stored-' + filename, doc_mime)


def extract(adapter, body):
    return asyncio.run(adapter._extract_media(body))


class InboundFileShapes(unittest.TestCase):
    def test_plain_url_shape_still_works(self):
        adapter = Fake()
        paths, types = extract(adapter, {'msgtype': 'file', 'file': {'url': 'https://cdn.example/a.pdf', 'filename': 'a.pdf'}})
        self.assertEqual(adapter.urls, ['https://cdn.example/a.pdf'])
        self.assertEqual(paths, ['/tmp/stored-a.pdf']); self.assertEqual(types, ['application/pdf'])

    def test_alias_url_keys_are_accepted(self):
        for key in ('downloadUrl', 'file_url', 'fileUrl', 'download_url'):
            adapter = Fake()
            paths, _ = extract(adapter, {'msgtype': 'file', 'file': {key: 'https://cdn.example/b.docx',
                                                                    'filename': 'b.docx'}})
            self.assertEqual(adapter.urls, ['https://cdn.example/b.docx'], key)
            self.assertEqual(paths, ['/tmp/stored-b.docx'], key)

    def test_aes_key_aliases_are_honoured(self):
        for key in ('aeskey', 'aes_key', 'aesKey'):
            adapter = Fake()
            extract(adapter, {'msgtype': 'file', 'file': {'url': 'https://cdn.example/c.pdf',
                                                          key: base64.b64encode(b'k' * 16).decode()}})
            self.assertEqual(len(adapter.decrypted_with), 1, key)
            self.assertTrue(adapter.stored['raw'].startswith(b'DEC'), key)

    def test_media_id_only_payload_is_reported_not_crashed(self):
        adapter = Fake()
        paths, types = extract(adapter, {'msgtype': 'file', 'file': {'media_id': 'MEDIA123', 'filename': 'd.pptx'}})
        self.assertEqual((paths, types), ([], [])); self.assertEqual(adapter.urls, [])

    def test_download_failure_is_swallowed_and_reported(self):
        adapter = Fake(fail=True)
        paths, types = extract(adapter, {'msgtype': 'file', 'file': {'url': 'https://cdn.example/e.pdf'}})
        self.assertEqual((paths, types), ([], [])); self.assertEqual(adapter.urls, ['https://cdn.example/e.pdf'])

    def test_images_and_quoted_files_still_route_through_the_same_path(self):
        adapter = Fake(raw=b'\x89PNG\r\n\x1a\nfixture', content_type='image/png')
        paths, types = extract(adapter, {'msgtype': 'image', 'image': {'download_url': 'https://cdn.example/f.png'}})
        self.assertEqual(adapter.urls, ['https://cdn.example/f.png'])
        self.assertEqual(paths, ['/tmp/stored-f.png']); self.assertEqual(types, ['image/png'])


if __name__ == '__main__':
    unittest.main()
