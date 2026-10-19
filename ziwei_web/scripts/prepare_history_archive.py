#!/usr/bin/env python3
"""Read a verified private Hermes backup without extracting into or writing to its source.
Output is PRIVATE: never commit the normalized archive or source messages.
No Gateway, model call, session import or memory API is invoked.
"""
import argparse, datetime, hashlib, json, os, pathlib, sqlite3, tempfile, zipfile

def prepare(source, destination):
    source = pathlib.Path(source)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    records, counts = [], {}
    with zipfile.ZipFile(source) as archive, tempfile.TemporaryDirectory(prefix="ziwei-history-") as tmp:
        names = archive.namelist()
        if names.count("state.db") != 1:
            raise ValueError("Expected one state.db; unknown formats are not inferred")
        info = archive.getinfo("state.db")
        if info.file_size > 128 * 1024 * 1024:
            raise ValueError("Database exceeds import bound")
        if any(n in names for n in ("state.db-wal", "state.db-journal")):
            raise ValueError("WAL-bearing backup needs a validated native recovery first")
        dbpath = pathlib.Path(tmp) / "state.db"
        dbpath.write_bytes(archive.read(info))  # ZIP reader verifies this entry's CRC.
        os.chmod(dbpath, 0o600)
        db = sqlite3.connect(f"file:{dbpath}?mode=ro", uri=True)
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Source integrity failed")
        counts["native_total"] = db.execute("SELECT count(*) FROM messages").fetchone()[0]
        counts["native_sessions"] = db.execute("SELECT count(*) FROM sessions").fetchone()[0]
        conversation_count, archival_count = 0, 0
        for mid, sid, role, content, timestamp, tool_name, tool_calls in db.execute(
            "SELECT id,session_id,role,content,timestamp,tool_name,tool_calls FROM messages ORDER BY timestamp,id"
        ):
            if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
                archival_count += 1
                content = json.dumps({"original_role": role, "content": content,
                                      "tool_name": tool_name, "tool_calls": tool_calls}, ensure_ascii=False)
                role = "archive"
            else:
                conversation_count += 1
            at = datetime.datetime.fromtimestamp(float(timestamp), datetime.timezone.utc).isoformat()
            records.append({"ref": f"state.db/session:{sid}/message:{mid}", "role": role, "content": content, "at": at})
        counts["native_conversation_records"] = conversation_count
        counts["native_other_records_as_archive"] = archival_count
        counts["native_indexed"] = len(records)
        db.close()
        # These are narrative archives, not verified verbatim chat turns or memory entries.
        for name in ("history_archive/v41-package-20261009/history/shared_history.txt", "workspace/history/shared_history.md"):
            if name not in names:
                continue
            entry = archive.getinfo(name)
            if entry.file_size > 8 * 1024 * 1024:
                raise ValueError("Narrative archive exceeds bound")
            text = archive.read(entry).decode("utf-8")
            at = datetime.datetime(*entry.date_time, tzinfo=datetime.timezone.utc).isoformat()
            records.append({"ref": name, "role": "archive", "content": text, "at": at})
        counts["narrative_documents"] = len(records) - counts["native_indexed"]
        # Preserve the old session JSON as a searchable document, never assign uncertain speakers.
        name = "sessions/sessions.json"
        if name in names:
            entry = archive.getinfo(name)
            if entry.file_size > 8 * 1024 * 1024:
                raise ValueError("Legacy sessions exceed bound")
            data = archive.read(entry).decode("utf-8")
            json.loads(data)
            records.append({"ref": name, "role": "archive", "content": data,
                            "at": datetime.datetime(*entry.date_time, tzinfo=datetime.timezone.utc).isoformat()})
            counts["legacy_session_documents"] = 1
    result = {"schema": 1, "sha256": digest, "label": source.name, "records": records,
              "counts": counts, "authority": "query_archive_only_not_long_term_memory"}
    destination = pathlib.Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(result, stream, ensure_ascii=False)
    return {"source": source.name, "sha256": digest, "counts": counts, "records": len(records)}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.destination), ensure_ascii=False))
