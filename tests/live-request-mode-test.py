#!/usr/bin/env python3
"""
Live verification of Request-Mode Gate through the real MyMergent SSE endpoint.
Tests: read_only_report, apply_pending_diff, discard_pending_diff
"""
import requests
import json
import time

SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
ANON_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
API_URL = "https://luminous-workspace.preview.emergentagent.com"

def get_token():
    r = requests.post(f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
        json={"email": "REDACTED_LEAKED_USER", "password": "REDACTED_LEAKED_PASSWORD"})
    return r.json()["access_token"]

def hdrs(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

def create_project(token, name):
    r = requests.post(f"{API_URL}/api/projects", headers=hdrs(token),
        json={"name": name, "description": "test", "type": "app"})
    d = r.json()
    return d["project"]["id"], d["initialChat"]["id"]

def create_chat(token, project_id):
    r = requests.post(f"{API_URL}/api/projects/{project_id}/chats", headers=hdrs(token),
        json={"title": "test"})
    return r.json()["id"]

def create_file(token, project_id, path, content):
    requests.post(f"{API_URL}/api/projects/{project_id}/files", headers=hdrs(token),
        json={"path": path, "content": content, "file_type": "jsx"})

def insert_pending_diff_message(token, chat_id, file_path, old_content, new_content):
    """Insert an assistant message with diffStatus=pending to simulate a pending diff."""
    r = requests.post(f"{API_URL}/api/chats/{chat_id}/messages", headers=hdrs(token),
        json={
            "content": "## Diff Preview\n\n1 file ready for review.",
            "role": "assistant",
            "metadata": {
                "diffStatus": "pending",
                "diffFiles": [{
                    "path": file_path,
                    "action": "update",
                    "newContent": new_content,
                    "oldContent": old_content,
                    "description": "Test diff",
                    "fileType": "jsx"
                }],
                "planData": None,
                "toolMode": "diff_generated"
            }
        })
    return r.json()

def get_messages(token, chat_id):
    r = requests.get(f"{API_URL}/api/chats/{chat_id}/messages", headers=hdrs(token))
    return r.json()

def parse_sse(token, chat_id, message, timeout=90):
    """Parse SSE stream and return events + content."""
    events = []
    content = ""
    try:
        r = requests.post(f"{API_URL}/api/chats/{chat_id}/messages/stream",
            headers={**hdrs(token), "Accept": "text/event-stream"},
            json={"content": message},
            stream=True, timeout=timeout)
        
        current_event = None
        for line in r.iter_lines(decode_unicode=True):
            if line is None or line == "":
                current_event = None
                continue
            if line.startswith("event: "):
                current_event = line[7:]
            elif line.startswith("data: "):
                try:
                    data = json.loads(line[6:])
                    events.append({"event": current_event or "message", "data": data})
                    if current_event == "token":
                        content += data.get("content", "")
                except json.JSONDecodeError:
                    pass
    except Exception as e:
        print(f"  SSE Error: {e}")
    return events, content

# ====================================
print("=" * 60)
print("LIVE VERIFICATION: Request-Mode Gate")
print("=" * 60)

token = get_token()
print("✓ Authenticated")

project_id, initial_chat = create_project(token, f"rmgate-{int(time.time())}")
print(f"✓ Project: {project_id}")

FILE_PATH = "components/dashboard/BuilderMemoryPanel.jsx"
OLD_CONTENT = """import React from 'react';

export default function BuilderMemoryPanel({ projectId }) {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">Builder Memory</h2>
      <p>Memory panel for project {projectId}</p>
    </div>
  );
}"""

NEW_CONTENT = OLD_CONTENT.replace(
    '<p>Memory panel for project {projectId}</p>',
    '<p>Memory panel for project {projectId}</p>\n      <p className="text-xs text-gray-500">Last updated: {new Date().toLocaleString()}</p>'
)

create_file(token, project_id, FILE_PATH, OLD_CONTENT)
print(f"✓ File created: {FILE_PATH}")

results = {}

# ═══════════════════════════════════════════
# CHECK 1: read_only_report
# ═══════════════════════════════════════════
print("\n" + "─" * 60)
print("CHECK 1: read_only_report")
print("─" * 60)

read_only_msg = """READ-ONLY CODE LOCATION REPORT

Do not propose a plan.
Do not generate file_actions.
Do not suggest updates.

Find the exact write point in /app/lib/ai/service.js where diff preview metadata is attached to the saved message or SSE payload.

Return only:
file:
function:
diff metadata anchor:"""

events, content = parse_sse(token, initial_chat, read_only_msg)

event_types = [e["event"] for e in events]
has_plan = "plan" in event_types
has_diff = "diff_file" in event_types

# Check status for request mode classification
status_stages = [e["data"].get("stage") for e in events if e["event"] == "status"]

print(f"  Events: {len(events)}")
print(f"  Event types: {set(event_types)}")
print(f"  Status stages: {status_stages}")
print(f"  Content length: {len(content)}")
print(f"  Has plan event: {has_plan}")
print(f"  Has diff_file event: {has_diff}")
print(f"  Content preview: {content[:200]}")

check1 = not has_plan and not has_diff and len(content) > 10
results["read_only_report"] = check1
print(f"\n  → read_only_report passed: {check1}")

# ═══════════════════════════════════════════
# CHECK 2: apply_pending_diff
# ═══════════════════════════════════════════
print("\n" + "─" * 60)
print("CHECK 2: apply_pending_diff")
print("─" * 60)

chat_2 = create_chat(token, project_id)
print(f"  Chat: {chat_2}")

# Insert a synthetic pending diff message
diff_msg = insert_pending_diff_message(token, chat_2, FILE_PATH, OLD_CONTENT, NEW_CONTENT)
diff_msg_id = diff_msg.get("id")
print(f"  Inserted pending diff message: {diff_msg_id}")

# Verify pending diff exists
time.sleep(1)
msgs_before = get_messages(token, chat_2)
pending_before = [m for m in msgs_before if (m.get("metadata") or {}).get("diffStatus") == "pending"]
print(f"  Pending diffs before apply: {len(pending_before)}")

# Send apply command
print("  Sending 'Apply the pending diff now.'...")
events_2, content_2 = parse_sse(token, chat_2, "Apply the pending diff now.", timeout=30)

event_types_2 = [e["event"] for e in events_2]
has_plan_2 = "plan" in event_types_2
has_diff_2 = "diff_file" in event_types_2
status_stages_2 = [e["data"].get("stage") for e in events_2 if e["event"] == "status"]

print(f"  Event types: {set(event_types_2)}")
print(f"  Status stages: {status_stages_2}")
print(f"  Content: {content_2[:300]}")

# Verify message status changed
time.sleep(1)
msgs_after = get_messages(token, chat_2)
updated_msg = next((m for m in msgs_after if m.get("id") == diff_msg_id), None)
new_status = (updated_msg.get("metadata") or {}).get("diffStatus") if updated_msg else "NOT_FOUND"
print(f"  Diff message status after apply: {new_status}")

check2 = (
    not has_plan_2
    and not has_diff_2
    and ("applied" in content_2.lower() or "applying" in status_stages_2 or "applying_pending_diff" in status_stages_2)
    and new_status == "applied"
)
results["apply_pending_diff"] = check2
print(f"\n  → apply_pending_diff passed: {check2}")

# ═══════════════════════════════════════════
# CHECK 3: discard_pending_diff
# ═══════════════════════════════════════════
print("\n" + "─" * 60)
print("CHECK 3: discard_pending_diff")
print("─" * 60)

chat_3 = create_chat(token, project_id)
print(f"  Chat: {chat_3}")

# Insert a synthetic pending diff message
diff_msg_3 = insert_pending_diff_message(token, chat_3, FILE_PATH, OLD_CONTENT, NEW_CONTENT)
diff_msg_id_3 = diff_msg_3.get("id")
print(f"  Inserted pending diff message: {diff_msg_id_3}")

time.sleep(1)

# Send discard command
print("  Sending 'Discard the pending diff now.'...")
events_3, content_3 = parse_sse(token, chat_3, "Discard the pending diff now.", timeout=30)

event_types_3 = [e["event"] for e in events_3]
has_plan_3 = "plan" in event_types_3
has_diff_3 = "diff_file" in event_types_3
status_stages_3 = [e["data"].get("stage") for e in events_3 if e["event"] == "status"]

print(f"  Event types: {set(event_types_3)}")
print(f"  Status stages: {status_stages_3}")
print(f"  Content: {content_3[:300]}")

# Verify message status changed
time.sleep(1)
msgs_after_3 = get_messages(token, chat_3)
updated_msg_3 = next((m for m in msgs_after_3 if m.get("id") == diff_msg_id_3), None)
new_status_3 = (updated_msg_3.get("metadata") or {}).get("diffStatus") if updated_msg_3 else "NOT_FOUND"
print(f"  Diff message status after discard: {new_status_3}")

check3 = (
    not has_plan_3
    and not has_diff_3
    and ("discard" in content_3.lower())
    and new_status_3 == "discarded"
)
results["discard_pending_diff"] = check3
print(f"\n  → discard_pending_diff passed: {check3}")

# ═══════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════
print("\n" + "=" * 60)
print("RESULTS")
print("=" * 60)
for mode, passed in results.items():
    print(f"  {mode}: {'✓ PASSED' if passed else '✗ FAILED'}")

failures = [m for m, p in results.items() if not p]
if failures:
    print(f"\nFailure modes: {', '.join(failures)}")
else:
    print("\nALL PASSED")
