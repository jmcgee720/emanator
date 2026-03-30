#!/usr/bin/env python3
"""
Simplified Builder Memory Controls Phase 12 Step 5 Backend API Testing
Focuses on key functionality testing with better error handling
"""

import requests
import json
import sys

BASE_URL = "https://project-runner-48.preview.emergentagent.com"
AUTH_EMAIL = "testprov@test.com"
AUTH_PASSWORD = "password123"

def get_auth_token():
    """Get Supabase auth token"""
    try:
        supabase_url = "https://cawmmqakaxbznbelcrwd.supabase.co"
        auth_url = f"{supabase_url}/auth/v1/token?grant_type=password"
        
        payload = {"email": AUTH_EMAIL, "password": AUTH_PASSWORD}
        headers = {
            "apikey": "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22",
            "Content-Type": "application/json"
        }
        
        response = requests.post(auth_url, json=payload, headers=headers, timeout=10)
        if response.status_code == 200:
            token = response.json().get('access_token')
            print(f"✅ Authentication successful")
            return token
        else:
            print(f"❌ Auth failed: {response.status_code}")
            return None
    except Exception as e:
        print(f"❌ Auth error: {e}")
        return None

def test_api(method, endpoint, token=None, data=None, expected_status=200):
    """Test API endpoint with better error handling"""
    url = f"{BASE_URL}/api{endpoint}"
    headers = {"Content-Type": "application/json"}
    
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, timeout=15)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=data, timeout=15)
        elif method == "PUT":
            response = requests.put(url, headers=headers, json=data, timeout=15)
        elif method == "PATCH":
            response = requests.patch(url, headers=headers, json=data, timeout=15)
        elif method == "DELETE":
            response = requests.delete(url, headers=headers, timeout=15)
        
        success = response.status_code == expected_status
        result = f"{method} {endpoint} → {response.status_code}"
        
        if success:
            print(f"✅ {result}")
        else:
            print(f"❌ {result} (expected {expected_status})")
            if response.status_code >= 400:
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
        
        return response if response.status_code < 500 else None
        
    except Exception as e:
        print(f"❌ {method} {endpoint} → Error: {e}")
        return None

def main():
    print("🧪 Builder Memory Controls Phase 12 Step 5 — Simplified Backend Testing")
    print(f"🔗 Testing: {BASE_URL}")
    
    # Get auth token
    token = get_auth_token()
    if not token:
        sys.exit(1)
    
    # Get project
    projects_response = test_api("GET", "/projects", token)
    if not projects_response:
        print("❌ Failed to get projects")
        sys.exit(1)
    
    projects = projects_response.json()
    if not projects:
        print("❌ No projects found")
        sys.exit(1)
    
    project_id = projects[0]["id"]
    print(f"✅ Using project: {project_id}")
    
    print("\n=== NEW ROUTES TESTING ===")
    
    # Test 1: PATCH project-preferences (auth)
    test_api("PATCH", f"/projects/{project_id}/project-preferences", token, 
             {"recurring_constraints": ["no new files"]}, 200)
    
    # Test 2: PATCH project-preferences (no auth)  
    test_api("PATCH", f"/projects/{project_id}/project-preferences", None,
             {"recurring_constraints": ["unauthorized"]}, 401)
    
    # Test 3: GET builder-status (auth)
    test_api("GET", f"/projects/{project_id}/builder-status", token, None, 200)
    
    # Test 4: GET builder-status (no auth)
    test_api("GET", f"/projects/{project_id}/builder-status", None, None, 401)
    
    # Test 5: PUT memory (create entry first)
    print("\n--- Memory PUT Test ---")
    create_response = test_api("POST", f"/projects/{project_id}/memory", token,
                              {"key": "test_put", "value": "original"}, 201)
    
    if create_response:
        memory_id = create_response.json().get("id")
        if memory_id:
            print(f"✅ Created memory entry: {memory_id}")
            
            # Try PUT update (this may fail due to server error)
            put_response = test_api("PUT", f"/projects/{project_id}/memory/{memory_id}", token,
                                  {"key": "updated", "value": "new_value"}, 200)
            
            # PUT without auth
            test_api("PUT", f"/projects/{project_id}/memory/{memory_id}", None,
                    {"key": "unauthorized", "value": "test"}, 401)
            
            # Cleanup
            test_api("DELETE", f"/projects/{project_id}/memory/{memory_id}", token, None, 200)
        else:
            print("❌ No memory ID returned")
    
    print("\n=== EXISTING ROUTES VERIFICATION ===")
    
    # Existing routes
    test_api("GET", f"/projects/{project_id}/memory", token, None, 200)
    test_api("GET", f"/projects/{project_id}/user-preferences", token, None, 200)
    test_api("PATCH", f"/projects/{project_id}/user-preferences", token,
             {"response_style": {"concise_level": "concise"}}, 200)
    test_api("GET", f"/projects/{project_id}/project-preferences", token, None, 200)
    test_api("GET", f"/projects/{project_id}/learning", token, None, 200)
    
    print("\n✅ Testing completed - see results above")

if __name__ == "__main__":
    main()