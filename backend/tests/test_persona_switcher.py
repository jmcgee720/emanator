"""
Persona Switcher API Tests (v1)
Tests for: POST /api/growth/analyze with optional persona_id parameter
- Analyze WITHOUT persona_id (fallback to auto/best persona)
- Analyze WITH valid persona_id (uses specified persona)
- Analyze WITH invalid persona_id (returns 400)
- Analyze WITH persona_id belonging to different user (returns 404)
- Response includes persona_name field
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token from Supabase"""
    auth_url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    response = requests.post(
        auth_url,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Content-Type": "application/json"
        },
        json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        }
    )
    if response.status_code != 200:
        pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")
    
    data = response.json()
    token = data.get("access_token")
    if not token:
        pytest.skip("No access token in response")
    return token


@pytest.fixture
def auth_headers(auth_token):
    """Headers with auth token"""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }


@pytest.fixture(scope="module")
def test_page_id(auth_token):
    """Create a test page for analyze tests"""
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }
    
    # Crawl a page
    crawl_response = requests.post(
        f"{BASE_URL}/api/growth/crawl",
        headers=headers,
        json={"url": "https://example.com"}
    )
    if crawl_response.status_code != 201:
        pytest.skip(f"Failed to crawl test page: {crawl_response.text}")
    
    page_id = crawl_response.json().get("page_id")
    yield page_id
    
    # Cleanup
    requests.delete(f"{BASE_URL}/api/growth/pages/{page_id}", headers=headers)


@pytest.fixture(scope="module")
def test_persona_id(auth_token):
    """Get or create a test persona"""
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }
    
    # List existing personas
    list_response = requests.get(f"{BASE_URL}/api/personas", headers=headers)
    if list_response.status_code == 200:
        personas = list_response.json().get("personas", [])
        if len(personas) > 0:
            return personas[0]["id"]
    
    # Create a test persona if none exist
    create_response = requests.post(
        f"{BASE_URL}/api/personas/create",
        headers=headers,
        json={"name": "TEST_Switcher Persona", "description": "For switcher tests"}
    )
    if create_response.status_code == 201:
        return create_response.json()["persona"]["id"]
    
    pytest.skip("Could not get or create test persona")


class TestAnalyzeWithoutPersonaId:
    """Test POST /api/growth/analyze WITHOUT persona_id (fallback to auto)"""
    
    def test_analyze_without_persona_id_returns_200(self, auth_headers, test_page_id):
        """Analyze without persona_id should work (fallback to auto/best persona)"""
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": test_page_id},
            timeout=60
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Expected success: true"
        assert "opportunities" in data, "Expected opportunities in response"
        assert "fixes" in data, "Expected fixes in response"
        
        # Verify persona_name is returned (should be auto-selected persona name)
        assert "persona_name" in data, "Expected persona_name in response"
        print(f"Auto-selected persona: {data.get('persona_name')}")
    
    def test_analyze_without_persona_id_has_expected_structure(self, auth_headers, test_page_id):
        """Verify response structure when analyzing without persona_id"""
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": test_page_id},
            timeout=60
        )
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify opportunities structure
        opps = data.get("opportunities", {})
        expected_keys = ["title_issues", "meta_issues", "content_issues", "structure_issues", "recommendations"]
        for key in expected_keys:
            assert key in opps, f"Expected {key} in opportunities"
            assert isinstance(opps[key], list), f"{key} should be a list"


class TestAnalyzeWithValidPersonaId:
    """Test POST /api/growth/analyze WITH valid persona_id"""
    
    def test_analyze_with_persona_id_returns_200(self, auth_headers, test_page_id, test_persona_id):
        """Analyze with valid persona_id should use specified persona"""
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": test_page_id, "persona_id": test_persona_id},
            timeout=60
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Expected success: true"
        assert "opportunities" in data, "Expected opportunities in response"
        assert "fixes" in data, "Expected fixes in response"
        
        # Verify persona_name is returned and matches the specified persona
        assert "persona_name" in data, "Expected persona_name in response"
        persona_name = data.get("persona_name")
        assert persona_name is not None, "persona_name should not be None"
        print(f"Used persona: {persona_name}")
    
    def test_analyze_with_persona_id_returns_persona_name(self, auth_headers, test_page_id, test_persona_id):
        """Verify persona_name in response matches the specified persona"""
        # First get the persona name
        list_response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        personas = list_response.json().get("personas", [])
        expected_name = None
        for p in personas:
            if p["id"] == test_persona_id:
                expected_name = p["name"]
                break
        
        # Analyze with persona_id
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": test_page_id, "persona_id": test_persona_id},
            timeout=60
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("persona_name") == expected_name, f"Expected persona_name '{expected_name}', got '{data.get('persona_name')}'"


class TestAnalyzeWithInvalidPersonaId:
    """Test POST /api/growth/analyze WITH invalid persona_id"""
    
    def test_analyze_with_invalid_persona_id_format(self, auth_headers, test_page_id):
        """Analyze with invalid persona_id format should return 400 or 404"""
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": test_page_id, "persona_id": "invalid-id-format"},
            timeout=30
        )
        # Should return 400 or 404 for invalid ObjectId format (404 if treated as not found)
        assert response.status_code in [400, 404], f"Expected 400 or 404, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "error" in data, "Expected error in response"
    
    def test_analyze_with_nonexistent_persona_id(self, auth_headers, test_page_id):
        """Analyze with non-existent persona_id should return 404"""
        # Use a valid ObjectId format but non-existent
        fake_persona_id = "507f1f77bcf86cd799439011"
        
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": test_page_id, "persona_id": fake_persona_id},
            timeout=30
        )
        # Should return 404 for persona not found
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "error" in data, "Expected error in response"


class TestAnalyzePersonaOwnership:
    """Test that analyze with persona_id validates ownership"""
    
    def test_analyze_with_other_user_persona_returns_404(self, auth_headers, test_page_id):
        """Analyze with persona_id belonging to different user should return 404"""
        # This test uses a valid ObjectId format that doesn't belong to the test user
        # The route.js validates ownership before passing to backend
        other_user_persona_id = "507f1f77bcf86cd799439012"
        
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": test_page_id, "persona_id": other_user_persona_id},
            timeout=30
        )
        # Should return 404 because persona doesn't belong to user
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "error" in data, "Expected error in response"


class TestExistingFunctionalityStillWorks:
    """Test that existing functionality (crawl, pages, delete) still works"""
    
    def test_crawl_still_works(self, auth_headers):
        """POST /api/growth/crawl should still work"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://httpbin.org/html"}
        )
        assert response.status_code == 201, f"Crawl failed: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "page_id" in data
        
        # Cleanup
        if data.get("page_id"):
            requests.delete(f"{BASE_URL}/api/growth/pages/{data['page_id']}", headers=auth_headers)
    
    def test_pages_list_still_works(self, auth_headers):
        """GET /api/growth/pages should still work"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Pages list failed: {response.text}"
        
        data = response.json()
        assert "pages" in data
        assert isinstance(data["pages"], list)
    
    def test_page_delete_still_works(self, auth_headers):
        """DELETE /api/growth/pages/:id should still work"""
        # First create a page
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.org"}
        )
        assert crawl_response.status_code == 201
        page_id = crawl_response.json()["page_id"]
        
        # Delete the page
        delete_response = requests.delete(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        assert delete_response.status_code == 200, f"Delete failed: {delete_response.text}"
        
        data = delete_response.json()
        assert data.get("success") == True


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_personas(self, auth_headers):
        """Delete TEST_ prefixed personas"""
        list_response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        if list_response.status_code == 200:
            personas = list_response.json().get("personas", [])
            deleted_count = 0
            for p in personas:
                if p.get("name", "").startswith("TEST_"):
                    del_response = requests.delete(f"{BASE_URL}/api/personas/{p['id']}", headers=auth_headers)
                    if del_response.status_code == 200:
                        deleted_count += 1
            print(f"Cleaned up {deleted_count} test personas")
        assert True
