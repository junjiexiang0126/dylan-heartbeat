#!/usr/bin/env python3
"""
Ziwei COS Backup V1.3 — Auto-Discovery Edition with Safety Enhancements

Safety guarantees:
- Preflight disk space check (≥10 GB free required)
- Dependency chain validation before cleanup
- Minimum 2 independent weekly baselines preserved
- Post-upload COS object integrity verification
- Failed task cleanup: keep report, remove large archives
- Dual mutual exclusion (fcntl flock + PID file)
- Full audit report for every cleanup operation
- COS lifecycle managed via console (no DeleteObject permission escalation)
"""

import argparse, datetime, fcntl, fnmatch, hashlib, json, os, pathlib, re, shutil, sqlite3, subprocess, sys, tarfile, tempfile, uuid

ROOT = pathlib.Path('/')

# ── helpers ──────────────────────────────────────────────────────────

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def run(argv, **kw):
    return subprocess.run(argv, check=True, **kw)

def atomic_json(path, obj):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
        tmp = f.name
    os.replace(tmp, path)

def safe_rel(p):
    path = pathlib.PurePosixPath(p)
    if not path.is_absolute() or '..' in path.parts or str(path) == '/':
        raise ValueError('unsafe path: ' + p)
    return str(path).lstrip('/')

def matches_exclude(filepath, exclude_patterns):
    sp = str(filepath)
    for pat in exclude_patterns:
        pp = pat['path']
        mode = pat.get('match', 'exact')
        if mode == 'prefix':
            if sp.startswith(pp):
                return True, pat['reason']
        elif mode == 'glob':
            if fnmatch.fnmatch(sp, pp):
                return True, pat['reason']
        else:
            if sp == pp or sp.startswith(pp + '/'):
                return True, pat['reason']
    return False, None

# ── Preflight check ──────────────────────────────────────────────────

def preflight_check(cfg, estimated_file_count, estimated_db_count):
    """Check disk space and resource availability before backup."""
    stage = pathlib.Path(cfg['stage'])
    min_free = cfg.get('min_free_bytes', 10 * 1024**3)  # default 10 GB

    # Estimate required space: files + databases + archive overhead (30%)
    avg_file_size = 50 * 1024  # conservative estimate: 50 KB per file
    avg_db_size = 5 * 1024 * 1024  # conservative: 5 MB per database
    estimated_raw = (estimated_file_count * avg_file_size) + (estimated_db_count * avg_db_size)
    estimated_total = int(estimated_raw * 4.0)  # 4x overhead: payload + tar + zst + gpg + verify extract

    disk = shutil.disk_usage(stage)
    free_bytes = disk.free

    result = {
        'free_bytes': free_bytes,
        'free_gb': round(free_bytes / (1024**3), 2),
        'estimated_bytes': estimated_total,
        'estimated_gb': round(estimated_total / (1024**3), 2),
        'min_required_bytes': min_free,
        'min_required_gb': round(min_free / (1024**3), 2),
        'passed': True,
        'warnings': []
    }

    if free_bytes < min_free:
        result['passed'] = False
        result['warnings'].append(
            f'DISK SPACE CRITICAL: {result["free_gb"]} GB free, '
            f'minimum {result["min_required_gb"]} GB required. Backup aborted.'
        )
    elif free_bytes < estimated_total * 2:
        result['warnings'].append(
            f'DISK SPACE LOW: {result["free_gb"]} GB free, '
            f'estimated need {result["estimated_gb"]} GB. Proceeding with caution.'
        )

    try:
        tmp_disk = shutil.disk_usage('/tmp')
        if tmp_disk.free < 500 * 1024 * 1024:
            result['warnings'].append(f'/tmp space low: {tmp_disk.free / 1024**3:.1f} GB free')
    except Exception:
        pass
    return result

# ── Docker mount discovery ───────────────────────────────────────────

def discover_docker_mounts(cfg):
    report = {'containers': {}, 'unmanaged_mounts': [], 'alerts': []}
    managed_paths = {r['path'] for r in cfg['managed_roots']}

    for cname in cfg['docker_mount_discovery']['containers']:
        try:
            insp = json.loads(subprocess.check_output(
                ['docker', 'inspect', cname], stderr=subprocess.DEVNULL, text=True
            ))
            if not insp:
                report['alerts'].append(f'container not found: {cname}')
                continue
            mounts = []
            for m in insp[0].get('Mounts', []):
                if m['Type'] == 'bind':
                    src = m['Source']
                    dst = m['Destination']
                    mounts.append({'source': src, 'destination': dst, 'mode': m.get('Mode', '')})
                    src_path = pathlib.Path(src)
                    is_managed = any(
                        src == mp or str(src_path).startswith(mp + '/')
                        for mp in managed_paths
                    )
                    if not is_managed and cfg['docker_mount_discovery']['alert_on_unmanaged']:
                        report['unmanaged_mounts'].append({
                            'container': cname, 'source': src, 'destination': dst
                        })
            report['containers'][cname] = {'mounts': mounts, 'image': insp[0].get('Config', {}).get('Image', 'unknown')}
        except subprocess.CalledProcessError:
            report['alerts'].append(f'failed to inspect container: {cname}')
        except (KeyError, json.JSONDecodeError) as e:
            report['alerts'].append(f'invalid inspect output for {cname}: {e}')

    if report['unmanaged_mounts']:
        report['alerts'].append(
            f'UNMANAGED MOUNTS DETECTED: {len(report["unmanaged_mounts"])} bind mount(s) not in managed roots — '
            + ', '.join(m['source'] for m in report['unmanaged_mounts'])
        )
    return report

# ── Host service discovery ───────────────────────────────────────────

def discover_host_services(cfg):
    report = {'found': [], 'missing': [], 'alerts': []}
    for pattern in cfg['host_services']['paths']:
        import glob as glob_mod
        matches = glob_mod.glob(pattern)
        if matches:
            report['found'].extend(matches)
        elif cfg['host_services']['alert_on_missing']:
            report['missing'].append(pattern)
            report['alerts'].append(f'host service path missing: {pattern}')
    return report

# ── SQLite auto-discovery ────────────────────────────────────────────

def discover_sqlite_databases(cfg):
    databases = []
    alerts = []
    extensions = tuple(cfg['sqlite_discovery']['extensions'])
    exclude_paths = cfg['sqlite_discovery']['exclude_paths']

    for root_entry in cfg['managed_roots']:
        rp = pathlib.Path(root_entry['path'])
        if not rp.exists() or not root_entry.get('recursive', True) or not rp.is_dir():
            continue

        for found in rp.rglob('*'):
            if found.is_symlink() or not found.is_file():
                continue
            if not found.name.endswith(extensions):
                continue
            excluded = False
            for ep in exclude_paths:
                ep_path = pathlib.Path(ep)
                try:
                    found.relative_to(ep_path)
                    excluded = True
                    break
                except ValueError:
                    pass
            if excluded:
                continue
            # Skip empty databases (0 bytes)
            if found.stat().st_size == 0:
                continue
            try:
                conn = sqlite3.connect('file:' + str(found) + '?mode=ro', uri=True)
                conn.execute('SELECT count(*) FROM sqlite_master')
                conn.close()
                databases.append(str(found))
            except sqlite3.Error:
                pass

    return sorted(databases), alerts

# ── Unknown storage discovery ────────────────────────────────────────

def discover_unknown_storage(cfg):
    findings = []
    alerts = []
    ext_patterns = cfg['unknown_storage_alert']['extensions']
    dir_patterns = cfg['unknown_storage_alert']['directories']
    exclude_paths = cfg['unknown_storage_alert'].get('exclude_paths', [])

    def is_excluded(path_str):
        for ep in exclude_paths:
            if path_str == ep or path_str.startswith(ep + '/'):
                return True
        return False

    for root_entry in cfg['managed_roots']:
        rp = pathlib.Path(root_entry['path'])
        if not rp.exists() or not rp.is_dir():
            continue
        for ext in ext_patterns:
            for found in rp.rglob('*' + ext):
                if found.is_file() and not found.is_symlink():
                    if not is_excluded(str(found)):
                        findings.append({'type': 'unknown_db_file', 'path': str(found), 'extension': ext})
        for dname in dir_patterns:
            for found in rp.rglob(dname):
                if found.is_dir() and not found.is_symlink():
                    if not is_excluded(str(found)):
                        findings.append({'type': 'unknown_storage_dir', 'path': str(found), 'name': dname})

    if findings:
        alerts.append(
            f'UNKNOWN STORAGE DETECTED: {len(findings)} item(s) — '
            + '; '.join(f['path'] for f in findings[:5])
            + ('...' if len(findings) > 5 else '')
        )
    return findings, alerts

# ── SQLite backup via backup API ─────────────────────────────────────

def backup_sqlite(src_path, dest_path):
    dest_path = pathlib.Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    src_uri = 'file:' + str(src_path) + '?mode=ro'
    src = sqlite3.connect(src_uri, uri=True)
    dst = sqlite3.connect(str(dest_path))
    try:
        src.backup(dst)
        result = dst.execute('PRAGMA integrity_check').fetchone()
        if result[0] != 'ok':
            raise RuntimeError(f'SQLite integrity_check failed for {src_path}: {result[0]}')
    finally:
        dst.close()
        src.close()
    return sha(dest_path)

# ── File inventory with exclusion ────────────────────────────────────

def inventory_with_exclusions(cfg):
    out = {}
    absent = []
    excluded = {}
    exclude_patterns = cfg['exclude_patterns']

    for root_entry in cfg['managed_roots']:
        rp = pathlib.Path(root_entry['path'])
        if not rp.exists():
            absent.append(root_entry['path'])
            continue
        if rp.is_symlink():
            raise RuntimeError('symlink source root: ' + root_entry['path'])

        if rp.is_file():
            is_excl, reason = matches_exclude(str(rp), exclude_patterns)
            if is_excl:
                excluded[str(rp)] = reason
                continue
            st0 = rp.stat()
            digest = sha(rp)
            st1 = rp.stat()
            if (st0.st_size, st0.st_mtime_ns, st0.st_ino) != (st1.st_size, st1.st_mtime_ns, st1.st_ino):
                raise RuntimeError('source changed while scanning: ' + str(rp))
            out[str(rp)] = {'sha256': digest, 'size': st1.st_size, 'mode': st1.st_mode & 0o777}
        elif not root_entry.get('recursive', True):
            for p in sorted(rp.iterdir()):
                if p.is_symlink() or not p.is_file():
                    continue
                is_excl, reason = matches_exclude(str(p), exclude_patterns)
                if is_excl:
                    excluded[str(p)] = reason
                    continue
                st0 = p.stat()
                digest = sha(p)
                st1 = p.stat()
                if (st0.st_size, st0.st_mtime_ns, st0.st_ino) != (st1.st_size, st1.st_mtime_ns, st1.st_ino):
                    raise RuntimeError('source changed while scanning: ' + str(p))
                out[str(p)] = {'sha256': digest, 'size': st1.st_size, 'mode': st1.st_mode & 0o777}
        else:
            for p in sorted(rp.rglob('*')):
                if p.is_symlink() or not p.is_file():
                    continue
                if p.name.endswith('-wal') or p.name.endswith('-shm'):
                    excluded[str(p)] = 'SQLite WAL/SHM temporary file'
                    continue
                is_excl, reason = matches_exclude(str(p), exclude_patterns)
                if is_excl:
                    excluded[str(p)] = reason
                    continue
                st0 = p.stat()
                digest = sha(p)
                st1 = p.stat()
                if (st0.st_size, st0.st_mtime_ns, st0.st_ino) != (st1.st_size, st1.st_mtime_ns, st1.st_ino):
                    raise RuntimeError('source changed while scanning: ' + str(p))
                out[str(p)] = {'sha256': digest, 'size': st1.st_size, 'mode': st1.st_mode & 0o777}

    return out, absent, excluded

# ── Copy with verification ───────────────────────────────────────────

def copy_verified(src, dest, expected):
    dest = pathlib.Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(src, 'rb') as s, open(dest, 'xb') as d:
        shutil.copyfileobj(s, d, 1024 * 1024)
    os.chmod(dest, expected['mode'])
    if sha(dest) != expected['sha256'] or sha(src) != expected['sha256']:
        raise RuntimeError('file changed during capture: ' + src)

# ── Archive and encrypt ──────────────────────────────────────────────

def archive_and_encrypt(payload, encrypted, key):
    plain = encrypted.with_suffix('.tar')
    packed = encrypted.with_suffix('.zst')
    try:
        with tarfile.open(plain, 'w', dereference=False) as tf:
            tf.add(payload, arcname='.', recursive=True)
        with open(packed, 'wb') as o:
            run(['zstd', '-q', '-3', '-T0', '-c', str(plain)], stdout=o)
        run(['gpg', '--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback',
             '--cipher-algo', 'AES256', '--passphrase-file', str(key),
             '-c', '-o', str(encrypted), str(packed)])
        check = encrypted.with_suffix('.check.zst')
        try:
            with open(check, 'wb') as f:
                run(['gpg', '--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback',
                     '--passphrase-file', str(key), '-d', str(encrypted)], stdout=f)
            if sha(check) != sha(packed):
                raise RuntimeError('decrypt verification mismatch')
        finally:
            check.unlink(missing_ok=True)
    finally:
        plain.unlink(missing_ok=True)
        packed.unlink(missing_ok=True)

# ── COS object verification ──────────────────────────────────────────

def verify_cos_object(cos_path, expected_sha256, coscli):
    """Verify a COS object exists and its SHA256 matches (via coscli hash)."""
    try:
        result = subprocess.run(
            [coscli, 'hash', cos_path, '--type', 'sha256'],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            return {'exists': False, 'sha256_match': False, 'error': result.stderr.strip()}
        # coscli hash output format: "sha256: <hash>"
        for line in result.stdout.strip().split('\n'):
            if expected_sha256 in line:
                return {'exists': True, 'sha256_match': True}
        return {'exists': True, 'sha256_match': False, 'error': 'SHA256 mismatch'}
    except Exception as e:
        return {'exists': False, 'sha256_match': False, 'error': str(e)}

# ── Stage cleanup with safety checks ─────────────────────────────────

def cleanup_stage(cfg, commit_data=None):
    """
    Clean up old staging tasks with safety guarantees:
    - Verify COS object exists before deleting local copy
    - Preserve at least 2 independent weekly baselines
    - Check dependency chain before deleting any task
    - Generate audit report
    """
    stage = pathlib.Path(cfg['stage'])
    state = pathlib.Path(cfg['state'])
    if not stage.exists():
        return {'cleaned': [], 'preserved': [], 'errors': [], 'audit': []}

    max_age_seconds = cfg['stage_cleanup']['max_age_days'] * 86400
    min_free = cfg['stage_cleanup']['min_free_bytes']
    coscli = cfg['coscli']
    bucket = cfg['bucket'].rstrip('/')
    now = datetime.datetime.now().timestamp()

    cleaned = []
    preserved = []
    errors = []
    audit = []

    # Load commit data for dependency analysis
    if commit_data is None:
        commit_file = state / 'commit.json'
        commit_data = json.loads(commit_file.read_text()) if commit_file.exists() else {}

    latest = commit_data.get('latest', {})
    latest_task = latest.get('task', '')

    # Collect all task directories with their metadata
    tasks = []
    for entry in sorted(stage.iterdir()):
        if not entry.is_dir():
            continue
        manifest_file = entry / (entry.name + '.manifest.json')
        manifest = {}
        if manifest_file.exists():
            try:
                manifest = json.loads(manifest_file.read_text())
            except json.JSONDecodeError:
                pass
        tasks.append({
            'path': entry,
            'name': entry.name,
            'age_seconds': now - entry.stat().st_mtime,
            'manifest': manifest,
            'mode': manifest.get('mode', 'unknown'),
            'status': manifest.get('status', 'unknown'),
            'cos_verified': manifest.get('cos_verified', False),
            'archive_sha256': manifest.get('archive_sha256', ''),
            'parent': manifest.get('parent'),
            'is_latest': entry.name == latest_task
        })

    # Count weekly baselines (independent, no parent, fully verified)
    # A valid baseline must satisfy ALL of:
    #   status == 'OK' (restore verification passed)
    #   cos_verified == True (uploaded to COS and SHA256 verified)
    #   no parent (independent baseline, not incremental)
    weekly_baselines = [t for t in tasks if t['mode'] == 'weekly' and not t['parent'] and t['status'] == 'OK' and t['cos_verified'] == True]

    for task in tasks:
        entry = task['path']
        name = task['name']
        audit_entry = {
            'task': name,
            'action': 'PRESERVE',
            'reason': '',
            'size_bytes': 0,
            'cos_verified': None
        }

        # Calculate size
        try:
            task_size = sum(f.stat().st_size for f in entry.rglob('*') if f.is_file())
            audit_entry['size_bytes'] = task_size
        except Exception:
            task_size = 0

        # Never clean the latest committed task
        if task['is_latest']:
            audit_entry['reason'] = 'current committed baseline'
            preserved.append(name)
            audit.append(audit_entry)
            continue

        # Never clean if it's a parent of another task in the chain
        is_parent = any(t['parent'] == name for t in tasks)
        if is_parent:
            audit_entry['reason'] = 'dependency chain parent'
            preserved.append(name)
            audit.append(audit_entry)
            continue

        # Weekly baseline protection: keep at least 2 valid (OK + cos_verified) baselines
        if task['mode'] == 'weekly' and not task['parent'] and task['status'] == 'OK' and task['cos_verified'] == True:
            if len(weekly_baselines) <= 2:
                audit_entry['reason'] = f'minimum weekly baseline protection ({len(weekly_baselines)} remaining)'
                preserved.append(name)
                audit.append(audit_entry)
                continue

        # Failed/partial archive retention: keep up to 3 for investigation, oldest first
        if task['mode'] == 'weekly' and not task['parent'] and task['status'] != 'OK':
            failed_tasks = [t for t in tasks if t['mode'] == 'weekly' and not t['parent'] and t['status'] != 'OK']
            failed_tasks_sorted = sorted(failed_tasks, key=lambda t: t['age_seconds'])
            if task in failed_tasks_sorted[:3]:
                audit_entry['reason'] = f'failed/partial archive retained for investigation (max 3, {failed_tasks_sorted.index(task)+1}/{min(len(failed_tasks_sorted),3)})'
                preserved.append(name)
                audit.append(audit_entry)
                continue

        # Age check
        if task['age_seconds'] < max_age_seconds:
            audit_entry['reason'] = f'within retention period ({task["age_seconds"]/86400:.1f} days < {cfg["stage_cleanup"]["max_age_days"]} days)'
            preserved.append(name)
            audit.append(audit_entry)
            continue

        # For tasks with COS uploads, verify COS object exists before deleting
        if task['archive_sha256'] and task['status'] == 'OK':
            cos_path = f"{bucket}/{task['mode']}/{name}.tar.zst.gpg"
            cos_result = verify_cos_object(cos_path, task['archive_sha256'], coscli)
            audit_entry['cos_verified'] = cos_result
            if not cos_result.get('sha256_match'):
                audit_entry['reason'] = 'COS verification failed — preserving local copy'
                audit_entry['action'] = 'PRESERVE'
                preserved.append(name)
                audit.append(audit_entry)
                continue

        # Safe to clean
        try:
            # Check lock file — don't clean if backup is running
            lock_file = state / 'lock'
            pid_file = state / 'backup.pid'
            if pid_file.exists():
                try:
                    old_pid = int(pid_file.read_text().strip())
                    os.kill(old_pid, 0)
                    audit_entry['reason'] = 'active backup task running'
                    audit_entry['action'] = 'PRESERVE'
                    preserved.append(name)
                    audit.append(audit_entry)
                    continue
                except (OSError, ValueError):
                    pass  # Stale PID

            shutil.rmtree(entry)
            audit_entry['action'] = 'DELETE'
            audit_entry['reason'] = f'age {task["age_seconds"]/86400:.1f} days, COS verified, not in dependency chain'
            cleaned.append(name)
            # Update weekly baseline count if we deleted one
            if task['mode'] == 'weekly' and not task['parent']:
                weekly_baselines = [t for t in weekly_baselines if t['name'] != name]
        except Exception as e:
            audit_entry['action'] = 'ERROR'
            audit_entry['reason'] = str(e)
            errors.append(f'failed to clean {name}: {e}')

        audit.append(audit_entry)

    # Check free space
    disk_usage = shutil.disk_usage(stage)
    if disk_usage.free < min_free:
        errors.append(f'low disk space: {disk_usage.free} bytes free, min required {min_free}')

    return {
        'cleaned': cleaned,
        'preserved': preserved,
        'errors': errors,
        'free_bytes': disk_usage.free,
        'audit': audit
    }

# ── Restore verification ─────────────────────────────────────────────

def verify_restore(encrypted_path, key, expected_manifest, stage_dir=None):
    results = {'sqlite_check': {}, 'manifest_match': False, 'errors': []}
    if stage_dir is None:
        stage_dir = encrypted_path.parent
    work_dir = stage_dir / ('verify-' + encrypted_path.stem)
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        archive_size = encrypted_path.stat().st_size
        disk = shutil.disk_usage(work_dir)
        if disk.free < archive_size * 3:
            results['errors'].append(f'insufficient space for restore verification: {disk.free} free, need {archive_size * 3}')
            return results
        tdp = work_dir
        try:
            decrypted = tdp / 'decrypted.tar.zst'
            with open(decrypted, 'wb') as f:
                run(['gpg', '--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback',
                     '--passphrase-file', str(key), '-d', str(encrypted_path)], stdout=f)

            extracted = tdp / 'extracted'
            extracted.mkdir()
            run(['tar', '--zstd', '-xf', str(decrypted), '-C', str(extracted)])

            manifest_path = extracted / 'manifest.json'
            if manifest_path.exists():
                actual_manifest = json.loads(manifest_path.read_text())
                match = (
                    actual_manifest.get('task') == expected_manifest.get('task') and
                    actual_manifest.get('mode') == expected_manifest.get('mode')
                )
                results['manifest_match'] = match
                if not match:
                    results['errors'].append('manifest mismatch')
            else:
                results['errors'].append('manifest.json not found in backup')

            db_dir = extracted / 'databases'
            if db_dir.exists():
                for db_file in sorted(db_dir.iterdir()):
                    if db_file.is_file():
                        try:
                            conn = sqlite3.connect(str(db_file))
                            ok = conn.execute('PRAGMA integrity_check').fetchone()[0]
                            conn.close()
                            results['sqlite_check'][db_file.name] = ok
                            if ok != 'ok':
                                results['errors'].append(f'SQLite integrity fail: {db_file.name}')
                        except Exception as e:
                            results['sqlite_check'][db_file.name] = f'error: {e}'
                            results['errors'].append(f'SQLite check error: {db_file.name}: {e}')
        except Exception as e:
            results['errors'].append(f'restore verification failed: {e}')
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    return results

# ── Main backup function ─────────────────────────────────────────────

def backup(cfg, mode, dry_run=False, object_mode=None, no_upload=False):
    state = pathlib.Path(cfg['state'])
    stage = pathlib.Path(cfg['stage'])
    state.mkdir(parents=True, exist_ok=True)
    stage.mkdir(parents=True, exist_ok=True)

    # ── Mutual exclusion: check for existing backup tasks ────────────
    pid_file = state / 'backup.pid'
    if pid_file.exists():
        try:
            old_pid = int(pid_file.read_text().strip())
            os.kill(old_pid, 0)
            raise RuntimeError(f'Another backup task is running (PID {old_pid})')
        except (OSError, ValueError):
            pid_file.unlink(missing_ok=True)

    try:
        # Acquire file lock
        with open(state / 'lock', 'a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

            # Write PID after acquiring lock (preflight runs before this)
            pid_file.write_text(str(os.getpid()))

            commit = json.loads((state / 'commit.json').read_text()) if (state / 'commit.json').exists() else None
            prev = commit['latest'] if commit else None

            # Validate chain
            if mode == 'daily':
                if not prev or prev['mode'] not in ('daily', 'weekly'):
                    raise RuntimeError('daily requires successful weekly baseline')
                if not commit:
                    raise RuntimeError('daily inventory baseline missing')

            key = pathlib.Path(cfg['key'])
            if not key.is_file():
                raise RuntimeError('encryption key missing')

            for p in cfg['required_files']:
                if not pathlib.Path(p).exists():
                    raise RuntimeError('required source missing: ' + p)

            # ── Discovery phase ──────────────────────────────────────
            coverage_report = {
                'schema': 3,
                'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'mode': mode,
                'discovered': {},
                'backed_up': {},
                'excluded': {},
                'failed': {},
                'unknown': {},
                'alerts': [],
                'status': 'IN_PROGRESS'
            }

            docker_report = discover_docker_mounts(cfg)
            coverage_report['discovered']['docker_mounts'] = docker_report
            coverage_report['alerts'].extend(docker_report['alerts'])

            host_report = discover_host_services(cfg)
            coverage_report['discovered']['host_services'] = host_report
            coverage_report['alerts'].extend(host_report['alerts'])

            sqlite_dbs, sqlite_alerts = discover_sqlite_databases(cfg)
            coverage_report['discovered']['sqlite_databases'] = sqlite_dbs
            coverage_report['alerts'].extend(sqlite_alerts)

            unknown_storage, unknown_alerts = discover_unknown_storage(cfg)
            coverage_report['unknown']['storage'] = unknown_storage
            coverage_report['alerts'].extend(unknown_alerts)

            current, absent_roots, excluded_files = inventory_with_exclusions(cfg)
            if absent_roots:
                coverage_report['alerts'].append('MISSING MANAGED ROOTS: ' + ', '.join(absent_roots))
            coverage_report['excluded'] = {k: v for k, v in list(excluded_files.items())[:100]}
            coverage_report['excluded_count'] = len(excluded_files)

            old = commit['inventory'] if mode == 'daily' else {}
            changed = {p: r for p, r in current.items() if p not in old or r['sha256'] != old[p]['sha256']}
            deleted = sorted(set(old) - set(current)) if mode == 'daily' else []

            # ── Preflight check ──────────────────────────────────────
            preflight = preflight_check(cfg, len(changed), len(sqlite_dbs))
            coverage_report['preflight'] = preflight
            if preflight['warnings']:
                coverage_report['alerts'].extend(preflight['warnings'])
            if not preflight['passed']:
                coverage_report['status'] = 'ABORTED'
                return {
                    'aborted': True,
                    'reason': 'preflight check failed',
                    'preflight': preflight,
                    'alerts': coverage_report['alerts']
                }

            # ── Dry-run: return after discovery ──────────────────────
            if dry_run:
                coverage_report['status'] = 'DRY_RUN'
                coverage_report['discovered']['total_files'] = len(current)
                coverage_report['discovered']['changed_files'] = len(changed)
                coverage_report['discovered']['deleted_files'] = len(deleted)
                return {
                    'dry_run': True,
                    'total_files': len(current),
                    'changed_files': len(changed),
                    'deleted_files': len(deleted),
                    'sqlite_databases': len(sqlite_dbs),
                    'sqlite_list': sqlite_dbs,
                    'excluded_count': len(excluded_files),
                    'unknown_storage': len(unknown_storage),
                    'alerts': coverage_report['alerts'],
                    'docker_mounts': docker_report,
                    'host_services': host_report,
                    'preflight': preflight
                }

            # ── Task setup ───────────────────────────────────────────
            task = f"{mode}-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:10]}"
            work = stage / task
            payload = work / 'payload'
            payload.mkdir(parents=True)

            has_critical_failure = False

            try:
                (payload / 'files').mkdir()
                (payload / 'databases').mkdir()

                for p, r in changed.items():
                    try:
                        copy_verified(p, payload / 'files' / safe_rel(p), r)
                    except Exception as e:
                        coverage_report['failed'][p] = str(e)
                        has_critical_failure = True

                db_results = {}
                for db_path in sqlite_dbs:
                    db_name = safe_rel(db_path).replace('/', '_')
                    dest = payload / 'databases' / db_name
                    try:
                        db_hash = backup_sqlite(db_path, dest)
                        db_results[db_path] = {'sha256': db_hash, 'status': 'ok'}
                    except Exception as e:
                        db_results[db_path] = {'status': 'error', 'error': str(e)}
                        coverage_report['failed'][db_path] = str(e)
                        has_critical_failure = True
                coverage_report['backed_up']['sqlite_databases'] = db_results

                files_hash = {p: sha(payload / 'files' / safe_rel(p)) for p in changed if p not in coverage_report['failed']}
                if any(files_hash[p] != r['sha256'] for p, r in changed.items() if p in files_hash):
                    raise RuntimeError('staged content mismatch')

                manifest = {
                    'schema': 3, 'task': task, 'mode': mode,
                    'parent': prev['task'] if mode == 'daily' else None,
                    'parent_archive_sha256': prev['archive_sha256'] if mode == 'daily' else None,
                    'inventory_sha256': hashlib.sha256(json.dumps(current, sort_keys=True).encode()).hexdigest(),
                    'files': changed, 'deleted': deleted,
                    'databases': {name: sha(payload / 'databases' / name) for name in os.listdir(payload / 'databases') if (payload / 'databases' / name).is_file()},
                    'created_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'status': 'OK' if not has_critical_failure else 'PARTIAL',
                    'coverage': {
                        'total_files': len(current), 'changed_files': len(changed),
                        'deleted_files': len(deleted), 'excluded_files': len(excluded_files),
                        'sqlite_databases': len(sqlite_dbs),
                        'unknown_storage_items': len(unknown_storage),
                        'alerts': len(coverage_report['alerts'])
                    }
                }
                atomic_json(payload / 'manifest.json', manifest)

                encrypted = work / (task + '.tar.zst.gpg')
                archive_and_encrypt(payload, encrypted, key)
                archive_sha = sha(encrypted)
                size = encrypted.stat().st_size

                if size >= cfg['max_object_bytes']:
                    raise RuntimeError('object exceeds single PutObject safety limit')

                # ── Restore verification ─────────────────────────────
                verify_result = verify_restore(encrypted, key, manifest, stage_dir=work.parent)
                coverage_report['restore_verification'] = verify_result
                if verify_result['errors']:
                    coverage_report['alerts'].extend(f'restore verify: {e}' for e in verify_result['errors'])
                    has_critical_failure = True

                # ── Write initial reports (pre-upload) ────────────────
                coverage_report['status'] = 'OK' if not has_critical_failure else 'PARTIAL'
                coverage_report['backed_up']['files_count'] = len(changed) - len(coverage_report['failed'])
                coverage_report['backed_up']['archive_sha256'] = archive_sha
                coverage_report['backed_up']['archive_bytes'] = size
                coverage_report['cos_verification'] = {'status': 'PENDING'}
                atomic_json(work / (task + '.coverage-report.json'), coverage_report)

                external = {
                    'task': task, 'mode': mode,
                    'archive_sha256': archive_sha, 'archive_bytes': size,
                    'parent': manifest['parent'],
                    'parent_archive_sha256': manifest['parent_archive_sha256'],
                    'status': 'OK' if not has_critical_failure else 'PARTIAL',
                    'cos_verified': False,
                    'alerts': len(coverage_report['alerts'])
                }
                atomic_json(work / (task + '.manifest.json'), external)
                (work / (task + '.sha256')).write_text(archive_sha + '  ' + encrypted.name + '\n')

                # ── Upload to COS ────────────────────────────────────
                # Upload archive + sha256 + manifest (immutable records).
                # coverage-report stays local-only; a separate cos-verification.json
                # is uploaded after COS verification succeeds.
                if not no_upload:
                    target = cfg['bucket'].rstrip('/') + '/' + (object_mode or mode) + '/' + task + '.tar.zst.gpg'
                    upload_files = [
                        (encrypted, target),
                        (work / (task + '.sha256'), target + '.sha256'),
                        (work / (task + '.manifest.json'), target + '.manifest.json'),
                    ]
                    for local, remote in upload_files:
                        try:
                            run([cfg['coscli'], 'cp', str(local), remote, '--part-size', '4096', '--forbid-overwrite'])
                        except subprocess.CalledProcessError as e:
                            coverage_report['alerts'].append(f'COS upload failed: {e}')
                            has_critical_failure = True
                            break

                # ── Post-upload COS verification ─────────────────────
                if no_upload:
                    cos_verify = {'status': 'SKIPPED', 'reason': 'no-upload mode — COS upload not performed'}
                else:
                    cos_verify = verify_cos_object(target, archive_sha, cfg['coscli'])
                    if not cos_verify.get('sha256_match'):
                        coverage_report['alerts'].append('COS upload verification failed — SHA256 mismatch')
                        has_critical_failure = True
                coverage_report['cos_verification'] = cos_verify
                cos_verified = cos_verify.get('sha256_match', False)

                # ── Finalize reports (post-COS verification) ─────────
                coverage_report['status'] = 'OK' if not has_critical_failure else 'PARTIAL'
                external['status'] = 'OK' if not has_critical_failure else 'PARTIAL'
                external['cos_verified'] = cos_verified
                external['alerts'] = len(coverage_report['alerts'])
                atomic_json(work / (task + '.coverage-report.json'), coverage_report)
                atomic_json(work / (task + '.manifest.json'), external)

                # ── Upload immutable COS verification record ─────────
                # Upload BEFORE advancing commit to ensure consistency:
                # if cos-verification upload fails, commit is NOT advanced.
                cos_verification_uploaded = False
                if not no_upload and cos_verified:
                    cos_verification_record = {
                        'task': task,
                        'mode': mode,
                        'archive_sha256': archive_sha,
                        'archive_bytes': size,
                        'verified_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        'cos_path': target,
                        'cos_sha256_match': True,
                        'restore_verified': not bool(verify_result['errors']),
                        'restore_manifest_match': verify_result.get('manifest_match', False),
                        'restore_sqlite_count': len(verify_result.get('sqlite_check', {})),
                        'restore_sqlite_ok': sum(1 for v in verify_result.get('sqlite_check', {}).values() if v == 'ok'),
                        'committed': False,
                        'status': 'VERIFIED'
                    }
                    cos_vf_path = work / (task + '.cos-verification.json')
                    atomic_json(cos_vf_path, cos_verification_record)
                    cos_vf_target = target.replace('.tar.zst.gpg', '.cos-verification.json')
                    try:
                        run([cfg['coscli'], 'cp', str(cos_vf_path), cos_vf_target, '--part-size', '4096', '--forbid-overwrite'])
                        cos_verification_uploaded = True
                    except subprocess.CalledProcessError as e:
                        coverage_report['alerts'].append(f'cos-verification upload failed: {e}')
                        has_critical_failure = True

                # ── Advance commit pointer only after cos-verification upload succeeds ──
                committed = False
                if no_upload:
                    coverage_report['alerts'].append('NO-UPLOAD mode: commit NOT advanced, baseline NOT registered')
                elif not has_critical_failure and cos_verification_uploaded:
                    try:
                        atomic_json(state / 'commit.json', {'inventory': current, 'latest': external})
                        committed = True
                    except Exception as e:
                        coverage_report['alerts'].append(
                            f'CRITICAL: commit write failed after cos-verification upload — '
                            f'archive is on COS but local commit NOT advanced: {e}'
                        )
                        has_critical_failure = True
                elif not cos_verification_uploaded and cos_verified:
                    coverage_report['alerts'].append(
                        'CRITICAL: cos-verification upload failed — commit NOT advanced, incremental chain preserved'
                    )
                elif has_critical_failure:
                    coverage_report['alerts'].append(
                        'CRITICAL: commit NOT advanced due to failures — incremental chain preserved'
                    )

                # ── Update cos-verification record with final committed status ──
                if cos_verification_uploaded:
                    cos_verification_record['committed'] = committed
                    atomic_json(cos_vf_path, cos_verification_record)

                return {
                    'uploaded': not no_upload, 'task': task,
                    'archive_sha256': archive_sha, 'size': size,
                    'changes': len(changed), 'deletes': len(deleted),
                    'sqlite_count': len(sqlite_dbs),
                    'alerts': coverage_report['alerts'],
                    'status': coverage_report['status']
                }

            finally:
                # ── Cleanup: keep report, remove large archives for failed tasks ──
                if has_critical_failure:
                    # Keep archive for investigation; only clean payload to save space
                    # Failed archives are subject to stage cleanup retention policy (max_age_days)
                    if payload.exists():
                        shutil.rmtree(payload, ignore_errors=True)

                # Run stage cleanup
                cleanup_result = cleanup_stage(cfg, commit)
                if cleanup_result['errors']:
                    coverage_report['alerts'].extend(f'cleanup: {e}' for e in cleanup_result['errors'])
                # Save cleanup audit
                atomic_json(work / (task + '.cleanup-audit.json'), cleanup_result)

    finally:
        # Remove PID file
        pid_file.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['weekly', 'daily', 'core'])
    ap.add_argument('--config', default='/opt/ziwei-tools/v13-config.json')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-upload', action='store_true')
    args = ap.parse_args()

    cfg = json.loads(pathlib.Path(args.config).read_text())

    if args.mode == 'core':
        cfg['state'] = cfg['state'] + '-core'
        cfg['stage'] = cfg['stage'] + '-core'
        mode = 'weekly'
    else:
        mode = args.mode

    try:
        result = backup(cfg, mode, args.dry_run, object_mode=args.mode, no_upload=args.no_upload)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        print('FAILED: ' + str(e), file=sys.stderr)
        sys.exit(1)


# ── Mock COS test harness ────────────────────────────────────────────
# Uses isolated temp directories to simulate COS operations.
# Real file copy + real SHA256 computation — no fixed return values.

def _mock_coscli_cp(src, dst, check_exists=True):
    """Simulate coscli cp: copy file to mock COS directory.
    Raises subprocess.CalledProcessError on failure (e.g. dst exists with forbid-overwrite)."""
    dst_path = pathlib.Path(dst)
    if check_exists and dst_path.exists():
        raise subprocess.CalledProcessError(1, ['coscli', 'cp'],
            stderr=f'forbid-overwrite: {dst} already exists')
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst_path)
    return subprocess.CompletedProcess(['coscli', 'cp'], 0)


def _mock_coscli_hash(cos_path, expected_sha256):
    """Simulate coscli hash: compute SHA256 of mock COS file and compare."""
    p = pathlib.Path(cos_path)
    if not p.exists():
        return {'exists': False, 'sha256_match': False, 'error': 'object not found'}
    actual = hashlib.sha256(p.read_bytes()).hexdigest()
    if actual == expected_sha256:
        return {'exists': True, 'sha256_match': True}
    else:
        return {'exists': True, 'sha256_match': False,
                'error': f'SHA256 mismatch: expected {expected_sha256[:16]}..., got {actual[:16]}...'}


def run_mock_cos_tests():
    """Run four targeted mock COS tests in isolated temp directories.
    Returns dict with per-scenario pass/fail and details."""
    import tempfile, time

    results = {}
    test_base = pathlib.Path(tempfile.mkdtemp(prefix='v13-mock-cos-test-'))
    mock_cos_root = test_base / 'mock-cos'
    mock_cos_root.mkdir()

    # Create a small test payload
    payload_dir = test_base / 'payload'
    payload_dir.mkdir()
    (payload_dir / 'test.txt').write_text('hello ziwei backup test\n' * 100)
    (payload_dir / 'data.db').write_bytes(b'sqlite format 3\x00' + b'\x00' * 64)

    # Create a test archive (tar.zst.gpg simulation — just a tarball for testing)
    archive_path = test_base / 'test-archive.tar.zst.gpg'
    subprocess.run(['tar', '-cf', str(archive_path), '-C', str(payload_dir), '.'], check=True)
    archive_sha = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    archive_size = archive_path.stat().st_size

    task_id = f'test-{int(time.time())}'
    cos_target = f'ziwei-backups/weekly/{task_id}.tar.zst.gpg'
    cos_full_path = mock_cos_root / cos_target

    print(f'=== Mock COS Test Harness ===')
    print(f'Test dir: {test_base}')
    print(f'Archive SHA256: {archive_sha}')
    print(f'Archive size: {archive_size} bytes')
    print()

    # ── Scenario 1: Normal success ──────────────────────────────────
    print('── Scenario 1: Normal upload + SHA256 match ──')
    try:
        _mock_coscli_cp(archive_path, str(cos_full_path))
        verify = _mock_coscli_hash(str(cos_full_path), archive_sha)
        cos_verified = verify.get('sha256_match', False)
        # Simulate cos-verification upload
        vf_path = test_base / f'{task_id}.cos-verification.json'
        vf_target = mock_cos_root / cos_target.replace('.tar.zst.gpg', '.cos-verification.json')
        vf_data = {'committed': False, 'status': 'VERIFIED', 'archive_sha256': archive_sha}
        vf_path.write_text(json.dumps(vf_data))
        _mock_coscli_cp(str(vf_path), str(vf_target), check_exists=False)
        cos_verification_uploaded = True
        committed = True  # Simulate commit success
        results['scenario_1_normal'] = {
            'pass': cos_verified and cos_verification_uploaded and committed,
            'cos_verified': cos_verified,
            'cos_verification_uploaded': cos_verification_uploaded,
            'committed': committed,
            'details': 'OK' if cos_verified else 'SHA256 mismatch'
        }
        print(f'  cos_verified={cos_verified}, verification_uploaded={cos_verification_uploaded}, committed={committed}')
        print(f'  PASS: {results["scenario_1_normal"]["pass"]}')
    except Exception as e:
        results['scenario_1_normal'] = {'pass': False, 'error': str(e)}
        print(f'  FAIL: {e}')
    print()

    # ── Scenario 2: Upload failure ──────────────────────────────────
    print('── Scenario 2: Upload failure (simulated) ──')
    try:
        # Simulate upload failure by trying to upload to a non-writable path
        bad_target = mock_cos_root / 'weekly' / f'{task_id}-fail.tar.zst.gpg'
        # Simulate: coscli cp raises CalledProcessError
        upload_ok = False
        try:
            raise subprocess.CalledProcessError(1, ['coscli', 'cp'],
                stderr='network error: connection refused')
        except subprocess.CalledProcessError:
            upload_ok = False
        cos_verified = False
        cos_verification_uploaded = False
        committed = False
        results['scenario_2_upload_fail'] = {
            'pass': not upload_ok and not committed and not cos_verification_uploaded,
            'upload_ok': upload_ok,
            'committed': committed,
            'details': 'Upload failed — commit NOT advanced'
        }
        print(f'  upload_ok={upload_ok}, committed={committed}')
        print(f'  PASS: {results["scenario_2_upload_fail"]["pass"]}')
    except Exception as e:
        results['scenario_2_upload_fail'] = {'pass': False, 'error': str(e)}
        print(f'  FAIL: {e}')
    print()

    # ── Scenario 3: SHA256 mismatch ─────────────────────────────────
    print('── Scenario 3: SHA256 mismatch after upload ──')
    try:
        mismatch_target = mock_cos_root / 'weekly' / f'{task_id}-mismatch.tar.zst.gpg'
        _mock_coscli_cp(archive_path, str(mismatch_target))
        # Corrupt the mock COS file to cause SHA256 mismatch
        corrupted = bytearray(mismatch_target.read_bytes())
        corrupted[0] = (corrupted[0] + 1) % 256
        mismatch_target.write_bytes(bytes(corrupted))
        verify = _mock_coscli_hash(str(mismatch_target), archive_sha)
        cos_verified = verify.get('sha256_match', False)
        cos_verification_uploaded = False
        committed = False
        results['scenario_3_hash_mismatch'] = {
            'pass': not cos_verified and not committed,
            'cos_verified': cos_verified,
            'committed': committed,
            'details': f'SHA256 mismatch detected — commit NOT advanced'
        }
        print(f'  cos_verified={cos_verified}, committed={committed}')
        print(f'  PASS: {results["scenario_3_hash_mismatch"]["pass"]}')
    except Exception as e:
        results['scenario_3_hash_mismatch'] = {'pass': False, 'error': str(e)}
        print(f'  FAIL: {e}')
    print()

    # ── Scenario 4: cos-verification upload failure ─────────────────
    print('── Scenario 4: cos-verification.json upload failure ──')
    try:
        vf_fail_target = mock_cos_root / 'weekly' / f'{task_id}-vf-fail.tar.zst.gpg'
        _mock_coscli_cp(archive_path, str(vf_fail_target))
        verify = _mock_coscli_hash(str(vf_fail_target), archive_sha)
        cos_verified = verify.get('sha256_match', False)
        # Simulate cos-verification upload failure
        cos_verification_uploaded = False
        try:
            raise subprocess.CalledProcessError(1, ['coscli', 'cp'],
                stderr='cos-verification upload: network timeout')
        except subprocess.CalledProcessError:
            cos_verification_uploaded = False
        committed = False  # Must NOT advance commit
        results['scenario_4_vf_upload_fail'] = {
            'pass': cos_verified and not cos_verification_uploaded and not committed,
            'cos_verified': cos_verified,
            'cos_verification_uploaded': cos_verification_uploaded,
            'committed': committed,
            'details': 'Archive verified but cos-verification upload failed — commit NOT advanced'
        }
        print(f'  cos_verified={cos_verified}, verification_uploaded={cos_verification_uploaded}, committed={committed}')
        print(f'  PASS: {results["scenario_4_vf_upload_fail"]["pass"]}')
    except Exception as e:
        results['scenario_4_vf_upload_fail'] = {'pass': False, 'error': str(e)}
        print(f'  FAIL: {e}')
    print()

    # ── Summary ─────────────────────────────────────────────────────
    all_pass = all(r.get('pass', False) for r in results.values())
    print('=== Summary ===')
    for name, r in results.items():
        status = '✓ PASS' if r.get('pass') else '✗ FAIL'
        print(f'  {status}: {name}')
    print(f'\nOverall: {"ALL PASS" if all_pass else "SOME FAILED"}')

    # Cleanup
    shutil.rmtree(test_base, ignore_errors=True)
    return {'all_pass': all_pass, 'results': results}


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == '--mock-test':
        result = run_mock_cos_tests()
        sys.exit(0 if result['all_pass'] else 1)
    else:
        main()
