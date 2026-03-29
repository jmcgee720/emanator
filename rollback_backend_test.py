#!/usr/bin/env python3
"""
Comprehensive Backend Testing for Rollback Feature
Testing at: https://lightwave-import.preview.emergentagent.com
Auth: testprov@test.com / password123

Full test flow (must be sequential):
1. Setup - find source project and get original files
2. Create sandbox from source
3. Add file to sandbox 
4. Test before apply (should pass)
5. Promote sandbox
6. Verify source has promoted files
7. Test rollback scenarios (including failure cases)
8. Verify rollback worked
9. Cleanup
"""

import requests
import json
import time
from typing import Dict, List, Optional, Any

BASE_URL = "https://lightwave-import.preview.emergentagent.com/api"

# Test Results Storage
test_results = []
source_project_id = None
sandbox_project_id = None
second_sandbox_id = None
original_source_files = None
auth_token = None

def get_auth_token():
    """Get authentication token using curl command from review request"""
    import subprocess
    
    curl_command = [
        'curl', '-s', '-X', 'POST',
        'https://cawmmqakaxbznbelcrwd.supabase.co/auth/v1/token?grant_type=password',
        '-H', 'Content-Type: application/json',
        '-H', 'apikey: sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22',
        '-d', '{"email":"testprov@test.com","password":"password123"}'
    ]
    
    try:
        result = subprocess.run(curl_command, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            response = json.loads(result.stdout)
            if 'access_token' in response:
                return response['access_token']
            else:
                print("❌ No access token in response:", response)
                return None
        else:
            print("❌ Curl command failed:", result.stderr)
            return None
    except Exception as e:
        print(f"❌ Error getting auth token: {e}")
        return None

def log_test(test_name: str, passed: bool, details: str):
    """Log test results"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {test_name}")
    if details:
        print(f"   Details: {details}")
    test_results.append({
        "test": test_name,
        "passed": passed,
        "details": details
    })
    print()

def api_request(method: str, endpoint: str, data: Dict = None, headers: Dict = None) -> tuple:
    """Make API request and return (response, success)"""
    url = f"{BASE_URL}{endpoint}"
    req_headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }
    if headers:
        req_headers.update(headers)
    
    try:
        if method.upper() == "GET":
            resp = requests.get(url, headers=req_headers, timeout=30)
        elif method.upper() == "POST":
            resp = requests.post(url, headers=req_headers, json=data, timeout=30)
        elif method.upper() == "PUT":
            resp = requests.put(url, headers=req_headers, json=data, timeout=30)
        elif method.upper() == "DELETE":
            resp = requests.delete(url, headers=req_headers, timeout=30)
        else:
            return None, False
        
        return resp, True
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return None, False

def setup_phase():
    """SETUP: Find non-sandbox project and note original files"""
    global source_project_id, original_source_files
    
    print("🔧 SETUP PHASE: Finding source project and getting original files")
    
    # Get projects list and find non-sandbox project
    resp, success = api_request("GET", "/projects")
    if not success:
        log_test("GET /projects", False, "API request failed")
        return False
    
    if resp.status_code != 200:
        log_test("GET /projects", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    projects = resp.json()
    non_sandbox_projects = [p for p in projects if not p.get('settings', {}).get('is_sandbox', False)]
    
    if not non_sandbox_projects:
        log_test("Find non-sandbox project", False, "No non-sandbox projects available")
        return False
    
    source_project_id = non_sandbox_projects[0]['id']
    log_test("Find non-sandbox project", True, f"Found {len(non_sandbox_projects)} non-sandbox projects, selected {source_project_id}")
    
    # Get original files from source project
    resp, success = api_request("GET", f"/projects/{source_project_id}/files")
    if not success:
        log_test("GET source files", False, "API request failed")
        return False
    
    if resp.status_code != 200:
        log_test("GET source files", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    original_source_files = resp.json()
    log_test("GET source files", True, f"Found {len(original_source_files)} original files in source project")
    
    return True

def create_sandbox():
    """Create sandbox from source project"""
    global sandbox_project_id
    
    print("🔧 SETUP: Creating sandbox from source project")
    
    resp, success = api_request("POST", f"/projects/{source_project_id}/sandbox")
    if not success:
        log_test("POST create sandbox", False, "API request failed")
        return False
    
    if resp.status_code != 201:
        log_test("POST create sandbox", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    result = resp.json()
    sandbox_project_id = result['project']['id']
    
    # Verify sandbox settings
    settings = result['project'].get('settings', {})
    is_sandbox = settings.get('is_sandbox', False)
    sandbox_status = settings.get('sandbox_status', '')
    source_id = settings.get('sandbox_source_id', '')
    
    success_details = (
        f"Sandbox created: {sandbox_project_id}, "
        f"is_sandbox={is_sandbox}, "
        f"status={sandbox_status}, "
        f"source_id matches={source_id == source_project_id}"
    )
    
    log_test("POST create sandbox", True, success_details)
    return True

def test_1_add_file_to_sandbox():
    """TEST 1: Add file to sandbox"""
    print("📋 TEST 1: Add file to sandbox")
    
    file_data = {
        "path": "rollback-test.js", 
        "content": "const x = 1",
        "file_type": "text"
    }
    
    resp, success = api_request("POST", f"/projects/{sandbox_project_id}/files", file_data)
    if not success:
        log_test("TEST 1 - Add file to sandbox", False, "API request failed")
        return False
    
    if resp.status_code != 201:
        log_test("TEST 1 - Add file to sandbox", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    result = resp.json()
    log_test("TEST 1 - Add file to sandbox", True, f"File created: {result.get('path', 'unknown')}")
    return True

def test_2_run_test_before_apply():
    """TEST 2: Run test-before-apply (should pass)"""
    print("📋 TEST 2: Run test-before-apply")
    
    test_data = {
        "diffs": [
            {
                "path": "rollback-test.js",
                "content": "const x = 1"
            }
        ]
    }
    
    resp, success = api_request("POST", f"/projects/{sandbox_project_id}/test-before-apply", test_data)
    if not success:
        log_test("TEST 2 - Test before apply", False, "API request failed")
        return False
    
    if resp.status_code != 200:
        log_test("TEST 2 - Test before apply", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    result = resp.json()
    passed = result.get('passed', False)
    
    if not passed:
        log_test("TEST 2 - Test before apply", False, f"Test failed: {result}")
        return False
    
    log_test("TEST 2 - Test before apply", True, f"Test passed: {result}")
    return True

def test_3_promote_sandbox():
    """TEST 3: Promote sandbox"""
    print("📋 TEST 3: Promote sandbox")
    
    resp, success = api_request("POST", f"/projects/{sandbox_project_id}/promote")
    if not success:
        log_test("TEST 3 - Promote sandbox", False, "API request failed")
        return False
    
    if resp.status_code != 200:
        log_test("TEST 3 - Promote sandbox", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    result = resp.json()
    success_flag = result.get('success', False)
    
    if not success_flag:
        log_test("TEST 3 - Promote sandbox", False, f"Promotion failed: {result}")
        return False
    
    log_test("TEST 3 - Promote sandbox", True, f"Promoted successfully: {result}")
    return True

def test_4_verify_source_has_promoted_files():
    """TEST 4: Verify source project has promoted files"""
    print("📋 TEST 4: Verify source project has promoted files")
    
    resp, success = api_request("GET", f"/projects/{source_project_id}/files")
    if not success:
        log_test("TEST 4 - Verify source files", False, "API request failed")
        return False
    
    if resp.status_code != 200:
        log_test("TEST 4 - Verify source files", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    current_files = resp.json()
    rollback_test_file = next((f for f in current_files if f['path'] == 'rollback-test.js'), None)
    
    if not rollback_test_file:
        log_test("TEST 4 - Verify source files", False, "rollback-test.js not found in source project")
        return False
    
    log_test("TEST 4 - Verify source files", True, f"Found rollback-test.js in source project")
    return True

def test_5_rollback_non_promoted_sandbox_should_fail():
    """TEST 5: Rollback non-promoted sandbox → should fail"""
    global second_sandbox_id
    
    print("📋 TEST 5: Rollback non-promoted sandbox (should fail)")
    
    # Create a second sandbox from source
    resp, success = api_request("POST", f"/projects/{source_project_id}/sandbox")
    if not success:
        log_test("TEST 5 - Create second sandbox", False, "API request failed")
        return False
    
    if resp.status_code != 201:
        log_test("TEST 5 - Create second sandbox", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    result = resp.json()
    second_sandbox_id = result['project']['id']
    
    # Try to rollback the non-promoted sandbox
    resp, success = api_request("POST", f"/projects/{second_sandbox_id}/rollback")
    if not success:
        log_test("TEST 5 - Rollback non-promoted sandbox", False, "API request failed")
        return False
    
    if resp.status_code != 400:
        log_test("TEST 5 - Rollback non-promoted sandbox", False, f"Expected 400, got {resp.status_code}: {resp.text}")
        return False
    
    error_text = resp.text
    if "has not been promoted" not in error_text:
        log_test("TEST 5 - Rollback non-promoted sandbox", False, f"Expected 'has not been promoted' error, got: {error_text}")
        return False
    
    log_test("TEST 5 - Rollback non-promoted sandbox", True, "Correctly blocked non-promoted sandbox rollback")
    return True

def test_6_rollback_promoted_sandbox():
    """TEST 6: ROLLBACK promoted sandbox"""
    print("📋 TEST 6: ROLLBACK promoted sandbox")
    
    resp, success = api_request("POST", f"/projects/{sandbox_project_id}/rollback")
    if not success:
        log_test("TEST 6 - Rollback promoted sandbox", False, "API request failed")
        return False
    
    if resp.status_code != 200:
        log_test("TEST 6 - Rollback promoted sandbox", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    result = resp.json()
    success_flag = result.get('success', False)
    files_restored = result.get('files_restored', 0)
    files_removed = result.get('files_removed', 0)
    sandbox_status = result.get('sandbox_status', '')
    
    if not success_flag:
        log_test("TEST 6 - Rollback promoted sandbox", False, f"Rollback failed: {result}")
        return False
    
    if sandbox_status != 'rolled_back':
        log_test("TEST 6 - Rollback promoted sandbox", False, f"Expected status 'rolled_back', got '{sandbox_status}'")
        return False
    
    log_test("TEST 6 - Rollback promoted sandbox", True, 
             f"success={success_flag}, files_restored={files_restored}, files_removed={files_removed}, status={sandbox_status}")
    return True

def test_7_verify_source_files_restored():
    """TEST 7: Verify source files restored"""
    print("📋 TEST 7: Verify source files restored")
    
    resp, success = api_request("GET", f"/projects/{source_project_id}/files")
    if not success:
        log_test("TEST 7 - Verify source files restored", False, "API request failed")
        return False
    
    if resp.status_code != 200:
        log_test("TEST 7 - Verify source files restored", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    current_files = resp.json()
    
    # Should NOT include rollback-test.js
    rollback_test_file = next((f for f in current_files if f['path'] == 'rollback-test.js'), None)
    if rollback_test_file:
        log_test("TEST 7 - Verify source files restored", False, "rollback-test.js still present (should be removed)")
        return False
    
    # Should match original files count
    if len(current_files) != len(original_source_files):
        log_test("TEST 7 - Verify source files restored", False, 
                f"File count mismatch: original={len(original_source_files)}, current={len(current_files)}")
        return False
    
    log_test("TEST 7 - Verify source files restored", True, 
             f"Source files properly restored - rollback-test.js removed, {len(current_files)} files match original")
    return True

def test_8_verify_sandbox_status():
    """TEST 8: Verify sandbox status is 'rolled_back'"""
    print("📋 TEST 8: Verify sandbox status")
    
    resp, success = api_request("GET", f"/projects/{sandbox_project_id}")
    if not success:
        log_test("TEST 8 - Verify sandbox status", False, "API request failed")
        return False
    
    if resp.status_code != 200:
        log_test("TEST 8 - Verify sandbox status", False, f"Status {resp.status_code}: {resp.text}")
        return False
    
    project = resp.json()
    settings = project.get('settings', {})
    sandbox_status = settings.get('sandbox_status', '')
    
    if sandbox_status != 'rolled_back':
        log_test("TEST 8 - Verify sandbox status", False, f"Expected 'rolled_back', got '{sandbox_status}'")
        return False
    
    log_test("TEST 8 - Verify sandbox status", True, f"Sandbox status correctly set to 'rolled_back'")
    return True

def test_9_double_rollback_blocked():
    """TEST 9: Double rollback blocked"""
    print("📋 TEST 9: Double rollback should be blocked")
    
    resp, success = api_request("POST", f"/projects/{sandbox_project_id}/rollback")
    if not success:
        log_test("TEST 9 - Double rollback blocked", False, "API request failed")
        return False
    
    if resp.status_code != 400:
        log_test("TEST 9 - Double rollback blocked", False, f"Expected 400, got {resp.status_code}: {resp.text}")
        return False
    
    error_text = resp.text
    if "has not been promoted" not in error_text:
        log_test("TEST 9 - Double rollback blocked", False, f"Expected 'has not been promoted' error, got: {error_text}")
        return False
    
    log_test("TEST 9 - Double rollback blocked", True, "Double rollback correctly blocked")
    return True

def test_10_non_sandbox_rollback():
    """TEST 10: Non-sandbox rollback → 400"""
    print("📋 TEST 10: Non-sandbox rollback should fail")
    
    resp, success = api_request("POST", f"/projects/{source_project_id}/rollback")
    if not success:
        log_test("TEST 10 - Non-sandbox rollback", False, "API request failed")
        return False
    
    if resp.status_code != 400:
        log_test("TEST 10 - Non-sandbox rollback", False, f"Expected 400, got {resp.status_code}: {resp.text}")
        return False
    
    error_text = resp.text
    if "Not a sandbox project" not in error_text:
        log_test("TEST 10 - Non-sandbox rollback", False, f"Expected 'Not a sandbox project' error, got: {error_text}")
        return False
    
    log_test("TEST 10 - Non-sandbox rollback", True, "Non-sandbox rollback correctly blocked")
    return True

def test_11_no_auth():
    """TEST 11: No auth → 401"""
    print("📋 TEST 11: No auth should return 401")
    
    # Make request without auth token
    resp, success = api_request("POST", f"/projects/{sandbox_project_id}/rollback", headers={"Authorization": ""})
    if not success:
        log_test("TEST 11 - No auth", False, "API request failed")
        return False
    
    if resp.status_code != 401:
        log_test("TEST 11 - No auth", False, f"Expected 401, got {resp.status_code}: {resp.text}")
        return False
    
    log_test("TEST 11 - No auth", True, "Unauthorized request correctly blocked")
    return True

def cleanup():
    """CLEANUP: Delete sandbox projects"""
    global sandbox_project_id, second_sandbox_id
    
    print("🧹 CLEANUP: Deleting sandbox projects")
    
    cleanup_success = True
    
    if sandbox_project_id:
        resp, success = api_request("DELETE", f"/projects/{sandbox_project_id}")
        if success and resp.status_code == 200:
            log_test("Cleanup - Delete main sandbox", True, f"Sandbox {sandbox_project_id} deleted")
        else:
            log_test("Cleanup - Delete main sandbox", False, f"Failed to delete sandbox {sandbox_project_id}")
            cleanup_success = False
    
    if second_sandbox_id:
        resp, success = api_request("DELETE", f"/projects/{second_sandbox_id}")
        if success and resp.status_code == 200:
            log_test("Cleanup - Delete second sandbox", True, f"Second sandbox {second_sandbox_id} deleted")
        else:
            log_test("Cleanup - Delete second sandbox", False, f"Failed to delete second sandbox {second_sandbox_id}")
            cleanup_success = False
    
    return cleanup_success

def run_all_tests():
    """Run all tests in the specified sequence"""
    global auth_token
    
    print("🎉 ROLLBACK FEATURE COMPREHENSIVE TESTING")
    print("=" * 60)
    print()
    
    # Get authentication token
    print("🔑 Getting authentication token...")
    auth_token = get_auth_token()
    if not auth_token:
        print("❌ Failed to get authentication token")
        return False
    
    print(f"✅ Got auth token: {auth_token[:50]}...")
    print()
    
    # Run tests in sequence
    test_functions = [
        setup_phase,
        create_sandbox,
        test_1_add_file_to_sandbox,
        test_2_run_test_before_apply,
        test_3_promote_sandbox,
        test_4_verify_source_has_promoted_files,
        test_5_rollback_non_promoted_sandbox_should_fail,
        test_6_rollback_promoted_sandbox,
        test_7_verify_source_files_restored,
        test_8_verify_sandbox_status,
        test_9_double_rollback_blocked,
        test_10_non_sandbox_rollback,
        test_11_no_auth,
        cleanup
    ]
    
    for i, test_func in enumerate(test_functions, 1):
        try:
            success = test_func()
            if not success and test_func != cleanup:
                print(f"❌ Test sequence stopped at step {i}: {test_func.__name__}")
                # Still try cleanup
                try:
                    cleanup()
                except:
                    pass
                return False
        except Exception as e:
            print(f"❌ Exception in {test_func.__name__}: {e}")
            if test_func != cleanup:
                try:
                    cleanup()
                except:
                    pass
                return False
    
    return True

def generate_report():
    """Generate final test report"""
    passed_tests = len([t for t in test_results if t['passed']])
    total_tests = len(test_results)
    success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
    
    report = {
        "test_suite": "Rollback Feature Comprehensive Testing",
        "url": BASE_URL.replace('/api', ''),
        "auth": "testprov@test.com",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "summary": {
            "total_tests": total_tests,
            "passed": passed_tests,
            "failed": total_tests - passed_tests,
            "success_rate": f"{success_rate:.1f}%"
        },
        "detailed_results": test_results,
        "test_sequence": [
            "SETUP: Find source project and note files",
            "Create sandbox from source",
            "Add file to sandbox", 
            "Run test-before-apply (should pass)",
            "Promote sandbox",
            "Verify source has promoted files",
            "Rollback non-promoted sandbox → should fail",
            "ROLLBACK promoted sandbox",
            "Verify source files restored",
            "Verify sandbox status = 'rolled_back'",
            "Double rollback blocked",
            "Non-sandbox rollback blocked",
            "No auth → 401",
            "Cleanup"
        ]
    }
    
    # Save to file
    report_file = "/app/test_reports/iteration_20.json"
    with open(report_file, 'w') as f:
        json.dump(report, f, indent=2)
    
    print("📋 FINAL SUMMARY")
    print("=" * 60)
    print(f"Total Tests: {total_tests}")
    print(f"Passed: {passed_tests}")
    print(f"Failed: {total_tests - passed_tests}")
    print(f"Success Rate: {success_rate:.1f}%")
    print(f"\nDetailed results saved to: {report_file}")
    print()
    
    return report

if __name__ == "__main__":
    success = run_all_tests()
    report = generate_report()
    
    if success and report['summary']['success_rate'] == "100.0%":
        print("🎉 ALL TESTS PASSED - Rollback feature is fully operational!")
    else:
        print("❌ Some tests failed - see detailed results above")