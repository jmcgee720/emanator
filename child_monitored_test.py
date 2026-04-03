#!/usr/bin/env python3
"""
Child Monitored Role Testing for MyMergent
Tests the child_monitored role and monitored account mode functionality.
"""

import requests
import json
import time
import uuid
from datetime import datetime

class MyMergentChildMonitoredTester:
    def __init__(self):
        self.base_url = "https://file-persistence-fix-1.preview.emergentagent.com"
        self.supabase_url = "https://cawmmqakaxbznbelcrwd.supabase.co"
        self.supabase_anon_key = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
        self.test_email = "testprov@test.com"
        self.test_password = "password123"
        self.auth_token = None
        self.test_user_id = None
        self.test_user_email = None
        
    def get_auth_token(self):
        """Get Supabase auth token for testing."""
        print("🔑 Getting authentication token...")
        
        auth_payload = {
            "email": self.test_email,
            "password": self.test_password
        }
        
        try:
            response = requests.post(
                f"{self.supabase_url}/auth/v1/token?grant_type=password",
                headers={
                    "Content-Type": "application/json",
                    "apikey": self.supabase_anon_key
                },
                json=auth_payload
            )
            
            if response.status_code == 200:
                data = response.json()
                self.auth_token = data.get("access_token")
                print(f"✅ Authentication successful")
                return True
            else:
                print(f"❌ Auth failed: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Auth error: {e}")
            return False
    
    def api_request(self, method, endpoint, data=None, expect_status=200):
        """Make API request with authentication."""
        url = f"{self.base_url}/api{endpoint}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.auth_token}"
        }
        
        try:
            if method == "GET":
                response = requests.get(url, headers=headers)
            elif method == "POST":
                response = requests.post(url, headers=headers, json=data)
            elif method == "PUT":
                response = requests.put(url, headers=headers, json=data)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            print(f"📡 {method} {endpoint} → {response.status_code}")
            
            if response.status_code == expect_status:
                try:
                    return response.json()
                except:
                    return {"success": True}
            else:
                print(f"❌ Expected {expect_status}, got {response.status_code}: {response.text}")
                return None
                
        except Exception as e:
            print(f"❌ Request error: {e}")
            return None

    def test_1_create_child_monitored_user(self):
        """Test creating a user with child_monitored role."""
        print("\n🧪 TEST 1: Create child_monitored user")
        
        # Generate unique test email
        unique_id = str(uuid.uuid4())[:8]
        self.test_user_email = f"e2e-monitored-test-{unique_id}@example.com"
        
        payload = {
            "email": self.test_user_email,
            "role": "child_monitored"
        }
        
        result = self.api_request("POST", "/admin/users", payload, 201)
        
        if result:
            print(f"✅ User created successfully with email: {self.test_user_email}")
            print(f"   Role: {result.get('role')}")
            print(f"   ID: {result.get('id')}")
            self.test_user_id = result.get('id')
            
            if result.get('role') == 'child_monitored':
                print("✅ Role correctly set to child_monitored")
                return True
            else:
                print(f"❌ Expected role 'child_monitored', got '{result.get('role')}'")
                return False
        else:
            print("❌ Failed to create user")
            return False

    def test_2_verify_user_enrichment(self):
        """Test GET /api/admin/users to verify child_monitored enrichment."""
        print("\n🧪 TEST 2: Verify child_monitored user enrichment")
        
        result = self.api_request("GET", "/admin/users")
        
        if result and isinstance(result, list):
            print(f"✅ Retrieved {len(result)} users")
            
            # Find our test user
            test_user = None
            for user in result:
                if user.get('email') == self.test_user_email:
                    test_user = user
                    break
            
            if test_user:
                print(f"✅ Found test user: {test_user.get('email')}")
                print(f"   Role: {test_user.get('role')}")
                print(f"   ID: {test_user.get('id')}")
                
                if test_user.get('role') == 'child_monitored':
                    print("✅ User correctly enriched with child_monitored role")
                    return True
                else:
                    print(f"❌ Expected role 'child_monitored', got '{test_user.get('role')}'")
                    return False
            else:
                print(f"❌ Test user {self.test_user_email} not found in user list")
                return False
        else:
            print("❌ Failed to retrieve users or invalid response")
            return False

    def test_3_update_user_role(self):
        """Test updating user role to member and back to child_monitored."""
        print("\n🧪 TEST 3: Update user role")
        
        if not self.test_user_id:
            print("❌ No test user ID available")
            return False
        
        # Test 3a: Change to member
        print("📝 Changing role to member...")
        result = self.api_request("PUT", f"/admin/users/{self.test_user_id}", {"role": "member"})
        
        if result and result.get('role') == 'member':
            print("✅ Role successfully changed to member")
        else:
            print(f"❌ Failed to change role to member: {result}")
            return False
        
        # Test 3b: Change back to child_monitored
        print("📝 Changing role back to child_monitored...")
        result = self.api_request("PUT", f"/admin/users/{self.test_user_id}", {"role": "child_monitored"})
        
        if result and result.get('role') == 'child_monitored':
            print("✅ Role successfully changed back to child_monitored")
            return True
        else:
            print(f"❌ Failed to change role to child_monitored: {result}")
            return False

    def test_4_monitored_endpoint_with_auth(self):
        """Test GET /api/admin/monitored with owner authentication."""
        print("\n🧪 TEST 4: Access /api/admin/monitored with owner auth")
        
        result = self.api_request("GET", "/admin/monitored")
        
        if result is not None:
            print(f"✅ Monitored endpoint accessible with owner auth")
            print(f"   Response type: {type(result)}")
            if isinstance(result, list):
                print(f"   Number of entries: {len(result)}")
                if len(result) > 0:
                    print(f"   Sample entry: {result[0]}")
                else:
                    print("   No monitored activity entries (which is expected for new user)")
            return True
        else:
            print("❌ Failed to access monitored endpoint")
            return False

    def test_5_monitored_endpoint_without_auth(self):
        """Test GET /api/admin/monitored without authentication."""
        print("\n🧪 TEST 5: Access /api/admin/monitored without auth")
        
        url = f"{self.base_url}/api/admin/monitored"
        
        try:
            # Request without auth headers
            response = requests.get(url)
            print(f"📡 GET /admin/monitored (no auth) → {response.status_code}")
            
            if response.status_code == 401:
                print("✅ Correctly returns 401 Unauthorized without auth")
                return True
            else:
                print(f"❌ Expected 401, got {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Request error: {e}")
            return False

    def test_6_permission_enforcement(self):
        """Test permission enforcement for existing endpoints."""
        print("\n🧪 TEST 6: Permission enforcement tests")
        
        # Test admin activity endpoint (should work for owner)
        result = self.api_request("GET", "/admin/activity")
        
        if result is not None:
            print("✅ Admin activity endpoint accessible to owner")
            if isinstance(result, list):
                print(f"   Activity entries: {len(result)}")
        else:
            print("❌ Admin activity endpoint failed")
            return False
        
        # Test without auth
        url = f"{self.base_url}/api/admin/activity"
        try:
            response = requests.get(url)
            if response.status_code == 401:
                print("✅ Admin activity correctly returns 401 without auth")
            else:
                print(f"❌ Admin activity should return 401 without auth, got {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Request error: {e}")
            return False
        
        return True

    def test_7_cleanup(self):
        """Clean up by deleting the test user."""
        print("\n🧪 TEST 7: Cleanup - Delete test user")
        
        if not self.test_user_id:
            print("❌ No test user ID to delete")
            return False
        
        result = self.api_request("DELETE", f"/admin/users/{self.test_user_id}")
        
        if result and result.get('success'):
            print(f"✅ Test user {self.test_user_email} successfully deleted")
            return True
        else:
            print(f"❌ Failed to delete test user: {result}")
            return False

    def run_all_tests(self):
        """Run all test scenarios."""
        print("🚀 Starting Child Monitored Role Testing")
        print(f"🔗 Base URL: {self.base_url}")
        
        # Get authentication token
        if not self.get_auth_token():
            print("❌ Authentication failed, cannot proceed with tests")
            return
        
        test_results = []
        
        # Run all tests in sequence
        tests = [
            ("Create child_monitored user", self.test_1_create_child_monitored_user),
            ("Verify user enrichment", self.test_2_verify_user_enrichment),
            ("Update user role", self.test_3_update_user_role),
            ("Monitored endpoint with auth", self.test_4_monitored_endpoint_with_auth),
            ("Monitored endpoint without auth", self.test_5_monitored_endpoint_without_auth),
            ("Permission enforcement", self.test_6_permission_enforcement),
            ("Cleanup", self.test_7_cleanup)
        ]
        
        for test_name, test_func in tests:
            try:
                result = test_func()
                test_results.append((test_name, result))
                if not result:
                    print(f"⚠️  Test '{test_name}' failed, continuing...")
            except Exception as e:
                print(f"💥 Test '{test_name}' crashed: {e}")
                test_results.append((test_name, False))
        
        # Print summary
        print("\n📊 TEST SUMMARY")
        print("=" * 50)
        passed = 0
        total = len(test_results)
        
        for test_name, result in test_results:
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{status} {test_name}")
            if result:
                passed += 1
        
        print("=" * 50)
        print(f"Results: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 All tests passed! Child monitored role functionality is working correctly.")
        else:
            print("⚠️  Some tests failed. Please review the results above.")
        
        return test_results

def save_test_report(test_results):
    """Save test results to iteration_12.json."""
    report = {
        "timestamp": datetime.now().isoformat(),
        "test_suite": "Child Monitored Role and Monitored Account Mode",
        "base_url": "https://file-persistence-fix-1.preview.emergentagent.com",
        "tests": {},
        "summary": {
            "total": len(test_results),
            "passed": sum(1 for _, result in test_results if result),
            "failed": sum(1 for _, result in test_results if not result)
        }
    }
    
    for test_name, result in test_results:
        report["tests"][test_name.lower().replace(" ", "_")] = {
            "passed": result,
            "timestamp": datetime.now().isoformat()
        }
    
    try:
        with open("/app/test_reports/iteration_12.json", "w") as f:
            json.dump(report, f, indent=2)
        print(f"\n📝 Test report saved to /app/test_reports/iteration_12.json")
    except Exception as e:
        print(f"❌ Failed to save test report: {e}")

if __name__ == "__main__":
    tester = MyMergentChildMonitoredTester()
    test_results = tester.run_all_tests()
    save_test_report(test_results)