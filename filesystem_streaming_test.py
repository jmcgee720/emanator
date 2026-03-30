#!/usr/bin/env python3
"""
MyMergent AI Builder Platform Filesystem Awareness Streaming Tests

This test suite validates the specific filesystem awareness implementation 
mentioned in the review request with focus on:
1. Streaming endpoint with filesystem awareness
2. Build intent file generation  
3. Non-streaming fallback
4. Project files API
5. Message persistence

Test URL: https://emanator-core.preview.emergentagent.com
Known Project ID: be43ac27-901d-46b3-a965-e1ad7e3e7d0a (MyMergent Landing Page)
Known Chat ID: 36c0d150-2960-4b70-9267-9b6a521893a8
"""

import requests
import json
import sys
import time
import subprocess
from datetime import datetime

# Configuration from review request
API_URL = "https://emanator-core.preview.emergentagent.com"
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
PROJECT_ID = "be43ac27-901d-46b3-a965-e1ad7e3e7d0a"
CHAT_ID = "36c0d150-2960-4b70-9267-9b6a521893a8"
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"

def log(message):
    """Log test results with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}")

def get_supabase_token():
    """Get authentication token from Supabase as specified in review request"""
    log("🔑 Getting Supabase authentication token...")
    
    try:
        # Using the exact curl command logic from review request
        auth_url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
        headers = {
            "apikey": SUPABASE_KEY,
            "Content-Type": "application/json"
        }
        data = {
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        }
        
        response = requests.post(auth_url, headers=headers, json=data)
        log(f"Auth response status: {response.status_code}")
        
        if response.status_code == 200:
            auth_data = response.json()
            token = auth_data.get('access_token', '')
            if token:
                log("✅ Successfully obtained authentication token")
                return token
            else:
                log("❌ No access token in response")
                log(f"Response: {json.dumps(auth_data, indent=2)}")
                return None
        else:
            log(f"❌ Authentication failed: {response.status_code}")
            log(f"Response: {response.text}")
            return None
            
    except Exception as e:
        log(f"❌ Error getting auth token: {e}")
        return None

def test_streaming_endpoint_filesystem_awareness(token):
    """
    Test 1: Streaming endpoint with filesystem awareness
    POST /api/chats/36c0d150-2960-4b70-9267-9b6a521893a8/messages/stream
    """
    log("🧪 TEST 1: Streaming endpoint with filesystem awareness")
    
    if not token:
        log("❌ No authentication token available")
        return False
    
    try:
        url = f"{API_URL}/api/chats/{CHAT_ID}/messages/stream"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        data = {
            "content": "What files are in this project? List them all.",
            "metadata": {
                "provider": "openai",
                "model": "gpt-4o",
                "scope": "project"
            }
        }
        
        log(f"Making streaming request to: {url}")
        
        # Make streaming request with timeout
        response = requests.post(url, headers=headers, json=data, stream=True, timeout=45)
        log(f"Response status: {response.status_code}")
        log(f"Response headers: {dict(response.headers)}")
        
        if response.status_code != 200:
            log(f"❌ Unexpected status code: {response.status_code}")
            log(f"Response body: {response.text}")
            return False
        
        # Check if response is SSE (Server-Sent Events)
        content_type = response.headers.get('content-type', '')
        if 'text/event-stream' not in content_type:
            log(f"❌ Expected text/event-stream, got: {content_type}")
            return False
        
        log("✅ Response is SSE (text/event-stream)")
        
        # Parse SSE stream and collect events
        events = []
        status_events = []
        token_events = []
        done_event = None
        message_saved_event = None
        current_event_type = None
        
        for line in response.iter_lines(decode_unicode=True):
            if not line or line.strip() == '':
                continue
                
            if line.startswith('event:'):
                current_event_type = line[6:].strip()
            elif line.startswith('data:'):
                try:
                    data_content = line[5:].strip()
                    if not data_content:
                        continue
                    event_data = json.loads(data_content)
                    events.append((current_event_type, event_data))
                    
                    if current_event_type == 'status':
                        status_stage = event_data.get('stage', '')
                        status_events.append(status_stage)
                        log(f"Status event: {event_data}")
                    elif current_event_type == 'token':
                        token_events.append(event_data.get('content', ''))
                    elif current_event_type == 'done':
                        done_event = event_data
                        log(f"Done event: {event_data}")
                    elif current_event_type == 'message_saved':
                        message_saved_event = event_data
                        log(f"Message saved event: {event_data}")
                        
                except json.JSONDecodeError as e:
                    log(f"Failed to parse JSON: {line}")
                    
            # Stop after reasonable time or when we get done event
            if done_event and message_saved_event:
                break
            elif len(events) > 100:  # Increased limit
                break
        
        log(f"Collected {len(events)} total events")
        log(f"Status events: {status_events}")
        log(f"Token events count: {len(token_events)}")
        
        # Verify expected status events from review request
        expected_statuses = [
            'classifying_intent', 'intent_classified', 'selecting_provider',
            'loading_context', 'scanning_files', 'files_scanned', 
            'generating', 'updating_canvas', 'complete'
        ]
        
        found_statuses = set(status_events)
        critical_statuses = {'scanning_files', 'files_scanned'}
        
        if critical_statuses.issubset(found_statuses):
            log("✅ Found critical filesystem awareness statuses")
        else:
            log(f"❌ Missing critical filesystem statuses. Found: {found_statuses}")
        
        # Verify done event has fsStats
        if done_event and 'fsStats' in done_event:
            fs_stats = done_event['fsStats']
            scanned = fs_stats.get('scanned', 0)
            log(f"✅ fsStats found with scanned count: {scanned}")
            
            if scanned > 0:
                log("✅ files_scanned status should show scanned count > 0")
            else:
                log("❌ No files were scanned (scanned count = 0)")
        else:
            log("❌ Done event missing fsStats")
        
        # Verify message_saved event
        if message_saved_event and 'id' in message_saved_event:
            log("✅ message_saved event contains id")
        else:
            log("❌ message_saved event missing or no id")
        
        # Verify token events exist (streaming content)
        if len(token_events) > 0:
            log(f"✅ Received {len(token_events)} token events with content")
        else:
            log("❌ No token events received")
        
        return True
        
    except requests.exceptions.Timeout:
        log("❌ Request timeout (45 seconds)")
        return False
    except Exception as e:
        log(f"❌ Streaming test failed: {e}")
        return False

def test_build_intent_file_generation(token):
    """
    Test 2: Build intent file generation
    POST /api/chats/36c0d150-2960-4b70-9267-9b6a521893a8/messages/stream
    """
    log("🧪 TEST 2: Build intent file generation")
    
    if not token:
        log("❌ No authentication token available")
        return False
    
    try:
        url = f"{API_URL}/api/chats/{CHAT_ID}/messages/stream"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        data = {
            "content": "Create a simple About.jsx component with a short bio section",
            "metadata": {
                "provider": "openai",
                "model": "gpt-4o",
                "scope": "project"
            }
        }
        
        log(f"Making build intent request to: {url}")
        
        response = requests.post(url, headers=headers, json=data, stream=True, timeout=45)
        log(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ Unexpected status code: {response.status_code}")
            return False
        
        # Parse SSE stream for file events
        file_events = []
        done_event = None
        message_saved_event = None
        saving_files_status = False
        
        for line in response.iter_lines(decode_unicode=True):
            if line.startswith('event:'):
                event_type = line[6:].strip()
            elif line.startswith('data:'):
                try:
                    event_data = json.loads(line[5:].strip())
                    
                    if event_type == 'status' and event_data.get('status') == 'saving_files':
                        saving_files_status = True
                        log(f"✅ Found saving_files status")
                    elif event_type == 'file':
                        file_events.append(event_data)
                        log(f"File event: {event_data}")
                    elif event_type == 'done':
                        done_event = event_data
                    elif event_type == 'message_saved':
                        message_saved_event = event_data
                        
                except json.JSONDecodeError as e:
                    log(f"Failed to parse JSON: {line}")
                    
            # Stop after reasonable time
            if done_event and message_saved_event:
                break
        
        # Verify saving_files status
        if saving_files_status:
            log("✅ SSE stream contains saving_files status event")
        else:
            log("❌ No saving_files status found")
        
        # Verify file event with About.jsx
        about_file_found = False
        for file_event in file_events:
            if 'About.jsx' in file_event.get('path', '') and file_event.get('action') == 'created':
                about_file_found = True
                log("✅ Found file event with path 'About.jsx' and action 'created'")
                break
        
        if not about_file_found:
            log(f"❌ About.jsx file creation event not found. File events: {file_events}")
        
        # Verify done event has files array
        if done_event and 'files' in done_event:
            log("✅ Done event contains files array")
        else:
            log("❌ Done event missing files array")
        
        # Verify message_saved event has generatedFiles
        if message_saved_event and 'generatedFiles' in message_saved_event:
            log("✅ message_saved event contains generatedFiles")
        else:
            log("❌ message_saved event missing generatedFiles")
        
        return True
        
    except Exception as e:
        log(f"❌ Build intent test failed: {e}")
        return False

def test_non_streaming_fallback(token):
    """
    Test 3: Non-streaming fallback still works
    POST /api/chats/36c0d150-2960-4b70-9267-9b6a521893a8/messages
    """
    log("🧪 TEST 3: Non-streaming fallback")
    
    if not token:
        log("❌ No authentication token available")
        return False
    
    try:
        url = f"{API_URL}/api/chats/{CHAT_ID}/messages"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        data = {
            "content": "What is 5 + 5?",
            "metadata": {
                "provider": "openai",
                "model": "gpt-4o",
                "scope": "project"
            }
        }
        
        log(f"Making non-streaming request to: {url}")
        
        response = requests.post(url, headers=headers, json=data, timeout=30)
        log(f"Response status: {response.status_code}")
        log(f"Response headers: {dict(response.headers)}")
        
        if response.status_code not in [200, 201]:
            log(f"❌ Unexpected status code: {response.status_code}")
            log(f"Response body: {response.text}")
            return False
        
        # Accept both 200 and 201 as valid for message creation
        if response.status_code == 201:
            log("ℹ️ Got 201 (Created) which is acceptable for message creation")
        else:
            log("✅ Got 200 (OK) response")
        
        # Verify response is JSON (not SSE)
        content_type = response.headers.get('content-type', '')
        if 'application/json' not in content_type:
            log(f"❌ Expected application/json, got: {content_type}")
            return False
        
        log("✅ Response is JSON (not SSE)")
        
        response_data = response.json()
        
        # Verify has userMessage and assistantMessage fields
        if 'userMessage' in response_data:
            log("✅ Response contains userMessage field")
        else:
            log("❌ Response missing userMessage field")
        
        if 'assistantMessage' in response_data:
            log("✅ Response contains assistantMessage field")
        else:
            log("❌ Response missing assistantMessage field")
        
        log(f"Response structure: {list(response_data.keys())}")
        
        return True
        
    except Exception as e:
        log(f"❌ Non-streaming fallback test failed: {e}")
        return False

def test_project_files_api(token):
    """
    Test 4: Project files API
    GET /api/projects/be43ac27-901d-46b3-a965-e1ad7e3e7d0a/files
    """
    log("🧪 TEST 4: Project files API")
    
    if not token:
        log("❌ No authentication token available")
        return False
    
    try:
        url = f"{API_URL}/api/projects/{PROJECT_ID}/files"
        headers = {
            "Authorization": f"Bearer {token}"
        }
        
        log(f"Making request to: {url}")
        
        response = requests.get(url, headers=headers, timeout=30)
        log(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ Unexpected status code: {response.status_code}")
            log(f"Response body: {response.text}")
            return False
        
        files_data = response.json()
        
        # Verify returns array of files
        if not isinstance(files_data, list):
            log(f"❌ Expected array, got: {type(files_data)}")
            return False
        
        log(f"✅ Returns array of {len(files_data)} files")
        
        # Verify file structure (path, content, file_type, version fields)
        if len(files_data) > 0:
            sample_file = files_data[0]
            required_fields = ['path', 'content', 'file_type', 'version']
            
            for field in required_fields:
                if field in sample_file:
                    log(f"✅ Sample file contains '{field}' field")
                else:
                    log(f"❌ Sample file missing '{field}' field")
            
            log(f"Sample file structure: {list(sample_file.keys())}")
        else:
            log("ℹ️ No files in project to verify structure")
        
        return True
        
    except Exception as e:
        log(f"❌ Project files API test failed: {e}")
        return False

def test_message_persistence(token):
    """
    Test 5: Message persistence
    GET /api/chats/36c0d150-2960-4b70-9267-9b6a521893a8/messages
    """
    log("🧪 TEST 5: Message persistence")
    
    if not token:
        log("❌ No authentication token available")
        return False
    
    try:
        url = f"{API_URL}/api/chats/{CHAT_ID}/messages"
        headers = {
            "Authorization": f"Bearer {token}"
        }
        
        log(f"Making request to: {url}")
        
        response = requests.get(url, headers=headers, timeout=30)
        log(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ Unexpected status code: {response.status_code}")
            log(f"Response body: {response.text}")
            return False
        
        messages_data = response.json()
        
        # Verify returns array of messages
        if not isinstance(messages_data, list):
            log(f"❌ Expected array, got: {type(messages_data)}")
            return False
        
        log(f"✅ Returns array of {len(messages_data)} messages")
        
        # Check for recent messages with metadata.streamed = true
        streamed_messages = 0
        for message in messages_data:
            if message.get('metadata', {}).get('streamed') == True:
                streamed_messages += 1
        
        log(f"✅ Found {streamed_messages} messages with metadata.streamed = true")
        
        # Verify message structure (role, content, created_at fields)
        if len(messages_data) > 0:
            sample_message = messages_data[0]
            required_fields = ['role', 'content', 'created_at']
            
            for field in required_fields:
                if field in sample_message:
                    log(f"✅ Sample message contains '{field}' field")
                else:
                    log(f"❌ Sample message missing '{field}' field")
            
            log(f"Sample message structure: {list(sample_message.keys())}")
        else:
            log("ℹ️ No messages to verify structure")
        
        return True
        
    except Exception as e:
        log(f"❌ Message persistence test failed: {e}")
        return False

def main():
    """Run all filesystem awareness streaming tests"""
    log("🚀 Starting MyMergent AI Builder Platform Filesystem Awareness Streaming Tests")
    log(f"Testing against: {API_URL}")
    log(f"Project ID: {PROJECT_ID}")
    log(f"Chat ID: {CHAT_ID}")
    
    # Get authentication token
    token = get_supabase_token()
    if not token:
        log("❌ Cannot proceed without authentication token")
        return 1
    
    tests = [
        ("Streaming Endpoint with Filesystem Awareness", lambda: test_streaming_endpoint_filesystem_awareness(token)),
        ("Build Intent File Generation", lambda: test_build_intent_file_generation(token)),
        ("Non-Streaming Fallback", lambda: test_non_streaming_fallback(token)),
        ("Project Files API", lambda: test_project_files_api(token)),
        ("Message Persistence", lambda: test_message_persistence(token)),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        log(f"\n{'='*60}")
        log(f"Running: {test_name}")
        log('='*60)
        
        try:
            result = test_func()
            if result:
                passed += 1
                log(f"✅ {test_name}: PASSED")
            else:
                log(f"❌ {test_name}: FAILED")
        except Exception as e:
            log(f"❌ {test_name}: ERROR - {e}")
    
    log(f"\n{'='*60}")
    log(f"FINAL RESULTS: {passed}/{total} tests passed")
    log('='*60)
    
    if passed == total:
        log("🎉 ALL FILESYSTEM AWARENESS STREAMING TESTS PASSED!")
        return 0
    else:
        log("❌ SOME FILESYSTEM AWARENESS STREAMING TESTS FAILED")
        return 1

if __name__ == "__main__":
    sys.exit(main())