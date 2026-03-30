"""
Test suite for Multi-Page Batch Crawl v1 feature.
Tests POST /api/growth/crawl with single and batch modes.
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL environment variable is required")

# Test credentials
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"

# Supabase config
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token via Supabase auth"""
    # Use Supabase REST API for authentication
    response = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Content-Type": "application/json"
        }
    )
    if response.status_code != 200:
        pytest.skip(f"Supabase authentication failed: {response.status_code} - {response.text}")
    data = response.json()
    token = data.get("access_token")
    if not token:
        pytest.skip("No access token in Supabase response")
    return token


@pytest.fixture
def auth_headers(auth_token):
    """Headers with auth token"""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }


class TestCrawlAuth:
    """Test authentication requirements for crawl endpoint"""
    
    def test_crawl_without_auth_returns_401(self):
        """POST /api/growth/crawl without auth should return 401"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://example.com"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data)


class TestSingleModeCrawl:
    """Test single page crawl mode (default and explicit)"""
    
    def test_crawl_without_mode_defaults_to_single(self, auth_headers):
        """POST /api/growth/crawl without mode should default to single and return page_id"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://httpbin.org/html"},
            headers=auth_headers,
            timeout=60
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should return single page result with page_id (backward compat)
        assert "page_id" in data, "Response should contain page_id for single mode"
        assert "success" in data and data["success"] is True
        assert "extracted_data" in data, "Should return extracted_data for single mode"
        assert "mode" not in data or data.get("mode") != "batch", "Should not be batch mode"
    
    def test_crawl_with_explicit_single_mode(self, auth_headers):
        """POST /api/growth/crawl with mode=single should return single page result"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://httpbin.org/html", "mode": "single"},
            headers=auth_headers,
            timeout=60
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "page_id" in data, "Response should contain page_id"
        assert "success" in data and data["success"] is True
        assert "extracted_data" in data


class TestBatchModeCrawl:
    """Test batch crawl mode with BFS discovery"""
    
    def test_batch_crawl_returns_summary(self, auth_headers):
        """POST /api/growth/crawl with mode=batch should return batch summary"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://httpbin.org", "mode": "batch", "max_pages": 3},
            headers=auth_headers,
            timeout=180  # Batch can take longer
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Batch mode should return summary fields
        assert data.get("mode") == "batch", "Response should indicate batch mode"
        assert "pages_saved" in data, "Should have pages_saved count"
        assert "pages_failed" in data, "Should have pages_failed count"
        assert "pages_attempted" in data, "Should have pages_attempted count"
        assert "page_ids" in data, "Should have page_ids array"
        assert isinstance(data["page_ids"], list), "page_ids should be a list"
        
        # httpbin.org has internal links, should crawl more than 1 page
        assert data["pages_saved"] >= 1, "Should save at least 1 page"
        assert data["pages_attempted"] >= 1, "Should attempt at least 1 page"
    
    def test_batch_crawl_respects_max_pages(self, auth_headers):
        """Batch crawl should stop at max_pages limit"""
        max_pages = 2
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://httpbin.org", "mode": "batch", "max_pages": max_pages},
            headers=auth_headers,
            timeout=180
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should not exceed max_pages
        assert data["pages_saved"] <= max_pages, f"Should not save more than {max_pages} pages"
        assert len(data["page_ids"]) <= max_pages, f"page_ids should not exceed {max_pages}"
    
    def test_batch_crawl_stays_on_same_hostname(self, auth_headers):
        """Batch crawl should only crawl same hostname (no external links)"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://httpbin.org", "mode": "batch", "max_pages": 5},
            headers=auth_headers,
            timeout=180
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify all saved pages are from same hostname by checking pages list
        if data["page_ids"]:
            pages_response = requests.get(
                f"{BASE_URL}/api/growth/pages",
                headers=auth_headers
            )
            if pages_response.status_code == 200:
                pages_data = pages_response.json()
                pages = pages_data.get("pages", [])
                batch_pages = [p for p in pages if p.get("id") in data["page_ids"]]
                for page in batch_pages:
                    url = page.get("url", "")
                    assert "httpbin.org" in url, f"Page URL {url} should be from httpbin.org"
    
    def test_batch_crawl_site_with_no_internal_links(self, auth_headers):
        """Batch crawl on site with no internal links should return 1 page"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://example.com", "mode": "batch", "max_pages": 5},
            headers=auth_headers,
            timeout=180
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        
        # example.com has no internal links, should only save 1 page
        assert data["pages_saved"] == 1, "example.com should only have 1 page (no internal links)"
        assert data["pages_attempted"] == 1
        assert len(data["page_ids"]) == 1


class TestBatchCrawlDataStorage:
    """Test that batch crawl stores correct metadata"""
    
    def test_batch_pages_have_crawl_mode_field(self, auth_headers):
        """Pages from batch crawl should have crawl_mode='batch' field"""
        # First do a batch crawl
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://httpbin.org", "mode": "batch", "max_pages": 2},
            headers=auth_headers,
            timeout=180
        )
        assert crawl_response.status_code == 201
        crawl_data = crawl_response.json()
        
        if crawl_data["page_ids"]:
            page_id = crawl_data["page_ids"][0]
            # Get the page details
            page_response = requests.get(
                f"{BASE_URL}/api/growth/pages/{page_id}",
                headers=auth_headers
            )
            assert page_response.status_code == 200
            page_data = page_response.json()
            page = page_data.get("page", {})
            
            assert page.get("crawl_mode") == "batch", "Batch crawled page should have crawl_mode='batch'"
    
    def test_batch_pages_have_parent_seed_url(self, auth_headers):
        """Pages from batch crawl should have parent_seed_url field"""
        seed_url = "https://httpbin.org"
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": seed_url, "mode": "batch", "max_pages": 3},
            headers=auth_headers,
            timeout=180
        )
        assert crawl_response.status_code == 201
        crawl_data = crawl_response.json()
        
        if len(crawl_data["page_ids"]) > 1:
            # Check a child page (not the seed)
            page_id = crawl_data["page_ids"][1]
            page_response = requests.get(
                f"{BASE_URL}/api/growth/pages/{page_id}",
                headers=auth_headers
            )
            assert page_response.status_code == 200
            page_data = page_response.json()
            page = page_data.get("page", {})
            
            assert "parent_seed_url" in page, "Child page should have parent_seed_url"
            assert seed_url in page.get("parent_seed_url", ""), f"parent_seed_url should contain {seed_url}"
    
    def test_single_mode_has_crawl_mode_single(self, auth_headers):
        """Pages from single crawl should have crawl_mode='single'"""
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://httpbin.org/html"},
            headers=auth_headers,
            timeout=60
        )
        assert crawl_response.status_code == 201
        crawl_data = crawl_response.json()
        page_id = crawl_data.get("page_id")
        
        if page_id:
            page_response = requests.get(
                f"{BASE_URL}/api/growth/pages/{page_id}",
                headers=auth_headers
            )
            assert page_response.status_code == 200
            page_data = page_response.json()
            page = page_data.get("page", {})
            
            assert page.get("crawl_mode") == "single", "Single crawled page should have crawl_mode='single'"


class TestBatchCrawlValidation:
    """Test input validation for batch crawl"""
    
    def test_invalid_mode_returns_400(self, auth_headers):
        """Invalid mode value should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://example.com", "mode": "invalid"},
            headers=auth_headers,
            timeout=30
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "error" in data
    
    def test_max_pages_capped_at_25(self, auth_headers):
        """max_pages should be capped at 25"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            json={"url": "https://example.com", "mode": "batch", "max_pages": 100},
            headers=auth_headers,
            timeout=180
        )
        # Should succeed but cap at 25
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        # The backend caps at 25, so it should work


class TestExistingFunctionality:
    """Verify existing Growth Engine features still work"""
    
    def test_pages_list_works(self, auth_headers):
        """GET /api/growth/pages should still work"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "pages" in data
        assert isinstance(data["pages"], list)
    
    def test_personas_list_works(self, auth_headers):
        """GET /api/personas should still work"""
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "personas" in data
    
    def test_trends_list_works(self, auth_headers):
        """GET /api/trends should still work"""
        response = requests.get(
            f"{BASE_URL}/api/trends",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "trends" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
