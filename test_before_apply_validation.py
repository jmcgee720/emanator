#!/usr/bin/env python3
"""
Test-before-apply Validation Gate Testing for MyMergent Sandboxes
Testing validation gate endpoints at https://service-js-repair.preview.emergentagent.com

Test Flow (per review request):
SETUP: 
- GET /api/projects to find a non-sandbox project
- POST /api/projects/:id/sandbox to create sandbox
- Use sandbox ID for all subsequent tests

1. **Valid diffs → PASS**: POST /api/projects/:sandboxId/test-before-apply with valid JS + JSON diffs
2. **Invalid JSON → FAIL**: Post with broken JSON file
3. **Unbalanced braces → FAIL**: Post with bad JS
4. **Empty diffs → FAIL**: Post with empty array
5. **Non-sandbox → FAIL**: Post to the original (non-sandbox) project
6. **Auth enforcement**: POST without token → 401
7. **Result persisted**: GET /api/projects/:sandboxId and check settings.last_test_result exists

CLEANUP: DELETE /api/projects/:sandboxId

Save to /app/test_reports/iteration_16.json
"""

import requests
import json
import sys
from datetime import datetime

class TestBeforeApplyTester:
    def __init__(self):
        self.base_url = "https://service-js-repair.preview.emergentagent.com/api"
        self.supabase_url = "https://cawmmqakaxbznbelcrwd.supabase.co"
        self.supabase_key = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
        self.test_email = "testprov@test.com"
        self.test_password = "password123"
        self.auth_token = None
        self.source_project_id = None
        self.sandbox_project_id = None
        self.results = {
            "timestamp": datetime.utcnow().isoformat(),
            "test_suite": "Test-before-apply Validation Gate for MyMergent Sandboxes",
            "base_url": self.base_url,
            "iteration": 16,
            "tests": {},
            "summary": {
                "total": 0,
                "passed": 0,
                "failed": 0
            }
        }
    
    def log_test(self, test_name, passed, details="", response_data=None):
        """Log individual test result"""
        self.results["tests"][test_name] = {
            "passed": passed,
            "details": details,
            "response_data": response_data,
            "timestamp": datetime.utcnow().isoformat()
        }
        self.results["summary"]["total"] += 1
        if passed:
            self.results["summary"]["passed"] += 1
            print(f"✅ {test_name}: PASSED - {details}")
        else:
            self.results["summary"]["failed"] += 1
            print(f"❌ {test_name}: FAILED - {details}")
    
    def get_supabase_token(self):
        """Get Supabase auth token using provided credentials"""
        print("\n🔑 Getting Supabase auth token...")
        
        try:
            response = requests.post(
                f"{self.supabase_url}/auth/v1/token?grant_type=password",
                headers={
                    "Content-Type": "application/json",
                    "apikey": self.supabase_key
                },
                json={
                    "email": self.test_email,
                    "password": self.test_password
                },
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if "access_token" in data:
                    self.auth_token = data["access_token"]
                    print(f"✅ Successfully obtained auth token")
                    return True
                else:
                    print(f"❌ No access_token in response: {data}")
                    return False
            else:
                print(f"❌ Auth failed: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Exception getting auth token: {e}")
            return False
    
    def setup_find_source_project(self):
        """Find a non-sandbox project for testing"""
        print("\n📋 SETUP: Finding non-sandbox project...")
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = requests.get(f"{self.base_url}/projects", headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                
                if isinstance(data, list) and len(data) > 0:
                    # Find non-sandbox projects
                    non_sandbox_projects = [
                        p for p in data 
                        if not p.get("settings", {}).get("is_sandbox", False)
                    ]
                    
                    if non_sandbox_projects:
                        self.source_project_id = non_sandbox_projects[0]["id"]
                        details = f"Found {len(non_sandbox_projects)} non-sandbox projects. Selected: {self.source_project_id} ({non_sandbox_projects[0].get('name', 'Unknown')})"
                        self.log_test("setup_find_source_project", True, details, {
                            "source_project_id": self.source_project_id,
                            "project_name": non_sandbox_projects[0].get("name", "Unknown"),
                            "total_projects": len(data),
                            "non_sandbox_projects": len(non_sandbox_projects)
                        })
                        return True
                    else:
                        self.log_test("setup_find_source_project", False, f"No non-sandbox projects found among {len(data)} projects", data)
                        return False
                else:
                    self.log_test("setup_find_source_project", False, f"Expected non-empty array, got {len(data) if isinstance(data, list) else type(data)}")
                    return False
            else:
                self.log_test("setup_find_source_project", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_test("setup_find_source_project", False, f"Exception: {e}")
            return False
    
    def setup_create_sandbox(self):
        """Create sandbox from source project"""
        print("\n🏗️ SETUP: Creating sandbox from source project...")
        
        if not self.source_project_id:
            self.log_test("setup_create_sandbox", False, "No source project ID available")
            return False
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = requests.post(
                f"{self.base_url}/projects/{self.source_project_id}/sandbox", 
                headers=headers, 
                timeout=15
            )
            
            if response.status_code == 201:
                data = response.json()
                
                if "project" in data and "initialChat" in data:
                    project = data["project"]
                    self.sandbox_project_id = project.get("id")
                    
                    # Validate sandbox properties
                    settings = project.get("settings", {})
                    is_valid_sandbox = (
                        project.get("name", "").endswith("[sandbox]") and
                        settings.get("is_sandbox") is True and
                        settings.get("sandbox_source_id") == self.source_project_id and
                        settings.get("sandbox_status") == "active" and
                        settings.get("sandbox_created_by") == self.test_email
                    )
                    
                    details = f"Sandbox created: {self.sandbox_project_id} (name: {project.get('name')}, valid: {is_valid_sandbox})"
                    self.log_test("setup_create_sandbox", is_valid_sandbox, details, data)
                    return is_valid_sandbox
                    
                else:
                    self.log_test("setup_create_sandbox", False, f"Expected 'project' and 'initialChat' in response, got keys: {data.keys()}", data)
                    return False
            else:
                self.log_test("setup_create_sandbox", False, f"Expected 201 Created, got HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_test("setup_create_sandbox", False, f"Exception: {e}")
            return False
    
    def test_valid_diffs_pass(self):
        """Test 1: Valid diffs → PASS - valid JS + JSON diffs"""
        print("\n✨ TEST 1: Valid diffs should PASS...")
        
        if not self.sandbox_project_id:
            self.log_test("test_valid_diffs_pass", False, "No sandbox project ID available")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            # Valid JS and JSON diffs as specified in review request
            payload = {
                "diffs": [
                    {
                        "path": "app.jsx",
                        "content": "export default function App() { return <div>OK</div> }"
                    },
                    {
                        "path": "data.json", 
                        "content": '{"key":1}'
                    }
                ]
            }
            
            response = requests.post(
                f"{self.base_url}/projects/{self.sandbox_project_id}/test-before-apply",
                headers=headers,
                json=payload,
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check expected response structure
                passed = data.get("passed", False)
                files_tested = data.get("files_tested", 0)
                errors = data.get("errors", [])
                
                expected_pass = passed is True
                expected_files = files_tested == 2
                expected_no_errors = len(errors) == 0
                
                success = expected_pass and expected_files and expected_no_errors
                details = f"passed={passed}, files_tested={files_tested}, errors={len(errors)} items"
                
                self.log_test("test_valid_diffs_pass", success, details, data)
            else:
                self.log_test("test_valid_diffs_pass", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("test_valid_diffs_pass", False, f"Exception: {e}")
    
    def test_invalid_json_fail(self):
        """Test 2: Invalid JSON → FAIL - broken JSON file"""
        print("\n🚫 TEST 2: Invalid JSON should FAIL...")
        
        if not self.sandbox_project_id:
            self.log_test("test_invalid_json_fail", False, "No sandbox project ID available")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            # Broken JSON as specified in review request
            payload = {
                "diffs": [
                    {
                        "path": "x.json",
                        "content": "{broken"
                    }
                ]
            }
            
            response = requests.post(
                f"{self.base_url}/projects/{self.sandbox_project_id}/test-before-apply",
                headers=headers,
                json=payload,
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Should fail with JSON error
                passed = data.get("passed", True)  # expect False
                errors = data.get("errors", [])
                
                has_json_error = any("Invalid JSON" in str(error) for error in errors)
                
                success = not passed and has_json_error
                details = f"passed={passed}, has_json_error={has_json_error}, errors={errors}"
                
                self.log_test("test_invalid_json_fail", success, details, data)
            else:
                self.log_test("test_invalid_json_fail", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("test_invalid_json_fail", False, f"Exception: {e}")
    
    def test_unbalanced_braces_fail(self):
        """Test 3: Unbalanced braces → FAIL - bad JS syntax"""
        print("\n🚫 TEST 3: Unbalanced braces should FAIL...")
        
        if not self.sandbox_project_id:
            self.log_test("test_unbalanced_braces_fail", False, "No sandbox project ID available")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            # Bad JS with unbalanced braces as specified in review request
            payload = {
                "diffs": [
                    {
                        "path": "y.js",
                        "content": "function a() {"
                    }
                ]
            }
            
            response = requests.post(
                f"{self.base_url}/projects/{self.sandbox_project_id}/test-before-apply",
                headers=headers,
                json=payload,
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Should fail with brace error
                passed = data.get("passed", True)  # expect False
                errors = data.get("errors", [])
                
                has_brace_error = any("Unbalanced braces" in str(error) for error in errors)
                
                success = not passed and has_brace_error
                details = f"passed={passed}, has_brace_error={has_brace_error}, errors={errors}"
                
                self.log_test("test_unbalanced_braces_fail", success, details, data)
            else:
                self.log_test("test_unbalanced_braces_fail", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("test_unbalanced_braces_fail", False, f"Exception: {e}")
    
    def test_empty_diffs_fail(self):
        """Test 4: Empty diffs → FAIL - empty array"""
        print("\n🚫 TEST 4: Empty diffs should FAIL...")
        
        if not self.sandbox_project_id:
            self.log_test("test_empty_diffs_fail", False, "No sandbox project ID available")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            # Empty diffs array as specified in review request
            payload = {
                "diffs": []
            }
            
            response = requests.post(
                f"{self.base_url}/projects/{self.sandbox_project_id}/test-before-apply",
                headers=headers,
                json=payload,
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Should fail with "no pending diffs" error
                passed = data.get("passed", True)  # expect False
                errors = data.get("errors", [])
                
                has_no_diffs_error = any("No pending diffs" in str(error) for error in errors)
                
                success = not passed and has_no_diffs_error
                details = f"passed={passed}, has_no_diffs_error={has_no_diffs_error}, errors={errors}"
                
                self.log_test("test_empty_diffs_fail", success, details, data)
            else:
                self.log_test("test_empty_diffs_fail", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("test_empty_diffs_fail", False, f"Exception: {e}")
    
    def test_non_sandbox_fail(self):
        """Test 5: Non-sandbox → FAIL - post to original (non-sandbox) project"""
        print("\n🚫 TEST 5: Non-sandbox project should FAIL...")
        
        if not self.source_project_id:
            self.log_test("test_non_sandbox_fail", False, "No source project ID available")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            # Try to test against non-sandbox project
            payload = {
                "diffs": [
                    {
                        "path": "test.js",
                        "content": "console.log('test')"
                    }
                ]
            }
            
            response = requests.post(
                f"{self.base_url}/projects/{self.source_project_id}/test-before-apply",
                headers=headers,
                json=payload,
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Should fail with "not a sandbox project" error
                passed = data.get("passed", True)  # expect False
                errors = data.get("errors", [])
                
                has_sandbox_error = any("Not a sandbox project" in str(error) for error in errors)
                
                success = not passed and has_sandbox_error
                details = f"passed={passed}, has_sandbox_error={has_sandbox_error}, errors={errors}"
                
                self.log_test("test_non_sandbox_fail", success, details, data)
            else:
                self.log_test("test_non_sandbox_fail", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("test_non_sandbox_fail", False, f"Exception: {e}")
    
    def test_auth_enforcement(self):
        """Test 6: Auth enforcement - POST without token → 401"""
        print("\n🔒 TEST 6: Auth enforcement - no token should return 401...")
        
        if not self.sandbox_project_id:
            self.log_test("test_auth_enforcement", False, "No sandbox project ID available")
            return
        
        try:
            # Make request without Authorization header
            headers = {"Content-Type": "application/json"}
            
            payload = {
                "diffs": [
                    {
                        "path": "test.js",
                        "content": "console.log('test')"
                    }
                ]
            }
            
            response = requests.post(
                f"{self.base_url}/projects/{self.sandbox_project_id}/test-before-apply",
                headers=headers,
                json=payload,
                timeout=10
            )
            
            if response.status_code == 401:
                self.log_test("test_auth_enforcement", True, "Correctly returned 401 Unauthorized without auth token")
            else:
                self.log_test("test_auth_enforcement", False, f"Expected 401, got HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("test_auth_enforcement", False, f"Exception: {e}")
    
    def test_result_persisted(self):
        """Test 7: Result persisted - check settings.last_test_result exists"""
        print("\n💾 TEST 7: Checking if test result is persisted...")
        
        if not self.sandbox_project_id:
            self.log_test("test_result_persisted", False, "No sandbox project ID available")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = requests.get(
                f"{self.base_url}/projects/{self.sandbox_project_id}",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                
                settings = data.get("settings", {})
                last_test_result = settings.get("last_test_result")
                
                if last_test_result:
                    # Check structure of persisted result
                    has_passed_field = "passed" in last_test_result
                    has_timestamp = "timestamp" in last_test_result
                    has_files_tested = "files_tested" in last_test_result
                    
                    success = has_passed_field and has_timestamp and has_files_tested
                    details = f"last_test_result exists with passed={has_passed_field}, timestamp={has_timestamp}, files_tested={has_files_tested}"
                    
                    self.log_test("test_result_persisted", success, details, {
                        "last_test_result": last_test_result,
                        "settings_keys": list(settings.keys())
                    })
                else:
                    self.log_test("test_result_persisted", False, "No last_test_result found in project settings", {
                        "settings": settings
                    })
            else:
                self.log_test("test_result_persisted", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("test_result_persisted", False, f"Exception: {e}")
    
    def cleanup_delete_sandbox(self):
        """CLEANUP: Delete the sandbox project"""
        print("\n🗑️ CLEANUP: Deleting sandbox project...")
        
        if not self.sandbox_project_id:
            self.log_test("cleanup_delete_sandbox", False, "No sandbox project ID available for cleanup")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            # Delete the sandbox project
            response = requests.delete(
                f"{self.base_url}/projects/{self.sandbox_project_id}",
                headers=headers,
                timeout=10
            )
            
            if response.status_code in [200, 204]:
                # Verify deletion by trying to get the project
                verify_response = requests.get(
                    f"{self.base_url}/projects/{self.sandbox_project_id}",
                    headers=headers,
                    timeout=10
                )
                
                if verify_response.status_code == 404:
                    details = f"Sandbox project {self.sandbox_project_id} successfully deleted and verified as removed"
                    self.log_test("cleanup_delete_sandbox", True, details)
                else:
                    details = f"Deletion returned {response.status_code} but project still accessible: HTTP {verify_response.status_code}"
                    self.log_test("cleanup_delete_sandbox", False, details)
            else:
                self.log_test("cleanup_delete_sandbox", False, f"Expected 200/204, got HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("cleanup_delete_sandbox", False, f"Exception: {e}")
    
    def save_results(self):
        """Save test results to iteration_16.json"""
        try:
            with open("/app/test_reports/iteration_16.json", "w") as f:
                json.dump(self.results, f, indent=2)
            print(f"\n💾 Test results saved to /app/test_reports/iteration_16.json")
        except Exception as e:
            print(f"\n❌ Failed to save results: {e}")
    
    def run_all_tests(self):
        """Run the complete test suite following the review request flow"""
        print("🚀 Starting Test-before-apply Validation Gate Testing")
        print(f"Testing against: {self.base_url}")
        print("Following review request test flow...")
        
        # Step 1: Get auth token
        if not self.get_supabase_token():
            print("❌ Cannot proceed without auth token")
            self.save_results()
            return False
        
        # SETUP Phase
        if not self.setup_find_source_project():
            print("❌ Cannot proceed without source project")
            self.save_results()
            return False
            
        if not self.setup_create_sandbox():
            print("❌ Cannot proceed without sandbox")
            self.save_results()
            return False
        
        # TEST Phase - All 7 tests as specified in review request
        self.test_valid_diffs_pass()           # Test 1
        self.test_invalid_json_fail()          # Test 2
        self.test_unbalanced_braces_fail()     # Test 3
        self.test_empty_diffs_fail()           # Test 4
        self.test_non_sandbox_fail()           # Test 5
        self.test_auth_enforcement()           # Test 6
        self.test_result_persisted()           # Test 7
        
        # CLEANUP Phase
        self.cleanup_delete_sandbox()
        
        # Save results to iteration_16.json
        self.save_results()
        
        # Print summary
        print(f"\n📊 Test Summary:")
        print(f"Total tests: {self.results['summary']['total']}")
        print(f"Passed: {self.results['summary']['passed']} ✅")
        print(f"Failed: {self.results['summary']['failed']} ❌")
        
        if self.results['summary']['failed'] == 0:
            print("🎉 All test-before-apply validation gate tests passed!")
            return True
        else:
            print("⚠️  Some tests failed. Check details above.")
            return False

if __name__ == "__main__":
    tester = TestBeforeApplyTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)