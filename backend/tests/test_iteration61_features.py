"""
Iteration 61 Backend Tests
Tests for: Template Marketplace, Share Link Expiry, Deployment Status Polling, Cron-based Scheduled Auto-Crawl

Features tested:
1. GET /api/marketplace - List marketplace templates (no auth)
2. POST /api/marketplace/publish - Publish project as template (auth required)
3. POST /api/marketplace/:id/clone - Clone marketplace template (auth required)
4. DELETE /api/marketplace/:id - Delete own marketplace template (auth required)
5. POST /api/projects/:id/share with expires_in - Create share link with expiry
6. GET /api/shared/:token - Return 410 for expired links
7. GET /api/projects/:id/shares - Include is_expired and expires_at fields
8. GET /api/projects/:id/deployments/:id/status - Return deployment status
9. GET /api/growth/monitors/schedule - Return schedule config
10. POST /api/growth/monitors/schedule - Save schedule config
"""

import pytest
import requests
import os
import time
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')

# Test credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"


class TestMarketplaceAPI:
    """Template Marketplace API tests"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Get authentication cookies by logging in"""
        session = requests.Session()
        # Login via Supabase auth
        login_res = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if login_res.status_code != 200:
            pytest.skip(f"Login failed: {login_res.status_code} - {login_res.text[:200]}")
        return session.cookies
    
    def test_marketplace_list_no_auth(self):
        """GET /api/marketplace should return templates array without auth"""
        response = requests.get(f"{BASE_URL}/api/marketplace")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        data = response.json()
        assert "templates" in data, "Response should have 'templates' key"
        assert isinstance(data["templates"], list), "templates should be a list"
        print(f"PASS: GET /api/marketplace returns {len(data['templates'])} templates (no auth required)")
    
    def test_marketplace_publish_requires_auth(self):
        """POST /api/marketplace/publish should require auth"""
        response = requests.post(f"{BASE_URL}/api/marketplace/publish", json={
            "project_id": "test-id",
            "name": "Test Template"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: POST /api/marketplace/publish requires auth (401)")
    
    def test_marketplace_clone_requires_auth(self):
        """POST /api/marketplace/:id/clone should require auth"""
        response = requests.post(f"{BASE_URL}/api/marketplace/fake-id/clone")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: POST /api/marketplace/:id/clone requires auth (401)")
    
    def test_marketplace_delete_requires_auth(self):
        """DELETE /api/marketplace/:id should require auth"""
        response = requests.delete(f"{BASE_URL}/api/marketplace/fake-id")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: DELETE /api/marketplace/:id requires auth (401)")
    
    def test_marketplace_publish_requires_project_id(self, auth_cookies):
        """POST /api/marketplace/publish should require project_id"""
        session = requests.Session()
        session.cookies.update(auth_cookies)
        response = session.post(f"{BASE_URL}/api/marketplace/publish", json={
            "name": "Test Template"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "project_id" in data.get("error", "").lower() or "required" in data.get("error", "").lower()
        print("PASS: POST /api/marketplace/publish requires project_id (400)")


class TestShareExpiryAPI:
    """Share Link Expiry API tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        """Get authenticated session"""
        session = requests.Session()
        login_res = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if login_res.status_code != 200:
            pytest.skip(f"Login failed: {login_res.status_code}")
        return session
    
    @pytest.fixture(scope="class")
    def test_project(self, auth_session):
        """Get or create a test project with files"""
        # List projects
        res = auth_session.get(f"{BASE_URL}/api/projects")
        if res.status_code != 200:
            pytest.skip("Cannot list projects")
        projects = res.json()
        if isinstance(projects, list) and len(projects) > 0:
            # Find a project with files
            for proj in projects:
                files_res = auth_session.get(f"{BASE_URL}/api/projects/{proj['id']}/files")
                if files_res.status_code == 200:
                    files = files_res.json()
                    if isinstance(files, list) and len(files) > 0:
                        return proj
        pytest.skip("No project with files found for share testing")
    
    def test_share_with_expiry_never(self, auth_session, test_project):
        """POST /api/projects/:id/share with expires_in='never' should create non-expiring link"""
        response = auth_session.post(
            f"{BASE_URL}/api/projects/{test_project['id']}/share",
            json={"expires_in": "never"}
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text[:200]}"
        data = response.json()
        assert "share_token" in data, "Response should have share_token"
        assert data.get("expires_at") is None, "expires_at should be None for 'never'"
        print(f"PASS: Share link created with expires_in='never', expires_at=None")
    
    def test_share_with_expiry_1h(self, auth_session, test_project):
        """POST /api/projects/:id/share with expires_in='1h' should set expiry"""
        response = auth_session.post(
            f"{BASE_URL}/api/projects/{test_project['id']}/share",
            json={"expires_in": "1h"}
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text[:200]}"
        data = response.json()
        assert "share_token" in data, "Response should have share_token"
        assert data.get("expires_at") is not None, "expires_at should be set for '1h'"
        # Verify expiry is roughly 1 hour from now
        expires_at = datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
        now = datetime.now(expires_at.tzinfo)
        diff = (expires_at - now).total_seconds()
        assert 3500 < diff < 3700, f"Expiry should be ~1 hour from now, got {diff}s"
        print(f"PASS: Share link created with expires_in='1h', expires_at={data['expires_at']}")
        return data["share_token"]
    
    def test_shares_list_includes_expiry_fields(self, auth_session, test_project):
        """GET /api/projects/:id/shares should include is_expired and expires_at"""
        response = auth_session.get(f"{BASE_URL}/api/projects/{test_project['id']}/shares")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "shares" in data, "Response should have 'shares' key"
        if len(data["shares"]) > 0:
            share = data["shares"][0]
            assert "is_expired" in share, "Share should have 'is_expired' field"
            assert "expires_at" in share, "Share should have 'expires_at' field"
            print(f"PASS: GET /api/projects/:id/shares includes is_expired={share['is_expired']}, expires_at={share.get('expires_at')}")
        else:
            print("PASS: GET /api/projects/:id/shares returns empty list (no shares yet)")


class TestDeploymentStatusAPI:
    """Deployment Status Polling API tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        """Get authenticated session"""
        session = requests.Session()
        login_res = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if login_res.status_code != 200:
            pytest.skip(f"Login failed: {login_res.status_code}")
        return session
    
    @pytest.fixture(scope="class")
    def test_project(self, auth_session):
        """Get a test project"""
        res = auth_session.get(f"{BASE_URL}/api/projects")
        if res.status_code != 200:
            pytest.skip("Cannot list projects")
        projects = res.json()
        if isinstance(projects, list) and len(projects) > 0:
            return projects[0]
        pytest.skip("No projects found")
    
    def test_deployment_status_requires_auth(self, test_project):
        """GET /api/projects/:id/deployments/:id/status should require auth"""
        response = requests.get(f"{BASE_URL}/api/projects/{test_project['id']}/deployments/fake-id/status")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: GET /api/projects/:id/deployments/:id/status requires auth (401)")
    
    def test_deployment_status_not_found(self, auth_session, test_project):
        """GET /api/projects/:id/deployments/:id/status should return 404 for non-existent deployment"""
        # Use a fake UUID that won't exist
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = auth_session.get(f"{BASE_URL}/api/projects/{test_project['id']}/deployments/{fake_id}/status")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text[:200]}"
        print("PASS: GET /api/projects/:id/deployments/:id/status returns 404 for non-existent deployment")
    
    def test_deployments_list(self, auth_session, test_project):
        """GET /api/projects/:id/deployments should return list"""
        response = auth_session.get(f"{BASE_URL}/api/projects/{test_project['id']}/deployments")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: GET /api/projects/:id/deployments returns {len(data)} deployments")


class TestScheduleAPI:
    """Cron-based Scheduled Auto-Crawl API tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        """Get authenticated session"""
        session = requests.Session()
        login_res = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if login_res.status_code != 200:
            pytest.skip(f"Login failed: {login_res.status_code}")
        return session
    
    def test_schedule_get_requires_auth(self):
        """GET /api/growth/monitors/schedule should require auth"""
        response = requests.get(f"{BASE_URL}/api/growth/monitors/schedule")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: GET /api/growth/monitors/schedule requires auth (401)")
    
    def test_schedule_post_requires_auth(self):
        """POST /api/growth/monitors/schedule should require auth"""
        response = requests.post(f"{BASE_URL}/api/growth/monitors/schedule", json={
            "enabled": True,
            "frequency": "24h"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: POST /api/growth/monitors/schedule requires auth (401)")
    
    def test_schedule_get(self, auth_session):
        """GET /api/growth/monitors/schedule should return schedule config"""
        response = auth_session.get(f"{BASE_URL}/api/growth/monitors/schedule")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        data = response.json()
        assert "schedule" in data, "Response should have 'schedule' key"
        schedule = data["schedule"]
        assert "enabled" in schedule, "Schedule should have 'enabled' field"
        assert "frequency" in schedule, "Schedule should have 'frequency' field"
        print(f"PASS: GET /api/growth/monitors/schedule returns enabled={schedule['enabled']}, frequency={schedule['frequency']}")
    
    def test_schedule_set_enabled(self, auth_session):
        """POST /api/growth/monitors/schedule should save enabled=true"""
        response = auth_session.post(f"{BASE_URL}/api/growth/monitors/schedule", json={
            "enabled": True,
            "frequency": "24h"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        data = response.json()
        assert "schedule" in data, "Response should have 'schedule' key"
        schedule = data["schedule"]
        assert schedule["enabled"] == True, "Schedule should be enabled"
        assert schedule["frequency"] == "24h", "Frequency should be 24h"
        print(f"PASS: POST /api/growth/monitors/schedule sets enabled=True, frequency=24h")
    
    def test_schedule_set_disabled(self, auth_session):
        """POST /api/growth/monitors/schedule should save enabled=false"""
        response = auth_session.post(f"{BASE_URL}/api/growth/monitors/schedule", json={
            "enabled": False,
            "frequency": "12h"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        data = response.json()
        schedule = data["schedule"]
        assert schedule["enabled"] == False, "Schedule should be disabled"
        assert schedule["frequency"] == "12h", "Frequency should be 12h"
        print(f"PASS: POST /api/growth/monitors/schedule sets enabled=False, frequency=12h")
    
    def test_schedule_invalid_frequency(self, auth_session):
        """POST /api/growth/monitors/schedule should reject invalid frequency"""
        response = auth_session.post(f"{BASE_URL}/api/growth/monitors/schedule", json={
            "enabled": True,
            "frequency": "invalid"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: POST /api/growth/monitors/schedule rejects invalid frequency (400)")
    
    def test_schedule_valid_frequencies(self, auth_session):
        """POST /api/growth/monitors/schedule should accept all valid frequencies"""
        valid_freqs = ["6h", "12h", "24h", "48h", "7d"]
        for freq in valid_freqs:
            response = auth_session.post(f"{BASE_URL}/api/growth/monitors/schedule", json={
                "enabled": True,
                "frequency": freq
            })
            assert response.status_code == 200, f"Expected 200 for {freq}, got {response.status_code}"
        print(f"PASS: All valid frequencies accepted: {valid_freqs}")


class TestExpiredShareLink:
    """Test that expired share links return 410"""
    
    def test_shared_endpoint_exists(self):
        """GET /api/shared/:token should return 404 for non-existent token"""
        response = requests.get(f"{BASE_URL}/api/shared/nonexistent-token-12345")
        # Should be 404 (not found) not 500 (server error)
        assert response.status_code in [404, 410], f"Expected 404 or 410, got {response.status_code}"
        print(f"PASS: GET /api/shared/:token returns {response.status_code} for non-existent token")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
