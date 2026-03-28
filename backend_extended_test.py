#!/usr/bin/env python3
"""
MyMergent Backend API Extended Test Suite
Additional tests for export/import validation and edge cases
"""

import requests
import json
import sys
from datetime import datetime
import uuid

# Base URL from environment
BASE_URL = "https://ai-visual-phase.preview.emergentagent.com/api"

# Test configuration
HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json"
}

class ExtendedAPITester:
    def __init__(self):
        self.results = {}
        
    def log_result(self, test_name, success, details="", response_code=None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        self.results[test_name] = {
            "status": status, 
            "success": success, 
            "details": details,
            "response_code": response_code
        }
        print(f"{status} {test_name}")
        if details:
            print(f"   Details: {details}")
        if response_code:
            print(f"   Response Code: {response_code}")
        print()

    def test_export_invalid_types(self):
        """Test export API with invalid export types"""
        try:
            fake_project_id = str(uuid.uuid4())
            invalid_headers = HEADERS.copy()
            invalid_headers["Authorization"] = "Bearer fake_token"
            
            # Test invalid export type
            payload = {"export_type": "invalid_type"}
            response = requests.post(f"{BASE_URL}/projects/{fake_project_id}/exports", 
                                   json=payload, headers=invalid_headers, timeout=10)
            
            if response.status_code == 401:  # Auth will fail first
                self.log_result("Export API - Invalid Type Auth Check", True, 
                              f"Correctly rejected due to auth", response.status_code)
            else:
                self.log_result("Export API - Invalid Type Auth Check", False, 
                              f"Unexpected status: {response.status_code}", response.status_code)
                
        except Exception as e:
            self.log_result("Export API - Invalid Type", False, f"Connection error: {str(e)}")

    def test_import_invalid_manifest(self):
        """Test import API with invalid manifest format"""
        try:
            invalid_headers = HEADERS.copy()
            invalid_headers["Authorization"] = "Bearer fake_token"
            
            # Test invalid manifest
            payload = {
                "manifest": {
                    "version": "1.0.0",
                    "format": "invalid_format",  # Wrong format
                    "project": {
                        "name": "Test Import",
                        "description": "Test project",
                        "type": "app"
                    }
                }
            }
            response = requests.post(f"{BASE_URL}/projects/import", 
                                   json=payload, headers=invalid_headers, timeout=10)
            
            if response.status_code == 401:  # Auth will fail first
                self.log_result("Import API - Invalid Manifest Auth Check", True, 
                              f"Correctly rejected due to auth", response.status_code)
            else:
                self.log_result("Import API - Invalid Manifest Auth Check", False, 
                              f"Unexpected status: {response.status_code}", response.status_code)
                
        except Exception as e:
            self.log_result("Import API - Invalid Manifest", False, f"Connection error: {str(e)}")

    def test_search_short_query(self):
        """Test search API with too short query"""
        try:
            invalid_headers = HEADERS.copy()
            invalid_headers["Authorization"] = "Bearer fake_token"
            
            # Test query too short
            payload = {"query": "x"}  # Only 1 character
            response = requests.post(f"{BASE_URL}/search", 
                                   json=payload, headers=invalid_headers, timeout=10)
            
            if response.status_code == 401:  # Auth will fail first
                self.log_result("Search API - Short Query Auth Check", True, 
                              f"Correctly rejected due to auth", response.status_code)
            else:
                self.log_result("Search API - Short Query Auth Check", False, 
                              f"Unexpected status: {response.status_code}", response.status_code)
                
        except Exception as e:
            self.log_result("Search API - Short Query", False, f"Connection error: {str(e)}")

    def test_cors_headers(self):
        """Test CORS headers in API responses"""
        try:
            response = requests.get(f"{BASE_URL}/health", headers=HEADERS, timeout=10)
            
            cors_headers = [
                'Access-Control-Allow-Origin',
                'Access-Control-Allow-Methods', 
                'Access-Control-Allow-Headers'
            ]
            
            missing_cors = []
            for header in cors_headers:
                if header not in response.headers:
                    missing_cors.append(header)
            
            if not missing_cors:
                self.log_result("CORS Headers", True, 
                              f"All required CORS headers present", response.status_code)
            else:
                self.log_result("CORS Headers", False, 
                              f"Missing CORS headers: {missing_cors}", response.status_code)
                
        except Exception as e:
            self.log_result("CORS Headers", False, f"Connection error: {str(e)}")

    def test_options_method(self):
        """Test OPTIONS method for CORS preflight"""
        try:
            response = requests.options(f"{BASE_URL}/health", headers=HEADERS, timeout=10)
            
            if response.status_code in [200, 204]:  # Both are valid for OPTIONS
                self.log_result("OPTIONS Method (CORS Preflight)", True, 
                              f"OPTIONS request handled correctly", response.status_code)
            else:
                self.log_result("OPTIONS Method (CORS Preflight)", False, 
                              f"OPTIONS returned {response.status_code}", response.status_code)
                
        except Exception as e:
            self.log_result("OPTIONS Method", False, f"Connection error: {str(e)}")

    def test_project_creation_validation(self):
        """Test project creation with missing required fields"""
        try:
            invalid_headers = HEADERS.copy()
            invalid_headers["Authorization"] = "Bearer fake_token"
            
            # Test missing project name
            payload = {"type": "app"}  # Missing name
            response = requests.post(f"{BASE_URL}/projects", 
                                   json=payload, headers=invalid_headers, timeout=10)
            
            if response.status_code == 401:  # Auth will fail first
                self.log_result("Project Creation - Missing Name Auth Check", True, 
                              f"Correctly rejected due to auth", response.status_code)
            else:
                self.log_result("Project Creation - Missing Name Auth Check", False, 
                              f"Unexpected status: {response.status_code}", response.status_code)
                
        except Exception as e:
            self.log_result("Project Creation - Missing Name", False, f"Connection error: {str(e)}")

    def test_api_root_endpoint(self):
        """Test API root endpoint"""
        try:
            response = requests.get(f"{BASE_URL}/", headers=HEADERS, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if "message" in data and "MyMergent API" in data["message"]:
                    self.log_result("API Root Endpoint", True, 
                                  f"API root responds correctly: {data['message']}", response.status_code)
                else:
                    self.log_result("API Root Endpoint", False, 
                                  f"Unexpected response: {data}", response.status_code)
            else:
                self.log_result("API Root Endpoint", False, 
                              f"HTTP error {response.status_code}", response.status_code)
                
        except Exception as e:
            self.log_result("API Root Endpoint", False, f"Connection error: {str(e)}")

    def run_extended_tests(self):
        """Run extended API tests"""
        print("=" * 60)
        print("MyMergent Backend Extended Test Suite")
        print(f"Testing against: {BASE_URL}")
        print(f"Started at: {datetime.now().isoformat()}")
        print("=" * 60)
        print()

        # Test additional functionality
        print("🔧 Testing Edge Cases & Validation:")
        self.test_export_invalid_types()
        self.test_import_invalid_manifest()
        self.test_search_short_query()
        self.test_project_creation_validation()
        
        print("🌐 Testing CORS & HTTP Methods:")
        self.test_cors_headers()
        self.test_options_method()
        self.test_api_root_endpoint()

        # Print summary
        print("\n" + "=" * 60)
        print("EXTENDED TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.results.values() if result['success'])
        total = len(self.results)
        
        for test_name, result in self.results.items():
            print(f"{result['status']} {test_name}")
            
        print(f"\nResults: {passed}/{total} extended tests passed")
        
        if passed == total:
            print("🎉 All extended tests passed!")
            return True
        else:
            print(f"❌ {total - passed} extended tests failed")
            return False

if __name__ == "__main__":
    tester = ExtendedAPITester()
    success = tester.run_extended_tests()
    sys.exit(0 if success else 1)