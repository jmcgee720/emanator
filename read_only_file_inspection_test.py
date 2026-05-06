#!/usr/bin/env python3
"""
READ-ONLY FILE INSPECTION Feature Testing Suite

This test suite validates the READ-ONLY FILE INSPECTION feature of the MyMergent AI builder platform.
Tests the specific scenarios mentioned in the review request.

Test Configuration:
- App URL: https://webcontainer-preview.preview.emergentagent.com
- Test Project ID: 2fa5e2c3-4e74-4dfe-872c-d9601fd0fcfd (has 2 files: _meta/prompt_runs.json and components/dashboard/BuilderMemoryPanel.jsx)
- Test Chat ID: 015c4e6d-06f0-4f13-b8f4-8c0f874c3923
- Auth: Supabase Bearer Token
"""

import requests
import json
import sys
import time
from datetime import datetime

# Configuration from review request
BASE_URL = "https://webcontainer-preview.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_ANON = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"

# Test data from review request
PROJECT_ID = "2fa5e2c3-4e74-4dfe-872c-d9601fd0fcfd"
CHAT_ID = "015c4e6d-06f0-4f13-b8f4-8c0f874c3923"

def log(message):
    """Log test results with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}")

def get_auth_token():
    """Get Supabase auth token using the provided credentials"""
    log("🔐 Getting Supabase auth token...")
    
    try:
        auth_data = {
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        }
        
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={
                "apikey": SUPABASE_ANON,
                "Content-Type": "application/json"
            },
            json=auth_data
        )
        
        if response.status_code == 200:
            token_data = response.json()
            access_token = token_data.get('access_token')
            if access_token:
                log(f"✅ Successfully obtained auth token")
                return access_token
            else:
                log(f"❌ No access token in response: {token_data}")
                return None
        else:
            log(f"❌ Auth failed: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        log(f"❌ Auth token retrieval failed: {e}")
        return None

def parse_sse_events(response_text):
    """Parse Server-Sent Events from response text"""
    events = []
    lines = response_text.strip().split('\n')
    current_event = {}
    
    for line in lines:
        line = line.strip()
        if not line:
            if current_event:
                events.append(current_event)
                current_event = {}
        elif line.startswith('event:'):
            current_event['event'] = line[6:].strip()
        elif line.startswith('data:'):
            data_str = line[5:].strip()
            try:
                current_event['data'] = json.loads(data_str)
            except:
                current_event['data'] = data_str
    
    # Add final event if exists
    if current_event:
        events.append(current_event)
    
    return events

def test_health_check():
    """Test the health check endpoint"""
    log("🧪 TESTING: Health Check API")
    
    try:
        response = requests.get(f"{API_BASE}/health")
        
        if response.status_code == 200:
            health_data = response.json()
            if health_data.get('status') == 'healthy':
                log(f"✅ Health check passed: {health_data}")
                return True
            else:
                log(f"❌ Health check returned unhealthy: {health_data}")
                return False
        else:
            log(f"❌ Health check failed: {response.status_code}")
            return False
            
    except Exception as e:
        log(f"❌ Health check error: {e}")
        return False

def test_explicit_readonly_existing_file(token):
    """
    Test Case 1: Explicit READ-ONLY with existing file
    Send "READ-ONLY FILE INSPECTION. Open and inspect BuilderMemoryPanel.jsx"
    Expect: SSE events, toolMode: "chat_only", actual code content, no diffFiles/planId
    """
    log("🧪 TEST 1: Explicit READ-ONLY with existing file")
    
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "content": "READ-ONLY FILE INSPECTION. Open and inspect BuilderMemoryPanel.jsx",
            "scope": "project"
        }
        
        response = requests.post(
            f"{API_BASE}/chats/{CHAT_ID}/messages/stream",
            headers=headers,
            json=payload,
            stream=True
        )
        
        if response.status_code != 200:
            log(f"❌ Request failed: {response.status_code} - {response.text}")
            return False
        
        # Check content type
        content_type = response.headers.get('content-type', '')
        if 'text/event-stream' not in content_type:
            log(f"❌ Expected SSE stream, got: {content_type}")
            return False
        
        log("✅ SSE stream established")
        
        # Collect response
        response_text = ""
        for chunk in response.iter_content(decode_unicode=True):
            if chunk:
                response_text += chunk
        
        # Parse SSE events
        events = parse_sse_events(response_text)
        log(f"📊 Received {len(events)} SSE events")
        
        # Check for required event types
        event_types = [e.get('event') for e in events]
        required_events = ['status', 'token', 'done']
        
        for required in required_events:
            if required not in event_types:
                log(f"❌ Missing required event: {required}")
                return False
        
        log("✅ All required event types present")
        
        # Find done event and check toolMode
        done_events = [e for e in events if e.get('event') == 'done']
        if not done_events:
            log("❌ No done event found")
            return False
        
        done_event = done_events[0]
        done_data = done_event.get('data', {})
        tool_mode = done_data.get('toolMode')
        
        if tool_mode != 'chat_only':
            log(f"❌ Expected toolMode 'chat_only', got: {tool_mode}")
            return False
        
        log("✅ toolMode is 'chat_only'")
        
        # Check that no diffFiles or planId in done event (they should be None/null if present)
        diff_files = done_data.get('diffFiles')
        plan_id = done_data.get('planId')
        
        if diff_files is not None or plan_id is not None:
            log(f"❌ Found non-null diffFiles or planId in done event: diffFiles={diff_files}, planId={plan_id}")
            return False
        
        log("✅ No diffFiles or planId (correct for read-only)")
        
        # Check token content for actual code
        token_events = [e for e in events if e.get('event') == 'token']
        full_content = ''.join([e.get('data', {}).get('content', '') for e in token_events])
        
        # Look for code indicators
        code_indicators = ['useState', 'useEffect', 'setMemoryEntries', 'fetch("/api/projects/"']
        found_indicators = []
        
        for indicator in code_indicators:
            if indicator in full_content:
                found_indicators.append(indicator)
        
        if found_indicators:
            log(f"✅ Found code content indicators: {found_indicators}")
        else:
            log(f"❌ No code content found in response: {full_content[:200]}...")
            return False
        
        # Check for negative indicators (error messages)
        negative_phrases = ["I'm unable to", "I cannot inspect", "I can't access"]
        for phrase in negative_phrases:
            if phrase in full_content:
                log(f"❌ Found negative phrase: {phrase}")
                return False
        
        log("✅ No negative error messages")
        log("🎉 TEST 1 PASSED: Explicit READ-ONLY with existing file")
        return True
        
    except Exception as e:
        log(f"❌ TEST 1 failed: {e}")
        return False

def test_explicit_readonly_nonexistent_file(token):
    """
    Test Case 2: Explicit READ-ONLY with non-existing file
    Send "READ-ONLY FILE INSPECTION. Open and inspect NonExistentComponent.jsx"
    Expect: toolMode: "chat_only", file not found message, suggest available files
    """
    log("🧪 TEST 2: Explicit READ-ONLY with non-existing file")
    
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "content": "READ-ONLY FILE INSPECTION. Open and inspect NonExistentComponent.jsx",
            "scope": "project"
        }
        
        response = requests.post(
            f"{API_BASE}/chats/{CHAT_ID}/messages/stream",
            headers=headers,
            json=payload,
            stream=True
        )
        
        if response.status_code != 200:
            log(f"❌ Request failed: {response.status_code} - {response.text}")
            return False
        
        # Collect response
        response_text = ""
        for chunk in response.iter_content(decode_unicode=True):
            if chunk:
                response_text += chunk
        
        # Parse SSE events
        events = parse_sse_events(response_text)
        
        # Check done event for toolMode
        done_events = [e for e in events if e.get('event') == 'done']
        if not done_events:
            log("❌ No done event found")
            return False
        
        done_event = done_events[0]
        done_data = done_event.get('data', {})
        tool_mode = done_data.get('toolMode')
        
        if tool_mode != 'chat_only':
            log(f"❌ Expected toolMode 'chat_only', got: {tool_mode}")
            return False
        
        log("✅ toolMode is 'chat_only'")
        
        # Check that no diffFiles or planId in done event (they should be None/null if present)
        diff_files = done_data.get('diffFiles')
        plan_id = done_data.get('planId')
        
        if diff_files is not None or plan_id is not None:
            log(f"❌ Found non-null diffFiles or planId in done event: diffFiles={diff_files}, planId={plan_id}")
            return False
        
        log("✅ No diffFiles or planId")
        
        # Check content mentions file not found
        token_events = [e for e in events if e.get('event') == 'token']
        full_content = ''.join([e.get('data', {}).get('content', '') for e in token_events])
        
        not_found_indicators = ['not found', 'does not exist', 'available files', 'BuilderMemoryPanel.jsx']
        found_indicators = []
        
        for indicator in not_found_indicators:
            if indicator.lower() in full_content.lower():
                found_indicators.append(indicator)
        
        if found_indicators:
            log(f"✅ Found appropriate not-found response: {found_indicators}")
        else:
            log(f"❌ No file-not-found indicators: {full_content[:200]}...")
            return False
        
        log("🎉 TEST 2 PASSED: Explicit READ-ONLY with non-existing file")
        return True
        
    except Exception as e:
        log(f"❌ TEST 2 failed: {e}")
        return False

def test_implicit_readonly_show_pattern(token):
    """
    Test Case 3: Implicit read-only (show/inspect pattern)
    Send "Show me what is in BuilderMemoryPanel.jsx"
    Expect: toolMode: "chat_only", actual file code, no diffFiles/planId
    """
    log("🧪 TEST 3: Implicit read-only (show/inspect pattern)")
    
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "content": "Show me what is in BuilderMemoryPanel.jsx",
            "scope": "project"
        }
        
        response = requests.post(
            f"{API_BASE}/chats/{CHAT_ID}/messages/stream",
            headers=headers,
            json=payload,
            stream=True
        )
        
        if response.status_code != 200:
            log(f"❌ Request failed: {response.status_code} - {response.text}")
            return False
        
        # Collect response
        response_text = ""
        for chunk in response.iter_content(decode_unicode=True):
            if chunk:
                response_text += chunk
        
        # Parse SSE events
        events = parse_sse_events(response_text)
        
        # Check done event for toolMode
        done_events = [e for e in events if e.get('event') == 'done']
        if not done_events:
            log("❌ No done event found")
            return False
        
        done_event = done_events[0]
        done_data = done_event.get('data', {})
        tool_mode = done_data.get('toolMode')
        
        if tool_mode != 'chat_only':
            log(f"❌ Expected toolMode 'chat_only', got: {tool_mode}")
            return False
        
        log("✅ toolMode is 'chat_only'")
        
        # Check that no diffFiles or planId in done event (they should be None/null if present)
        diff_files = done_data.get('diffFiles')
        plan_id = done_data.get('planId')
        
        if diff_files is not None or plan_id is not None:
            log(f"❌ Found non-null diffFiles or planId in done event: diffFiles={diff_files}, planId={plan_id}")
            return False
        
        log("✅ No diffFiles or planId")
        
        # Check content includes actual file code
        token_events = [e for e in events if e.get('event') == 'token']
        full_content = ''.join([e.get('data', {}).get('content', '') for e in token_events])
        
        code_indicators = ['useState', 'useEffect', 'setMemoryEntries', 'fetch("/api/projects/"']
        found_indicators = []
        
        for indicator in code_indicators:
            if indicator in full_content:
                found_indicators.append(indicator)
        
        if found_indicators:
            log(f"✅ Found code content: {found_indicators}")
        else:
            log(f"❌ No code content found")
            return False
        
        log("🎉 TEST 3 PASSED: Implicit read-only (show pattern)")
        return True
        
    except Exception as e:
        log(f"❌ TEST 3 failed: {e}")
        return False

def test_non_readonly_should_not_trigger(token):
    """
    Test Case 4: Non-read-only should NOT trigger read-only mode
    Send "Fix a bug in BuilderMemoryPanel.jsx"
    Expect: This should NOT be treated as read_only_report (may generate plans or diff files)
    """
    log("🧪 TEST 4: Non-read-only should NOT trigger read-only mode")
    
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "content": "Fix a bug in BuilderMemoryPanel.jsx",
            "scope": "project"
        }
        
        response = requests.post(
            f"{API_BASE}/chats/{CHAT_ID}/messages/stream",
            headers=headers,
            json=payload,
            stream=True
        )
        
        if response.status_code != 200:
            log(f"❌ Request failed: {response.status_code} - {response.text}")
            return False
        
        # Collect response
        response_text = ""
        for chunk in response.iter_content(decode_unicode=True):
            if chunk:
                response_text += chunk
        
        # Parse SSE events
        events = parse_sse_events(response_text)
        
        # Check done event for toolMode
        done_events = [e for e in events if e.get('event') == 'done']
        if not done_events:
            log("❌ No done event found")
            return False
        
        done_event = done_events[0]
        done_data = done_event.get('data', {})
        tool_mode = done_data.get('toolMode')
        
        if tool_mode == 'chat_only':
            log(f"❌ This should NOT be chat_only mode for fix request")
            return False
        
        log(f"✅ toolMode is '{tool_mode}' (not chat_only, as expected)")
        
        # It's OK if this generates plans or diff files - that's the expected behavior
        if 'diffFiles' in done_data or 'planId' in done_data:
            log("✅ May generate plans/diffs (expected for code-change request)")
        
        log("🎉 TEST 4 PASSED: Non-read-only correctly avoided read-only mode")
        return True
        
    except Exception as e:
        log(f"❌ TEST 4 failed: {e}")
        return False

def test_health_endpoint():
    """Test Case 5: Health check - GET /api/health should return {"status":"healthy",...}"""
    log("🧪 TEST 5: Health endpoint check")
    
    try:
        response = requests.get(f"{API_BASE}/health")
        
        if response.status_code != 200:
            log(f"❌ Health endpoint failed: {response.status_code}")
            return False
        
        health_data = response.json()
        
        if health_data.get('status') != 'healthy':
            log(f"❌ Health status not healthy: {health_data}")
            return False
        
        log(f"✅ Health endpoint working: {health_data}")
        log("🎉 TEST 5 PASSED: Health endpoint")
        return True
        
    except Exception as e:
        log(f"❌ TEST 5 failed: {e}")
        return False

def main():
    """Run all READ-ONLY FILE INSPECTION tests"""
    log("🚀 Starting READ-ONLY FILE INSPECTION Testing Suite")
    log(f"Testing against: {BASE_URL}")
    log(f"Project ID: {PROJECT_ID}")
    log(f"Chat ID: {CHAT_ID}")
    
    # Get auth token
    token = get_auth_token()
    if not token:
        log("❌ Failed to get auth token, cannot continue")
        return 1
    
    # Test sequence
    tests = [
        ("Health Check", lambda: test_health_endpoint()),
        ("Explicit READ-ONLY with existing file", lambda: test_explicit_readonly_existing_file(token)),
        ("Explicit READ-ONLY with non-existing file", lambda: test_explicit_readonly_nonexistent_file(token)),
        ("Implicit read-only (show pattern)", lambda: test_implicit_readonly_show_pattern(token)),
        ("Non-read-only should NOT trigger read-only mode", lambda: test_non_readonly_should_not_trigger(token)),
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
        
        # Small delay between tests
        time.sleep(1)
    
    log(f"\n{'='*60}")
    log(f"FINAL RESULTS: {passed}/{total} tests passed")
    log('='*60)
    
    if passed == total:
        log("🎉 ALL READ-ONLY FILE INSPECTION TESTS PASSED!")
        return 0
    else:
        log("❌ SOME TESTS FAILED")
        return 1

if __name__ == "__main__":
    sys.exit(main())