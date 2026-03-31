#!/usr/bin/env python3

"""
Phase 12 Step 6C — Core System creation security gap closure testing
Tests the new server-side is_self_edit flag requirement for chat creation.

Key security enhancement: Chat creation with self-edit prefix in title now requires
explicit is_self_edit=true flag in request body. Without flag, prefix gets stripped
to prevent title injection attacks.
"""

import requests
import json
import sys
from urllib.parse import urlparse

# Test configuration
BASE_URL = "https://pipeline-secure.preview.emergentagent.com"
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"
SELF_EDIT_PREFIX = "⚙ Self-Edit: "

def authenticate():
    """Get Supabase auth token using the correct Supabase auth endpoint"""
    # Use the correct Supabase URL from environment
    auth_url = "https://cawmmqakaxbznbelcrwd.supabase.co/auth/v1/token?grant_type=password"
    
    auth_payload = {
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    }
    
    headers = {
        "Content-Type": "application/json",
        "apikey": "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
    }
    
    response = requests.post(auth_url, headers=headers, json=auth_payload)
    
    if response.status_code == 200:
        token = response.json().get("access_token")
        print(f"✅ Authentication successful for {TEST_EMAIL}")
        return token
    else:
        print(f"❌ Authentication failed: {response.status_code} - {response.text}")
        return None

def test_chat_creation_security():
    """Test all chat creation security scenarios"""
    
    print("\n" + "="*80)
    print("PHASE 12 STEP 6C — CORE SYSTEM CREATION SECURITY GAP CLOSURE")
    print("Testing server-side is_self_edit flag requirement")
    print("="*80)
    
    # Get auth token
    token = authenticate()
    if not token:
        print("❌ Cannot proceed without authentication")
        return False
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Find a project to test with
    print(f"\n🔍 Getting projects list...")
    projects_response = requests.get(f"{BASE_URL}/api/projects", headers=headers)
    
    if projects_response.status_code != 200:
        print(f"❌ Failed to get projects: {projects_response.status_code}")
        return False
    
    projects = projects_response.json()
    if not projects:
        print("❌ No projects found")
        return False
    
    # Use first non-sandbox project
    test_project = None
    for p in projects:
        if not p.get('settings', {}).get('is_sandbox', False):
            test_project = p
            break
    
    if not test_project:
        print("❌ No non-sandbox project found")
        return False
    
    project_id = test_project['id']
    print(f"✅ Using project: {test_project['name']} ({project_id})")
    
    # Track created chats for cleanup
    created_chats = []
    
    try:
        # TEST SCENARIO 1: Owner + is_self_edit=true + self-edit title → 201, chat_type='self_edit', title preserved
        print(f"\n📝 TEST 1: Owner + is_self_edit=true + self-edit title")
        test1_payload = {
            "title": f"{SELF_EDIT_PREFIX}Test Security Enhancement",
            "is_self_edit": True
        }
        
        response1 = requests.post(f"{BASE_URL}/api/projects/{project_id}/chats", 
                                 headers=headers, json=test1_payload)
        
        if response1.status_code == 201:
            chat1 = response1.json()
            created_chats.append(chat1['id'])
            if (chat1.get('chat_type') == 'self_edit' and 
                chat1.get('title') == f"{SELF_EDIT_PREFIX}Test Security Enhancement"):
                print(f"✅ TEST 1 PASSED: Self-edit chat created with preserved title")
                print(f"   - Chat type: {chat1.get('chat_type')}")
                print(f"   - Title: {chat1.get('title')}")
            else:
                print(f"❌ TEST 1 FAILED: Wrong chat type or title")
                print(f"   - Expected chat_type: self_edit, got: {chat1.get('chat_type')}")
                print(f"   - Expected title: {SELF_EDIT_PREFIX}Test Security Enhancement")
                print(f"   - Got title: {chat1.get('title')}")
        else:
            print(f"❌ TEST 1 FAILED: Expected 201, got {response1.status_code}")
            print(f"   Response: {response1.text}")
        
        # TEST SCENARIO 2: Owner + is_self_edit=false + self-edit title → 201, chat_type='builder', title STRIPPED
        print(f"\n📝 TEST 2: Owner + is_self_edit=false + self-edit title (CRITICAL SECURITY TEST)")
        test2_payload = {
            "title": f"{SELF_EDIT_PREFIX}Injection Attempt",
            "is_self_edit": False
        }
        
        response2 = requests.post(f"{BASE_URL}/api/projects/{project_id}/chats", 
                                 headers=headers, json=test2_payload)
        
        if response2.status_code == 201:
            chat2 = response2.json()
            created_chats.append(chat2['id'])
            expected_stripped_title = "Injection Attempt"  # Prefix should be stripped
            
            if (chat2.get('chat_type') == 'builder' and 
                chat2.get('title') == expected_stripped_title):
                print(f"✅ TEST 2 PASSED: Title injection prevented, prefix stripped")
                print(f"   - Chat type: {chat2.get('chat_type')} (correct, not self_edit)")
                print(f"   - Title: {chat2.get('title')} (prefix stripped)")
            else:
                print(f"❌ TEST 2 FAILED: Security vulnerability - title injection not prevented!")
                print(f"   - Expected chat_type: builder, got: {chat2.get('chat_type')}")
                print(f"   - Expected title: {expected_stripped_title}")
                print(f"   - Got title: {chat2.get('title')}")
        else:
            print(f"❌ TEST 2 FAILED: Expected 201, got {response2.status_code}")
            print(f"   Response: {response2.text}")
        
        # TEST SCENARIO 3: Owner + is_self_edit=true + normal title → 201, original title preserved
        print(f"\n📝 TEST 3: Owner + is_self_edit=true + normal title")
        test3_payload = {
            "title": "Normal Chat with Flag",
            "is_self_edit": True
        }
        
        response3 = requests.post(f"{BASE_URL}/api/projects/{project_id}/chats", 
                                 headers=headers, json=test3_payload)
        
        if response3.status_code == 201:
            chat3 = response3.json()
            created_chats.append(chat3['id'])
            if (chat3.get('chat_type') == 'builder' and  # Should still be builder since no prefix
                chat3.get('title') == "Normal Chat with Flag"):
                print(f"✅ TEST 3 PASSED: Normal title preserved, flag alone doesn't add prefix")
                print(f"   - Chat type: {chat3.get('chat_type')}")
                print(f"   - Title: {chat3.get('title')}")
            else:
                print(f"❌ TEST 3 FAILED: Unexpected behavior")
                print(f"   - Expected chat_type: builder, got: {chat3.get('chat_type')}")
                print(f"   - Expected title: Normal Chat with Flag")
                print(f"   - Got title: {chat3.get('title')}")
        else:
            print(f"❌ TEST 3 FAILED: Expected 201, got {response3.status_code}")
            print(f"   Response: {response3.text}")
        
        # TEST SCENARIO 4: Owner + no flag + normal title → 201, chat_type='builder' (normal flow)
        print(f"\n📝 TEST 4: Owner + no flag + normal title (normal flow)")
        test4_payload = {
            "title": "Regular Builder Chat"
        }
        
        response4 = requests.post(f"{BASE_URL}/api/projects/{project_id}/chats", 
                                 headers=headers, json=test4_payload)
        
        if response4.status_code == 201:
            chat4 = response4.json()
            created_chats.append(chat4['id'])
            if (chat4.get('chat_type') == 'builder' and 
                chat4.get('title') == "Regular Builder Chat"):
                print(f"✅ TEST 4 PASSED: Normal builder chat created")
                print(f"   - Chat type: {chat4.get('chat_type')}")
                print(f"   - Title: {chat4.get('title')}")
            else:
                print(f"❌ TEST 4 FAILED: Normal flow broken")
                print(f"   - Expected chat_type: builder, got: {chat4.get('chat_type')}")
                print(f"   - Expected title: Regular Builder Chat")
                print(f"   - Got title: {chat4.get('title')}")
        else:
            print(f"❌ TEST 4 FAILED: Expected 201, got {response4.status_code}")
            print(f"   Response: {response4.text}")
        
        # TEST SCENARIO 5: No auth + is_self_edit=true → 401
        print(f"\n📝 TEST 5: No auth + is_self_edit=true → 401")
        test5_payload = {
            "title": f"{SELF_EDIT_PREFIX}Unauthorized Attempt",
            "is_self_edit": True
        }
        
        response5 = requests.post(f"{BASE_URL}/api/projects/{project_id}/chats", 
                                 json=test5_payload)  # No auth headers
        
        if response5.status_code == 401:
            print(f"✅ TEST 5 PASSED: Unauthorized access properly blocked")
        else:
            print(f"❌ TEST 5 FAILED: Expected 401, got {response5.status_code}")
            print(f"   Response: {response5.text}")
        
        # TEST SCENARIO 6: Owner creates normal chat (comprehensive)
        print(f"\n📝 TEST 6: Owner creates normal chat (no is_self_edit flag)")
        test6_payload = {
            "title": "My Builder Chat"
        }
        
        response6 = requests.post(f"{BASE_URL}/api/projects/{project_id}/chats", 
                                 headers=headers, json=test6_payload)
        
        if response6.status_code == 201:
            chat6 = response6.json()
            created_chats.append(chat6['id'])
            if (chat6.get('chat_type') == 'builder' and 
                chat6.get('title') == "My Builder Chat"):
                print(f"✅ TEST 6 PASSED: Normal builder chat workflow")
                print(f"   - Chat type: {chat6.get('chat_type')}")
                print(f"   - Title: {chat6.get('title')}")
            else:
                print(f"❌ TEST 6 FAILED")
        else:
            print(f"❌ TEST 6 FAILED: Expected 201, got {response6.status_code}")
        
        # TEST SCENARIO 7: Owner creates chat with default title
        print(f"\n📝 TEST 7: Owner creates chat with default title")
        test7_payload = {}  # No title in body
        
        response7 = requests.post(f"{BASE_URL}/api/projects/{project_id}/chats", 
                                 headers=headers, json=test7_payload)
        
        if response7.status_code == 201:
            chat7 = response7.json()
            created_chats.append(chat7['id'])
            if (chat7.get('chat_type') == 'builder' and 
                chat7.get('title') == "New Chat"):
                print(f"✅ TEST 7 PASSED: Default title applied")
                print(f"   - Chat type: {chat7.get('chat_type')}")
                print(f"   - Title: {chat7.get('title')}")
            else:
                print(f"❌ TEST 7 FAILED")
        else:
            print(f"❌ TEST 7 FAILED: Expected 201, got {response7.status_code}")
        
        # TEST SCENARIO 8: Owner GET messages on self-edit chat → 200
        if created_chats:
            print(f"\n📝 TEST 8: Owner GET messages on self-edit chat")
            # Use first created chat (should be self-edit from test 1)
            self_edit_chat_id = created_chats[0]
            
            response8 = requests.get(f"{BASE_URL}/api/chats/{self_edit_chat_id}/messages", 
                                   headers=headers)
            
            if response8.status_code == 200:
                messages8 = response8.json()
                print(f"✅ TEST 8 PASSED: Owner can access self-edit chat messages")
                print(f"   - Messages count: {len(messages8)}")
            else:
                print(f"❌ TEST 8 FAILED: Expected 200, got {response8.status_code}")
        
        # TEST SCENARIO 9: Owner stream in self-edit chat → 200 (SSE)
        if created_chats:
            print(f"\n📝 TEST 9: Owner stream in self-edit chat (SSE test)")
            self_edit_chat_id = created_chats[0]
            
            stream_payload = {
                "content": "Test streaming in self-edit chat",
                "metadata": {
                    "selfEditTarget": "plan_validator"
                }
            }
            
            stream_headers = {**headers, "Accept": "text/event-stream"}
            
            response9 = requests.post(f"{BASE_URL}/api/chats/{self_edit_chat_id}/messages/stream", 
                                    headers=stream_headers, json=stream_payload, stream=True)
            
            if response9.status_code == 200 and 'text/event-stream' in response9.headers.get('content-type', ''):
                print(f"✅ TEST 9 PASSED: Owner can stream in self-edit chat")
                print(f"   - Content-Type: {response9.headers.get('content-type')}")
                
                # Read first few SSE events to verify
                event_count = 0
                for line in response9.iter_lines():
                    if line:
                        line_text = line.decode('utf-8')
                        if line_text.startswith('event:'):
                            event_count += 1
                            if event_count <= 3:  # Only show first few events
                                print(f"   - SSE Event: {line_text}")
                        if event_count >= 5:  # Stop after a few events
                            break
                response9.close()
            else:
                print(f"❌ TEST 9 FAILED: Expected SSE stream, got {response9.status_code}")
                print(f"   Content-Type: {response9.headers.get('content-type', 'None')}")
        
    finally:
        # Cleanup: Delete created chats
        print(f"\n🧹 Cleaning up {len(created_chats)} test chats...")
        for chat_id in created_chats:
            try:
                delete_response = requests.delete(f"{BASE_URL}/api/chats/{chat_id}", headers=headers)
                if delete_response.status_code == 200:
                    print(f"✅ Deleted chat {chat_id}")
                else:
                    print(f"⚠️ Failed to delete chat {chat_id}: {delete_response.status_code}")
            except Exception as e:
                print(f"⚠️ Error deleting chat {chat_id}: {e}")
    
    print(f"\n" + "="*80)
    print("PHASE 12 STEP 6C TESTING COMPLETED")
    print("="*80)
    return True

if __name__ == "__main__":
    success = test_chat_creation_security()
    sys.exit(0 if success else 1)