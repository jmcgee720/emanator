"""
Test Patch History API - Iteration 79
Tests for the new Patch History Timeline feature:
- GET /api/projects/:id/patch-history returns history array
- Backend health check with 0 compilation errors
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"


class TestHealthCheck:
    """Health endpoint tests"""
    
    def test_health_returns_200(self):
        """Backend health check should return 200 with healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.status_code}"
        
        data = response.json()
        assert data.get("status") == "healthy", f"Unexpected status: {data}"
        print(f"✓ Health check passed: {data}")


class TestPatchHistoryAPI:
    """Patch History endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code == 200:
            data = response.json()
            token = data.get("access_token") or data.get("token")
            if token:
                return token
        pytest.skip(f"Authentication failed: {response.status_code} - {response.text[:200]}")
    
    @pytest.fixture(scope="class")
    def core_project_id(self, auth_token):
        """Get Core System project ID"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/projects", headers=headers)
        if response.status_code != 200:
            pytest.skip(f"Failed to get projects: {response.status_code}")
        
        projects = response.json()
        # Find Core System project (is_core = true)
        for proj in projects:
            settings = proj.get("settings", {})
            if settings.get("is_core") == True:
                return proj.get("id")
        
        # If no core project, skip
        pytest.skip("No Core System project found")
    
    def test_patch_history_returns_history_array(self, auth_token, core_project_id):
        """GET /api/projects/:id/patch-history should return { history: [] }"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/projects/{core_project_id}/patch-history",
            headers=headers
        )
        
        assert response.status_code == 200, f"Patch history failed: {response.status_code} - {response.text[:200]}"
        
        data = response.json()
        assert "history" in data, f"Response missing 'history' key: {data}"
        assert isinstance(data["history"], list), f"'history' should be a list: {type(data['history'])}"
        
        print(f"✓ Patch history returned {len(data['history'])} snapshot(s)")
        
        # If there are snapshots, verify structure
        if len(data["history"]) > 0:
            snap = data["history"][0]
            assert "id" in snap, "Snapshot missing 'id'"
            assert "name" in snap, "Snapshot missing 'name'"
            assert "created_at" in snap, "Snapshot missing 'created_at'"
            assert "file_count" in snap, "Snapshot missing 'file_count'"
            print(f"✓ Snapshot structure verified: {snap.get('name')}")
    
    def test_patch_history_unauthorized(self):
        """GET /api/projects/:id/patch-history without auth should return 401"""
        # Use a fake project ID
        response = requests.get(f"{BASE_URL}/api/projects/fake-id/patch-history")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ Unauthorized request correctly rejected")


class TestFileDiffAPI:
    """File Diff endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        if response.status_code == 200:
            data = response.json()
            token = data.get("access_token") or data.get("token")
            if token:
                return token
        pytest.skip(f"Authentication failed: {response.status_code}")
    
    @pytest.fixture(scope="class")
    def core_project_id(self, auth_token):
        """Get Core System project ID"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/projects", headers=headers)
        if response.status_code != 200:
            pytest.skip(f"Failed to get projects: {response.status_code}")
        
        projects = response.json()
        for proj in projects:
            settings = proj.get("settings", {})
            if settings.get("is_core") == True:
                return proj.get("id")
        pytest.skip("No Core System project found")
    
    def test_file_diff_returns_original_content(self, auth_token, core_project_id):
        """GET /api/projects/:id/file-diff?path=... should return original file content"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        # Test with a known file path
        test_path = "lib/ai/prompt-builder.js"
        response = requests.get(
            f"{BASE_URL}/api/projects/{core_project_id}/file-diff?path={test_path}",
            headers=headers
        )
        
        assert response.status_code == 200, f"File diff failed: {response.status_code}"
        
        data = response.json()
        assert "path" in data, f"Response missing 'path': {data}"
        assert data["path"] == test_path, f"Path mismatch: {data['path']}"
        # original can be null if file doesn't exist on disk
        print(f"✓ File diff returned for {test_path}, original exists: {data.get('original') is not None}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
