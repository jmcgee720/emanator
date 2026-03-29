"""
Test H7.6 - GitHub Repository Import API endpoints
Tests for:
- POST /api/import/github (GitHub import)
- POST /api/import/github/sync (Pull Latest)

Note: This is a Next.js app with Supabase auth. We can only test unauthenticated requests
to verify auth protection. Validation tests require browser-based auth which is tested via Playwright.
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestGitHubImportAuth:
    """Test authentication requirements for GitHub import endpoints"""
    
    def test_github_import_returns_401_without_auth(self):
        """POST /api/import/github should return 401 without authentication"""
        response = requests.post(
            f"{BASE_URL}/api/import/github",
            json={"pat": "ghp_test", "repo": "owner/repo", "branch": "main"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data)
        print(f"PASS: /api/import/github returns 401 without auth")
    
    def test_github_sync_returns_401_without_auth(self):
        """POST /api/import/github/sync should return 401 without authentication"""
        response = requests.post(
            f"{BASE_URL}/api/import/github/sync",
            json={"project_id": "test123", "pat": "ghp_test"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        assert "error" in data or "Unauthorized" in str(data)
        print(f"PASS: /api/import/github/sync returns 401 without auth")
    
    def test_github_import_with_empty_body(self):
        """POST /api/import/github should return 401 even with empty body"""
        response = requests.post(
            f"{BASE_URL}/api/import/github",
            json={},
            headers={"Content-Type": "application/json"}
        )
        # Should return 401 (auth check happens before validation)
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print(f"PASS: /api/import/github returns 401 with empty body (auth first)")
    
    def test_github_sync_with_empty_body(self):
        """POST /api/import/github/sync should return 401 even with empty body"""
        response = requests.post(
            f"{BASE_URL}/api/import/github/sync",
            json={},
            headers={"Content-Type": "application/json"}
        )
        # Should return 401 (auth check happens before validation)
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print(f"PASS: /api/import/github/sync returns 401 with empty body (auth first)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
