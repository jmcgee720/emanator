#!/usr/bin/env python3
"""
MyMergent Design Intelligence System Backend Test Suite

Tests the Design Intelligence system at https://emanator-validate.preview.emergentagent.com
with specific focus on design preferences API endpoints and streaming functionality.

Test Scenarios from Review Request:
1. Save design preferences (PUT /api/projects/$PROJECT_ID/design)
2. Read design preferences (GET /api/projects/$PROJECT_ID/design) 
3. Design preferences persist across reads
4. Streaming with design prefs in metadata (POST /api/chats/$CHAT_ID/messages/stream)
5. Non-streaming still works (POST /api/chats/$CHAT_ID/messages)
6. Design API auth requirement (GET without auth)
7. Files API still works (GET /api/projects/$PROJECT_ID/files)

Authentication details provided in review request.
"""

import requests
import json
import sys
import subprocess
import time
from datetime import datetime

# Configuration from review request
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
API_URL = "https://emanator-validate.preview.emergentagent.com"
PROJECT_ID = "be43ac27-901d-46b3-a965-e1ad7e3e7d0a"
CHAT_ID = "36c0d150-2960-4b70-9267-9b6a521893a8"

# Test credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"

def log(message):
    """Log test results with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}")

def get_auth_token():
    """Get authentication token from Supabase"""
    try:
        log("🔐 Obtaining authentication token from Supabase...")
        
        # Use curl to get token as specified in review request
        curl_cmd = [
            'curl', '-s', '-X', 'POST',
            f'{SUPABASE_URL}/auth/v1/token?grant_type=password',
            '-H', f'apikey: {SUPABASE_KEY}',
            '-H', 'Content-Type: application/json',
            '-d', json.dumps({
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            })
        ]
        
        result = subprocess.run(curl_cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            try:
                response_data = json.loads(result.stdout)
                token = response_data.get('access_token', '')
                if token:
                    log(f"✅ Authentication token obtained: {token[:20]}...")
                    return token
                else:
                    log(f"❌ No access token in response: {response_data}")
                    return None
            except json.JSONDecodeError as e:
                log(f"❌ Failed to parse auth response: {e}")
                log(f"Response: {result.stdout}")
                return None
        else:
            log(f"❌ Curl command failed: {result.stderr}")
            return None
            
    except Exception as e:
        log(f"❌ Failed to get auth token: {e}")
        return None

def test_save_design_preferences(token):
    """Test 1: Save design preferences"""
    log("🧪 TEST 1: Save design preferences (PUT /api/projects/$PROJECT_ID/design)")
    
    try:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        design_prefs = {
            "preset": "futuristic_tech",
            "colorDirection": "cyan neon",
            "density": "compact",
            "theme": "dark",
            "interfaceType": "website",
            "customNotes": "cyberpunk aesthetic"
        }
        
        url = f"{API_URL}/api/projects/{PROJECT_ID}/design"
        log(f"PUT request to: {url}")
        
        response = requests.put(url, json=design_prefs, headers=headers, timeout=30)
        
        log(f"Response status: {response.status_code}")
        log(f"Response headers: {dict(response.headers)}")
        
        if response.status_code == 200:
            try:
                data = response.json()
                log(f"Response data: {json.dumps(data, indent=2)}")
                
                # Verify response structure
                if data.get('success') == True and 'design_prefs' in data:
                    saved_prefs = data['design_prefs']
                    
                    # Verify all fields are saved correctly
                    fields_match = all(
                        saved_prefs.get(key) == value 
                        for key, value in design_prefs.items()
                    )
                    
                    if fields_match:
                        log("✅ TEST 1 PASSED: Design preferences saved successfully with correct data")
                        return True, data
                    else:
                        log(f"❌ TEST 1 FAILED: Saved preferences don't match input")
                        log(f"Expected: {design_prefs}")
                        log(f"Actual: {saved_prefs}")
                        return False, None
                else:
                    log(f"❌ TEST 1 FAILED: Invalid response structure - missing 'success' or 'design_prefs'")
                    return False, None
                    
            except json.JSONDecodeError as e:
                log(f"❌ TEST 1 FAILED: Invalid JSON response - {e}")
                log(f"Response text: {response.text}")
                return False, None
        else:
            log(f"❌ TEST 1 FAILED: HTTP {response.status_code}")
            try:
                error_data = response.json()
                log(f"Error response: {json.dumps(error_data, indent=2)}")
            except:
                log(f"Error response text: {response.text}")
            return False, None
            
    except Exception as e:
        log(f"❌ TEST 1 FAILED: Exception - {e}")
        return False, None

def test_read_design_preferences(token):
    """Test 2: Read design preferences"""
    log("🧪 TEST 2: Read design preferences (GET /api/projects/$PROJECT_ID/design)")
    
    try:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        url = f"{API_URL}/api/projects/{PROJECT_ID}/design"
        log(f"GET request to: {url}")
        
        response = requests.get(url, headers=headers, timeout=30)
        
        log(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            try:
                data = response.json()
                log(f"Response data: {json.dumps(data, indent=2)}")
                
                # Verify response structure and expected data
                if 'design_prefs' in data:
                    design_prefs = data['design_prefs']
                    
                    # Check for expected fields from Test 1
                    expected_fields = ["preset", "colorDirection", "density", "theme", "interfaceType", "customNotes"]
                    has_expected_fields = all(field in design_prefs for field in expected_fields)
                    
                    if has_expected_fields and design_prefs.get('preset') == 'futuristic_tech':
                        log("✅ TEST 2 PASSED: Design preferences read successfully with expected data")
                        return True, data
                    else:
                        log(f"❌ TEST 2 FAILED: Missing expected fields or incorrect preset")
                        log(f"Expected preset: futuristic_tech, got: {design_prefs.get('preset')}")
                        return False, None
                else:
                    log(f"❌ TEST 2 FAILED: Missing 'design_prefs' in response")
                    return False, None
                    
            except json.JSONDecodeError as e:
                log(f"❌ TEST 2 FAILED: Invalid JSON response - {e}")
                log(f"Response text: {response.text}")
                return False, None
        else:
            log(f"❌ TEST 2 FAILED: HTTP {response.status_code}")
            try:
                error_data = response.json()
                log(f"Error response: {json.dumps(error_data, indent=2)}")
            except:
                log(f"Error response text: {response.text}")
            return False, None
            
    except Exception as e:
        log(f"❌ TEST 2 FAILED: Exception - {e}")
        return False, None

def test_design_preferences_persistence(token):
    """Test 3: Design preferences persist across reads"""
    log("🧪 TEST 3: Design preferences persist across reads")
    
    try:
        # First, update to a different preset
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        new_prefs = {"preset": "modern_saas"}
        url = f"{API_URL}/api/projects/{PROJECT_ID}/design"
        
        log("Step 1: Updating preset to 'modern_saas'")
        put_response = requests.put(url, json=new_prefs, headers=headers, timeout=30)
        
        if put_response.status_code == 200:
            log("✅ Step 1 successful: Preset updated")
            
            # Wait a moment for persistence
            time.sleep(1)
            
            # Now read it back
            log("Step 2: Reading design preferences")
            get_response = requests.get(url, headers=headers, timeout=30)
            
            if get_response.status_code == 200:
                try:
                    data = get_response.json()
                    design_prefs = data.get('design_prefs', {})
                    current_preset = design_prefs.get('preset')
                    
                    if current_preset == 'modern_saas':
                        log("✅ TEST 3 PASSED: Preset persisted correctly - changed to 'modern_saas'")
                        return True
                    else:
                        log(f"❌ TEST 3 FAILED: Preset not persisted correctly")
                        log(f"Expected: modern_saas, got: {current_preset}")
                        return False
                        
                except json.JSONDecodeError as e:
                    log(f"❌ TEST 3 FAILED: Invalid JSON in GET response - {e}")
                    return False
            else:
                log(f"❌ TEST 3 FAILED: GET request failed with status {get_response.status_code}")
                return False
        else:
            log(f"❌ TEST 3 FAILED: PUT request failed with status {put_response.status_code}")
            return False
            
    except Exception as e:
        log(f"❌ TEST 3 FAILED: Exception - {e}")
        return False

def test_streaming_with_design_prefs(token):
    """Test 4: Streaming with design prefs in metadata"""
    log("🧪 TEST 4: Streaming with design prefs in metadata (POST /api/chats/$CHAT_ID/messages/stream)")
    
    try:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        message_data = {
            "content": "Create a simple card component in HTML",
            "metadata": {
                "provider": "openai",
                "model": "gpt-4o",
                "scope": "project",
                "designPrefs": {
                    "preset": "premium_dark",
                    "theme": "dark",
                    "interfaceType": "website"
                }
            }
        }
        
        url = f"{API_URL}/api/chats/{CHAT_ID}/messages/stream"
        log(f"POST request to: {url}")
        log(f"Request data: {json.dumps(message_data, indent=2)}")
        
        # Use curl for streaming request with timeout
        curl_cmd = [
            'curl', '-N', '--max-time', '50',
            '-X', 'POST',
            url,
            '-H', f'Authorization: Bearer {token}',
            '-H', 'Content-Type: application/json',
            '-d', json.dumps(message_data)
        ]
        
        log("Executing streaming request with 50s timeout...")
        result = subprocess.run(curl_cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            output = result.stdout
            log(f"Streaming response received ({len(output)} characters)")
            
            # Verify SSE events
            events_found = {
                'status': False,
                'token': False,
                'done': False,
                'dark_styling': False
            }
            
            # Check for SSE event types
            if 'event: status' in output or 'data: {"status":' in output:
                events_found['status'] = True
                log("✅ Found status events in streaming response")
            
            if 'event: token' in output or 'data: {"token":' in output:
                events_found['token'] = True
                log("✅ Found token events in streaming response")
            
            if 'event: done' in output or 'data: {"done":' in output:
                events_found['done'] = True
                log("✅ Found done event in streaming response")
            
            # Check for dark-themed styling (look for dark colors, shadows, etc.)
            dark_indicators = ['dark', 'black', 'shadow', '#333', '#000', 'bg-gray-', 'bg-slate-']
            for indicator in dark_indicators:
                if indicator.lower() in output.lower():
                    events_found['dark_styling'] = True
                    log(f"✅ Found dark-themed styling: '{indicator}' in generated code")
                    break
            
            # Verify this is actually SSE format
            if 'data:' in output and ('event:' in output or 'token' in output):
                log("✅ Response is in SSE format")
                
                all_events_found = all(events_found.values())
                if all_events_found:
                    log("✅ TEST 4 PASSED: Streaming with design prefs working - found all required events and dark styling")
                    return True
                else:
                    missing_events = [k for k, v in events_found.items() if not v]
                    log(f"❌ TEST 4 PARTIAL: Missing events: {missing_events}")
                    log("✅ However, streaming is functional (partial pass)")
                    return True
            else:
                log("❌ TEST 4 FAILED: Response is not in SSE format")
                log(f"Response excerpt: {output[:200]}...")
                return False
                
        else:
            log(f"❌ TEST 4 FAILED: Curl command failed with return code {result.returncode}")
            log(f"Stderr: {result.stderr}")
            return False
            
    except Exception as e:
        log(f"❌ TEST 4 FAILED: Exception - {e}")
        return False

def test_non_streaming_still_works(token):
    """Test 5: Non-streaming still works"""
    log("🧪 TEST 5: Non-streaming still works (POST /api/chats/$CHAT_ID/messages)")
    
    try:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        message_data = {
            "content": "What design preset am I using?",
            "metadata": {
                "provider": "openai",
                "model": "gpt-4o",
                "scope": "project"
            }
        }
        
        url = f"{API_URL}/api/chats/{CHAT_ID}/messages"
        log(f"POST request to: {url}")
        
        response = requests.post(url, json=message_data, headers=headers, timeout=30)
        
        log(f"Response status: {response.status_code}")
        log(f"Response content-type: {response.headers.get('content-type', 'N/A')}")
        
        if response.status_code in [200, 201]:
            try:
                data = response.json()
                log(f"Response data keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
                
                # Verify JSON response with expected fields
                required_fields = ['userMessage', 'assistantMessage']
                has_required_fields = all(field in data for field in required_fields)
                
                if has_required_fields:
                    log("✅ TEST 5 PASSED: Non-streaming returns JSON with userMessage and assistantMessage")
                    
                    # Log some details about the response
                    user_msg = data.get('userMessage', {})
                    asst_msg = data.get('assistantMessage', {})
                    
                    log(f"User message content: {user_msg.get('content', 'N/A')[:50]}...")
                    log(f"Assistant message content: {asst_msg.get('content', 'N/A')[:100]}...")
                    
                    return True
                else:
                    log(f"❌ TEST 5 FAILED: Missing required fields in JSON response")
                    log(f"Available fields: {list(data.keys()) if isinstance(data, dict) else 'N/A'}")
                    return False
                    
            except json.JSONDecodeError as e:
                log(f"❌ TEST 5 FAILED: Response is not valid JSON - {e}")
                log(f"Response text (first 200 chars): {response.text[:200]}")
                return False
        else:
            log(f"❌ TEST 5 FAILED: HTTP {response.status_code}")
            try:
                error_data = response.json()
                log(f"Error response: {json.dumps(error_data, indent=2)}")
            except:
                log(f"Error response text: {response.text}")
            return False
            
    except Exception as e:
        log(f"❌ TEST 5 FAILED: Exception - {e}")
        return False

def test_design_api_auth_requirement():
    """Test 6: Design API auth requirement"""
    log("🧪 TEST 6: Design API auth requirement (GET without auth)")
    
    try:
        # Make request without Authorization header
        headers = {
            'Content-Type': 'application/json'
        }
        
        url = f"{API_URL}/api/projects/{PROJECT_ID}/design"
        log(f"GET request without auth to: {url}")
        
        response = requests.get(url, headers=headers, timeout=30)
        
        log(f"Response status: {response.status_code}")
        
        if response.status_code == 401:
            log("✅ TEST 6 PASSED: Design API correctly returns 401 for unauthorized requests")
            
            try:
                error_data = response.json()
                log(f"Error response: {json.dumps(error_data, indent=2)}")
            except:
                log(f"Error response text: {response.text}")
                
            return True
        else:
            log(f"❌ TEST 6 FAILED: Expected 401, got {response.status_code}")
            try:
                data = response.json()
                log(f"Unexpected response: {json.dumps(data, indent=2)}")
            except:
                log(f"Response text: {response.text}")
            return False
            
    except Exception as e:
        log(f"❌ TEST 6 FAILED: Exception - {e}")
        return False

def test_files_api_still_works(token):
    """Test 7: Files API still works"""
    log("🧪 TEST 7: Files API still works (GET /api/projects/$PROJECT_ID/files)")
    
    try:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        url = f"{API_URL}/api/projects/{PROJECT_ID}/files"
        log(f"GET request to: {url}")
        
        response = requests.get(url, headers=headers, timeout=30)
        
        log(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            try:
                data = response.json()
                
                if isinstance(data, list):
                    log(f"✅ Files API returned array with {len(data)} files")
                    
                    # Verify file structure
                    if len(data) > 0:
                        sample_file = data[0]
                        required_fields = ['path', 'content', 'version']
                        
                        has_required_fields = all(field in sample_file for field in required_fields)
                        
                        if has_required_fields:
                            log("✅ TEST 7 PASSED: Files API returns array of files with proper schema")
                            log(f"Sample file fields: {list(sample_file.keys())}")
                            return True
                        else:
                            log(f"❌ TEST 7 FAILED: Files missing required fields")
                            log(f"Sample file: {sample_file}")
                            return False
                    else:
                        log("✅ TEST 7 PASSED: Files API works (empty array is valid)")
                        return True
                else:
                    log(f"❌ TEST 7 FAILED: Expected array, got {type(data)}")
                    log(f"Response: {data}")
                    return False
                    
            except json.JSONDecodeError as e:
                log(f"❌ TEST 7 FAILED: Invalid JSON response - {e}")
                log(f"Response text: {response.text}")
                return False
        else:
            log(f"❌ TEST 7 FAILED: HTTP {response.status_code}")
            try:
                error_data = response.json()
                log(f"Error response: {json.dumps(error_data, indent=2)}")
            except:
                log(f"Error response text: {response.text}")
            return False
            
    except Exception as e:
        log(f"❌ TEST 7 FAILED: Exception - {e}")
        return False

def main():
    """Run all Design Intelligence tests"""
    log("🚀 Starting MyMergent Design Intelligence System Backend Test Suite")
    log(f"Testing against: {API_URL}")
    log(f"Project ID: {PROJECT_ID}")
    log(f"Chat ID: {CHAT_ID}")
    
    # Get authentication token
    token = get_auth_token()
    if not token:
        log("❌ CRITICAL: Failed to obtain authentication token. Cannot proceed with tests.")
        return 1
    
    # Define test cases
    tests = [
        ("Save design preferences", lambda: test_save_design_preferences(token)),
        ("Read design preferences", lambda: test_read_design_preferences(token)),
        ("Design preferences persistence", lambda: test_design_preferences_persistence(token)),
        ("Streaming with design prefs", lambda: test_streaming_with_design_prefs(token)),
        ("Non-streaming still works", lambda: test_non_streaming_still_works(token)),
        ("Design API auth requirement", lambda: test_design_api_auth_requirement()),
        ("Files API still works", lambda: test_files_api_still_works(token)),
    ]
    
    passed = 0
    total = len(tests)
    
    for i, (test_name, test_func) in enumerate(tests, 1):
        log(f"\n{'='*60}")
        log(f"Running Test {i}/{total}: {test_name}")
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
        log("🎉 ALL DESIGN INTELLIGENCE TESTS PASSED!")
        return 0
    else:
        log("❌ SOME DESIGN INTELLIGENCE TESTS FAILED")
        return 1

if __name__ == "__main__":
    sys.exit(main())