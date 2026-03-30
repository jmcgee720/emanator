"""
Test Channel Drafts v1 for Growth Engine
Tests the POST /api/growth/generate-drafts endpoint and drafts storage
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"


class TestSetup:
    """Setup: Get auth token and find a page with analysis"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        # Login to get token
        login_url = f"{BASE_URL}/api/auth/login"
        response = requests.post(login_url, json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if response.status_code != 200:
            # Try Supabase auth
            supabase_url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
            supabase_key = os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
            
            if supabase_url and supabase_key:
                auth_response = requests.post(
                    f"{supabase_url}/auth/v1/token?grant_type=password",
                    headers={
                        "apikey": supabase_key,
                        "Content-Type": "application/json"
                    },
                    json={
                        "email": TEST_EMAIL,
                        "password": TEST_PASSWORD
                    }
                )
                if auth_response.status_code == 200:
                    return auth_response.json().get("access_token")
        
        if response.status_code == 200:
            return response.json().get("token") or response.json().get("access_token")
        
        pytest.skip("Authentication failed - skipping tests")
        return None


@pytest.fixture(scope="module")
def auth_headers():
    """Get authentication headers for API calls"""
    supabase_url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
    supabase_key = os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    
    if not supabase_url or not supabase_key:
        pytest.skip("Supabase credentials not configured")
    
    auth_response = requests.post(
        f"{supabase_url}/auth/v1/token?grant_type=password",
        headers={
            "apikey": supabase_key,
            "Content-Type": "application/json"
        },
        json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        }
    )
    
    if auth_response.status_code != 200:
        pytest.skip(f"Authentication failed: {auth_response.status_code}")
    
    token = auth_response.json().get("access_token")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }


@pytest.fixture(scope="module")
def existing_page_id(auth_headers):
    """Get an existing page with analysis for testing"""
    response = requests.get(f"{BASE_URL}/api/growth/pages", headers=auth_headers)
    
    if response.status_code != 200:
        pytest.skip("Could not fetch pages")
    
    pages = response.json().get("pages", [])
    
    # Find a page with opportunities (analyzed)
    for page in pages:
        if page.get("opportunities"):
            return page.get("id")
    
    # If no analyzed page, use first page
    if pages:
        return pages[0].get("id")
    
    pytest.skip("No pages available for testing")


@pytest.fixture(scope="module")
def existing_persona_id(auth_headers):
    """Get an existing persona for testing"""
    response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
    
    if response.status_code != 200:
        return None
    
    personas = response.json().get("personas", [])
    if personas:
        return personas[0].get("id")
    return None


class TestGenerateDraftsAuth:
    """Test authentication for generate-drafts endpoint"""
    
    def test_generate_drafts_without_auth_returns_401(self):
        """POST /api/growth/generate-drafts WITHOUT auth returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={"page_id": "test123"},
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data)
        print("PASS: generate-drafts without auth returns 401")


class TestGenerateDraftsValidation:
    """Test input validation for generate-drafts endpoint"""
    
    def test_generate_drafts_invalid_page_id_returns_error(self, auth_headers):
        """POST /api/growth/generate-drafts WITH invalid page_id returns 400 or 404"""
        response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={"page_id": "invalid_page_id_12345"},
            headers=auth_headers
        )
        
        # Should return 400 (invalid format) or 404 (not found)
        assert response.status_code in [400, 404], f"Expected 400 or 404, got {response.status_code}"
        data = response.json()
        assert "error" in data
        print(f"PASS: generate-drafts with invalid page_id returns {response.status_code}")
    
    def test_generate_drafts_invalid_persona_id_returns_404(self, auth_headers, existing_page_id):
        """POST /api/growth/generate-drafts WITH invalid persona_id returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={
                "page_id": existing_page_id,
                "persona_id": "000000000000000000000000"  # Valid ObjectId format but doesn't exist
            },
            headers=auth_headers
        )
        
        # Should return 404 for non-existent persona
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        data = response.json()
        assert "error" in data
        print("PASS: generate-drafts with invalid persona_id returns 404")


class TestGenerateDraftsSuccess:
    """Test successful draft generation"""
    
    def test_generate_drafts_with_valid_page_id(self, auth_headers, existing_page_id):
        """POST /api/growth/generate-drafts WITH auth and valid page_id returns 200 with drafts"""
        response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={"page_id": existing_page_id},
            headers=auth_headers,
            timeout=60  # AI generation can take time
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify success
        assert data.get("success") == True, "Expected success: true"
        assert "drafts" in data, "Expected 'drafts' in response"
        
        drafts = data["drafts"]
        
        # Verify drafts structure
        assert "social_post" in drafts, "Expected 'social_post' in drafts"
        assert "search_ad" in drafts, "Expected 'search_ad' in drafts"
        assert "email" in drafts, "Expected 'email' in drafts"
        
        print("PASS: generate-drafts with valid page_id returns 200 with drafts")
        print(f"  - social_post keys: {list(drafts.get('social_post', {}).keys())}")
        print(f"  - search_ad keys: {list(drafts.get('search_ad', {}).keys())}")
        print(f"  - email keys: {list(drafts.get('email', {}).keys())}")
    
    def test_drafts_structure_social_post(self, auth_headers, existing_page_id):
        """Verify social_post draft structure: headline, body, cta"""
        response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={"page_id": existing_page_id},
            headers=auth_headers,
            timeout=60
        )
        
        if response.status_code != 200:
            pytest.skip(f"Draft generation failed: {response.status_code}")
        
        drafts = response.json().get("drafts", {})
        social_post = drafts.get("social_post", {})
        
        # Verify social_post structure
        assert "headline" in social_post, "social_post should have 'headline'"
        assert "body" in social_post, "social_post should have 'body'"
        assert "cta" in social_post, "social_post should have 'cta'"
        
        # Verify values are strings
        assert isinstance(social_post.get("headline"), str), "headline should be string"
        assert isinstance(social_post.get("body"), str), "body should be string"
        assert isinstance(social_post.get("cta"), str), "cta should be string"
        
        print("PASS: social_post has correct structure (headline, body, cta)")
    
    def test_drafts_structure_search_ad(self, auth_headers, existing_page_id):
        """Verify search_ad draft structure: headline_1, headline_2, description"""
        response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={"page_id": existing_page_id},
            headers=auth_headers,
            timeout=60
        )
        
        if response.status_code != 200:
            pytest.skip(f"Draft generation failed: {response.status_code}")
        
        drafts = response.json().get("drafts", {})
        search_ad = drafts.get("search_ad", {})
        
        # Verify search_ad structure
        assert "headline_1" in search_ad, "search_ad should have 'headline_1'"
        assert "headline_2" in search_ad, "search_ad should have 'headline_2'"
        assert "description" in search_ad, "search_ad should have 'description'"
        
        print("PASS: search_ad has correct structure (headline_1, headline_2, description)")
    
    def test_drafts_structure_email(self, auth_headers, existing_page_id):
        """Verify email draft structure: subject, preview_text, body_intro"""
        response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={"page_id": existing_page_id},
            headers=auth_headers,
            timeout=60
        )
        
        if response.status_code != 200:
            pytest.skip(f"Draft generation failed: {response.status_code}")
        
        drafts = response.json().get("drafts", {})
        email = drafts.get("email", {})
        
        # Verify email structure
        assert "subject" in email, "email should have 'subject'"
        assert "preview_text" in email, "email should have 'preview_text'"
        assert "body_intro" in email, "email should have 'body_intro'"
        
        print("PASS: email has correct structure (subject, preview_text, body_intro)")


class TestGenerateDraftsWithPersona:
    """Test draft generation with persona_id"""
    
    def test_generate_drafts_with_persona_id(self, auth_headers, existing_page_id, existing_persona_id):
        """POST /api/growth/generate-drafts WITH persona_id uses specified persona"""
        if not existing_persona_id:
            pytest.skip("No persona available for testing")
        
        response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={
                "page_id": existing_page_id,
                "persona_id": existing_persona_id
            },
            headers=auth_headers,
            timeout=60
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("success") == True
        assert "drafts" in data
        
        print("PASS: generate-drafts with persona_id returns 200")


class TestDraftsPersistence:
    """Test that drafts are stored on growth_pages"""
    
    def test_drafts_stored_on_page(self, auth_headers, existing_page_id):
        """GET /api/growth/pages/:id returns drafts field after generation"""
        # First generate drafts
        gen_response = requests.post(
            f"{BASE_URL}/api/growth/generate-drafts",
            json={"page_id": existing_page_id},
            headers=auth_headers,
            timeout=60
        )
        
        if gen_response.status_code != 200:
            pytest.skip(f"Draft generation failed: {gen_response.status_code}")
        
        # Now fetch the page and verify drafts are stored
        page_response = requests.get(
            f"{BASE_URL}/api/growth/pages/{existing_page_id}",
            headers=auth_headers
        )
        
        assert page_response.status_code == 200, f"Expected 200, got {page_response.status_code}"
        page_data = page_response.json()
        
        page = page_data.get("page", page_data)
        
        # Verify drafts field exists
        assert "drafts" in page, "Page should have 'drafts' field after generation"
        
        drafts = page.get("drafts")
        assert drafts is not None, "drafts should not be None"
        assert "social_post" in drafts, "drafts should contain social_post"
        assert "search_ad" in drafts, "drafts should contain search_ad"
        assert "email" in drafts, "drafts should contain email"
        
        print("PASS: drafts are stored on growth_pages document")


class TestExistingFunctionality:
    """Test that existing Growth Engine functionality still works"""
    
    def test_pages_list_still_works(self, auth_headers):
        """GET /api/growth/pages still returns pages list"""
        response = requests.get(f"{BASE_URL}/api/growth/pages", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "pages" in data, "Response should have 'pages' key"
        
        print(f"PASS: pages list works, found {len(data.get('pages', []))} pages")
    
    def test_personas_list_still_works(self, auth_headers):
        """GET /api/personas still returns personas list"""
        response = requests.get(f"{BASE_URL}/api/personas", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "personas" in data, "Response should have 'personas' key"
        
        print(f"PASS: personas list works, found {len(data.get('personas', []))} personas")
    
    def test_trends_list_still_works(self, auth_headers):
        """GET /api/trends still returns trends list"""
        response = requests.get(f"{BASE_URL}/api/trends", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "trends" in data, "Response should have 'trends' key"
        
        print(f"PASS: trends list works, found {len(data.get('trends', []))} trends")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
