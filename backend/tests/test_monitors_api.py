"""
Test Suite for Growth Panel Site Monitor API Endpoints
Tests: GET/POST /growth/monitors, POST /growth/monitors/:id/check, DELETE /growth/monitors/:id
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Supabase auth credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"


@pytest.fixture(scope="module")
def auth_token():
    """Get Supabase auth token for authenticated requests"""
    # Try to get token from Supabase auth
    try:
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
        if response.status_code == 200:
            data = response.json()
            return data.get("access_token")
    except Exception as e:
        print(f"Auth error: {e}")
    
    pytest.skip("Could not authenticate - skipping authenticated tests")


@pytest.fixture
def api_client(auth_token):
    """Requests session with auth header"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}"
    })
    return session


class TestHealthCheck:
    """Basic health check to ensure API is running"""
    
    def test_health_endpoint(self):
        """Test /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"PASS: Health check - status: {data.get('status')}")


class TestMonitorsAPIUnauth:
    """Test monitors endpoints require authentication"""
    
    def test_get_monitors_requires_auth(self):
        """GET /api/growth/monitors should return 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/growth/monitors")
        assert response.status_code == 401
        data = response.json()
        assert "error" in data
        print(f"PASS: GET /monitors returns 401 without auth")
    
    def test_post_monitors_requires_auth(self):
        """POST /api/growth/monitors should return 401 without auth"""
        response = requests.post(
            f"{BASE_URL}/api/growth/monitors",
            headers={"Content-Type": "application/json"},
            json={"url": "https://example.com"}
        )
        assert response.status_code == 401
        print(f"PASS: POST /monitors returns 401 without auth")


class TestMonitorsAPICRUD:
    """Test monitors CRUD operations with authentication"""
    
    def test_get_monitors_list(self, api_client):
        """GET /api/growth/monitors returns monitors list"""
        response = api_client.get(f"{BASE_URL}/api/growth/monitors")
        assert response.status_code == 200
        data = response.json()
        assert "monitors" in data
        assert isinstance(data["monitors"], list)
        print(f"PASS: GET /monitors returns list with {len(data['monitors'])} monitors")
    
    def test_create_monitor(self, api_client):
        """POST /api/growth/monitors creates a new monitor"""
        test_url = f"https://test-monitor-{int(time.time())}.example.com"
        response = api_client.post(
            f"{BASE_URL}/api/growth/monitors",
            json={"url": test_url}
        )
        assert response.status_code in [200, 201]
        data = response.json()
        assert "monitor" in data
        monitor = data["monitor"]
        assert monitor.get("url") == test_url
        assert "id" in monitor
        assert monitor.get("checks") == 0
        assert monitor.get("enabled") == True
        print(f"PASS: POST /monitors created monitor with id: {monitor['id']}")
        return monitor["id"]
    
    def test_create_duplicate_monitor_returns_already_exists(self, api_client):
        """POST /api/growth/monitors with duplicate URL returns already_exists"""
        # First create a monitor
        test_url = f"https://duplicate-test-{int(time.time())}.example.com"
        response1 = api_client.post(
            f"{BASE_URL}/api/growth/monitors",
            json={"url": test_url}
        )
        assert response1.status_code in [200, 201]
        
        # Try to create same monitor again
        response2 = api_client.post(
            f"{BASE_URL}/api/growth/monitors",
            json={"url": test_url}
        )
        assert response2.status_code == 200  # Returns 200 for existing
        data = response2.json()
        assert "monitor" in data
        assert data["monitor"].get("already_exists") == True
        print(f"PASS: Duplicate monitor returns already_exists=true")
        
        # Cleanup
        monitor_id = data["monitor"]["id"]
        api_client.delete(f"{BASE_URL}/api/growth/monitors/{monitor_id}")
    
    def test_delete_monitor(self, api_client):
        """DELETE /api/growth/monitors/:id deletes a monitor"""
        # First create a monitor to delete
        test_url = f"https://delete-test-{int(time.time())}.example.com"
        create_response = api_client.post(
            f"{BASE_URL}/api/growth/monitors",
            json={"url": test_url}
        )
        assert create_response.status_code in [200, 201]
        monitor_id = create_response.json()["monitor"]["id"]
        
        # Delete the monitor
        delete_response = api_client.delete(f"{BASE_URL}/api/growth/monitors/{monitor_id}")
        assert delete_response.status_code == 200
        data = delete_response.json()
        assert data.get("success") == True
        print(f"PASS: DELETE /monitors/{monitor_id} succeeded")
        
        # Verify it's deleted by trying to get monitors list
        list_response = api_client.get(f"{BASE_URL}/api/growth/monitors")
        monitors = list_response.json().get("monitors", [])
        assert not any(m["id"] == monitor_id for m in monitors)
        print(f"PASS: Monitor {monitor_id} no longer in list after delete")
    
    def test_delete_nonexistent_monitor_returns_404(self, api_client):
        """DELETE /api/growth/monitors/:id with invalid ID returns 404"""
        fake_id = "000000000000000000000000"
        response = api_client.delete(f"{BASE_URL}/api/growth/monitors/{fake_id}")
        assert response.status_code == 404
        print(f"PASS: DELETE nonexistent monitor returns 404")


class TestMonitorCheckEndpoint:
    """Test the monitor check/re-crawl endpoint"""
    
    def test_check_monitor_triggers_recrawl(self, api_client):
        """POST /api/growth/monitors/:id/check triggers re-crawl"""
        # First create a monitor with a real URL that can be crawled
        test_url = "https://books.toscrape.com"
        create_response = api_client.post(
            f"{BASE_URL}/api/growth/monitors",
            json={"url": test_url}
        )
        
        # Handle case where monitor already exists
        if create_response.status_code == 200:
            monitor = create_response.json()["monitor"]
            if monitor.get("already_exists"):
                print(f"INFO: Monitor for {test_url} already exists, using existing")
        else:
            assert create_response.status_code == 201
            monitor = create_response.json()["monitor"]
        
        monitor_id = monitor["id"]
        initial_checks = monitor.get("checks", 0)
        
        # Trigger a check (this may take a few seconds as it crawls)
        print(f"INFO: Triggering check for monitor {monitor_id}...")
        check_response = api_client.post(
            f"{BASE_URL}/api/growth/monitors/{monitor_id}/check",
            timeout=60  # Allow time for crawl
        )
        
        # The check endpoint should return updated monitor data
        assert check_response.status_code == 200
        data = check_response.json()
        assert "monitor" in data
        
        updated_monitor = data["monitor"]
        assert updated_monitor.get("checks", 0) > initial_checks
        assert updated_monitor.get("last_checked_at") is not None
        
        # Check for changes array (may be empty on first check)
        assert "changes" in data
        assert isinstance(data["changes"], list)
        
        # Check for counter_moves array
        assert "counter_moves" in data
        assert isinstance(data["counter_moves"], list)
        
        print(f"PASS: Monitor check succeeded - checks: {updated_monitor['checks']}, changes: {len(data['changes'])}")
    
    def test_check_nonexistent_monitor_returns_404(self, api_client):
        """POST /api/growth/monitors/:id/check with invalid ID returns 404"""
        fake_id = "000000000000000000000000"
        response = api_client.post(f"{BASE_URL}/api/growth/monitors/{fake_id}/check")
        assert response.status_code == 404
        print(f"PASS: Check nonexistent monitor returns 404")


class TestMonitorValidation:
    """Test input validation for monitor endpoints"""
    
    def test_create_monitor_requires_url(self, api_client):
        """POST /api/growth/monitors without url returns 400"""
        response = api_client.post(
            f"{BASE_URL}/api/growth/monitors",
            json={}
        )
        assert response.status_code == 400
        data = response.json()
        assert "error" in data
        print(f"PASS: Create monitor without URL returns 400")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
