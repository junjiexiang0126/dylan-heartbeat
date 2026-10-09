"""Offline backup/restore. Never restores over a live service or resets budget."""
import argparse
import fcntl
import os
import shutil
import sqlite3
import time
from pathlib import Path
from .store import Store

def restore(data,backup):
    data=Path(data);data.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (data/'service.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        store=Store(data);prior=store.budget()['reserved_fen']
        source=sqlite3.connect('file:'+str(Path(backup).resolve())+'?mode=ro',uri=True)
        temporary=data/'restore.sqlite'
        try:
            if source.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Backup corrupt')
            with sqlite3.connect(temporary) as target: source.backup(target)
        finally: source.close()
        shutil.copy2(store.path,data/('before-restore-'+str(time.time_ns())+'.sqlite'))
        os.chmod(temporary,0o600);os.replace(temporary,store.path)
        restored=Store(data);used=restored.budget()['reserved_fen']
        if prior>used:
            with restored.transaction() as db:
                db.execute("INSERT INTO calls(run_id,reserved_fen,status,input_tokens,output_tokens,created) VALUES('restore-carryover',?,'carryover',0,0,?)",(prior-used,time.time()))
        restored.recover()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('operation',choices=('backup','restore'));parser.add_argument('--data',required=True);parser.add_argument('--backup');args=parser.parse_args()
    if args.operation=='restore':
        if not args.backup: parser.error('--backup required')
        restore(args.data,args.backup);print('Restored; previous state retained, budget cannot decrease')
    else:
        data=Path(args.data);data.mkdir(parents=True,exist_ok=True)
        with (data/'service.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);print(Store(data).backup())

if __name__=='__main__': main()
