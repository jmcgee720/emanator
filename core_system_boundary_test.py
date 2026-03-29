#!/usr/bin/env python3
"""
Core System Boundary Test - MyMergent Chat Type Feature
Test the chat_type field functionality for the MyMergent platform
"""

import requests
import json
import sys
from datetime import datetime

# Test configuration
BASE_URL = "https://lightwave-import.preview.emergentagent.com"
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
TEST_PROJECT_ID = "2fa5e2c3-4e74-4dfe-872c-d9601fd0fcfd"
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"

class CoreSystemBoundaryTester:
    def __init__(self):
        self.access_token = None
        self.created_chat_ids = []
        
    def authenticate(self):
        """Authenticate with Supabase and get access token"""
        try:
            print("🔐 Authenticating with Supabase...")
            
            auth_url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
            headers = {
                "apikey": SUPABASE_ANON_KEY,
                "Content-Type": "application/json"
            }
            payload = {
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            }
            
            response = requests.post(auth_url, headers=headers, json=payload, timeout=30)
            
            if response.status_code == 200:
                data = response.json()
                self.access_token = data.get('access_token')
                print(f"✅ Authentication successful! Token obtained.")
                return True
            else:
                print(f"❌ Authentication failed: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Authentication error: {e}")
            return False
    
    def get_auth_headers(self):
        """Get headers with bearer token for API calls"""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
    
    def test_chat_listing_returns_chat_type(self):
        """Test 1: Chat listing returns chat_type field"""
        print("\n📋 TEST 1: Chat listing returns chat_type field")
        
        try:
            url = f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/chats"
            response = requests.get(url, headers=self.get_auth_headers(), timeout=30)
            
            if response.status_code == 200:
                chats = response.json()
                print(f"✅ Chat listing successful - Found {len(chats)} chats")
                
                # Check if all chats have chat_type field
                all_have_chat_type = True
                builder_count = 0
                self_edit_count = 0
                
                for chat in chats:
                    if 'chat_type' not in chat:
                        print(f"❌ Chat missing chat_type: {chat.get('title', 'No title')}")
                        all_have_chat_type = False
                    else:
                        chat_type = chat['chat_type']
                        title = chat.get('title', 'No title')
                        
                        # Verify chat_type logic
                        if title.startswith("⚙ Self-Edit: "):
                            if chat_type == "self_edit":
                                self_edit_count += 1
                                print(f"✅ Self-edit chat correctly typed: '{title}' -> {chat_type}")
                            else:
                                print(f"❌ Self-edit chat wrongly typed: '{title}' -> {chat_type} (expected: self_edit)")
                                all_have_chat_type = False
                        else:
                            if chat_type == "builder":
                                builder_count += 1
                                print(f"✅ Builder chat correctly typed: '{title}' -> {chat_type}")
                            else:
                                print(f"❌ Builder chat wrongly typed: '{title}' -> {chat_type} (expected: builder)")
                                all_have_chat_type = False
                
                print(f"📊 Summary: {builder_count} builder chats, {self_edit_count} self-edit chats")
                
                if all_have_chat_type and len(chats) > 0:
                    print("✅ TEST 1 PASSED - All chats have correct chat_type field")
                    return True
                elif len(chats) == 0:
                    print("⚠️  No chats found to test")
                    return True
                else:
                    print("❌ TEST 1 FAILED - Some chats missing or have incorrect chat_type")
                    return False
            else:
                print(f"❌ Failed to get chat listing: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Error in chat listing test: {e}")
            return False
    
    def test_owner_create_self_edit_chat(self):
        """Test 2: Owner can create self-edit chat"""
        print("\n🔧 TEST 2: Owner can create self-edit chat")
        
        try:
            url = f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/chats"
            payload = {
                "title": "⚙ Self-Edit: Test from testing agent"
            }
            
            response = requests.post(url, headers=self.get_auth_headers(), json=payload, timeout=30)
            
            if response.status_code == 201:
                chat = response.json()
                chat_id = chat.get('id')
                
                if chat_id:
                    self.created_chat_ids.append(chat_id)
                
                expected_title = "⚙ Self-Edit: Test from testing agent"
                actual_title = chat.get('title')
                chat_type = chat.get('chat_type')
                
                if actual_title == expected_title and chat_type == "self_edit":
                    print(f"✅ Self-edit chat created successfully:")
                    print(f"   Title: '{actual_title}'")
                    print(f"   Type: '{chat_type}'")
                    print(f"   ID: {chat_id}")
                    print("✅ TEST 2 PASSED")
                    return True
                else:
                    print(f"❌ Chat created but with wrong properties:")
                    print(f"   Expected title: '{expected_title}'")
                    print(f"   Actual title: '{actual_title}'")
                    print(f"   Expected type: 'self_edit'")
                    print(f"   Actual type: '{chat_type}'")
                    print("❌ TEST 2 FAILED")
                    return False
            else:
                print(f"❌ Failed to create self-edit chat: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Error in self-edit chat creation test: {e}")
            return False
    
    def test_owner_create_normal_builder_chat(self):
        """Test 3: Owner can create normal builder chat"""
        print("\n🔨 TEST 3: Owner can create normal builder chat")
        
        try:
            url = f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/chats"
            payload = {
                "title": "Testing Builder Chat"
            }
            
            response = requests.post(url, headers=self.get_auth_headers(), json=payload, timeout=30)
            
            if response.status_code == 201:
                chat = response.json()
                chat_id = chat.get('id')
                
                if chat_id:
                    self.created_chat_ids.append(chat_id)
                
                expected_title = "Testing Builder Chat"
                actual_title = chat.get('title')
                chat_type = chat.get('chat_type')
                
                if actual_title == expected_title and chat_type == "builder":
                    print(f"✅ Builder chat created successfully:")
                    print(f"   Title: '{actual_title}'")
                    print(f"   Type: '{chat_type}'")
                    print(f"   ID: {chat_id}")
                    print("✅ TEST 3 PASSED")
                    return True
                else:
                    print(f"❌ Chat created but with wrong properties:")
                    print(f"   Expected title: '{expected_title}'")
                    print(f"   Actual title: '{actual_title}'")
                    print(f"   Expected type: 'builder'")
                    print(f"   Actual type: '{chat_type}'")
                    print("❌ TEST 3 FAILED")
                    return False
            else:
                print(f"❌ Failed to create builder chat: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Error in builder chat creation test: {e}")
            return False
    
    def test_self_edit_chat_title_format(self):
        """Test 4: Self-edit chat has correct title format"""
        print("\n🎯 TEST 4: Self-edit chat has correct title format")
        
        try:
            # Test with various self-edit title formats
            test_cases = [
                {
                    "input": "⚙ Self-Edit: Format verification test",
                    "expected_type": "self_edit"
                },
                {
                    "input": "⚙ Self-Edit: ",  # Edge case: minimal self-edit title
                    "expected_type": "self_edit"
                },
                {
                    "input": "Self-Edit: Missing gear icon",  # Should NOT be self-edit
                    "expected_type": "builder"
                },
                {
                    "input": "⚙Self-Edit: Missing space",  # Should NOT be self-edit
                    "expected_type": "builder"
                }
            ]
            
            all_passed = True
            
            for i, test_case in enumerate(test_cases):
                print(f"\n   Testing case {i+1}: '{test_case['input']}'")
                
                url = f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/chats"
                payload = {"title": test_case["input"]}
                
                response = requests.post(url, headers=self.get_auth_headers(), json=payload, timeout=30)
                
                if response.status_code == 201:
                    chat = response.json()
                    chat_id = chat.get('id')
                    
                    if chat_id:
                        self.created_chat_ids.append(chat_id)
                    
                    actual_type = chat.get('chat_type')
                    expected_type = test_case['expected_type']
                    
                    if actual_type == expected_type:
                        print(f"   ✅ Correct type: '{actual_type}' for '{test_case['input']}'")
                    else:
                        print(f"   ❌ Wrong type: expected '{expected_type}', got '{actual_type}' for '{test_case['input']}'")
                        all_passed = False
                else:
                    print(f"   ❌ Failed to create chat for format test: {response.status_code}")
                    all_passed = False
            
            if all_passed:
                print("\n✅ TEST 4 PASSED - All title format tests passed")
                return True
            else:
                print("\n❌ TEST 4 FAILED - Some title format tests failed")
                return False
                
        except Exception as e:
            print(f"❌ Error in title format test: {e}")
            return False
    
    def cleanup_test_chats(self):
        """Test 5: Cleanup - Delete created test chats"""
        print("\n🧹 TEST 5: Cleanup - Deleting test chats")
        
        if not self.created_chat_ids:
            print("✅ No test chats to clean up")
            return True
        
        cleanup_success = True
        
        for chat_id in self.created_chat_ids:
            try:
                url = f"{BASE_URL}/api/chats/{chat_id}"
                response = requests.delete(url, headers=self.get_auth_headers(), timeout=30)
                
                if response.status_code == 200:
                    print(f"✅ Successfully deleted chat: {chat_id}")
                else:
                    print(f"❌ Failed to delete chat {chat_id}: {response.status_code} - {response.text}")
                    cleanup_success = False
                    
            except Exception as e:
                print(f"❌ Error deleting chat {chat_id}: {e}")
                cleanup_success = False
        
        if cleanup_success:
            print("✅ TEST 5 PASSED - All test chats cleaned up successfully")
        else:
            print("❌ TEST 5 FAILED - Some test chats could not be cleaned up")
            
        return cleanup_success
    
    def run_all_tests(self):
        """Run all Core System Boundary tests"""
        print("🚀 STARTING CORE SYSTEM BOUNDARY TESTING")
        print("=" * 60)
        print(f"Base URL: {BASE_URL}")
        print(f"Test Project ID: {TEST_PROJECT_ID}")
        print(f"Test User: {TEST_EMAIL}")
        print("=" * 60)
        
        # Authenticate first
        if not self.authenticate():
            print("❌ AUTHENTICATION FAILED - Cannot proceed with tests")
            return False
        
        # Run all tests
        test_results = {
            "chat_listing_returns_chat_type": self.test_chat_listing_returns_chat_type(),
            "owner_create_self_edit_chat": self.test_owner_create_self_edit_chat(),
            "owner_create_normal_builder_chat": self.test_owner_create_normal_builder_chat(),
            "self_edit_chat_title_format": self.test_self_edit_chat_title_format(),
            "cleanup_test_chats": self.cleanup_test_chats()
        }
        
        # Print final results
        print("\n" + "=" * 60)
        print("📊 FINAL TEST RESULTS")
        print("=" * 60)
        
        passed_count = 0
        total_count = len(test_results)
        
        for test_name, result in test_results.items():
            status = "✅ PASSED" if result else "❌ FAILED"
            print(f"{test_name.replace('_', ' ').title()}: {status}")
            if result:
                passed_count += 1
        
        print("=" * 60)
        print(f"SUMMARY: {passed_count}/{total_count} tests passed")
        
        overall_success = passed_count == total_count
        if overall_success:
            print("🎉 ALL TESTS PASSED - Core System Boundary feature is working correctly!")
        else:
            print("⚠️  SOME TESTS FAILED - Review failed tests above")
        
        return overall_success

if __name__ == "__main__":
    tester = CoreSystemBoundaryTester()
    success = tester.run_all_tests()
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)