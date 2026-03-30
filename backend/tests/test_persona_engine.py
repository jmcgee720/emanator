"""
Persona Engine API Tests (v1)
Tests for: POST /api/personas/create, GET /api/personas, DELETE /api/personas/:id
Auto-seed personas on first crawl, Analyze integration with persona injection
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


@pytest.fixture
def no_auth_headers():
    """Headers without auth token"""
    return {"Content-Type": "application/json"}


class TestPersonaAuthRequired:
    """Test that all persona endpoints require authentication"""
    
    def test_create_persona_requires_auth(self, no_auth_headers):
        """POST /api/personas/create should return 401 without auth"""
        response = requests.post(
            f"{BASE_URL}/api/personas/create",
            headers=no_auth_headers,
            json={"name": "Test Persona", "description": "Test description"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data)
    
    def test_list_personas_requires_auth(self, no_auth_headers):
        """GET /api/personas should return 401 without auth"""
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=no_auth_headers
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
    
    def test_delete_persona_requires_auth(self, no_auth_headers):
        """DELETE /api/personas/:id should return 401 without auth"""
        response = requests.delete(
            f"{BASE_URL}/api/personas/507f1f77bcf86cd799439011",
            headers=no_auth_headers
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"


class TestPersonaCreate:
    """Test POST /api/personas/create endpoint"""
    
    def test_create_persona_success(self, auth_headers):
        """Create a persona with name and description, returns 201"""
        response = requests.post(
            f"{BASE_URL}/api/personas/create",
            headers=auth_headers,
            json={"name": "TEST_Impulse Buyer", "description": "Makes quick purchase decisions"}
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "persona" in data, "Expected persona object in response"
        persona = data["persona"]
        assert persona.get("name") == "TEST_Impulse Buyer", "Name should match"
        assert persona.get("description") == "Makes quick purchase decisions", "Description should match"
        assert "id" in persona, "Expected id in persona"
        
        # Store for cleanup
        TestPersonaCreate.created_persona_id = persona["id"]
    
    def test_create_persona_name_only(self, auth_headers):
        """Create a persona with only name (description optional)"""
        response = requests.post(
            f"{BASE_URL}/api/personas/create",
            headers=auth_headers,
            json={"name": "TEST_Minimal Persona"}
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "persona" in data
        persona = data["persona"]
        assert persona.get("name") == "TEST_Minimal Persona"
        
        # Cleanup
        if persona.get("id"):
            requests.delete(f"{BASE_URL}/api/personas/{persona['id']}", headers=auth_headers)
    
    def test_create_persona_missing_name(self, auth_headers):
        """Create persona without name should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/personas/create",
            headers=auth_headers,
            json={"description": "No name provided"}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data
    
    def test_create_persona_empty_name(self, auth_headers):
        """Create persona with empty name should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/personas/create",
            headers=auth_headers,
            json={"name": "", "description": "Empty name"}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data
    
    def test_create_persona_whitespace_name(self, auth_headers):
        """Create persona with whitespace-only name should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/personas/create",
            headers=auth_headers,
            json={"name": "   ", "description": "Whitespace name"}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"


class TestPersonaList:
    """Test GET /api/personas endpoint"""
    
    def test_list_personas(self, auth_headers):
        """List all personas for authenticated user"""
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "personas" in data, "Expected personas array in response"
        assert isinstance(data["personas"], list), "personas should be an array"
        
        # If there are personas, verify structure
        if len(data["personas"]) > 0:
            persona = data["personas"][0]
            assert "id" in persona, "Expected id in persona"
            assert "name" in persona, "Expected name in persona"


class TestPersonaDelete:
    """Test DELETE /api/personas/:id endpoint"""
    
    def test_delete_persona(self, auth_headers):
        """Delete a persona"""
        # First, create a persona
        create_response = requests.post(
            f"{BASE_URL}/api/personas/create",
            headers=auth_headers,
            json={"name": "TEST_ToDelete", "description": "Will be deleted"}
        )
        assert create_response.status_code == 201
        persona_id = create_response.json()["persona"]["id"]
        
        # Delete the persona
        response = requests.delete(
            f"{BASE_URL}/api/personas/{persona_id}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Expected success: true"
        
        # Verify persona is deleted by listing
        list_response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        personas = list_response.json().get("personas", [])
        persona_ids = [p["id"] for p in personas]
        assert persona_id not in persona_ids, "Deleted persona should not appear in list"
    
    def test_delete_nonexistent_persona(self, auth_headers):
        """Delete a persona that doesn't exist should return 404"""
        response = requests.delete(
            f"{BASE_URL}/api/personas/507f1f77bcf86cd799439011",
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"


class TestAutoSeedPersonas:
    """Test auto-seeding of personas on first crawl"""
    
    @pytest.fixture(autouse=True)
    def cleanup_personas(self, auth_headers):
        """Delete all existing personas before test to ensure clean state"""
        # Get all personas
        list_response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        if list_response.status_code == 200:
            personas = list_response.json().get("personas", [])
            for p in personas:
                requests.delete(f"{BASE_URL}/api/personas/{p['id']}", headers=auth_headers)
        yield
        # Cleanup after test - delete TEST_ prefixed personas
        list_response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        if list_response.status_code == 200:
            personas = list_response.json().get("personas", [])
            for p in personas:
                if p.get("name", "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/personas/{p['id']}", headers=auth_headers)
    
    def test_auto_seed_on_first_crawl(self, auth_headers):
        """First crawl for user with 0 personas should return seeded_personas array with 3 personas"""
        # Verify no personas exist
        list_response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        assert list_response.status_code == 200
        initial_personas = list_response.json().get("personas", [])
        assert len(initial_personas) == 0, f"Expected 0 personas, got {len(initial_personas)}"
        
        # Crawl a URL - should trigger auto-seed
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.com"}
        )
        assert crawl_response.status_code == 201, f"Crawl failed: {crawl_response.text}"
        
        crawl_data = crawl_response.json()
        assert "seeded_personas" in crawl_data, "Expected seeded_personas in crawl response"
        seeded = crawl_data["seeded_personas"]
        assert isinstance(seeded, list), "seeded_personas should be an array"
        assert len(seeded) == 3, f"Expected 3 seeded personas, got {len(seeded)}"
        
        # Verify each seeded persona has name and description
        for p in seeded:
            assert "name" in p, "Seeded persona should have name"
            assert "description" in p, "Seeded persona should have description"
        
        print(f"Auto-seeded personas: {[p['name'] for p in seeded]}")
        
        # Verify personas now exist in list
        list_response2 = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        assert list_response2.status_code == 200
        personas = list_response2.json().get("personas", [])
        assert len(personas) == 3, f"Expected 3 personas in list, got {len(personas)}"
        
        # Cleanup - delete the crawled page
        if crawl_data.get("page_id"):
            requests.delete(f"{BASE_URL}/api/growth/pages/{crawl_data['page_id']}", headers=auth_headers)
    
    def test_auto_seed_idempotency(self, auth_headers):
        """Second crawl for same user should NOT re-seed (seeded_personas should be empty)"""
        # First crawl - should seed
        crawl1_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.com"}
        )
        assert crawl1_response.status_code == 201
        crawl1_data = crawl1_response.json()
        seeded1 = crawl1_data.get("seeded_personas", [])
        assert len(seeded1) == 3, f"First crawl should seed 3 personas, got {len(seeded1)}"
        
        # Second crawl - should NOT re-seed
        crawl2_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://httpbin.org/html"}
        )
        assert crawl2_response.status_code == 201
        crawl2_data = crawl2_response.json()
        seeded2 = crawl2_data.get("seeded_personas", [])
        assert len(seeded2) == 0, f"Second crawl should NOT seed, got {len(seeded2)} personas"
        
        # Verify still only 3 personas
        list_response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        personas = list_response.json().get("personas", [])
        assert len(personas) == 3, f"Should still have 3 personas, got {len(personas)}"
        
        # Cleanup
        if crawl1_data.get("page_id"):
            requests.delete(f"{BASE_URL}/api/growth/pages/{crawl1_data['page_id']}", headers=auth_headers)
        if crawl2_data.get("page_id"):
            requests.delete(f"{BASE_URL}/api/growth/pages/{crawl2_data['page_id']}", headers=auth_headers)


class TestAnalyzeWithPersona:
    """Test that analyze endpoint works with personas present (persona injected into AI prompt)"""
    
    def test_analyze_with_personas(self, auth_headers):
        """POST /api/growth/analyze should work with personas present"""
        # Ensure at least one persona exists
        list_response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        personas = list_response.json().get("personas", [])
        
        if len(personas) == 0:
            # Create a persona
            create_response = requests.post(
                f"{BASE_URL}/api/personas/create",
                headers=auth_headers,
                json={"name": "TEST_Analyze Persona", "description": "For analyze test"}
            )
            assert create_response.status_code == 201
        
        # Crawl a page
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.com"}
        )
        assert crawl_response.status_code == 201
        page_id = crawl_response.json()["page_id"]
        
        # Analyze the page (persona should be injected into prompt)
        analyze_response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": page_id},
            timeout=30
        )
        assert analyze_response.status_code == 200, f"Analyze failed: {analyze_response.text}"
        
        data = analyze_response.json()
        assert data.get("success") == True, "Expected success: true"
        assert "opportunities" in data, "Expected opportunities in response"
        
        # Verify opportunities structure
        opps = data["opportunities"]
        expected_keys = ["title_issues", "meta_issues", "content_issues", "structure_issues", "recommendations"]
        for key in expected_keys:
            assert key in opps, f"Expected {key} in opportunities"
        
        print(f"Analyze with persona completed successfully")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/growth/pages/{page_id}", headers=auth_headers)


class TestPersonaCleanup:
    """Cleanup test personas created during testing"""
    
    def test_cleanup_test_personas(self, auth_headers):
        """Delete all TEST_ prefixed personas"""
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
        assert True  # Always pass cleanup
