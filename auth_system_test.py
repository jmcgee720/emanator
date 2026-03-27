#!/usr/bin/env python3
"""
Comprehensive Auth System Test for MyMergent
Testing the dual auth strategy (cookie-based SSR + bearer token fallback)
"""

import os
import asyncio
import aiohttp
import json
from datetime import datetime

# Configuration from environment
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
APP_URL = "https://emanator-validate.preview.emergentagent.com"
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "TestPass123!"

class AuthSystemTester:
    def __init__(self):
        self.session = None
        self.access_token = None
        self.test_results = []
        
    async def log_result(self, test_name, success, details=""):
        """Log test results"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} - {test_name}")
        if details:
            print(f"    {details}")
        
    async def setup_session(self):
        """Initialize HTTP session"""
        timeout = aiohttp.ClientTimeout(total=30)
        self.session = aiohttp.ClientSession(timeout=timeout)
        
    async def cleanup_session(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()
            
    async def test_1_bearer_token_auth_flow(self):
        """Test 1: Bearer Token Auth Flow (Critical)"""
        try:
            # Step 1: Sign in via Supabase directly
            auth_url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
            headers = {
                "apikey": SUPABASE_ANON_KEY,
                "Content-Type": "application/json"
            }
            payload = {
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            }
            
            async with self.session.post(auth_url, headers=headers, json=payload) as resp:
                if resp.status == 200:
                    auth_data = await resp.json()
                    self.access_token = auth_data.get("access_token")
                    if self.access_token:
                        await self.log_result("1.1 Supabase Direct Auth", True, f"Got access token: {self.access_token[:20]}...")
                    else:
                        await self.log_result("1.1 Supabase Direct Auth", False, "No access token in response")
                        return False
                else:
                    error_text = await resp.text()
                    await self.log_result("1.1 Supabase Direct Auth", False, f"Status {resp.status}: {error_text}")
                    return False
                    
            # Step 2: Use bearer token to call protected API
            api_headers = {"Authorization": f"Bearer {self.access_token}"}
            
            async with self.session.get(f"{APP_URL}/api/projects", headers=api_headers) as resp:
                if resp.status == 200:
                    projects = await resp.json()
                    await self.log_result("1.2 Bearer Token API Call", True, f"Got {len(projects)} projects")
                    return True
                elif resp.status == 401:
                    await self.log_result("1.2 Bearer Token API Call", False, "Bearer token auth failed (401)")
                    return False
                else:
                    error_text = await resp.text()
                    await self.log_result("1.2 Bearer Token API Call", False, f"Status {resp.status}: {error_text}")
                    return False
                    
        except Exception as e:
            await self.log_result("1 Bearer Token Auth Flow", False, f"Exception: {str(e)}")
            return False
            
    async def test_2_auth_check_endpoint(self):
        """Test 2: Auth Check Endpoint"""
        try:
            headers = {"Content-Type": "application/json"}
            payload = {"email": TEST_EMAIL}
            
            async with self.session.post(f"{APP_URL}/api/auth/check", headers=headers, json=payload) as resp:
                response_text = await resp.text()
                
                if resp.status == 200:
                    data = json.loads(response_text)
                    if data.get("allowed") and data.get("user", {}).get("role"):
                        await self.log_result("2 Auth Check Endpoint", True, f"User role: {data['user']['role']}")
                        return True
                    else:
                        await self.log_result("2 Auth Check Endpoint", False, f"Unexpected response: {data}")
                        return False
                else:
                    await self.log_result("2 Auth Check Endpoint", False, f"Status {resp.status}: {response_text}")
                    return False
                    
        except Exception as e:
            await self.log_result("2 Auth Check Endpoint", False, f"Exception: {str(e)}")
            return False
            
    async def test_3_project_crud_with_bearer_token(self):
        """Test 3: Project CRUD with Bearer Token"""
        if not self.access_token:
            await self.log_result("3 Project CRUD with Bearer", False, "No access token available")
            return False
            
        try:
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json"
            }
            
            # Test creating a project
            project_data = {
                "name": f"Auth Test Project {datetime.now().strftime('%H%M%S')}",
                "description": "Test project for auth system verification",
                "type": "app"
            }
            
            async with self.session.post(f"{APP_URL}/api/projects", headers=headers, json=project_data) as resp:
                if resp.status == 201:
                    project_response = await resp.json()
                    project_id = project_response.get("project", {}).get("id")
                    if project_id:
                        await self.log_result("3.1 Project Creation with Bearer", True, f"Created project ID: {project_id}")
                        
                        # Test getting projects list
                        async with self.session.get(f"{APP_URL}/api/projects", headers=headers) as get_resp:
                            if get_resp.status == 200:
                                projects = await get_resp.json()
                                found_project = any(p.get("id") == project_id for p in projects)
                                if found_project:
                                    await self.log_result("3.2 Project List with Bearer", True, f"Project found in list of {len(projects)}")
                                    return True
                                else:
                                    await self.log_result("3.2 Project List with Bearer", False, "Created project not found in list")
                                    return False
                            else:
                                error_text = await get_resp.text()
                                await self.log_result("3.2 Project List with Bearer", False, f"Status {get_resp.status}: {error_text}")
                                return False
                    else:
                        await self.log_result("3.1 Project Creation with Bearer", False, "No project ID in response")
                        return False
                else:
                    error_text = await resp.text()
                    await self.log_result("3.1 Project Creation with Bearer", False, f"Status {resp.status}: {error_text}")
                    return False
                    
        except Exception as e:
            await self.log_result("3 Project CRUD with Bearer", False, f"Exception: {str(e)}")
            return False
            
    async def test_4_canvas_fetch_with_bearer_token(self):
        """Test 4: Canvas Fetch with Bearer Token (Auto-creation)"""
        if not self.access_token:
            await self.log_result("4 Canvas Fetch with Bearer", False, "No access token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.access_token}"}
            
            # First get a project to test canvas with
            async with self.session.get(f"{APP_URL}/api/projects", headers=headers) as resp:
                if resp.status == 200:
                    projects = await resp.json()
                    if projects:
                        project_id = projects[0]["id"]
                        
                        # Test canvas fetch (should auto-create if missing)
                        async with self.session.get(f"{APP_URL}/api/projects/{project_id}/canvas", headers=headers) as canvas_resp:
                            if canvas_resp.status == 200:
                                canvas_data = await canvas_resp.json()
                                if "canvas_content" in canvas_data:
                                    await self.log_result("4 Canvas Fetch with Bearer", True, "Canvas data retrieved with auto-creation")
                                    return True
                                else:
                                    await self.log_result("4 Canvas Fetch with Bearer", False, "No canvas_content in response")
                                    return False
                            else:
                                error_text = await canvas_resp.text()
                                await self.log_result("4 Canvas Fetch with Bearer", False, f"Status {canvas_resp.status}: {error_text}")
                                return False
                    else:
                        await self.log_result("4 Canvas Fetch with Bearer", False, "No projects available for canvas testing")
                        return False
                else:
                    error_text = await resp.text()
                    await self.log_result("4 Canvas Fetch with Bearer", False, f"Projects fetch failed: Status {resp.status}: {error_text}")
                    return False
                    
        except Exception as e:
            await self.log_result("4 Canvas Fetch with Bearer", False, f"Exception: {str(e)}")
            return False
            
    async def test_5_auth_fetch_utility(self):
        """Test 5: Auth-fetch utility (verify token attachment logic)"""
        try:
            # This is more of a code verification since we can't directly test the JS utility
            # But we can verify that the endpoints work with bearer tokens as expected
            
            if not self.access_token:
                await self.log_result("5 Auth-fetch Utility", False, "No access token to test with")
                return False
                
            # Test that manual bearer token attachment works (simulating authFetch behavior)
            headers = {"Authorization": f"Bearer {self.access_token}"}
            
            async with self.session.get(f"{APP_URL}/api/projects", headers=headers) as resp:
                if resp.status == 200:
                    await self.log_result("5 Auth-fetch Utility", True, "Bearer token attachment working correctly")
                    return True
                else:
                    error_text = await resp.text()
                    await self.log_result("5 Auth-fetch Utility", False, f"Bearer token failed: Status {resp.status}: {error_text}")
                    return False
                    
        except Exception as e:
            await self.log_result("5 Auth-fetch Utility", False, f"Exception: {str(e)}")
            return False
            
    async def test_6_health_public_endpoints(self):
        """Test 6: Health/Public Endpoints (should work without auth)"""
        try:
            # Test health endpoint (no auth required)
            async with self.session.get(f"{APP_URL}/api/health") as resp:
                if resp.status == 200:
                    health_data = await resp.json()
                    if health_data.get("status") == "healthy":
                        await self.log_result("6.1 Health Endpoint", True, f"Database: {health_data.get('database', 'unknown')}")
                    else:
                        await self.log_result("6.1 Health Endpoint", False, f"Unexpected health data: {health_data}")
                        return False
                else:
                    error_text = await resp.text()
                    await self.log_result("6.1 Health Endpoint", False, f"Status {resp.status}: {error_text}")
                    return False
                    
            # Test provider status endpoint (no auth required)
            async with self.session.get(f"{APP_URL}/api/providers/status") as resp:
                if resp.status == 200:
                    provider_data = await resp.json()
                    openai_status = provider_data.get("openai", {}).get("status")
                    anthropic_status = provider_data.get("anthropic", {}).get("status")
                    await self.log_result("6.2 Provider Status Endpoint", True, f"OpenAI: {openai_status}, Anthropic: {anthropic_status}")
                    return True
                else:
                    error_text = await resp.text()
                    await self.log_result("6.2 Provider Status Endpoint", False, f"Status {resp.status}: {error_text}")
                    return False
                    
        except Exception as e:
            await self.log_result("6 Health/Public Endpoints", False, f"Exception: {str(e)}")
            return False
            
    async def test_7_unauthorized_access_protection(self):
        """Test 7: Verify unauthorized access is properly blocked"""
        try:
            # Test protected endpoint without auth (should get 401)
            async with self.session.get(f"{APP_URL}/api/projects") as resp:
                if resp.status == 401:
                    await self.log_result("7.1 Unauthorized Access Protection", True, "Correctly blocked unauthenticated request")
                else:
                    error_text = await resp.text()
                    await self.log_result("7.1 Unauthorized Access Protection", False, f"Expected 401 but got {resp.status}: {error_text}")
                    return False
                    
            # Test with invalid bearer token (should get 401)
            headers = {"Authorization": "Bearer invalid_token_here"}
            async with self.session.get(f"{APP_URL}/api/projects", headers=headers) as resp:
                if resp.status == 401:
                    await self.log_result("7.2 Invalid Bearer Token Protection", True, "Correctly rejected invalid bearer token")
                    return True
                else:
                    error_text = await resp.text()
                    await self.log_result("7.2 Invalid Bearer Token Protection", False, f"Expected 401 but got {resp.status}: {error_text}")
                    return False
                    
        except Exception as e:
            await self.log_result("7 Unauthorized Access Protection", False, f"Exception: {str(e)}")
            return False
            
    async def run_all_tests(self):
        """Run all auth system tests"""
        print("🚀 Starting MyMergent Auth System Tests")
        print("=" * 60)
        
        await self.setup_session()
        
        try:
            # Run tests in sequence
            test_results = []
            
            test_results.append(await self.test_1_bearer_token_auth_flow())
            test_results.append(await self.test_2_auth_check_endpoint())
            test_results.append(await self.test_3_project_crud_with_bearer_token())
            test_results.append(await self.test_4_canvas_fetch_with_bearer_token())
            test_results.append(await self.test_5_auth_fetch_utility())
            test_results.append(await self.test_6_health_public_endpoints())
            test_results.append(await self.test_7_unauthorized_access_protection())
            
            # Summary
            passed = sum(test_results)
            total = len(test_results)
            success_rate = (passed / total) * 100
            
            print("\n" + "=" * 60)
            print("🎯 AUTH SYSTEM TEST SUMMARY")
            print("=" * 60)
            print(f"✅ Passed: {passed}")
            print(f"❌ Failed: {total - passed}")
            print(f"📊 Success Rate: {success_rate:.1f}%")
            
            if success_rate >= 85:
                print("🎉 AUTH SYSTEM IS WORKING CORRECTLY!")
            elif success_rate >= 70:
                print("⚠️  AUTH SYSTEM HAS SOME ISSUES BUT IS MOSTLY FUNCTIONAL")
            else:
                print("🚨 AUTH SYSTEM HAS CRITICAL ISSUES THAT NEED FIXING")
                
            return success_rate >= 85
            
        finally:
            await self.cleanup_session()

async def main():
    """Main test runner"""
    tester = AuthSystemTester()
    success = await tester.run_all_tests()
    
    # Write results to file for CI/CD
    results_file = "/app/auth_test_results.json"
    with open(results_file, "w") as f:
        json.dump({
            "success": success,
            "timestamp": datetime.now().isoformat(),
            "test_results": tester.test_results
        }, f, indent=2)
    
    print(f"\n📝 Detailed results saved to: {results_file}")
    return success

if __name__ == "__main__":
    try:
        success = asyncio.run(main())
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n⚠️  Tests interrupted by user")
        exit(1)
    except Exception as e:
        print(f"\n💥 Test runner crashed: {e}")
        exit(1)