# Shared personality and memory, step 1

The chat Gateway and background worker call the same readMemories(DATA_DIR) function on every model request. No changes to Kelivo MCP configuration, model selection, thinking parameters, or tools are made.

Each group reads the first existing file:
- system_prompt.txt / identity/system_prompt.txt
- care_rules.txt / identity/care_rules.txt
- autonomy.txt / identity/autonomy.txt
- memory.md / core_memory.md / memory/core_memory.md
- long_term_goals.md / goals/long_term_goals.md
- shared_history.txt / history/shared_history.txt

Flat persistent files are authoritative. Missing groups are omitted; no files are automatically invented or overwritten. Each file has a 24,000-character context bound. Credentials are excluded. Original client instructions retain their order. Persistent reference files do not grant new tool authority. The worker remains limited to its currently implemented text activities.

The current persistent volume has autonomy.txt, memory.md and long_term_goals.md. The saved Ziwei-home archive contains a v2.0 system prompt and older shared history; the client reports newer content. Import the current system_prompt.txt, care_rules.txt and shared_history.txt through a secure admin workflow before claiming the full personality/history migration is complete. Do not put personal memory contents into this Git repository.

This step unifies persisted reference context. It does not synchronize client SQLite memory writes, migrate full chat history, close background tasks from chat, or enable background MCP tools. Those are separate steps.

Validation: npm test, 28 tests passing. Real mock-upstream integration checks shared persona/core memory in worker and chat, tool definitions and tool-choice forwarding, preservation of client model/thinking options, complete tool-call history and tool-call responses. These checks do not prove third-party MCP service availability.
