"""
Iteration 62 Tests: 25 Templates, Marketplace Reviews, Template Flow
Tests:
- GET /api/marketplace - returns empty templates array
- POST /api/marketplace/publish - creates marketplace template (needs auth)
- POST /api/marketplace/:id/reviews - adds rating/review (needs auth)
- GET /api/marketplace/:id/reviews - returns reviews for a template
- GET /api/templates - returns 25 templates organized by category
- POST /api/projects - creates project from template with files populated
- POST /api/projects/:id/share - share with expiry
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = 'https://syntax-error-patch.preview.emergentagent.com'


class TestMarketplaceAPI:
    """Marketplace endpoint tests"""

    def test_marketplace_list_no_auth(self):
        """GET /api/marketplace returns empty templates array (no auth required)"""
        response = requests.get(f"{BASE_URL}/api/marketplace")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert 'templates' in data, "Response should have 'templates' key"
        assert isinstance(data['templates'], list), "templates should be a list"
        print(f"PASS: GET /api/marketplace returns {len(data['templates'])} templates")

    def test_marketplace_publish_requires_auth(self):
        """POST /api/marketplace/publish requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/marketplace/publish",
            json={"project_id": "test-id", "name": "Test Template"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: POST /api/marketplace/publish returns 401 Unauthorized")

    def test_marketplace_reviews_post_requires_auth(self):
        """POST /api/marketplace/:id/reviews requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/marketplace/fake-template-id/reviews",
            json={"rating": 5, "comment": "Great template!"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: POST /api/marketplace/:id/reviews returns 401 Unauthorized")

    def test_marketplace_reviews_get_no_auth(self):
        """GET /api/marketplace/:id/reviews returns empty reviews (no auth required)"""
        response = requests.get(f"{BASE_URL}/api/marketplace/fake-template-id/reviews")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert 'reviews' in data, "Response should have 'reviews' key"
        assert isinstance(data['reviews'], list), "reviews should be a list"
        print(f"PASS: GET /api/marketplace/:id/reviews returns {len(data['reviews'])} reviews")

    def test_marketplace_clone_requires_auth(self):
        """POST /api/marketplace/:id/clone requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/marketplace/fake-template-id/clone",
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: POST /api/marketplace/:id/clone returns 401 Unauthorized")

    def test_marketplace_delete_requires_auth(self):
        """DELETE /api/marketplace/:id requires authentication"""
        response = requests.delete(f"{BASE_URL}/api/marketplace/fake-template-id")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: DELETE /api/marketplace/:id returns 401 Unauthorized")


class TestTemplatesAPI:
    """Templates listing endpoint tests"""

    def test_templates_list(self):
        """GET /api/templates returns 25 templates organized by category"""
        response = requests.get(f"{BASE_URL}/api/templates")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert 'templates' in data, "Response should have 'templates' key"
        templates = data['templates']
        assert isinstance(templates, list), "templates should be a list"
        
        # Verify we have 25 templates
        assert len(templates) == 25, f"Expected 25 templates, got {len(templates)}"
        
        # Verify categories
        categories = set(t.get('category') for t in templates)
        expected_categories = {'Marketing', 'Business', 'Personal', 'Content', 'Commerce'}
        assert categories == expected_categories, f"Expected categories {expected_categories}, got {categories}"
        
        # Verify 5 templates per category
        for cat in expected_categories:
            cat_count = len([t for t in templates if t.get('category') == cat])
            assert cat_count == 5, f"Expected 5 templates in {cat}, got {cat_count}"
        
        # Verify template structure
        for t in templates:
            assert 'id' in t, "Template should have 'id'"
            assert 'name' in t, "Template should have 'name'"
            assert 'description' in t, "Template should have 'description'"
            assert 'category' in t, "Template should have 'category'"
            assert 'file_count' in t, "Template should have 'file_count'"
            assert t['file_count'] > 0, f"Template {t['id']} should have at least 1 file"
        
        print(f"PASS: GET /api/templates returns {len(templates)} templates with correct categories")
        print(f"  Categories: {categories}")
        print(f"  Template IDs: {[t['id'] for t in templates]}")


class TestShareExpiryAPI:
    """Share link expiry endpoint tests"""

    def test_share_requires_auth(self):
        """POST /api/projects/:id/share requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/projects/fake-project-id/share",
            json={"expires_in": "24h"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: POST /api/projects/:id/share returns 401 Unauthorized")

    def test_shared_token_not_found(self):
        """GET /api/shared/:token returns 404 for non-existent token"""
        response = requests.get(f"{BASE_URL}/api/shared/nonexistent-token-12345")
        assert response.status_code in [404, 410], f"Expected 404 or 410, got {response.status_code}: {response.text}"
        print(f"PASS: GET /api/shared/:token returns {response.status_code} for non-existent token")


class TestDeploymentStatusAPI:
    """Deployment status polling endpoint tests"""

    def test_deployment_status_requires_auth(self):
        """GET /api/projects/:id/deployments/:id/status requires authentication"""
        response = requests.get(
            f"{BASE_URL}/api/projects/fake-project-id/deployments/fake-deploy-id/status?token=fake-token"
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: GET /api/projects/:id/deployments/:id/status returns 401 Unauthorized")


class TestScheduleAPI:
    """Auto-crawl schedule endpoint tests"""

    def test_schedule_get_requires_auth(self):
        """GET /api/growth/monitors/schedule requires authentication"""
        response = requests.get(f"{BASE_URL}/api/growth/monitors/schedule")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: GET /api/growth/monitors/schedule returns 401 Unauthorized")

    def test_schedule_post_requires_auth(self):
        """POST /api/growth/monitors/schedule requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/growth/monitors/schedule",
            json={"enabled": True, "frequency": "24h"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: POST /api/growth/monitors/schedule returns 401 Unauthorized")


class TestProjectCreationWithTemplate:
    """Project creation with template tests"""

    def test_project_creation_requires_auth(self):
        """POST /api/projects requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/projects",
            json={"name": "Test Project", "template_id": "saas-landing"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: POST /api/projects returns 401 Unauthorized")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
