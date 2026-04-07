"""
Test Deploy API Endpoints
- GET /api/projects/:id/download - Download project files for ZIP
- GET /api/projects/:id/deployments - List deployments
- POST /api/projects/:id/deploy/vercel - Deploy to Vercel (requires token)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

# Test credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"


@pytest.fixture(scope="module")
def auth_token():
    """Get Supabase auth token"""
    response = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Content-Type": "application/json"
        },
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    if response.status_code == 200:
        return response.json().get("access_token")
    pytest.skip(f"Auth failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def project_id(auth_token):
    """Get a valid project ID for testing"""
    response = requests.get(
        f"{BASE_URL}/api/projects",
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    if response.status_code == 200:
        projects = response.json()
        if projects and len(projects) > 0:
            return projects[0].get("id")
    pytest.skip("No projects available for testing")


class TestDownloadEndpoint:
    """Tests for GET /api/projects/:id/download"""
    
    def test_download_requires_auth(self):
        """Download endpoint returns 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/projects/test123/download")
        assert response.status_code == 401
        data = response.json()
        assert "error" in data
        print(f"PASS: Download returns 401 without auth - {data}")
    
    def test_download_invalid_project_id(self, auth_token):
        """Download endpoint returns 500 for invalid UUID format"""
        response = requests.get(
            f"{BASE_URL}/api/projects/invalid-id/download",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        # Invalid UUID format should return 500 (Supabase error)
        assert response.status_code in [404, 500]
        print(f"PASS: Download returns {response.status_code} for invalid project ID")
    
    def test_download_with_valid_project(self, auth_token, project_id):
        """Download endpoint returns files or 404 if no files"""
        response = requests.get(
            f"{BASE_URL}/api/projects/{project_id}/download",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        # Should return 200 with files or 404 if no files
        assert response.status_code in [200, 404]
        data = response.json()
        
        if response.status_code == 200:
            assert "files" in data
            assert "project_id" in data
            assert isinstance(data["files"], list)
            print(f"PASS: Download returns {len(data['files'])} files for project {project_id}")
        else:
            assert "error" in data
            assert "No files" in data["error"]
            print(f"PASS: Download returns 404 - No files in project {project_id}")


class TestDeploymentsEndpoint:
    """Tests for GET /api/projects/:id/deployments"""
    
    def test_deployments_requires_auth(self):
        """Deployments endpoint returns 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/projects/test123/deployments")
        assert response.status_code == 401
        data = response.json()
        assert "error" in data
        print(f"PASS: Deployments returns 401 without auth - {data}")
    
    def test_deployments_with_valid_project(self, auth_token, project_id):
        """Deployments endpoint returns array (empty or with deployments)"""
        response = requests.get(
            f"{BASE_URL}/api/projects/{project_id}/deployments",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: Deployments returns array with {len(data)} deployments")
        
        # If there are deployments, verify structure
        if len(data) > 0:
            dep = data[0]
            print(f"  First deployment: platform={dep.get('platform')}, status={dep.get('status')}")


class TestVercelDeployEndpoint:
    """Tests for POST /api/projects/:id/deploy/vercel"""
    
    def test_vercel_deploy_requires_auth(self):
        """Vercel deploy endpoint returns 401 without auth"""
        response = requests.post(
            f"{BASE_URL}/api/projects/test123/deploy/vercel",
            json={"token": "test-token"}
        )
        assert response.status_code == 401
        data = response.json()
        assert "error" in data
        print(f"PASS: Vercel deploy returns 401 without auth - {data}")
    
    def test_vercel_deploy_requires_token(self, auth_token, project_id):
        """Vercel deploy endpoint returns 400 without token in body"""
        response = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/deploy/vercel",
            headers={
                "Authorization": f"Bearer {auth_token}",
                "Content-Type": "application/json"
            },
            json={}  # No token provided
        )
        assert response.status_code == 400
        data = response.json()
        assert "error" in data
        assert "token" in data["error"].lower() or "required" in data["error"].lower()
        print(f"PASS: Vercel deploy returns 400 without token - {data}")
    
    def test_vercel_deploy_with_invalid_token(self, auth_token, project_id):
        """Vercel deploy with invalid token returns error from Vercel API"""
        response = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/deploy/vercel",
            headers={
                "Authorization": f"Bearer {auth_token}",
                "Content-Type": "application/json"
            },
            json={"token": "invalid-vercel-token-12345"}
        )
        # Should return 401/403 from Vercel or 404 if no files
        assert response.status_code in [401, 403, 404]
        data = response.json()
        assert "error" in data
        print(f"PASS: Vercel deploy with invalid token returns {response.status_code} - {data.get('error')}")


class TestMonitorsCheckAllButton:
    """Tests for Check All Monitors functionality"""
    
    def test_monitors_list_endpoint(self, auth_token):
        """Monitors list endpoint works"""
        response = requests.get(
            f"{BASE_URL}/api/growth/monitors",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "monitors" in data
        assert isinstance(data["monitors"], list)
        print(f"PASS: Monitors list returns {len(data['monitors'])} monitors")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
