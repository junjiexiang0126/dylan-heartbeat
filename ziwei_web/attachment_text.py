"""Extract bounded document text, with no macros, links or external resources."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

try:
    file, name = sys.argv[1:3]
    with zipfile.ZipFile(file) as z:
        names = ['word/document.xml'] if name.endswith('.docx') else [n for n in z.namelist() if n == 'xl/sharedStrings.xml' or n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]
        if not names or len(names) > 100: raise ValueError()
        texts = []
        total = 0
        for member in names:
            info = z.getinfo(member)
            total += info.file_size
            if total > 8 * 1024 * 1024: raise ValueError()
            data = z.read(member)
            if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise ValueError()
            root = ET.fromstring(data)
            texts.extend(node.text or '' for node in root.iter() if node.tag.rsplit('}',1)[-1] in ('t','v'))
        text = '\n'.join(texts)
        print(json.dumps({'text':text[:200000], 'truncated':len(text)>200000}, ensure_ascii=False))
except Exception:
    print(json.dumps({'error':'document_extract_failed'})); sys.exit(1)
