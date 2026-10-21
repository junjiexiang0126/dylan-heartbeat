#!/usr/bin/env python3
"""Offline restore from locally downloaded COS archives; never targets production / by default."""
import argparse,hashlib,json,os,pathlib,sqlite3,subprocess,tarfile,tempfile

def digest(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()

def safe_rel(s):
 p=pathlib.PurePosixPath(s)
 if not p.is_absolute() or '..' in p.parts or s=='/':raise RuntimeError('unsafe manifest path')
 return str(p).lstrip('/')

def restore(archives,key,dest):
 dest=pathlib.Path(dest).resolve()
 if dest.exists() and any(dest.iterdir()):raise RuntimeError('restore destination must be empty')
 dest.mkdir(parents=True,exist_ok=True)
 previous=None
 for i,arc in enumerate(archives):
  arc=pathlib.Path(arc)
  sidecar=pathlib.Path(str(arc)+'.manifest.json')
  if not sidecar.exists(): sidecar=arc.parent/(arc.name.removesuffix('.tar.zst.gpg')+'.manifest.json')
  meta=json.loads(sidecar.read_text())
  if digest(arc)!=meta['archive_sha256'] or arc.stat().st_size!=meta['archive_bytes']:raise RuntimeError('encrypted archive hash/size mismatch')
  if i==0 and meta['mode']!='weekly':raise RuntimeError('restore chain must start with weekly')
  if i>0 and (meta['mode']!='daily' or meta['parent']!=previous['task'] or meta['parent_archive_sha256']!=previous['archive_sha256']):raise RuntimeError('broken restore chain')
  with tempfile.TemporaryDirectory() as tmp:
   tmp=pathlib.Path(tmp);z=tmp/'plain.zst';tar=tmp/'plain.tar';out=tmp/'extracted';out.mkdir()
   with open(z,'wb') as f:subprocess.run(['gpg','--batch','--quiet','--pinentry-mode','loopback','--passphrase-file',str(key),'-d',str(arc)],stdout=f,check=True)
   with open(tar,'wb') as f:subprocess.run(['zstd','-q','-d','-c',str(z)],stdout=f,check=True)
   with tarfile.open(tar) as tf:
    for m in tf.getmembers():
     p=pathlib.PurePosixPath(m.name)
     if p.is_absolute() or '..' in p.parts or not (m.isfile() or m.isdir()):raise RuntimeError('unsafe tar entry')
    tf.extractall(out,filter='data')
   manifest=json.loads((out/'manifest.json').read_text())
   if manifest['task']!=meta['task'] or manifest['mode']!=meta['mode']:raise RuntimeError('inner manifest mismatch')
   if i and (manifest['parent']!=previous['task'] or manifest['parent_archive_sha256']!=previous['archive_sha256']):raise RuntimeError('inner chain mismatch')
   for p,record in manifest['files'].items():
    rel=safe_rel(p);source=out/'files'/rel
    if not source.is_file() or source.is_symlink() or digest(source)!=record['sha256']:raise RuntimeError('file integrity failure: '+p)
    target=dest/'files'/rel
    if target.is_symlink() or any(x.is_symlink() for x in target.parents if x!=dest.parent):raise RuntimeError('unsafe restore target')
    target.parent.mkdir(parents=True,exist_ok=True)
    import shutil
    shutil.copy2(source,target)
   for p in manifest['deleted']:
    rel=safe_rel(p);target=dest/'files'/rel
    if target.is_symlink() or any(x.is_symlink() for x in target.parents if x!=dest.parent):raise RuntimeError('unsafe deletion target')
    if target.is_file():target.unlink()
    elif target.exists():raise RuntimeError('refuse non-file deletion')
   for name,hashval in manifest['databases'].items():
    if '/' in name or name in ('.','..'):raise RuntimeError('unsafe db name')
    src=out/'databases'/name
    if not src.is_file() or digest(src)!=hashval:raise RuntimeError('database hash mismatch')
    target=dest/'databases'/name;target.parent.mkdir(parents=True,exist_ok=True)
    import shutil
    shutil.copy2(src,target)
    with sqlite3.connect(target) as c:
     if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('database integrity check failed')
  previous=meta
 return {'restored':len(archives),'last_task':previous['task']}

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--key',required=True);ap.add_argument('--dest',required=True);ap.add_argument('archives',nargs='+');a=ap.parse_args()
 print(json.dumps(restore(a.archives,a.key,a.dest),ensure_ascii=False))
