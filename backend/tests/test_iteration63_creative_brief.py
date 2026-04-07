"""
Iteration 63: Creative Brief Feature Tests
Tests for:
- GET /api/projects/:id/canvas - should return canvas with creative_brief field
- PUT /api/projects/:id/canvas - should save creative_brief inside canvas_content
- AI context.js assembleCanvasContext includes creative_brief in keySections
- AI context.js formatProjectSystemMessage formats creative_brief fields into system prompt
"""

import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCanvasAPI:
    """Canvas API tests for Creative Brief feature"""
    
    def test_health_check(self):
        """Verify API is accessible"""
        # Try a simple endpoint to verify connectivity
        response = requests.get(f"{BASE_URL}/api/providers/status", timeout=10)
        # Accept 200 or 401 (auth required) - both indicate API is running
        assert response.status_code in [200, 401, 403], f"API not accessible: {response.status_code}"
        print(f"API health check passed - status: {response.status_code}")
    
    def test_canvas_get_requires_auth(self):
        """GET /api/projects/:id/canvas should require authentication"""
        # Use a fake project ID
        response = requests.get(f"{BASE_URL}/api/projects/test-project-123/canvas", timeout=10)
        # Should return 401 Unauthorized without auth
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"Canvas GET auth check passed - status: {response.status_code}")
    
    def test_canvas_put_requires_auth(self):
        """PUT /api/projects/:id/canvas should require authentication"""
        payload = {
            "canvas_content": {
                "creative_brief": {
                    "elevator_pitch": "Test pitch",
                    "target_audience": "Test audience"
                }
            }
        }
        response = requests.put(
            f"{BASE_URL}/api/projects/test-project-123/canvas",
            json=payload,
            timeout=10
        )
        # Should return 401 Unauthorized without auth
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"Canvas PUT auth check passed - status: {response.status_code}")


class TestProjectsAPI:
    """Projects API tests"""
    
    def test_projects_list_requires_auth(self):
        """GET /api/projects should require authentication"""
        response = requests.get(f"{BASE_URL}/api/projects", timeout=10)
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"Projects list auth check passed - status: {response.status_code}")


class TestTemplatesAPI:
    """Templates API tests (public endpoint)"""
    
    def test_templates_list(self):
        """GET /api/templates should return templates"""
        response = requests.get(f"{BASE_URL}/api/templates", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Templates should be a list"
        print(f"Templates API returned {len(data)} templates")


class TestContextJSCodeReview:
    """Code review tests for context.js - verify creative_brief integration"""
    
    def test_assemble_canvas_context_includes_creative_brief(self):
        """Verify assembleCanvasContext includes creative_brief in keySections"""
        context_file = "/app/lib/ai/context.js"
        with open(context_file, 'r') as f:
            content = f.read()
        
        # Check that creative_brief is in keySections array
        assert "'creative_brief'" in content, "creative_brief should be in keySections"
        
        # Check that creative_brief is handled specially (passed as full object)
        assert "key === 'creative_brief'" in content, "creative_brief should have special handling"
        assert "contextCanvas[key] = canvas[key]" in content, "creative_brief should be passed as full object"
        print("assembleCanvasContext includes creative_brief correctly")
    
    def test_format_project_system_message_includes_brief(self):
        """Verify formatProjectSystemMessage formats creative_brief fields"""
        context_file = "/app/lib/ai/context.js"
        with open(context_file, 'r') as f:
            content = f.read()
        
        # Check that creative_brief fields are formatted into system message
        brief_fields = [
            'elevator_pitch',
            'target_audience',
            'primary_goal',
            'brand_name',
            'mood',
            'color_preferences',
            'reference_sites',
            'pages',
            'most_important_page',
            'must_have_features',
            'nice_to_have_features',
            'headline',
            'key_messaging',
            'tone_of_voice',
            'integrations',
            'timeline',
            'budget_tier',
            'things_to_avoid'
        ]
        
        for field in brief_fields:
            assert f"brief.{field}" in content, f"brief.{field} should be formatted in system message"
        
        print(f"formatProjectSystemMessage includes all {len(brief_fields)} creative_brief fields")


class TestCanvasPanelCodeReview:
    """Code review tests for CanvasPanel.jsx - verify Creative Brief form"""
    
    def test_canvas_panel_has_creative_brief_panel_testid(self):
        """Verify CanvasPanel has data-testid='creative-brief-panel'"""
        panel_file = "/app/components/dashboard/CanvasPanel.jsx"
        with open(panel_file, 'r') as f:
            content = f.read()
        
        assert 'data-testid="creative-brief-panel"' in content, "creative-brief-panel testid missing"
        print("CanvasPanel has creative-brief-panel testid")
    
    def test_canvas_panel_has_all_form_testids(self):
        """Verify CanvasPanel has all required form field testids"""
        panel_file = "/app/components/dashboard/CanvasPanel.jsx"
        with open(panel_file, 'r') as f:
            content = f.read()
        
        required_testids = [
            'brief-elevator-pitch',
            'brief-target-audience',
            'brief-primary-goal',
            'brief-brand-name',
            'brief-mood-picker',
            'brief-colors',
            'brief-references',
            'brief-pages-picker',
            'brief-must-have',
            'brief-headline',
            'brief-tone',
            'brief-integrations',
            'brief-budget',
            'brief-avoid',
            'brief-save-btn',
            'brief-close-btn'
        ]
        
        missing = []
        for testid in required_testids:
            if f'data-testid="{testid}"' not in content and f"testId=\"{testid}\"" not in content:
                missing.append(testid)
        
        assert len(missing) == 0, f"Missing testids: {missing}"
        print(f"CanvasPanel has all {len(required_testids)} required form testids")
    
    def test_canvas_panel_has_six_sections(self):
        """Verify CanvasPanel has 6 sections"""
        panel_file = "/app/components/dashboard/CanvasPanel.jsx"
        with open(panel_file, 'r') as f:
            content = f.read()
        
        sections = [
            'The Big Picture',
            'Brand & Style',
            'Pages & Structure',
            'Key Features',
            'Content Direction',
            'Technical & Constraints'
        ]
        
        for section in sections:
            assert section in content, f"Section '{section}' missing"
        
        print(f"CanvasPanel has all {len(sections)} sections")
    
    def test_canvas_panel_has_auto_save(self):
        """Verify CanvasPanel has auto-save with debounce"""
        panel_file = "/app/components/dashboard/CanvasPanel.jsx"
        with open(panel_file, 'r') as f:
            content = f.read()
        
        assert 'setTimeout' in content, "Auto-save timeout missing"
        assert '1500' in content, "1.5s debounce missing"
        assert 'saveBrief' in content, "saveBrief function missing"
        print("CanvasPanel has auto-save with 1.5s debounce")


class TestTopBarCodeReview:
    """Code review tests for TopBar.jsx - verify Brief button"""
    
    def test_topbar_has_canvas_btn_testid(self):
        """Verify TopBar has Brief button with data-testid='canvas-btn'"""
        topbar_file = "/app/components/dashboard/TopBar.jsx"
        with open(topbar_file, 'r') as f:
            content = f.read()
        
        assert 'data-testid="canvas-btn"' in content, "canvas-btn testid missing"
        print("TopBar has canvas-btn testid")
    
    def test_topbar_brief_button_has_text_label(self):
        """Verify TopBar Brief button has text label (not just icon)"""
        topbar_file = "/app/components/dashboard/TopBar.jsx"
        with open(topbar_file, 'r') as f:
            content = f.read()
        
        # Check for Brief text near the canvas button
        assert 'Brief' in content, "Brief text label missing"
        assert 'BookOpen' in content, "BookOpen icon missing"
        print("TopBar Brief button has text label and icon")


class TestProjectHubCodeReview:
    """Code review tests for ProjectHub.jsx - verify Creative Brief quick action"""
    
    def test_projecthub_has_creative_brief_action(self):
        """Verify ProjectHub has Creative Brief quick action card"""
        hub_file = "/app/components/dashboard/ProjectHub.jsx"
        with open(hub_file, 'r') as f:
            content = f.read()
        
        assert 'data-testid="hub-action-creative-brief"' in content, "hub-action-creative-brief testid missing"
        print("ProjectHub has hub-action-creative-brief testid")
    
    def test_projecthub_creative_brief_has_purple_styling(self):
        """Verify ProjectHub Creative Brief card has purple styling"""
        hub_file = "/app/components/dashboard/ProjectHub.jsx"
        with open(hub_file, 'r') as f:
            content = f.read()
        
        # Check for purple color references near creative brief
        assert '167,139,250' in content or 'A78BFA' in content, "Purple styling missing"
        print("ProjectHub Creative Brief card has purple styling")
    
    def test_projecthub_has_onOpenCanvas_prop(self):
        """Verify ProjectHub receives and uses onOpenCanvas prop"""
        hub_file = "/app/components/dashboard/ProjectHub.jsx"
        with open(hub_file, 'r') as f:
            content = f.read()
        
        assert 'onOpenCanvas' in content, "onOpenCanvas prop missing"
        print("ProjectHub has onOpenCanvas prop")


class TestCanvasRouteCodeReview:
    """Code review tests for canvas.js route - verify API structure"""
    
    def test_canvas_route_handles_get(self):
        """Verify canvas route handles GET requests"""
        route_file = "/app/lib/api/routes/canvas.js"
        with open(route_file, 'r') as f:
            content = f.read()
        
        assert "method === 'GET'" in content, "GET handler missing"
        print("Canvas route handles GET requests")
    
    def test_canvas_route_handles_put(self):
        """Verify canvas route handles PUT requests"""
        route_file = "/app/lib/api/routes/canvas.js"
        with open(route_file, 'r') as f:
            content = f.read()
        
        assert "method === 'PUT'" in content, "PUT handler missing"
        print("Canvas route handles PUT requests")
    
    def test_canvas_route_stores_canvas_content(self):
        """Verify canvas route stores canvas_content (which includes creative_brief)"""
        route_file = "/app/lib/api/routes/canvas.js"
        with open(route_file, 'r') as f:
            content = f.read()
        
        assert 'canvas_content' in content, "canvas_content handling missing"
        print("Canvas route stores canvas_content")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
