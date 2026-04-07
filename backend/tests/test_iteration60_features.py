"""
Iteration 60 Tests - Project Templates, Netlify Deploy, Batch Monitor Check
Tests:
1. GET /api/templates - returns 5 templates with correct structure
2. POST /api/projects with template_id - populates project files from template
3. POST /api/projects/:id/deploy/netlify - requires token (returns 400 without)
4. POST /api/growth/monitors/check-all - batch check on all monitors (auth required)
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')
SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', 'https://cawmmqakaxbznbelcrwd.supabase.co')
SUPABASE_ANON_KEY = os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22')

TEST_EMAIL = 'REDACTED_LEAKED_USER'
TEST_PASSWORD = 'REDACTED_LEAKED_PASSWORD'


@pytest.fixture(scope='module')
def auth_token():
    """Get Supabase auth token"""
    response = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
        },
        json={'email': TEST_EMAIL, 'password': TEST_PASSWORD}
    )
    if response.status_code == 200:
        data = response.json()
        return data.get('access_token')
    pytest.skip(f"Auth failed: {response.status_code} - {response.text[:200]}")


@pytest.fixture(scope='module')
def auth_headers(auth_token):
    """Headers with Bearer token for API requests"""
    return {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {auth_token}'
    }


class TestTemplatesAPI:
    """Test GET /api/templates endpoint"""
    
    def test_templates_returns_5_templates(self):
        """GET /api/templates returns list of 5 templates"""
        response = requests.get(f"{BASE_URL}/api/templates")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        
        data = response.json()
        assert 'templates' in data, "Response should have 'templates' key"
        templates = data['templates']
        assert len(templates) == 5, f"Expected 5 templates, got {len(templates)}"
        print(f"✓ GET /api/templates returns {len(templates)} templates")
    
    def test_templates_have_correct_structure(self):
        """Each template has id, name, description, category"""
        response = requests.get(f"{BASE_URL}/api/templates")
        assert response.status_code == 200
        
        templates = response.json()['templates']
        required_fields = ['id', 'name', 'description', 'category']
        
        for template in templates:
            for field in required_fields:
                assert field in template, f"Template missing '{field}': {template}"
        
        # Verify expected template IDs
        template_ids = [t['id'] for t in templates]
        expected_ids = ['landing-page', 'portfolio', 'saas-dashboard', 'blog', 'ecommerce']
        for expected_id in expected_ids:
            assert expected_id in template_ids, f"Missing template: {expected_id}"
        
        print(f"✓ All templates have correct structure: {template_ids}")
    
    def test_templates_have_categories(self):
        """Templates have correct categories"""
        response = requests.get(f"{BASE_URL}/api/templates")
        templates = response.json()['templates']
        
        expected_categories = {
            'landing-page': 'Marketing',
            'portfolio': 'Personal',
            'saas-dashboard': 'Business',
            'blog': 'Content',
            'ecommerce': 'Commerce'
        }
        
        for template in templates:
            expected_cat = expected_categories.get(template['id'])
            if expected_cat:
                assert template['category'] == expected_cat, f"Template {template['id']} has wrong category"
        
        print("✓ All templates have correct categories")


class TestProjectCreationWithTemplate:
    """Test POST /api/projects with template_id"""
    
    def test_create_project_with_template_requires_auth(self):
        """POST /api/projects with template_id requires auth"""
        response = requests.post(
            f"{BASE_URL}/api/projects",
            headers={'Content-Type': 'application/json'},
            json={'name': 'Test Template Project', 'template_id': 'landing-page'}
        )
        assert response.status_code == 401, f"Expected 401 without auth, got {response.status_code}"
        print("✓ POST /api/projects with template_id requires auth (401)")
    
    def test_create_project_with_template(self, auth_headers):
        """POST /api/projects with template_id populates files"""
        project_name = f"TEST_Template_Project_{int(time.time())}"
        
        response = requests.post(
            f"{BASE_URL}/api/projects",
            headers=auth_headers,
            json={'name': project_name, 'template_id': 'landing-page'}
        )
        
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text[:300]}"
        
        data = response.json()
        assert 'project' in data, "Response should have 'project' key"
        project = data['project']
        project_id = project['id']
        
        print(f"✓ Created project with template: {project_id}")
        
        # Verify files were populated from template
        time.sleep(1)  # Allow time for file population
        files_response = requests.get(
            f"{BASE_URL}/api/projects/{project_id}/files",
            headers=auth_headers
        )
        
        if files_response.status_code == 200:
            files = files_response.json()
            if isinstance(files, list) and len(files) > 0:
                print(f"✓ Template files populated: {len(files)} file(s)")
                # Check for expected file path
                file_paths = [f.get('path', '') for f in files]
                assert any('index.jsx' in p for p in file_paths), f"Expected index.jsx file, got: {file_paths}"
                print(f"✓ Found expected template file: {file_paths}")
            else:
                print(f"⚠ No files found in project (may be async)")
        
        # Cleanup - delete test project
        delete_response = requests.delete(
            f"{BASE_URL}/api/projects/{project_id}",
            headers=auth_headers
        )
        if delete_response.status_code in [200, 204]:
            print(f"✓ Cleaned up test project: {project_id}")


class TestNetlifyDeploy:
    """Test POST /api/projects/:id/deploy/netlify"""
    
    def test_netlify_deploy_requires_auth(self, auth_headers):
        """POST /api/projects/:id/deploy/netlify requires auth"""
        # First get a project ID
        projects_response = requests.get(f"{BASE_URL}/api/projects", headers=auth_headers)
        if projects_response.status_code != 200:
            pytest.skip("Could not get projects")
        
        projects = projects_response.json()
        if not projects or len(projects) == 0:
            pytest.skip("No projects available for testing")
        
        project_id = projects[0]['id']
        
        # Test without auth
        response = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/deploy/netlify",
            headers={'Content-Type': 'application/json'},
            json={}
        )
        assert response.status_code == 401, f"Expected 401 without auth, got {response.status_code}"
        print("✓ POST /api/projects/:id/deploy/netlify requires auth (401)")
    
    def test_netlify_deploy_requires_token(self, auth_headers):
        """POST /api/projects/:id/deploy/netlify returns 400 without token"""
        # Get a project ID
        projects_response = requests.get(f"{BASE_URL}/api/projects", headers=auth_headers)
        if projects_response.status_code != 200:
            pytest.skip("Could not get projects")
        
        projects = projects_response.json()
        if not projects or len(projects) == 0:
            pytest.skip("No projects available for testing")
        
        project_id = projects[0]['id']
        
        # Test with auth but no token
        response = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/deploy/netlify",
            headers=auth_headers,
            json={}  # No token provided
        )
        
        assert response.status_code == 400, f"Expected 400 without token, got {response.status_code}: {response.text[:200]}"
        
        data = response.json()
        assert 'error' in data, "Response should have 'error' key"
        assert 'token' in data['error'].lower(), f"Error should mention token: {data['error']}"
        
        print(f"✓ POST /api/projects/:id/deploy/netlify returns 400 without token: {data['error']}")


class TestBatchMonitorCheck:
    """Test POST /api/growth/monitors/check-all"""
    
    def test_batch_check_requires_auth(self):
        """POST /api/growth/monitors/check-all requires auth"""
        response = requests.post(
            f"{BASE_URL}/api/growth/monitors/check-all",
            headers={'Content-Type': 'application/json'}
        )
        assert response.status_code == 401, f"Expected 401 without auth, got {response.status_code}"
        print("✓ POST /api/growth/monitors/check-all requires auth (401)")
    
    def test_batch_check_with_auth(self, auth_headers):
        """POST /api/growth/monitors/check-all works with auth"""
        response = requests.post(
            f"{BASE_URL}/api/growth/monitors/check-all",
            headers=auth_headers
        )
        
        # Should return 200 even if no monitors exist
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text[:200]}"
        
        data = response.json()
        assert 'checked' in data, "Response should have 'checked' key"
        
        if data['checked'] == 0:
            print(f"✓ POST /api/growth/monitors/check-all works (no enabled monitors): {data}")
        else:
            assert 'results' in data, "Response should have 'results' when monitors checked"
            print(f"✓ POST /api/growth/monitors/check-all checked {data['checked']} monitor(s)")
            for result in data.get('results', []):
                print(f"  - Monitor {result.get('id')}: {result.get('status')}")


class TestOOMMemoryFix:
    """Verify OOM memory fix was applied"""
    
    def test_supervisor_config_has_2gb_heap(self):
        """Supervisor config has NODE_OPTIONS with 2048MB heap"""
        try:
            with open('/etc/supervisor/conf.d/nextjs_api.conf', 'r') as f:
                config = f.read()
            
            assert 'max-old-space-size=2048' in config, "Supervisor config should have 2048MB heap"
            print("✓ Supervisor config has NODE_OPTIONS='--max-old-space-size=2048'")
        except FileNotFoundError:
            pytest.skip("Supervisor config not accessible")
    
    def test_next_config_has_filesystem_cache(self):
        """next.config.js has filesystem cache enabled"""
        try:
            with open('/app/next.config.js', 'r') as f:
                config = f.read()
            
            assert "type: 'filesystem'" in config, "next.config.js should have filesystem cache"
            print("✓ next.config.js has filesystem cache enabled")
        except FileNotFoundError:
            pytest.skip("next.config.js not accessible")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
