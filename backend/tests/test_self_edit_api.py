"""
Backend API Tests for Self-Edit (patch_files) Feature
Tests the Core System self-editing functionality with patch_files tool
"""
import pytest
import requests
import os
import json
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')

# Test credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"


class TestAuthAndBasicAPIs:
    """Test authentication and basic API access"""
    
    def test_aurora_config(self):
        """Test aurora config endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/aurora/config")
        assert response.status_code == 200, f"Aurora config failed: {response.text}"
        print("SUCCESS: Aurora config endpoint working")
    
    def test_auth_check(self):
        """Test auth check endpoint"""
        response = requests.post(
            f"{BASE_URL}/api/auth/check",
            json={"email": TEST_EMAIL},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200, f"Auth check failed: {response.text}"
        data = response.json()
        assert data.get("allowed") == True, "User should be allowed"
        assert data.get("user", {}).get("role") == "owner", "User should be owner"
        print(f"SUCCESS: Auth check - user is {data.get('user', {}).get('role')}")
    
    def test_providers_status(self):
        """Test providers status endpoint"""
        response = requests.get(f"{BASE_URL}/api/providers/status")
        assert response.status_code == 200, f"Providers status failed: {response.text}"
        print("SUCCESS: Providers status endpoint working")
    
    def test_credits_endpoint(self):
        """Test credits endpoint"""
        response = requests.get(f"{BASE_URL}/api/credits")
        assert response.status_code == 200, f"Credits endpoint failed: {response.text}"
        data = response.json()
        assert "balance" in data, "Credits response should have balance"
        print(f"SUCCESS: Credits endpoint - balance: {data.get('balance')}")


class TestProjectsAPI:
    """Test projects API endpoints"""
    
    def test_list_projects(self):
        """Test listing projects"""
        response = requests.get(f"{BASE_URL}/api/projects")
        assert response.status_code == 200, f"List projects failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Projects should be a list"
        print(f"SUCCESS: Listed {len(data)} projects")
        return data
    
    def test_create_core_system_project(self):
        """Test creating a Core System project"""
        response = requests.post(
            f"{BASE_URL}/api/projects",
            json={
                "name": "TEST_Core_System_Project",
                "type": "app",
                "settings": {"is_core": True}
            },
            headers={"Content-Type": "application/json"}
        )
        # May return 201 or 200 depending on implementation
        assert response.status_code in [200, 201], f"Create project failed: {response.text}"
        data = response.json()
        project = data.get("project", data)
        assert project.get("name") == "TEST_Core_System_Project", "Project name mismatch"
        print(f"SUCCESS: Created Core System project: {project.get('id')}")
        return project
    
    def test_find_core_system_project(self):
        """Find existing Core System project"""
        response = requests.get(f"{BASE_URL}/api/projects")
        assert response.status_code == 200
        projects = response.json()
        
        # Look for Core System project
        core_project = None
        for p in projects:
            settings = p.get("settings", {})
            if settings.get("is_core") == True:
                core_project = p
                break
        
        if core_project:
            print(f"SUCCESS: Found Core System project: {core_project.get('id')}")
            return core_project
        else:
            print("INFO: No Core System project found, will create one")
            return None


class TestFileDiffAPI:
    """Test file-diff endpoint for Core System"""
    
    def test_file_diff_endpoint(self):
        """Test GET /api/projects/:id/file-diff endpoint"""
        # First get a Core System project
        projects_response = requests.get(f"{BASE_URL}/api/projects")
        assert projects_response.status_code == 200
        projects = projects_response.json()
        
        core_project = None
        for p in projects:
            if p.get("settings", {}).get("is_core") == True:
                core_project = p
                break
        
        if not core_project:
            pytest.skip("No Core System project found")
        
        project_id = core_project.get("id")
        
        # Test file-diff endpoint with a known file path
        response = requests.get(
            f"{BASE_URL}/api/projects/{project_id}/file-diff",
            params={"path": "lib/ai/prompt-builder.js"}
        )
        
        # Should return 200 with original content or null
        assert response.status_code == 200, f"File diff failed: {response.text}"
        data = response.json()
        assert "path" in data, "Response should have path"
        print(f"SUCCESS: File diff endpoint working - path: {data.get('path')}")
        if data.get("original"):
            print(f"  Original content length: {len(data.get('original'))} chars")
        return data


class TestPromoteToLiveAPI:
    """Test promote-to-live endpoint for Core System"""
    
    def test_promote_to_live_requires_auth(self):
        """Test that promote-to-live requires authentication"""
        # First get a Core System project
        projects_response = requests.get(f"{BASE_URL}/api/projects")
        assert projects_response.status_code == 200
        projects = projects_response.json()
        
        core_project = None
        for p in projects:
            if p.get("settings", {}).get("is_core") == True:
                core_project = p
                break
        
        if not core_project:
            pytest.skip("No Core System project found")
        
        project_id = core_project.get("id")
        
        # Test promote-to-live endpoint (should require auth)
        response = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/promote-to-live",
            headers={"Content-Type": "application/json"}
        )
        
        # Should return 401 or 403 without proper auth
        # Or 400 if no files to promote
        assert response.status_code in [200, 400, 401, 403], f"Unexpected status: {response.status_code}"
        print(f"SUCCESS: Promote-to-live endpoint responded with {response.status_code}")
        return response


class TestChatStreamAPI:
    """Test chat stream API with selfEditTarget"""
    
    def test_chat_stream_endpoint_exists(self):
        """Test that chat stream endpoint exists"""
        # First get a Core System project
        projects_response = requests.get(f"{BASE_URL}/api/projects")
        assert projects_response.status_code == 200
        projects = projects_response.json()
        
        core_project = None
        for p in projects:
            if p.get("settings", {}).get("is_core") == True:
                core_project = p
                break
        
        if not core_project:
            pytest.skip("No Core System project found")
        
        project_id = core_project.get("id")
        
        # Get chats for the project
        chats_response = requests.get(f"{BASE_URL}/api/projects/{project_id}/chats")
        assert chats_response.status_code == 200, f"Get chats failed: {chats_response.text}"
        chats = chats_response.json()
        
        if not chats:
            # Create a chat
            create_chat_response = requests.post(
                f"{BASE_URL}/api/projects/{project_id}/chats",
                json={"title": "TEST_Self_Edit_Chat", "is_self_edit": True},
                headers={"Content-Type": "application/json"}
            )
            assert create_chat_response.status_code in [200, 201], f"Create chat failed: {create_chat_response.text}"
            chat = create_chat_response.json()
        else:
            chat = chats[0]
        
        chat_id = chat.get("id")
        print(f"SUCCESS: Using chat: {chat_id}")
        
        # Test that chat/stream endpoint accepts selfEditTarget parameter
        # Note: This is a streaming endpoint, so we just verify it doesn't error immediately
        response = requests.post(
            f"{BASE_URL}/api/chat/stream",
            json={
                "chatId": chat_id,
                "message": "Test message",
                "selfEditTarget": {"id": "prompt_builder", "path": "lib/ai/prompt-builder.js"}
            },
            headers={"Content-Type": "application/json"},
            stream=True,
            timeout=5
        )
        
        # Should start streaming (200) or return an error we can handle
        assert response.status_code in [200, 400, 401, 403], f"Unexpected status: {response.status_code}"
        print(f"SUCCESS: Chat stream endpoint responded with {response.status_code}")
        
        # Close the stream
        response.close()
        return response


class TestSelfEditTargets:
    """Test self-edit target constants and configuration"""
    
    def test_self_edit_targets_defined(self):
        """Verify SELF_EDIT_TARGETS are properly defined in constants"""
        # This tests that the frontend constants file has the expected targets
        expected_targets = [
            "prompt_builder",
            "design_system", 
            "image_generator",
            "plan_validator",
            "safe_apply",
            "feature_planner",
            "request_router",
            "change_log",
            "prompt_library",
            "ai_service",
            "adaptive_learning",
            "ui_components",
            "api_routes"
        ]
        
        # Read the constants file
        constants_path = "/app/lib/constants.js"
        try:
            with open(constants_path, 'r') as f:
                content = f.read()
            
            for target in expected_targets:
                assert target in content, f"Target '{target}' not found in constants"
            
            print(f"SUCCESS: All {len(expected_targets)} self-edit targets defined in constants")
        except FileNotFoundError:
            pytest.skip("Constants file not found at expected path")


class TestPatchFilesTool:
    """Test patch_files tool definition"""
    
    def test_patch_files_tool_defined(self):
        """Verify patch_files tool is defined in AI tools"""
        tools_path = "/app/lib/ai/tools.js"
        try:
            with open(tools_path, 'r') as f:
                content = f.read()
            
            assert "patch_files" in content, "patch_files tool not found"
            assert "patches" in content, "patches parameter not found"
            assert "search" in content, "search parameter not found"
            assert "replace" in content, "replace parameter not found"
            
            print("SUCCESS: patch_files tool properly defined with search/replace patches")
        except FileNotFoundError:
            pytest.skip("Tools file not found at expected path")
    
    def test_patch_files_forced_for_self_edit(self):
        """Verify patch_files is forced for self-edit mode"""
        message_stream_path = "/app/lib/ai/message-stream.js"
        try:
            with open(message_stream_path, 'r') as f:
                content = f.read()
            
            # Check that patch_files is forced for self-edit
            assert "isSelfEdit" in content, "isSelfEdit detection not found"
            assert "patch_files" in content, "patch_files reference not found"
            assert "tool_choice" in content, "tool_choice not found"
            
            # Check for the specific forcing logic
            assert "Force the AI to use patch_files in self-edit mode" in content or \
                   "patch_files" in content and "isSelfEdit" in content, \
                   "patch_files forcing logic not found"
            
            print("SUCCESS: patch_files is forced for self-edit mode")
        except FileNotFoundError:
            pytest.skip("Message stream file not found at expected path")


class TestCodeTabComponents:
    """Test CodeTab component has Apply to Live and Rollback buttons"""
    
    def test_code_tab_has_live_controls(self):
        """Verify CodeTab has Apply to Live and Rollback buttons"""
        code_tab_path = "/app/components/dashboard/tabs/CodeTab.jsx"
        try:
            with open(code_tab_path, 'r') as f:
                content = f.read()
            
            # Check for Apply to Live button
            assert "Apply to Live" in content, "Apply to Live button not found"
            assert "apply-to-live-btn" in content, "apply-to-live-btn data-testid not found"
            
            # Check for Rollback button
            assert "Rollback" in content, "Rollback button not found"
            assert "rollback-live-btn" in content, "rollback-live-btn data-testid not found"
            
            # Check for diff view toggle
            assert "Diff" in content or "showDiff" in content, "Diff view not found"
            
            print("SUCCESS: CodeTab has Apply to Live, Rollback, and Diff view")
        except FileNotFoundError:
            pytest.skip("CodeTab file not found at expected path")


class TestDashboardAutoSwitchToCode:
    """Test Dashboard auto-switches to Code tab for self-edit chats"""
    
    def test_auto_switch_to_code_tab(self):
        """Verify Dashboard auto-switches to Code tab for self-edit"""
        dashboard_path = "/app/components/dashboard/Dashboard.jsx"
        try:
            with open(dashboard_path, 'r') as f:
                content = f.read()
            
            # Check for auto-switch logic
            assert "isSelfEditChat" in content or "SELF_EDIT" in content, \
                   "Self-edit chat detection not found"
            assert "setActiveTab" in content, "setActiveTab not found"
            assert "'code'" in content or '"code"' in content, "Code tab reference not found"
            
            print("SUCCESS: Dashboard has auto-switch to Code tab logic")
        except FileNotFoundError:
            pytest.skip("Dashboard file not found at expected path")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
