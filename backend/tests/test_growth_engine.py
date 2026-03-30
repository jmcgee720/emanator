"""
Growth Engine API Tests
Tests for: POST /api/growth/crawl, POST /api/growth/analyze, 
GET /api/growth/pages, GET /api/growth/pages/:id, DELETE /api/growth/pages/:id
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


class TestGrowthAuthRequired:
    """Test that all growth endpoints require authentication"""
    
    def test_crawl_requires_auth(self, no_auth_headers):
        """POST /api/growth/crawl should return 401 without auth"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=no_auth_headers,
            json={"url": "https://example.com"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data)
    
    def test_analyze_requires_auth(self, no_auth_headers):
        """POST /api/growth/analyze should return 401 without auth"""
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=no_auth_headers,
            json={"page_id": "test123"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
    
    def test_list_pages_requires_auth(self, no_auth_headers):
        """GET /api/growth/pages should return 401 without auth"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=no_auth_headers
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
    
    def test_get_page_requires_auth(self, no_auth_headers):
        """GET /api/growth/pages/:id should return 401 without auth"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages/507f1f77bcf86cd799439011",
            headers=no_auth_headers
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
    
    def test_delete_page_requires_auth(self, no_auth_headers):
        """DELETE /api/growth/pages/:id should return 401 without auth"""
        response = requests.delete(
            f"{BASE_URL}/api/growth/pages/507f1f77bcf86cd799439011",
            headers=no_auth_headers
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"


class TestGrowthCrawl:
    """Test POST /api/growth/crawl endpoint"""
    
    def test_crawl_success(self, auth_headers):
        """Crawl a simple URL and verify response structure"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.com"}
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Expected success: true"
        assert "page_id" in data, "Expected page_id in response"
        assert "url" in data, "Expected url in response"
        assert "extracted_data" in data, "Expected extracted_data in response"
        
        # Verify extracted_data structure
        ext = data["extracted_data"]
        assert "title" in ext, "Expected title in extracted_data"
        assert "word_count" in ext, "Expected word_count in extracted_data"
        assert "internal_links" in ext or ext.get("internal_links") is not None
        assert "external_links" in ext or ext.get("external_links") is not None
        assert "total_images" in ext or ext.get("total_images") is not None
        
        # Store page_id for cleanup
        TestGrowthCrawl.created_page_id = data["page_id"]
    
    def test_crawl_missing_url(self, auth_headers):
        """Crawl without URL should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
    
    def test_crawl_empty_url(self, auth_headers):
        """Crawl with empty URL should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": ""}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
    
    def test_crawl_invalid_url(self, auth_headers):
        """Crawl with invalid URL should return error"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "not-a-valid-url-at-all"}
        )
        # Should return 400 or 422 for invalid URL
        assert response.status_code in [400, 422, 502, 504], f"Expected error status, got {response.status_code}: {response.text}"


class TestGrowthPages:
    """Test GET /api/growth/pages and GET /api/growth/pages/:id"""
    
    def test_list_pages(self, auth_headers):
        """List all pages for user"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "pages" in data, "Expected pages array in response"
        assert isinstance(data["pages"], list), "pages should be an array"
        
        # If there are pages, verify structure
        if len(data["pages"]) > 0:
            page = data["pages"][0]
            assert "id" in page, "Expected id in page"
            assert "url" in page, "Expected url in page"
    
    def test_get_page_by_id(self, auth_headers):
        """Get a specific page by ID"""
        # First, list pages to get a valid ID
        list_response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert list_response.status_code == 200
        
        pages = list_response.json().get("pages", [])
        if len(pages) == 0:
            # Create a page first
            crawl_response = requests.post(
                f"{BASE_URL}/api/growth/crawl",
                headers=auth_headers,
                json={"url": "https://example.com"}
            )
            assert crawl_response.status_code == 201
            page_id = crawl_response.json()["page_id"]
        else:
            page_id = pages[0]["id"]
        
        # Get the page
        response = requests.get(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "page" in data, "Expected page object in response"
        assert data["page"]["id"] == page_id, "Page ID should match"
        assert "url" in data["page"], "Expected url in page"
        assert "extracted_data" in data["page"], "Expected extracted_data in page"
    
    def test_get_nonexistent_page(self, auth_headers):
        """Get a page that doesn't exist should return 404"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages/507f1f77bcf86cd799439011",
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
    
    def test_get_page_invalid_id(self, auth_headers):
        """Get a page with invalid ID format should return 404 or 400"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages/invalid-id-format",
            headers=auth_headers
        )
        assert response.status_code in [400, 404, 500], f"Expected error status, got {response.status_code}: {response.text}"


class TestGrowthAnalyze:
    """Test POST /api/growth/analyze endpoint"""
    
    def test_analyze_success(self, auth_headers):
        """Analyze a crawled page and verify response structure"""
        # First, crawl a page
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.com"}
        )
        assert crawl_response.status_code == 201, f"Crawl failed: {crawl_response.text}"
        page_id = crawl_response.json()["page_id"]
        
        # Analyze the page (may take a few seconds due to AI call)
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": page_id},
            timeout=30  # AI calls can take time
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Expected success: true"
        assert "page_id" in data, "Expected page_id in response"
        assert "opportunities" in data, "Expected opportunities in response"
        
        # Verify opportunities structure
        opps = data["opportunities"]
        expected_keys = ["title_issues", "meta_issues", "content_issues", "structure_issues", "recommendations"]
        for key in expected_keys:
            assert key in opps, f"Expected {key} in opportunities"
            assert isinstance(opps[key], list), f"{key} should be an array"
        
        # Store for cleanup
        TestGrowthAnalyze.analyzed_page_id = page_id
    
    def test_analyze_missing_page_id(self, auth_headers):
        """Analyze without page_id should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
    
    def test_analyze_nonexistent_page(self, auth_headers):
        """Analyze a page that doesn't exist should return 404"""
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": "507f1f77bcf86cd799439011"}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"


class TestGrowthDelete:
    """Test DELETE /api/growth/pages/:id endpoint"""
    
    def test_delete_page(self, auth_headers):
        """Delete a crawled page"""
        # First, crawl a page
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.com"}
        )
        assert crawl_response.status_code == 201
        page_id = crawl_response.json()["page_id"]
        
        # Delete the page
        response = requests.delete(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Expected success: true"
        
        # Verify page is deleted
        get_response = requests.get(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        assert get_response.status_code == 404, "Page should be deleted"
    
    def test_delete_nonexistent_page(self, auth_headers):
        """Delete a page that doesn't exist should return 404"""
        response = requests.delete(
            f"{BASE_URL}/api/growth/pages/507f1f77bcf86cd799439011",
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"


class TestGrowthFullFlow:
    """Test complete flow: crawl -> get -> analyze -> verify -> delete"""
    
    def test_full_growth_flow(self, auth_headers):
        """Complete end-to-end test of growth engine"""
        # Step 1: Crawl a URL
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.com"}
        )
        assert crawl_response.status_code == 201, f"Crawl failed: {crawl_response.text}"
        crawl_data = crawl_response.json()
        page_id = crawl_data["page_id"]
        print(f"Crawled page: {page_id}")
        
        # Step 2: Verify page appears in list
        list_response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert list_response.status_code == 200
        pages = list_response.json()["pages"]
        page_ids = [p["id"] for p in pages]
        assert page_id in page_ids, "Crawled page should appear in list"
        print(f"Page found in list")
        
        # Step 3: Get page details
        get_response = requests.get(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        assert get_response.status_code == 200
        page_data = get_response.json()["page"]
        assert page_data["extracted_data"]["title"] is not None or page_data["extracted_data"]["word_count"] >= 0
        print(f"Page details retrieved: {page_data['url']}")
        
        # Step 4: Analyze the page
        analyze_response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": page_id},
            timeout=30
        )
        assert analyze_response.status_code == 200, f"Analyze failed: {analyze_response.text}"
        analyze_data = analyze_response.json()
        assert "opportunities" in analyze_data
        print(f"Analysis complete with {len(analyze_data['opportunities'].get('recommendations', []))} recommendations")
        
        # Step 5: Verify analysis is persisted
        get_response2 = requests.get(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        assert get_response2.status_code == 200
        page_data2 = get_response2.json()["page"]
        assert page_data2.get("opportunities") is not None, "Opportunities should be persisted"
        print(f"Analysis persisted to page")
        
        # Step 6: Delete the page
        delete_response = requests.delete(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        assert delete_response.status_code == 200
        print(f"Page deleted")
        
        # Step 7: Verify deletion
        get_response3 = requests.get(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        assert get_response3.status_code == 404, "Page should be deleted"
        print(f"Deletion verified")
        
        print("Full growth flow test PASSED")
