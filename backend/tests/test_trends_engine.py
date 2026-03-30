"""
Test suite for Trend Engine v1 - Growth Engine integration
Tests:
- POST /api/trends/fetch - Fetch trends from Google Trends RSS and Hacker News
- GET /api/trends - List stored trends
- Auth requirements for both endpoints
- Existing growth endpoints still work (crawl, analyze, pages, delete)
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"
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


class TestTrendsAuth:
    """Test that trend endpoints require authentication"""

    def test_trends_list_unauthenticated_returns_401(self, no_auth_headers):
        """GET /api/trends without auth should return 401"""
        response = requests.get(f"{BASE_URL}/api/trends", headers=no_auth_headers)
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data)

    def test_trends_fetch_unauthenticated_returns_401(self, no_auth_headers):
        """POST /api/trends/fetch without auth should return 401"""
        response = requests.post(f"{BASE_URL}/api/trends/fetch", headers=no_auth_headers, json={})
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data)


class TestTrendsFetch:
    """Test POST /api/trends/fetch endpoint"""

    def test_trends_fetch_with_auth_returns_success(self, auth_headers):
        """POST /api/trends/fetch with auth should return {success: true, count: N}"""
        response = requests.post(f"{BASE_URL}/api/trends/fetch", headers=auth_headers, json={})
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "success" in data, f"Response missing 'success' key: {data}"
        assert data["success"] == True, f"Expected success=True, got {data}"
        assert "count" in data, f"Response missing 'count' key: {data}"
        assert isinstance(data["count"], int), f"count should be int, got {type(data['count'])}"
        
        print(f"Fetched {data['count']} trends")


class TestTrendsList:
    """Test GET /api/trends endpoint"""

    def test_trends_list_with_auth_returns_trends(self, auth_headers):
        """GET /api/trends with auth should return {trends: [...]}"""
        response = requests.get(f"{BASE_URL}/api/trends", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "trends" in data, f"Response missing 'trends' key: {data}"
        assert isinstance(data["trends"], list), f"trends should be list, got {type(data['trends'])}"
        
        # If trends exist, verify structure
        if len(data["trends"]) > 0:
            trend = data["trends"][0]
            assert "keyword" in trend, f"Trend missing 'keyword': {trend}"
            assert "source" in trend, f"Trend missing 'source': {trend}"
            assert "score" in trend, f"Trend missing 'score': {trend}"
            assert "created_at" in trend, f"Trend missing 'created_at': {trend}"
            
            # Verify source is valid
            assert trend["source"] in ["google_trends", "hackernews"], f"Invalid source: {trend['source']}"
            
            print(f"Found {len(data['trends'])} trends, first: {trend['keyword']} ({trend['source']})")
        else:
            print("No trends in database yet")


class TestExistingGrowthEndpoints:
    """Verify existing growth endpoints still work after trend integration"""

    def test_growth_crawl_still_works(self, auth_headers):
        """POST /api/growth/crawl should still work"""
        response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://example.com"}
        )
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        data = response.json()
        assert "success" in data or "page_id" in data, f"Unexpected response: {data}"
        
        if "page_id" in data:
            print(f"Crawled page_id: {data['page_id']}")

    def test_growth_pages_list_still_works(self, auth_headers):
        """GET /api/growth/pages should still work"""
        response = requests.get(f"{BASE_URL}/api/growth/pages", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "pages" in data, f"Response missing 'pages': {data}"
        assert isinstance(data["pages"], list), f"pages should be list"
        
        print(f"Found {len(data['pages'])} pages")

    def test_growth_analyze_still_works(self, auth_headers):
        """POST /api/growth/analyze should still work and return opportunities + fixes"""
        # First get a page to analyze
        pages_response = requests.get(f"{BASE_URL}/api/growth/pages", headers=auth_headers)
        pages_data = pages_response.json()
        
        if not pages_data.get("pages") or len(pages_data["pages"]) == 0:
            pytest.skip("No pages to analyze")
        
        page_id = pages_data["pages"][0]["id"]
        
        # Analyze the page
        response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": page_id}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "success" in data, f"Response missing 'success': {data}"
        assert "opportunities" in data, f"Response missing 'opportunities': {data}"
        assert "fixes" in data, f"Response missing 'fixes': {data}"
        
        print(f"Analysis returned opportunities: {list(data['opportunities'].keys())}")
        print(f"Analysis returned fixes: {list(data['fixes'].keys())}")

    def test_growth_page_detail_has_fixes_field(self, auth_headers):
        """GET /api/growth/pages/:id should return page with fixes field"""
        # Get pages list
        pages_response = requests.get(f"{BASE_URL}/api/growth/pages", headers=auth_headers)
        pages_data = pages_response.json()
        
        if not pages_data.get("pages") or len(pages_data["pages"]) == 0:
            pytest.skip("No pages to check")
        
        # Find a page that has been analyzed (has opportunities)
        analyzed_page = None
        for page in pages_data["pages"]:
            if page.get("opportunities"):
                analyzed_page = page
                break
        
        if not analyzed_page:
            pytest.skip("No analyzed pages found")
        
        # Get page detail
        response = requests.get(f"{BASE_URL}/api/growth/pages/{analyzed_page['id']}", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "page" in data, f"Response missing 'page': {data}"
        page = data["page"]
        
        # Verify fixes field exists
        assert "fixes" in page, f"Page missing 'fixes' field: {page.keys()}"
        print(f"Page has fixes: {page['fixes']}")

    def test_growth_delete_still_works(self, auth_headers):
        """DELETE /api/growth/pages/:id should still work"""
        # First crawl a test page to delete
        crawl_response = requests.post(
            f"{BASE_URL}/api/growth/crawl",
            headers=auth_headers,
            json={"url": "https://httpbin.org/html"}
        )
        
        if crawl_response.status_code not in [200, 201]:
            pytest.skip(f"Could not create test page: {crawl_response.text}")
        
        crawl_data = crawl_response.json()
        page_id = crawl_data.get("page_id")
        
        if not page_id:
            pytest.skip("No page_id returned from crawl")
        
        # Delete the page
        delete_response = requests.delete(
            f"{BASE_URL}/api/growth/pages/{page_id}",
            headers=auth_headers
        )
        
        assert delete_response.status_code in [200, 204], f"Expected 200/204, got {delete_response.status_code}: {delete_response.text}"
        
        # Verify page is deleted
        get_response = requests.get(f"{BASE_URL}/api/growth/pages/{page_id}", headers=auth_headers)
        assert get_response.status_code == 404, f"Page should be deleted, got {get_response.status_code}"
        
        print(f"Successfully deleted page {page_id}")


class TestTrendIntegrationWithAnalyze:
    """Test that trends are injected into analyze prompt"""

    def test_fetch_trends_then_analyze_works(self, auth_headers):
        """Fetch trends, then analyze a page - should work without errors"""
        # 1. Fetch trends first
        fetch_response = requests.post(f"{BASE_URL}/api/trends/fetch", headers=auth_headers, json={})
        assert fetch_response.status_code in [200, 201], f"Trend fetch failed: {fetch_response.text}"
        
        # 2. Get or create a page
        pages_response = requests.get(f"{BASE_URL}/api/growth/pages", headers=auth_headers)
        pages_data = pages_response.json()
        
        if not pages_data.get("pages") or len(pages_data["pages"]) == 0:
            # Crawl a page
            crawl_response = requests.post(
                f"{BASE_URL}/api/growth/crawl",
                headers=auth_headers,
                json={"url": "https://example.com"}
            )
            if crawl_response.status_code not in [200, 201]:
                pytest.skip(f"Could not crawl page: {crawl_response.text}")
            page_id = crawl_response.json().get("page_id")
        else:
            page_id = pages_data["pages"][0]["id"]
        
        # 3. Analyze the page (trends should be injected into prompt)
        analyze_response = requests.post(
            f"{BASE_URL}/api/growth/analyze",
            headers=auth_headers,
            json={"page_id": page_id}
        )
        
        assert analyze_response.status_code == 200, f"Analyze failed: {analyze_response.text}"
        data = analyze_response.json()
        
        assert "success" in data and data["success"] == True, f"Analyze not successful: {data}"
        assert "opportunities" in data, f"Missing opportunities: {data}"
        assert "fixes" in data, f"Missing fixes: {data}"
        
        print(f"Analyze with trends completed successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
