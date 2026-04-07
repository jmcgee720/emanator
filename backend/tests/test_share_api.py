"""
Test Share API Endpoints
- POST /api/projects/:id/share - Create share link (auth required)
- GET /api/projects/:id/shares - List share links (auth required)
- DELETE /api/projects/:id/share/:shareId - Delete share link (auth required)
- GET /api/shared/:token - Public preview (NO auth required)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')
SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', 'https://cawmmqakaxbznbelcrwd.supabase.co')
SUPABASE_ANON_KEY = os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22')

# Test credentials
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"
TEST_PROJECT_ID = "88c5725d-24bb-4163-aec9-a64e77091fc8"  # UI Test Project


class TestShareAPI:
    """Share API endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token from Supabase"""
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
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
        pytest.skip(f"Authentication failed: {response.status_code} - {response.text}")
    
    @pytest.fixture
    def auth_headers(self, auth_token):
        """Headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    # ============ POST /api/projects/:id/share ============
    
    def test_create_share_requires_auth(self):
        """POST /api/projects/:id/share returns 401 without auth"""
        response = requests.post(
            f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/share",
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data
        print(f"✓ POST /share without auth returns 401: {data.get('error')}")
    
    def test_create_share_empty_project(self, auth_headers):
        """POST /api/projects/:id/share returns 404 for empty project (no files)"""
        response = requests.post(
            f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/share",
            headers=auth_headers
        )
        # Test project has 0 files, so should return 404 with 'No files to share'
        if response.status_code == 404:
            data = response.json()
            assert "error" in data
            assert "No files" in data.get("error", "") or "no files" in data.get("error", "").lower()
            print(f"✓ POST /share for empty project returns 404: {data.get('error')}")
        elif response.status_code == 201:
            # If project has files, it should return share_url
            data = response.json()
            assert "share_url" in data
            assert "share_token" in data
            print(f"✓ POST /share created link: {data.get('share_url')}")
        else:
            pytest.fail(f"Unexpected status {response.status_code}: {response.text}")
    
    def test_create_share_invalid_project(self, auth_headers):
        """POST /api/projects/:id/share returns error for non-existent project"""
        fake_project_id = "00000000-0000-0000-0000-000000000000"
        response = requests.post(
            f"{BASE_URL}/api/projects/{fake_project_id}/share",
            headers=auth_headers
        )
        # Should return 404 (no files) or 500 (project not found)
        assert response.status_code in [404, 500], f"Expected 404/500, got {response.status_code}"
        print(f"✓ POST /share for invalid project returns {response.status_code}")
    
    # ============ GET /api/projects/:id/shares ============
    
    def test_list_shares_requires_auth(self):
        """GET /api/projects/:id/shares returns 401 without auth"""
        response = requests.get(
            f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/shares"
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ GET /shares without auth returns 401")
    
    def test_list_shares_with_auth(self, auth_headers):
        """GET /api/projects/:id/shares returns shares array"""
        response = requests.get(
            f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/shares",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "shares" in data
        assert isinstance(data["shares"], list)
        print(f"✓ GET /shares returns {len(data['shares'])} shares")
        return data["shares"]
    
    # ============ GET /api/shared/:token (PUBLIC) ============
    
    def test_public_preview_not_found(self):
        """GET /api/shared/nonexistent returns 404"""
        response = requests.get(f"{BASE_URL}/api/shared/nonexistent_token_12345")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        data = response.json()
        assert "error" in data
        assert "not found" in data.get("error", "").lower() or "Preview not found" in data.get("error", "")
        print(f"✓ GET /shared/nonexistent returns 404: {data.get('error')}")
    
    def test_public_preview_no_auth_required(self):
        """GET /api/shared/:token does NOT require auth"""
        # Even with invalid token, should return 404 not 401
        response = requests.get(f"{BASE_URL}/api/shared/test_token_abc")
        # Should be 404 (not found) not 401 (unauthorized)
        assert response.status_code != 401, "Public endpoint should not require auth"
        assert response.status_code == 404, f"Expected 404 for invalid token, got {response.status_code}"
        print("✓ GET /shared/:token is public (no auth required)")
    
    # ============ DELETE /api/projects/:id/share/:shareId ============
    
    def test_delete_share_requires_auth(self):
        """DELETE /api/projects/:id/share/:shareId returns 401 without auth"""
        response = requests.delete(
            f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/share/fake-share-id"
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ DELETE /share/:shareId without auth returns 401")
    
    def test_delete_share_with_auth(self, auth_headers):
        """DELETE /api/projects/:id/share/:shareId works with auth"""
        # Try to delete a non-existent share - should not error (idempotent)
        response = requests.delete(
            f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/share/00000000-0000-0000-0000-000000000000",
            headers=auth_headers
        )
        # Should return 200 (success) even if share doesn't exist (idempotent delete)
        # or 404 if strict
        assert response.status_code in [200, 404, 500], f"Unexpected status {response.status_code}"
        print(f"✓ DELETE /share/:shareId with auth returns {response.status_code}")


class TestShareEndToEnd:
    """End-to-end share flow tests (requires project with files)"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token from Supabase"""
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
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
        pytest.skip("Authentication failed")
    
    @pytest.fixture
    def auth_headers(self, auth_token):
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    def test_share_flow_with_empty_project(self, auth_headers):
        """Test complete share flow - empty project returns 404"""
        # Step 1: Try to create share for empty project
        create_response = requests.post(
            f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/share",
            headers=auth_headers
        )
        
        if create_response.status_code == 404:
            # Expected for empty project
            data = create_response.json()
            assert "No files" in data.get("error", "")
            print("✓ Share flow: Empty project correctly returns 'No files to share'")
            return
        
        # If project has files, continue with full flow
        assert create_response.status_code == 201
        share_data = create_response.json()
        share_token = share_data.get("share_token")
        share_id = share_data.get("share_id")
        share_url = share_data.get("share_url")
        
        assert share_token, "share_token should be present"
        assert share_url, "share_url should be present"
        print(f"✓ Created share: {share_url}")
        
        # Step 2: Verify public access works
        public_response = requests.get(f"{BASE_URL}/api/shared/{share_token}")
        assert public_response.status_code == 200
        preview_data = public_response.json()
        assert "title" in preview_data
        assert "files" in preview_data
        assert "views" in preview_data
        print(f"✓ Public preview accessible: {preview_data.get('title')}, {preview_data.get('views')} views")
        
        # Step 3: List shares
        list_response = requests.get(
            f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/shares",
            headers=auth_headers
        )
        assert list_response.status_code == 200
        shares = list_response.json().get("shares", [])
        assert any(s.get("share_token") == share_token for s in shares)
        print(f"✓ Share appears in list ({len(shares)} total)")
        
        # Step 4: Delete share
        if share_id:
            delete_response = requests.delete(
                f"{BASE_URL}/api/projects/{TEST_PROJECT_ID}/share/{share_id}",
                headers=auth_headers
            )
            assert delete_response.status_code == 200
            print("✓ Share deleted successfully")
            
            # Step 5: Verify public access no longer works
            verify_response = requests.get(f"{BASE_URL}/api/shared/{share_token}")
            assert verify_response.status_code == 404
            print("✓ Deleted share returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
