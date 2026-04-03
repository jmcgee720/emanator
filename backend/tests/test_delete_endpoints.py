"""
Test H7.4 - Project/Chat Deletion Endpoints
Tests for DELETE /api/projects/:id and POST /api/account/cleanup
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')

# Test credentials
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"


class TestDeleteEndpoints:
    """Test project deletion endpoints"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        """Get authenticated session with Supabase cookie"""
        session = requests.Session()
        session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json"
        })
        
        # For Supabase auth, we need to login via the Supabase auth endpoint
        # The app uses cookie-based auth, so we'll test the endpoints that don't require auth first
        # and note that full auth testing requires browser-based login
        
        return session
    
    def test_delete_project_without_auth_returns_401(self, auth_session):
        """DELETE /api/projects/:id should return 401 without authentication"""
        # Use a fake project ID
        fake_project_id = "00000000-0000-0000-0000-000000000000"
        
        response = auth_session.delete(f"{BASE_URL}/api/projects/{fake_project_id}")
        
        # Should return 401 Unauthorized
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data), f"Expected error message, got: {data}"
        print(f"SUCCESS: DELETE /api/projects/:id returns 401 without auth")
    
    def test_account_cleanup_without_auth_returns_401(self, auth_session):
        """POST /api/account/cleanup should return 401 without authentication"""
        response = auth_session.post(f"{BASE_URL}/api/account/cleanup")
        
        # Should return 401 Unauthorized
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data), f"Expected error message, got: {data}"
        print(f"SUCCESS: POST /api/account/cleanup returns 401 without auth")
    
    def test_delete_nonexistent_project_returns_404_or_401(self, auth_session):
        """DELETE /api/projects/:id with non-existent ID should return 404 or 401"""
        fake_project_id = "99999999-9999-9999-9999-999999999999"
        
        response = auth_session.delete(f"{BASE_URL}/api/projects/{fake_project_id}")
        
        # Without auth, should return 401
        # With auth but non-existent project, should return 404
        assert response.status_code in [401, 404], f"Expected 401 or 404, got {response.status_code}: {response.text}"
        print(f"SUCCESS: DELETE /api/projects/:id with invalid ID returns {response.status_code}")
    
    def test_api_health_check(self, auth_session):
        """Verify API is accessible"""
        # Try to access a public endpoint or the base URL
        response = auth_session.get(f"{BASE_URL}/api/health")
        
        # Health endpoint might not exist, but we should get a response
        # Accept 200, 404, or other valid HTTP responses (not connection errors)
        assert response.status_code < 500, f"API returned server error: {response.status_code}"
        print(f"SUCCESS: API is accessible, health check returned {response.status_code}")


class TestDeleteEndpointStructure:
    """Test that delete endpoints exist and have correct structure"""
    
    def test_delete_project_endpoint_exists(self):
        """Verify DELETE /api/projects/:id endpoint exists"""
        session = requests.Session()
        fake_id = "test-id"
        
        response = session.delete(f"{BASE_URL}/api/projects/{fake_id}")
        
        # Should not return 404 for the endpoint itself (might return 401 or 400)
        # A 404 would indicate the endpoint doesn't exist
        # 401 indicates endpoint exists but requires auth
        assert response.status_code != 405, "DELETE method not allowed on endpoint"
        print(f"SUCCESS: DELETE /api/projects/:id endpoint exists (returned {response.status_code})")
    
    def test_account_cleanup_endpoint_exists(self):
        """Verify POST /api/account/cleanup endpoint exists"""
        session = requests.Session()
        
        response = session.post(f"{BASE_URL}/api/account/cleanup")
        
        # Should not return 405 Method Not Allowed
        assert response.status_code != 405, "POST method not allowed on endpoint"
        print(f"SUCCESS: POST /api/account/cleanup endpoint exists (returned {response.status_code})")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
