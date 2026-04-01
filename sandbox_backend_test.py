#!/usr/bin/env python3
"""
Versioned Self-Modification Sandbox Backend Testing for MyMergent
Testing sandbox feature endpoints at https://prompt-grounding.preview.emergentagent.com

Test Scenarios:
1. Get source project (GET /api/projects with Bearer token)
2. Create sandbox (POST /api/projects/:id/sandbox)
3. Verify sandbox files cloned (GET /api/projects/:sandboxId/files)
4. Verify sandbox appears in project list (GET /api/projects)
5. Sandbox isolation — Create a chat in sandbox, verify it doesn't affect source
6. Auth enforcement (POST /api/projects/:id/sandbox without auth → 401)
7. Cleanup (DELETE /api/projects/:sandboxId)
"""

import requests
import json
import sys
from datetime import datetime

class SandboxBackendTester:
    def __init__(self):
        self.base_url = "https://prompt-grounding.preview.emergentagent.com/api"
        self.supabase_url = "https://cawmmqakaxbznbelcrwd.supabase.co"
        self.supabase_key = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
        self.test_email = "REDACTED_LEAKED_USER"
        self.test_password = "REDACTED_LEAKED_PASSWORD"
        self.auth_token = None
        self.source_project_id = None
        self.sandbox_project_id = None
        self.test_chat_id = None
        self.results = {
            "timestamp": datetime.utcnow().isoformat(),
            "test_suite": "Versioned Self-Modification Sandbox Feature",
            "base_url": self.base_url,
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
    
    def test_get_source_project(self):
        """Test getting source project - Find a non-sandbox project"""
        print("\n📋 Testing GET /api/projects to find source project...")
        
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
                        details = f"Found {len(non_sandbox_projects)} non-sandbox projects. Selected project ID: {self.source_project_id}"
                        self.log_test("get_source_project", True, details, {
                            "source_project_id": self.source_project_id,
                            "project_name": non_sandbox_projects[0].get("name", "Unknown"),
                            "total_projects": len(data),
                            "non_sandbox_projects": len(non_sandbox_projects)
                        })
                    else:
                        self.log_test("get_source_project", False, f"No non-sandbox projects found among {len(data)} projects", data)
                else:
                    self.log_test("get_source_project", False, f"Expected non-empty array, got {len(data) if isinstance(data, list) else type(data)}")
            else:
                self.log_test("get_source_project", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("get_source_project", False, f"Exception: {e}")
    
    def test_create_sandbox(self):
        """Test creating sandbox from source project"""
        print("\n🏗️ Testing POST /api/projects/:id/sandbox to create sandbox...")
        
        if not self.source_project_id:
            self.log_test("create_sandbox", False, "No source project ID available")
            return
        
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
                
                # Validate response structure
                if "project" in data and "initialChat" in data:
                    project = data["project"]
                    initial_chat = data["initialChat"]
                    
                    # Validate project properties
                    validation_results = []
                    
                    # Check name ends with [sandbox]
                    if project.get("name", "").endswith("[sandbox]"):
                        validation_results.append("✅ Name ends with '[sandbox]'")
                    else:
                        validation_results.append(f"❌ Name should end with '[sandbox]', got: {project.get('name')}")
                    
                    # Check settings
                    settings = project.get("settings", {})
                    if settings.get("is_sandbox") is True:
                        validation_results.append("✅ is_sandbox is true")
                    else:
                        validation_results.append(f"❌ is_sandbox should be true, got: {settings.get('is_sandbox')}")
                    
                    if settings.get("sandbox_source_id") == self.source_project_id:
                        validation_results.append("✅ sandbox_source_id matches source project ID")
                    else:
                        validation_results.append(f"❌ sandbox_source_id should be {self.source_project_id}, got: {settings.get('sandbox_source_id')}")
                    
                    if settings.get("sandbox_status") == "active":
                        validation_results.append("✅ sandbox_status is 'active'")
                    else:
                        validation_results.append(f"❌ sandbox_status should be 'active', got: {settings.get('sandbox_status')}")
                    
                    if settings.get("sandbox_created_by") == self.test_email:
                        validation_results.append("✅ sandbox_created_by matches test email")
                    else:
                        validation_results.append(f"❌ sandbox_created_by should be {self.test_email}, got: {settings.get('sandbox_created_by')}")
                    
                    # Check initial chat
                    if initial_chat.get("title") == "Sandbox Chat":
                        validation_results.append("✅ initialChat title is 'Sandbox Chat'")
                    else:
                        validation_results.append(f"❌ initialChat title should be 'Sandbox Chat', got: {initial_chat.get('title')}")
                    
                    # Store sandbox ID for later tests
                    self.sandbox_project_id = project.get("id")
                    
                    # Determine overall success
                    failed_validations = [v for v in validation_results if v.startswith("❌")]
                    success = len(failed_validations) == 0
                    
                    details = f"Sandbox created with ID: {self.sandbox_project_id}. Validation results: {'; '.join(validation_results)}"
                    self.log_test("create_sandbox", success, details, data)
                    
                else:
                    self.log_test("create_sandbox", False, f"Expected 'project' and 'initialChat' in response, got keys: {data.keys()}", data)
            else:
                self.log_test("create_sandbox", False, f"Expected 201 Created, got HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("create_sandbox", False, f"Exception: {e}")
    
    def test_verify_sandbox_files_cloned(self):
        """Test that sandbox has same files as source project"""
        print("\n📁 Testing GET /api/projects/:sandboxId/files to verify files cloned...")
        
        if not self.sandbox_project_id or not self.source_project_id:
            self.log_test("verify_sandbox_files_cloned", False, "Missing sandbox or source project ID")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            # Get source files
            source_response = requests.get(
                f"{self.base_url}/projects/{self.source_project_id}/files", 
                headers=headers, 
                timeout=10
            )
            
            # Get sandbox files
            sandbox_response = requests.get(
                f"{self.base_url}/projects/{self.sandbox_project_id}/files", 
                headers=headers, 
                timeout=10
            )
            
            if source_response.status_code == 200 and sandbox_response.status_code == 200:
                source_files = source_response.json()
                sandbox_files = sandbox_response.json()
                
                # Compare file counts
                if len(source_files) == len(sandbox_files):
                    details = f"File count matches: source has {len(source_files)} files, sandbox has {len(sandbox_files)} files"
                    
                    if len(source_files) > 0:
                        # Compare file paths (basic verification)
                        source_paths = set(f.get("path", "") for f in source_files)
                        sandbox_paths = set(f.get("path", "") for f in sandbox_files)
                        
                        if source_paths == sandbox_paths:
                            details += ". File paths match between source and sandbox"
                            success = True
                        else:
                            missing_in_sandbox = source_paths - sandbox_paths
                            extra_in_sandbox = sandbox_paths - source_paths
                            details += f". File paths differ: missing in sandbox: {missing_in_sandbox}, extra in sandbox: {extra_in_sandbox}"
                            success = False
                    else:
                        details += ". Both projects have 0 files (valid scenario)"
                        success = True
                    
                    self.log_test("verify_sandbox_files_cloned", success, details, {
                        "source_file_count": len(source_files),
                        "sandbox_file_count": len(sandbox_files)
                    })
                else:
                    details = f"File count mismatch: source has {len(source_files)} files, sandbox has {len(sandbox_files)} files"
                    self.log_test("verify_sandbox_files_cloned", False, details, {
                        "source_files": source_files,
                        "sandbox_files": sandbox_files
                    })
            else:
                error_details = []
                if source_response.status_code != 200:
                    error_details.append(f"source files: HTTP {source_response.status_code}")
                if sandbox_response.status_code != 200:
                    error_details.append(f"sandbox files: HTTP {sandbox_response.status_code}")
                
                self.log_test("verify_sandbox_files_cloned", False, f"Failed to get files: {', '.join(error_details)}")
                
        except Exception as e:
            self.log_test("verify_sandbox_files_cloned", False, f"Exception: {e}")
    
    def test_sandbox_appears_in_project_list(self):
        """Test that sandbox appears in project list with is_sandbox=true"""
        print("\n📋 Testing that sandbox appears in GET /api/projects list...")
        
        if not self.sandbox_project_id:
            self.log_test("sandbox_appears_in_project_list", False, "No sandbox project ID available")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = requests.get(f"{self.base_url}/projects", headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                
                # Find the sandbox project in the list
                sandbox_in_list = None
                for project in data:
                    if project.get("id") == self.sandbox_project_id:
                        sandbox_in_list = project
                        break
                
                if sandbox_in_list:
                    # Verify it has is_sandbox=true
                    if sandbox_in_list.get("settings", {}).get("is_sandbox") is True:
                        details = f"Sandbox project found in list with is_sandbox=true. Name: {sandbox_in_list.get('name', 'Unknown')}"
                        self.log_test("sandbox_appears_in_project_list", True, details, sandbox_in_list)
                    else:
                        details = f"Sandbox project found but is_sandbox is not true: {sandbox_in_list.get('settings', {}).get('is_sandbox')}"
                        self.log_test("sandbox_appears_in_project_list", False, details, sandbox_in_list)
                else:
                    details = f"Sandbox project ID {self.sandbox_project_id} not found in project list of {len(data)} projects"
                    self.log_test("sandbox_appears_in_project_list", False, details, data)
            else:
                self.log_test("sandbox_appears_in_project_list", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("sandbox_appears_in_project_list", False, f"Exception: {e}")
    
    def test_sandbox_isolation(self):
        """Test sandbox isolation by creating chat in sandbox and verifying it doesn't affect source"""
        print("\n🔒 Testing sandbox isolation with chat creation...")
        
        if not self.sandbox_project_id or not self.source_project_id:
            self.log_test("sandbox_isolation", False, "Missing sandbox or source project ID")
            return
        
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            # Step 1: Get initial chat count for source project
            source_chats_before = requests.get(
                f"{self.base_url}/projects/{self.source_project_id}/chats", 
                headers=headers, 
                timeout=10
            )
            
            if source_chats_before.status_code != 200:
                self.log_test("sandbox_isolation", False, f"Failed to get source chats: HTTP {source_chats_before.status_code}")
                return
            
            initial_source_chat_count = len(source_chats_before.json())
            
            # Step 2: Create a chat in the sandbox
            test_chat_data = {
                "title": "Test Chat in Sandbox"
            }
            
            create_chat_response = requests.post(
                f"{self.base_url}/projects/{self.sandbox_project_id}/chats",
                headers=headers,
                json=test_chat_data,
                timeout=10
            )
            
            if create_chat_response.status_code != 201:
                self.log_test("sandbox_isolation", False, f"Failed to create chat in sandbox: HTTP {create_chat_response.status_code}: {create_chat_response.text}")
                return
            
            created_chat = create_chat_response.json()
            self.test_chat_id = created_chat.get("id")
            
            # Step 3: Verify the chat appears in sandbox
            sandbox_chats = requests.get(
                f"{self.base_url}/projects/{self.sandbox_project_id}/chats", 
                headers=headers, 
                timeout=10
            )
            
            if sandbox_chats.status_code != 200:
                self.log_test("sandbox_isolation", False, f"Failed to get sandbox chats: HTTP {sandbox_chats.status_code}")
                return
            
            sandbox_chat_list = sandbox_chats.json()
            test_chat_in_sandbox = any(
                chat.get("title") == "Test Chat in Sandbox" 
                for chat in sandbox_chat_list
            )
            
            # Step 4: Verify the chat does NOT appear in source
            source_chats_after = requests.get(
                f"{self.base_url}/projects/{self.source_project_id}/chats", 
                headers=headers, 
                timeout=10
            )
            
            if source_chats_after.status_code != 200:
                self.log_test("sandbox_isolation", False, f"Failed to get source chats after: HTTP {source_chats_after.status_code}")
                return
            
            final_source_chat_list = source_chats_after.json()
            final_source_chat_count = len(final_source_chat_list)
            test_chat_in_source = any(
                chat.get("title") == "Test Chat in Sandbox" 
                for chat in final_source_chat_list
            )
            
            # Validation
            isolation_checks = []
            
            if test_chat_in_sandbox:
                isolation_checks.append("✅ Test chat appears in sandbox")
            else:
                isolation_checks.append("❌ Test chat missing from sandbox")
            
            if not test_chat_in_source:
                isolation_checks.append("✅ Test chat does NOT appear in source (isolation working)")
            else:
                isolation_checks.append("❌ Test chat appears in source (isolation FAILED)")
            
            if initial_source_chat_count == final_source_chat_count:
                isolation_checks.append("✅ Source chat count unchanged")
            else:
                isolation_checks.append(f"❌ Source chat count changed: {initial_source_chat_count} → {final_source_chat_count}")
            
            # Overall success
            failed_checks = [check for check in isolation_checks if check.startswith("❌")]
            success = len(failed_checks) == 0
            
            details = f"Isolation test results: {'; '.join(isolation_checks)}"
            
            self.log_test("sandbox_isolation", success, details, {
                "sandbox_chat_count": len(sandbox_chat_list),
                "source_chat_count_before": initial_source_chat_count,
                "source_chat_count_after": final_source_chat_count,
                "test_chat_id": self.test_chat_id
            })
            
        except Exception as e:
            self.log_test("sandbox_isolation", False, f"Exception: {e}")
    
    def test_auth_enforcement(self):
        """Test that creating sandbox without auth returns 401"""
        print("\n🚫 Testing auth enforcement for POST /api/projects/:id/sandbox without auth...")
        
        if not self.source_project_id:
            self.log_test("auth_enforcement", False, "No source project ID available")
            return
        
        try:
            # Make request without Authorization header
            response = requests.post(
                f"{self.base_url}/projects/{self.source_project_id}/sandbox",
                headers={"Content-Type": "application/json"},
                timeout=10
            )
            
            if response.status_code == 401:
                self.log_test("auth_enforcement", True, "Correctly returned 401 Unauthorized without auth token")
            else:
                self.log_test("auth_enforcement", False, f"Expected 401, got HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("auth_enforcement", False, f"Exception: {e}")
    
    def test_cleanup(self):
        """Test cleanup by deleting the sandbox project"""
        print("\n🗑️ Testing cleanup with DELETE /api/projects/:sandboxId...")
        
        if not self.sandbox_project_id:
            self.log_test("cleanup", False, "No sandbox project ID available for cleanup")
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
                    self.log_test("cleanup", True, details)
                else:
                    details = f"Deletion returned {response.status_code} but project still accessible: HTTP {verify_response.status_code}"
                    self.log_test("cleanup", False, details)
            else:
                self.log_test("cleanup", False, f"Expected 200/204, got HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("cleanup", False, f"Exception: {e}")
    
    def save_results(self):
        """Save test results to iteration_14.json"""
        try:
            with open("/app/test_reports/iteration_14.json", "w") as f:
                json.dump(self.results, f, indent=2)
            print(f"\n💾 Test results saved to /app/test_reports/iteration_14.json")
        except Exception as e:
            print(f"\n❌ Failed to save results: {e}")
    
    def run_all_tests(self):
        """Run all sandbox feature test scenarios"""
        print("🚀 Starting Versioned Self-Modification Sandbox Feature Testing")
        print(f"Testing against: {self.base_url}")
        
        # Step 1: Get auth token
        if not self.get_supabase_token():
            print("❌ Cannot proceed without auth token")
            self.save_results()
            return False
        
        # Step 2: Test sequence (order matters)
        self.test_get_source_project()
        self.test_create_sandbox()
        self.test_verify_sandbox_files_cloned()
        self.test_sandbox_appears_in_project_list()
        self.test_sandbox_isolation()
        self.test_auth_enforcement()
        self.test_cleanup()
        
        # Step 3: Save results
        self.save_results()
        
        # Print summary
        print(f"\n📊 Test Summary:")
        print(f"Total tests: {self.results['summary']['total']}")
        print(f"Passed: {self.results['summary']['passed']} ✅")
        print(f"Failed: {self.results['summary']['failed']} ❌")
        
        if self.results['summary']['failed'] == 0:
            print("🎉 All sandbox tests passed!")
            return True
        else:
            print("⚠️  Some tests failed. Check details above.")
            return False

if __name__ == "__main__":
    tester = SandboxBackendTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)